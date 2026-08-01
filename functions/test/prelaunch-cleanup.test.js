"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONFIRMATION,
  CUTOVER_AT,
  PROJECT_ID,
  assertApplyAllowed,
  collectionHash,
  employeeBalances,
  serializeValue
} = require("../src/lib/prelaunch-cleanup");

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
