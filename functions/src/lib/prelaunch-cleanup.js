"use strict";

const { createHash } = require("node:crypto");

const PROJECT_ID = "jimmore-workhub";
const CUTOVER_DATE = "2026-08-03";
const CUTOVER_AT = new Date("2026-08-02T16:00:00.000Z");
const CONFIRMATION = `DELETE ${PROJECT_ID} BEFORE ${CUTOVER_DATE}`;
const CUTOVER_MARKER_ID = "productionCutover_2026-08-03";

const DELETE_COLLECTIONS = Object.freeze([
  "attendance",
  "attendanceDaily",
  "attendanceExceptions",
  "auditEvents",
  "leaveRequests",
  "overtimeRequests",
  "passkeyCredentials",
  "passkeyEnrollmentRequests",
  "punchGuards",
  "rateLimits",
  "securityChallenges"
]);

const PRESERVE_COLLECTIONS = Object.freeze([
  "users",
  "workSettings",
  "workSites",
  "fieldAssignments"
]);

function serializeValue(value) {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (value instanceof Date) return { __type: "date", value: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __type: "bytes", value: Buffer.from(value).toString("base64") };
  }
  if (typeof value.toDate === "function") {
    return { __type: "timestamp", value: value.toDate().toISOString() };
  }
  if (typeof value.path === "string" && value.firestore) {
    return { __type: "reference", value: value.path };
  }
  if (Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && value.constructor?.name === "GeoPoint") {
    return { __type: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]));
}

function collectionHash(records) {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function backupDocument(docSnap) {
  return { id: docSnap.id, data: serializeValue(docSnap.data()) };
}

async function readCollection(db, collectionName) {
  const snap = await db.collection(collectionName).get();
  return snap.docs
    .filter((docSnap) => collectionName !== "auditEvents" || docSnap.id !== CUTOVER_MARKER_ID)
    .map(backupDocument)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function buildCleanupSnapshot(db) {
  const collections = {};
  for (const collectionName of [...DELETE_COLLECTIONS, ...PRESERVE_COLLECTIONS]) {
    collections[collectionName] = await readCollection(db, collectionName);
  }
  const manifest = Object.fromEntries(Object.entries(collections).map(([name, records]) => [name, {
    count: records.length,
    sha256: collectionHash(records),
    disposition: DELETE_COLLECTIONS.includes(name) ? "delete" : "preserve"
  }]));
  return {
    projectId: PROJECT_ID,
    cutoff: CUTOVER_AT.toISOString(),
    generatedAt: new Date().toISOString(),
    manifest,
    collections
  };
}

function employeeBalances(snapshot) {
  return (snapshot.collections.users || []).map(({ id, data }) => ({
    userId: id,
    name: data.name || "",
    email: data.email || "",
    department: data.department || "",
    annualLeaveHours: Number(data.annualLeaveHours || 0),
    compensatoryLeaveHours: Number(data.compensatoryLeaveHours || 0)
  })).sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), "zh-Hant"));
}

function assertApplyAllowed({ projectId, confirmation, now = new Date() }) {
  if (projectId !== PROJECT_ID) throw new Error(`拒絕執行：目前專案是 ${projectId || "未知"}，預期為 ${PROJECT_ID}。`);
  if (confirmation !== CONFIRMATION) throw new Error(`拒絕執行：確認字串必須完全等於「${CONFIRMATION}」。`);
  if (now >= CUTOVER_AT) throw new Error(`拒絕執行：正式清理只能在 ${CUTOVER_AT.toISOString()} 之前執行。`);
}

async function deleteRecords(db, collectionName, records, batchSize = 400) {
  let deleted = 0;
  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = db.batch();
    const chunk = records.slice(offset, offset + batchSize);
    chunk.forEach(({ id }) => batch.delete(db.doc(`${collectionName}/${id}`)));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function applyCleanup(db, snapshot, options) {
  assertApplyAllowed(options);
  const beforePreserved = Object.fromEntries(PRESERVE_COLLECTIONS.map((name) => [name, snapshot.manifest[name].count]));
  const deleted = {};
  for (const collectionName of DELETE_COLLECTIONS) {
    deleted[collectionName] = await deleteRecords(db, collectionName, snapshot.collections[collectionName]);
  }

  const markerRef = db.doc(`auditEvents/${CUTOVER_MARKER_ID}`);
  const markerSnap = await markerRef.get();
  if (!markerSnap.exists) {
    await markerRef.set({
      action: "system.production_cutover_completed",
      actorId: "prelaunch-cleanup",
      actorName: "Prelaunch cleanup tool",
      department: "",
      targetUserId: "",
      details: {
        cutoff: CUTOVER_AT.toISOString(),
        deleted,
        backupId: options.backupId || ""
      },
      createdAt: options.serverTimestamp()
    });
  }

  const verification = {};
  for (const collectionName of DELETE_COLLECTIONS) {
    const remaining = await db.collection(collectionName).get();
    const allowed = collectionName === "auditEvents" ? 1 : 0;
    if (remaining.size !== allowed) {
      throw new Error(`清理驗證失敗：${collectionName} 尚有 ${remaining.size} 筆，預期 ${allowed} 筆。`);
    }
    verification[collectionName] = remaining.size;
  }
  for (const collectionName of PRESERVE_COLLECTIONS) {
    const remaining = await db.collection(collectionName).get();
    if (remaining.size !== beforePreserved[collectionName]) {
      throw new Error(`保留資料驗證失敗：${collectionName} 原有 ${beforePreserved[collectionName]} 筆，目前 ${remaining.size} 筆。`);
    }
    verification[collectionName] = remaining.size;
  }
  return { deleted, verification, markerCreated: !markerSnap.exists };
}

module.exports = {
  CONFIRMATION,
  CUTOVER_AT,
  CUTOVER_DATE,
  CUTOVER_MARKER_ID,
  DELETE_COLLECTIONS,
  PRESERVE_COLLECTIONS,
  PROJECT_ID,
  applyCleanup,
  assertApplyAllowed,
  buildCleanupSnapshot,
  collectionHash,
  employeeBalances,
  serializeValue
};
