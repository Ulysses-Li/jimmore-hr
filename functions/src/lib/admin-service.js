"use strict";

const { getAuth } = require("firebase-admin/auth");
const { FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { calculateHoursExcludingLunch } = require("../core");

const ROLES = new Set(["employee", "manager", "admin"]);
const REQUEST_COLLECTIONS = new Set(["leaveRequests", "overtimeRequests"]);
const REVIEW_STATUSES = new Set(["approved", "rejected"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function finiteNumber(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new HttpsError("invalid-argument", `${label}格式不正確。`);
  }
  return number;
}

function wholeHours(value) {
  const hours = finiteNumber(value, "時數", 0.01, 24 * 31);
  if (!Number.isInteger(hours)) {
    throw new HttpsError("failed-precondition", "請假時數必須為整數小時。");
  }
  return hours;
}

function assertTime(value, label) {
  if (!TIME_PATTERN.test(value)) {
    throw new HttpsError("invalid-argument", `${label}格式必須為 HH:mm。`);
  }
}

function timeMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function publicUserState(user) {
  if (!user) return null;
  return {
    name: user.name || "",
    department: user.department || "",
    role: user.role || "",
    managerId: user.managerId || "",
    proxyUserId: user.proxyUserId || "",
    defaultShiftId: user.defaultShiftId || "",
    annualLeaveHours: Number(user.annualLeaveHours || 0),
    compensatoryLeaveHours: Number(user.compensatoryLeaveHours || 0),
    isActive: user.isActive !== false
  };
}

function createAdminHandlers({ db, audit, cleanText, profileFor, requireAdmin, requireReviewer }) {
  async function relatedUserName(userId) {
    if (!userId) return "";
    const snap = await db.doc(`users/${userId}`).get();
    return snap.exists ? cleanText(snap.data().name || snap.data().email, 120) : "";
  }

  async function createEmployeeAccount(request) {
    const admin = await profileFor(request.auth.uid);
    requireAdmin(admin);
    const name = cleanText(request.data?.name, 120);
    const department = cleanText(request.data?.department, 120);
    const email = cleanText(request.data?.email, 320).toLowerCase();
    const password = String(request.data?.password || "");
    if (!name || !department || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "姓名、部門及有效 Email 都是必填欄位。");
    }
    if (password.length < 8) {
      throw new HttpsError("invalid-argument", "初始密碼至少需要 8 個字元。");
    }

    const auth = getAuth();
    let authUser;
    try {
      authUser = await auth.createUser({
        email,
        password,
        displayName: name,
        disabled: false,
        emailVerified: false
      });
      await auth.setCustomUserClaims(authUser.uid, { role: "employee", department });
      await db.doc(`users/${authUser.uid}`).set({
        name,
        email,
        department,
        role: "employee",
        annualLeaveHours: 56,
        compensatoryLeaveHours: 0,
        isActive: true,
        createdBy: admin.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } catch (error) {
      if (authUser?.uid) await auth.deleteUser(authUser.uid).catch(() => {});
      if (error?.code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "這個 Email 已經有人使用。");
      }
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "員工帳號建立失敗。");
    }
    await audit("employee.created", admin, {
      targetUserId: authUser.uid,
      department,
      email
    });
    return { userId: authUser.uid };
  }

  async function updateEmployee(request) {
    const admin = await profileFor(request.auth.uid);
    requireAdmin(admin);
    const userId = cleanText(request.data?.userId, 128);
    if (!userId) throw new HttpsError("invalid-argument", "缺少員工編號。");
    const employeeSnap = await db.doc(`users/${userId}`).get();
    if (!employeeSnap.exists) throw new HttpsError("not-found", "找不到員工資料。");
    const before = employeeSnap.data();
    const role = cleanText(request.data?.role, 20);
    const name = cleanText(request.data?.name, 120);
    const department = cleanText(request.data?.department, 120);
    if (!name || !department || !ROLES.has(role)) {
      throw new HttpsError("invalid-argument", "姓名、部門或角色設定不正確。");
    }
    const isActive = request.data?.isActive !== false;
    if (userId === admin.id && (!isActive || role !== "admin")) {
      throw new HttpsError("failed-precondition", "不能停用自己或移除自己的管理員權限。");
    }
    const managerId = cleanText(request.data?.managerId, 128);
    const proxyUserId = cleanText(request.data?.proxyUserId, 128);
    if (managerId === userId || proxyUserId === userId) {
      throw new HttpsError("invalid-argument", "員工不能設為自己的主管或代理人。");
    }
    const payload = {
      name,
      department,
      role,
      managerId,
      managerName: await relatedUserName(managerId),
      proxyUserId,
      proxyUserName: await relatedUserName(proxyUserId),
      defaultShiftId: cleanText(request.data?.defaultShiftId, 80),
      annualLeaveHours: finiteNumber(request.data?.annualLeaveHours, "特休時數", 0, 10000),
      compensatoryLeaveHours: finiteNumber(request.data?.compensatoryLeaveHours, "補休時數", 0, 10000),
      isActive,
      updatedBy: admin.id,
      updatedAt: FieldValue.serverTimestamp()
    };

    const auth = getAuth();
    const oldAuthUser = await auth.getUser(userId);
    try {
      await auth.updateUser(userId, { displayName: name, disabled: !isActive });
      await auth.setCustomUserClaims(userId, {
        ...(oldAuthUser.customClaims || {}),
        role,
        department
      });
      await employeeSnap.ref.set(payload, { merge: true });
    } catch (error) {
      await auth.updateUser(userId, {
        displayName: oldAuthUser.displayName || before.name || "",
        disabled: oldAuthUser.disabled
      }).catch(() => {});
      await auth.setCustomUserClaims(userId, oldAuthUser.customClaims || {}).catch(() => {});
      throw error;
    }
    await audit("employee.updated", admin, {
      targetUserId: userId,
      department,
      before: publicUserState(before),
      after: publicUserState({ ...before, ...payload })
    });
    return { success: true };
  }

  async function reviewHrRequest(request) {
    const reviewer = await profileFor(request.auth.uid);
    const collectionName = cleanText(request.data?.collectionName, 40);
    const requestId = cleanText(request.data?.requestId, 128);
    const status = cleanText(request.data?.status, 20);
    if (!REQUEST_COLLECTIONS.has(collectionName) || !requestId || !REVIEW_STATUSES.has(status)) {
      throw new HttpsError("invalid-argument", "審核資料不正確。");
    }
    const requestRef = db.doc(`${collectionName}/${requestId}`);
    const initialSnap = await requestRef.get();
    if (!initialSnap.exists) throw new HttpsError("not-found", "找不到申請單。");
    const employee = await profileFor(initialSnap.data().userId);
    requireReviewer(reviewer, employee);
    const settingsSnap = collectionName === "overtimeRequests"
      ? await db.doc("workSettings/default").get()
      : null;
    const workSettings = settingsSnap?.exists ? settingsSnap.data() : {};
    let adjustment = null;

    await db.runTransaction(async (transaction) => {
      const currentSnap = await transaction.get(requestRef);
      const userRef = db.doc(`users/${employee.id}`);
      const userSnap = await transaction.get(userRef);
      if (!currentSnap.exists || currentSnap.data().status !== "pending") {
        throw new HttpsError("failed-precondition", "申請單已處理，請重新整理。");
      }
      if (!userSnap.exists) throw new HttpsError("not-found", "找不到員工資料。");
      const data = currentSnap.data();
      let hours = finiteNumber(data.hours, "時數", 0.01, 24 * 31);
      if (collectionName === "overtimeRequests") {
        hours = calculateHoursExcludingLunch(data.startTime, data.endTime, workSettings);
        if (hours < 1) {
          throw new HttpsError("failed-precondition", "扣除午休後，加班時間必須至少 1 小時。");
        }
      }
      if (status === "approved" && collectionName === "leaveRequests") {
        wholeHours(hours);
        const field = data.leaveType === "annual"
          ? "annualLeaveHours"
          : data.leaveType === "compensatory"
            ? "compensatoryLeaveHours"
            : "";
        if (field) {
          const balance = Number(userSnap.data()[field] || 0);
          if (balance < hours) throw new HttpsError("failed-precondition", "員工假別餘額不足。");
          adjustment = { field, amount: -hours };
        }
      }
      if (status === "approved" && collectionName === "overtimeRequests" && data.convertToCompTime === true) {
        adjustment = { field: "compensatoryLeaveHours", amount: hours };
      }
      transaction.update(requestRef, {
        status,
        ...(collectionName === "overtimeRequests" ? {
          hours,
          lunchDeducted: true,
          hoursCalculation: "lunch_excluded"
        } : {}),
        approvedBy: reviewer.id,
        approvedByName: reviewer.name || reviewer.email || "",
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      if (adjustment) {
        transaction.update(userRef, {
          [adjustment.field]: FieldValue.increment(adjustment.amount),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    });
    await audit(`hr_request.${status}`, reviewer, {
      targetUserId: employee.id,
      department: employee.department,
      collectionName,
      requestId,
      adjustment
    });
    return { status };
  }

  async function recalculateOvertimeRequest(request) {
    const reviewer = await profileFor(request.auth.uid);
    const requestId = cleanText(request.data?.requestId, 128);
    if (!requestId) throw new HttpsError("invalid-argument", "請指定加班申請單。");

    const requestRef = db.doc(`overtimeRequests/${requestId}`);
    const initialSnap = await requestRef.get();
    if (!initialSnap.exists) throw new HttpsError("not-found", "找不到加班申請單。");
    const employee = await profileFor(initialSnap.data().userId);
    requireReviewer(reviewer, employee);
    const settingsSnap = await db.doc("workSettings/default").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    let result;

    await db.runTransaction(async (transaction) => {
      const overtimeSnap = await transaction.get(requestRef);
      const userRef = db.doc(`users/${employee.id}`);
      const userSnap = await transaction.get(userRef);
      if (!overtimeSnap.exists) throw new HttpsError("not-found", "找不到加班申請單。");
      if (!userSnap.exists) throw new HttpsError("not-found", "找不到員工資料。");
      const overtime = overtimeSnap.data();
      if (overtime.status !== "approved") {
        throw new HttpsError("failed-precondition", "只有已核准的加班單可以修正時數。");
      }

      const oldHours = finiteNumber(overtime.hours, "原加班時數", 0.01, 24 * 31);
      const newHours = calculateHoursExcludingLunch(overtime.startTime, overtime.endTime, settings);
      if (newHours < 1) {
        throw new HttpsError("failed-precondition", "扣除午休後，加班時間必須至少 1 小時。");
      }
      const balanceAdjustment = overtime.convertToCompTime === true
        ? Number((newHours - oldHours).toFixed(2))
        : 0;

      transaction.update(requestRef, {
        hours: newHours,
        lunchDeducted: true,
        hoursCalculation: "lunch_excluded",
        hoursRecalculatedBy: reviewer.id,
        hoursRecalculatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      if (balanceAdjustment) {
        transaction.update(userRef, {
          compensatoryLeaveHours: FieldValue.increment(balanceAdjustment),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      result = { oldHours, newHours, balanceAdjustment };
    });

    await audit("overtime.hours_recalculated", reviewer, {
      targetUserId: employee.id,
      department: employee.department,
      requestId,
      ...result
    });
    return result;
  }

  async function voidApprovedLeave(request) {
    const admin = await profileFor(request.auth.uid);
    requireAdmin(admin);
    const requestId = cleanText(request.data?.requestId, 128);
    const reason = cleanText(request.data?.reason, 1000);
    if (!requestId || !reason) throw new HttpsError("invalid-argument", "假單與作廢原因都是必填。");
    const requestRef = db.doc(`leaveRequests/${requestId}`);
    let result;
    let employee;
    await db.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) throw new HttpsError("not-found", "找不到這張假單。");
      const leave = requestSnap.data();
      if (leave.status !== "approved") {
        throw new HttpsError("failed-precondition", "這張假單已不是已核准狀態。");
      }
      const userRef = db.doc(`users/${leave.userId}`);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new HttpsError("not-found", "找不到員工資料。");
      employee = { id: userSnap.id, ...userSnap.data() };
      const field = leave.leaveType === "annual"
        ? "annualLeaveHours"
        : leave.leaveType === "compensatory"
          ? "compensatoryLeaveHours"
          : "";
      const refundedHours = field ? wholeHours(leave.hours) : 0;
      transaction.update(requestRef, {
        status: "voided",
        voidReason: reason,
        voidedBy: admin.id,
        voidedByName: admin.name || admin.email || "",
        voidedAt: FieldValue.serverTimestamp(),
        refundedLeaveHours: refundedHours,
        refundedLeaveType: field ? leave.leaveType : "",
        updatedAt: FieldValue.serverTimestamp()
      });
      if (field) {
        transaction.update(userRef, {
          [field]: FieldValue.increment(refundedHours),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      result = { refundedHours, leaveType: leave.leaveType };
    });
    await audit("leave_request.voided", admin, {
      targetUserId: employee.id,
      department: employee.department,
      requestId,
      reason,
      ...result
    });
    return result;
  }

  async function saveWorkSettings(request) {
    const admin = await profileFor(request.auth.uid);
    requireAdmin(admin);
    const input = request.data || {};
    const shifts = Array.isArray(input.workShifts) ? input.workShifts.slice(0, 10) : [];
    if (!shifts.length) throw new HttpsError("invalid-argument", "至少需要一個班別。");
    const workShifts = shifts.map((shift, index) => {
      const normalized = {
        id: cleanText(shift.id, 80) || `shift_${index + 1}`,
        name: cleanText(shift.name, 120),
        workStart: cleanText(shift.workStart, 5),
        workEnd: cleanText(shift.workEnd, 5)
      };
      assertTime(normalized.workStart, "上班時間");
      assertTime(normalized.workEnd, "下班時間");
      if (!normalized.name || timeMinutes(normalized.workEnd) <= timeMinutes(normalized.workStart)) {
        throw new HttpsError("invalid-argument", "班別名稱必填，且下班時間必須晚於上班時間。");
      }
      return normalized;
    });
    const lunchStart = cleanText(input.lunchStart, 5);
    const lunchEnd = cleanText(input.lunchEnd, 5);
    assertTime(lunchStart, "午休開始");
    assertTime(lunchEnd, "午休結束");
    if (timeMinutes(lunchEnd) <= timeMinutes(lunchStart)) {
      throw new HttpsError("invalid-argument", "午休結束時間必須晚於開始時間。");
    }
    const holidayDates = [...new Set((Array.isArray(input.holidayDates) ? input.holidayDates : [])
      .map((date) => cleanText(date, 10))
      .filter((date) => DATE_PATTERN.test(date)))].slice(0, 500);
    const specialClosureDates = (Array.isArray(input.specialClosureDates) ? input.specialClosureDates : [])
      .slice(0, 500)
      .map((item) => {
        const date = cleanText(item.date, 10);
        const time = cleanText(item.time, 5);
        if (!DATE_PATTERN.test(date)) throw new HttpsError("invalid-argument", "特殊關門日期格式錯誤。");
        assertTime(time, "特殊關門時間");
        return { date, time, reason: cleanText(item.reason, 200) };
      });
    const payload = {
      workStart: workShifts[0].workStart,
      workEnd: workShifts[0].workEnd,
      workShifts,
      lunchStart,
      lunchEnd,
      holidayDates,
      specialClosureDates,
      standardHours: finiteNumber(input.standardHours, "標準工時", 1, 24),
      lateGraceMinutes: finiteNumber(input.lateGraceMinutes, "寬限分鐘", 0, 120),
      updatedBy: admin.id,
      updatedAt: FieldValue.serverTimestamp()
    };
    const ref = db.doc("workSettings/default");
    const beforeSnap = await ref.get();
    await ref.set(payload, { merge: true });
    await audit("work_settings.updated", admin, {
      before: beforeSnap.exists ? beforeSnap.data() : null,
      shiftCount: workShifts.length,
      holidayCount: holidayDates.length,
      closureCount: specialClosureDates.length
    });
    return { success: true };
  }

  return {
    createEmployeeAccount,
    updateEmployee,
    reviewHrRequest,
    recalculateOvertimeRequest,
    voidApprovedLeave,
    saveWorkSettings
  };
}

module.exports = { createAdminHandlers };
