"use strict";

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { CALLABLE_OPTIONS } = require("../config");

function createSecurityRuntime(db) {
  async function enforceRateLimit(uid, action, maxPerMinute) {
    const bucket = Math.floor(Date.now() / 60000);
    const ref = db.doc(`rateLimits/${uid}_${action}_${bucket}`);
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const count = snap.exists ? Number(snap.data().count || 0) : 0;
      if (count >= maxPerMinute) {
        throw new HttpsError("resource-exhausted", "操作過於頻繁，請稍後再試。");
      }
      transaction.set(ref, {
        uid,
        action,
        bucket,
        count: count + 1,
        expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
      }, { merge: true });
    });
  }

  function callable(handler, optionOverrides = {}) {
    return onCall({ ...CALLABLE_OPTIONS, ...optionOverrides }, async (request) => {
      if (!request.auth?.uid) throw new HttpsError("unauthenticated", "請先登入。");
      try {
        await enforceRateLimit(request.auth.uid, handler.name || "callable", 30);
        return await handler(request);
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error("Callable failed", { handler: handler.name, error });
        throw new HttpsError("internal", "伺服器處理失敗。");
      }
    });
  }

  async function profileFor(uid) {
    const snap = await db.doc(`users/${uid}`).get();
    if (!snap.exists || snap.data().isActive === false) {
      throw new HttpsError("permission-denied", "帳號不存在或已停用。");
    }
    return { id: snap.id, ...snap.data() };
  }

  function reviewerCanAccess(reviewer, employee) {
    return reviewer.role === "admin"
      || (reviewer.role === "manager" && (
        employee.managerId === reviewer.id
        || (reviewer.department && reviewer.department === employee.department)
      ));
  }

  function requireAdmin(profile) {
    if (profile.role !== "admin") {
      throw new HttpsError("permission-denied", "只有管理員可以執行此操作。");
    }
  }

  function requireReviewer(reviewer, employee) {
    if (!reviewerCanAccess(reviewer, employee)) {
      throw new HttpsError("permission-denied", "你無權審核這位員工。");
    }
  }

  async function audit(action, actor, details = {}) {
    await db.collection("auditEvents").add({
      action,
      actorId: actor.id,
      actorName: actor.name || actor.email || "",
      department: details.department || actor.department || "",
      targetUserId: details.targetUserId || "",
      details,
      createdAt: FieldValue.serverTimestamp()
    });
  }

  function cleanText(value, max = 500) {
    return String(value || "").trim().slice(0, max);
  }

  function timestampDate(value) {
    if (!value) return null;
    if (value.toDate) return value.toDate();
    return new Date(value);
  }

  return {
    audit,
    callable,
    cleanText,
    profileFor,
    requireAdmin,
    requireReviewer,
    reviewerCanAccess,
    timestampDate
  };
}

module.exports = { createSecurityRuntime };
