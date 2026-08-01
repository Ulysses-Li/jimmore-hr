"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONFIRMATION,
  CUTOVER_AT,
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
} = require("../src/lib/prelaunch-cleanup");

function fakeFirestore(initial) {
  const documents = new Map(Object.entries(initial));
  const snap = (path) => ({
    id: path.split("/").at(-1),
    exists: documents.has(path),
    data: () => documents.get(path)
  });
  return {
    documents,
    doc(path) {
      return {
        path,
        get: async () => snap(path),
        set: async (data) => documents.set(path, data)
      };
    },
    collection(name) {
      return {
        async get() {
          const docs = [...documents.keys()]
            .filter((path) => path.startsWith(`${name}/`) && path.split("/").length === 2)
            .map(snap);
          return { docs, size: docs.length };
        }
      };
    },
    batch() {
      const paths = [];
      return {
        delete: (ref) => paths.push(ref.path),
        commit: async () => paths.forEach((path) => documents.delete(path))
      };
    }
  };
}

test("prelaunch cleanup requires the exact project, confirmation and pre-cutover time", () => {
  assert.doesNotThrow(() => assertApplyAllowed({
    projectId: PROJECT_ID,
    confirmation: CONFIRMATION,
    now: new Date("2026-08-01T00:00:00.000Z")
  }));
  assert.throws(() => assertApplyAllowed({ projectId: "wrong", confirmation: CONFIRMATION, now: new Date(0) }), /目前專案/);
  assert.throws(() => assertApplyAllowed({ projectId: PROJECT_ID, confirmation: "DELETE", now: new Date(0) }), /確認字串/);
  assert.throws(() => assertApplyAllowed({ projectId: PROJECT_ID, confirmation: CONFIRMATION, now: CUTOVER_AT }), /正式清理只能/);
});

test("backup serialization preserves Firestore-like timestamps and produces stable hashes", () => {
  const source = {
    createdAt: { toDate: () => new Date("2026-08-01T00:00:00.000Z") },
    nested: [{ value: 3 }]
  };
  const serialized = serializeValue(source);
  assert.deepEqual(serialized.createdAt, { __type: "timestamp", value: "2026-08-01T00:00:00.000Z" });
  assert.equal(collectionHash([serialized]), collectionHash([serialized]));
});

test("employee balance report preserves each current balance", () => {
  const rows = employeeBalances({ collections: { users: [
    { id: "u2", data: { name: "乙", annualLeaveHours: 24, compensatoryLeaveHours: 2 } },
    { id: "u1", data: { name: "甲", annualLeaveHours: 56, compensatoryLeaveHours: 0 } }
  ] } });
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.userId, [
    row.annualLeaveHours,
    row.compensatoryLeaveHours
  ]])), {
    u1: [56, 0],
    u2: [24, 2]
  });
});

test("cleanup deletes only target collections, preserves configuration and is idempotent", async () => {
  const initial = {};
  DELETE_COLLECTIONS.forEach((name) => { initial[`${name}/test-document`] = { value: name }; });
  PRESERVE_COLLECTIONS.forEach((name) => { initial[`${name}/kept-document`] = { value: name }; });
  const db = fakeFirestore(initial);
  const options = {
    projectId: PROJECT_ID,
    confirmation: CONFIRMATION,
    now: new Date("2026-08-01T00:00:00.000Z"),
    backupId: "backup-1",
    serverTimestamp: () => "server-time"
  };

  const first = await applyCleanup(db, await buildCleanupSnapshot(db), options);
  assert.equal(first.markerCreated, true);
  DELETE_COLLECTIONS.filter((name) => name !== "auditEvents")
    .forEach((name) => assert.equal([...db.documents.keys()].some((path) => path.startsWith(`${name}/`)), false));
  PRESERVE_COLLECTIONS.forEach((name) => assert.equal(db.documents.has(`${name}/kept-document`), true));
  assert.equal(db.documents.has(`auditEvents/${CUTOVER_MARKER_ID}`), true);

  const second = await applyCleanup(db, await buildCleanupSnapshot(db), options);
  assert.equal(second.markerCreated, false);
  assert.ok(Object.values(second.deleted).every((count) => count === 0));
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith("auditEvents/")).length, 1);
});
