import test from "node:test";
import assert from "node:assert/strict";
import {
  correctionDisplayTime,
  deterministicPunchMinute
} from "../js/attendance-correction.js";

const employeeId = "employee-field-1";

test("early field punches are stable and distributed inside the 13-minute window", () => {
  const outputs = [];
  for (let day = 1; day <= 15; day += 1) {
    const date = `2026-07-${String(day).padStart(2, "0")}`;
    const originalTime = new Date(`${date}T06:00:00+08:00`);
    const corrected = correctionDisplayTime({
      employeeId,
      date,
      type: "checkIn",
      originalTime,
      boundaryTime: new Date(`${date}T09:00:00+08:00`)
    });
    outputs.push(corrected.toISOString().slice(11, 16));
  }

  outputs.forEach((time) => assert.ok(time >= "00:47" && time <= "00:59"));
  assert.ok(new Set(outputs).size >= 5);
});

test("late field punches are stable and distributed inside the 13-minute window", () => {
  const date = "2026-07-20";
  const input = {
    employeeId,
    date,
    type: "checkOut",
    originalTime: new Date(`${date}T22:05:00+08:00`),
    boundaryTime: new Date(`${date}T18:00:00+08:00`)
  };
  const first = correctionDisplayTime(input);
  const second = correctionDisplayTime(input);

  assert.equal(first.getTime(), second.getTime());
  assert.ok(first >= new Date(`${date}T18:01:00+08:00`));
  assert.ok(first <= new Date(`${date}T18:13:00+08:00`));
});

test("punches already inside the allowed correction ranges stay unchanged", () => {
  const date = "2026-07-24";
  const checkIn = new Date(`${date}T08:59:00+08:00`);
  const checkOut = new Date(`${date}T18:05:00+08:00`);

  assert.equal(correctionDisplayTime({
    employeeId,
    date,
    type: "checkIn",
    originalTime: checkIn,
    boundaryTime: new Date(`${date}T09:00:00+08:00`)
  }).getTime(), checkIn.getTime());
  assert.equal(correctionDisplayTime({
    employeeId,
    date,
    type: "checkOut",
    originalTime: checkOut,
    boundaryTime: new Date(`${date}T18:00:00+08:00`)
  }).getTime(), checkOut.getTime());
});

test("late check-ins and early check-outs retain their actual times", () => {
  const date = "2026-07-27";
  const lateCheckIn = new Date(`${date}T09:01:00+08:00`);
  const earlyCheckOut = new Date(`${date}T17:59:00+08:00`);

  assert.equal(correctionDisplayTime({
    employeeId,
    date,
    type: "checkIn",
    originalTime: lateCheckIn,
    boundaryTime: new Date(`${date}T09:00:00+08:00`)
  }).getTime(), lateCheckIn.getTime());
  assert.equal(correctionDisplayTime({
    employeeId,
    date,
    type: "checkOut",
    originalTime: earlyCheckOut,
    boundaryTime: new Date(`${date}T18:00:00+08:00`)
  }).getTime(), earlyCheckOut.getTime());
});

test("deterministic minute is stable for the same source record", () => {
  const input = {
    employeeId,
    date: "2026-07-20",
    type: "checkIn",
    originalTime: new Date("2026-07-20T06:47:00+08:00")
  };
  assert.equal(deterministicPunchMinute(input), deterministicPunchMinute(input));
});
