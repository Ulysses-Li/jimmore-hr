"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdminHandlers } = require("../src/lib/admin-service");

function fakeFirestore(initial) {
  const documents = new Map(Object.entries(initial));
  let nextId = 1;
  const snapshot = (path) => ({
    id: path.split("/").at(-1),
    exists: documents.has(path),
    data: () => documents.get(path),
    ref: doc(path)
  });
  function doc(path) {
    return {
      path,
      get: async () => snapshot(path),
      set: async (data, options = {}) => documents.set(path, options.merge ? { ...(documents.get(path) || {}), ...data } : data),
      delete: async () => documents.delete(path)
    };
  }
  return {
    documents,
    doc,
    collection(name) {
      return {
        doc(id = `auto-${nextId++}`) { return doc(`${name}/${id}`); },
        async get() {
          const docs = [...documents.keys()].filter((path) => path.startsWith(`${name}/`) && path.split("/").length === 2).map(snapshot);
          return { docs, size: docs.length };
        }
      };
    },
    async runTransaction(handler) {
      return handler({
        get: async (ref) => snapshot(ref.path),
        delete: (ref) => documents.delete(ref.path),
        create: (ref, data) => {
          if (documents.has(ref.path)) throw new Error("already exists");
          documents.set(ref.path, data);
        },
        update: (ref, data) => documents.set(ref.path, { ...(documents.get(ref.path) || {}), ...data })
      });
    }
  };
}

function handlersFor(db, calls, role = "admin") {
  return createAdminHandlers({
    db,
    audit: async () => {},
    cleanText: (value, max = 500) => String(value || "").trim().slice(0, max),
    profileFor: async (uid) => uid === "actor"
      ? { id: uid, name: "管理員", role, department: "IT" }
      : { id: uid, name: "員工", role: "employee", department: "IT" },
    requireAdmin: (profile) => {
      if (profile.role !== "admin") throw new Error("只有管理員可以執行此操作");
    },
    requireReviewer: () => {},
    rebuildAttendanceDaily: async (...args) => calls.daily.push(args),
    rebuildPunchGuard: async (...args) => calls.guard.push(args)
  });
}

test("admin permanently deletes attendance, audits it and reopens its correction case", async () => {
  const db = fakeFirestore({
    "attendance/r1": {
      userId: "u1",
      userName: "員工",
      department: "IT",
      date: "2026-07-31",
      type: "checkIn",
      source: "manager_approved_exception",
      exceptionId: "2026-07-31_u1",
      timestamp: new Date("2026-07-31T01:00:00.000Z")
    },
    "users/u1": { name: "員工", department: "IT", role: "employee" },
    "attendanceExceptions/2026-07-31_u1": { status: "approved", manualCorrectionRecordId: "r1", timeline: [] },
    "workSettings/default": { workStart: "09:00", workEnd: "18:00" }
  });
  const calls = { daily: [], guard: [] };
  const handlers = handlersFor(db, calls);

  const result = await handlers.deleteAttendanceRecord({
    auth: { uid: "actor" },
    data: { recordId: "r1", reason: "刪除測試打卡" }
  });

  assert.equal(result.success, true);
  assert.equal(result.exceptionReopened, true);
  assert.equal(db.documents.has("attendance/r1"), false);
  assert.equal(db.documents.get("attendanceExceptions/2026-07-31_u1").status, "needs_more_info");
  const auditRows = [...db.documents.entries()].filter(([path]) => path.startsWith("auditEvents/"));
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0][1].action, "attendance.deleted");
  assert.equal(auditRows[0][1].details.reason, "刪除測試打卡");
  assert.equal(calls.daily.length, 1);
  assert.deepEqual(calls.guard[0], ["u1", "2026-07-31"]);

  await assert.rejects(() => handlers.deleteAttendanceRecord({
    auth: { uid: "actor" },
    data: { recordId: "r1", reason: "再次刪除測試打卡" }
  }), /打卡紀錄已不存在/);
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith("auditEvents/")).length, 1);
});

test("non-admin cannot permanently delete attendance", async () => {
  const db = fakeFirestore({ "attendance/r1": { userId: "u1", date: "2026-07-31" } });
  const handlers = handlersFor(db, { daily: [], guard: [] }, "manager");
  await assert.rejects(() => handlers.deleteAttendanceRecord({
    auth: { uid: "actor" },
    data: { recordId: "r1", reason: "刪除測試打卡" }
  }), /只有管理員/);
  assert.equal(db.documents.has("attendance/r1"), true);
});
