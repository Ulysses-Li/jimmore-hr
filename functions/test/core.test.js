"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateHoursExcludingLunch,
  calculateWorkHours,
  decideLocation,
  earliestCheckInsByUserDate,
  haversineMeters,
  isRestDay,
  resolvePunchStatus,
  taipeiDateTime,
  todayKeyTaipei
} = require("../src/core");

test("Taipei date keys do not depend on server timezone", () => {
  assert.equal(todayKeyTaipei(new Date("2026-07-22T16:30:00.000Z")), "2026-07-23");
  assert.equal(taipeiDateTime("2026-07-23", "09:00").toISOString(), "2026-07-23T01:00:00.000Z");
});

test("location is accepted only when accuracy and radius both pass", () => {
  const site = { id: "hq", name: "總公司", latitude: 25.033, longitude: 121.5654, radiusM: 150, maxAccuracyM: 100, active: true };
  const accepted = decideLocation({ latitude: 25.0331, longitude: 121.5655, accuracy: 20 }, [site], []);
  assert.equal(accepted.allowed, true);
  assert.equal(accepted.workSiteId, "hq");

  const inaccurate = decideLocation({ latitude: 25.0331, longitude: 121.5655, accuracy: 250 }, [site], []);
  assert.equal(inaccurate.allowed, false);
  assert.equal(inaccurate.reason, "gps_accuracy_too_low");

  const outside = decideLocation({ latitude: 25.05, longitude: 121.58, accuracy: 20 }, [site], []);
  assert.equal(outside.allowed, false);
  assert.equal(outside.reason, "outside_allowed_area");
});

test("field assignment is reported separately from a work site", () => {
  const result = decideLocation(
    { latitude: 24.15, longitude: 120.68, accuracy: 25 },
    [],
    [{ id: "field-1", latitude: 24.15, longitude: 120.68, radiusM: 200, maxAccuracyM: 100, active: true }]
  );
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "approved_fieldwork");
  assert.equal(result.fieldAssignmentId, "field-1");
});

test("field staff can punch from any valid GPS location", () => {
  const result = decideLocation(
    { latitude: 23.5, longitude: 120.5, accuracy: 80 },
    [],
    [],
    { unrestricted: true }
  );
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "unrestricted_field_staff");
  assert.equal(result.workSiteId, null);
  assert.equal(result.fieldAssignmentId, null);
});

test("late and early-leave status use server time and grace", () => {
  const shift = { workStart: "09:00", workEnd: "18:00" };
  assert.equal(resolvePunchStatus("checkIn", new Date("2026-07-23T01:04:00Z"), shift, 5), "normal");
  assert.equal(resolvePunchStatus("checkIn", new Date("2026-07-23T01:06:00Z"), shift, 5), "late");
  assert.equal(resolvePunchStatus("checkOut", new Date("2026-07-23T09:59:00Z"), shift), "earlyLeave");
  assert.equal(resolvePunchStatus("checkOut", new Date("2026-07-23T10:00:00Z"), shift), "normal");
});

test("work hours pair punches and deduct lunch overlap", () => {
  const records = [
    { type: "checkIn", timestamp: new Date("2026-07-23T01:00:00Z") },
    { type: "checkOut", timestamp: new Date("2026-07-23T10:00:00Z") }
  ];
  assert.equal(calculateWorkHours(records, "2026-07-23", { lunchStart: "12:00", lunchEnd: "13:00" }), 8);
});

test("overtime hours deduct configured lunch overlap", () => {
  const settings = { lunchStart: "12:00", lunchEnd: "13:00" };
  assert.equal(
    calculateHoursExcludingLunch(
      new Date("2026-07-18T01:00:00Z"),
      new Date("2026-07-18T10:00:00Z"),
      settings
    ),
    8
  );
  assert.equal(
    calculateHoursExcludingLunch(
      new Date("2026-07-18T05:00:00Z"),
      new Date("2026-07-18T08:00:00Z"),
      settings
    ),
    3
  );
});

test("late ranking uses only the earliest check-in for each employee and date", () => {
  const records = [
    { id: "return", userId: "u1", date: "2026-07-13", type: "checkIn", timestamp: new Date("2026-07-13T02:59:00Z") },
    { id: "first", userId: "u1", date: "2026-07-13", type: "checkIn", timestamp: new Date("2026-07-13T00:58:00Z") },
    { id: "other-day", userId: "u1", date: "2026-07-14", type: "checkIn", timestamp: new Date("2026-07-14T01:05:00Z") },
    { id: "other-user", userId: "u2", date: "2026-07-13", type: "checkIn", timestamp: new Date("2026-07-13T01:10:00Z") }
  ];
  assert.deepEqual(
    earliestCheckInsByUserDate(records).map((record) => record.id).sort(),
    ["first", "other-day", "other-user"]
  );
});

test("weekends and configured holidays are rest days", () => {
  assert.equal(isRestDay("2026-07-25", {}), true);
  assert.equal(isRestDay("2026-07-23", { holidayDates: ["2026-07-23"] }), true);
  assert.equal(isRestDay("2026-07-23", {}), false);
  assert.ok(haversineMeters({ latitude: 25, longitude: 121 }, { latitude: 25, longitude: 121 }) < 1);
});
