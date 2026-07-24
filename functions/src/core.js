"use strict";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiParts(value = new Date()) {
  const shifted = new Date(new Date(value).getTime() + TAIPEI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay()
  };
}

function todayKeyTaipei(value = new Date()) {
  const p = taipeiParts(value);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function taipeiDateTime(dateKey, hhmm) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(hhmm)) {
    throw new Error("日期或時間格式錯誤");
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hours, minutes] = hhmm.split(":").map(Number);
  if (hours > 23 || minutes > 59) throw new Error("時間格式錯誤");
  return new Date(Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0));
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  return hours * 60 + minutes;
}

function haversineMeters(from, to) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validateCoordinates(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const accuracy = Number(location?.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !Number.isFinite(accuracy) || accuracy <= 0) {
    throw new Error("定位資料無效");
  }
  return { latitude, longitude, accuracy };
}

function decideLocation(locationInput, workSites = [], fieldAssignments = []) {
  const location = validateCoordinates(locationInput);
  const candidates = [
    ...workSites.filter((site) => site.active !== false).map((site) => ({
      kind: "workSite",
      id: site.id,
      name: site.name,
      latitude: Number(site.latitude),
      longitude: Number(site.longitude),
      radiusM: Number(site.radiusM || 150),
      maxAccuracyM: Number(site.maxAccuracyM || 100)
    })),
    ...fieldAssignments.filter((assignment) => assignment.active !== false).map((assignment) => ({
      kind: "fieldAssignment",
      id: assignment.id,
      name: assignment.name || "核准外勤",
      latitude: Number(assignment.latitude),
      longitude: Number(assignment.longitude),
      radiusM: Number(assignment.radiusM || 150),
      maxAccuracyM: Number(assignment.maxAccuracyM || 150)
    }))
  ].filter((candidate) => Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude));

  const matches = candidates.map((candidate) => ({
    ...candidate,
    distanceM: haversineMeters(location, candidate),
    accuracyAccepted: location.accuracy <= candidate.maxAccuracyM
  })).filter((candidate) => candidate.accuracyAccepted && candidate.distanceM <= candidate.radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);

  if (!matches.length) {
    const accuracyLimit = candidates.length
      ? Math.max(...candidates.map((candidate) => candidate.maxAccuracyM))
      : 100;
    return {
      allowed: false,
      reason: location.accuracy > accuracyLimit ? "gps_accuracy_too_low" : "outside_allowed_area",
      location
    };
  }

  const match = matches[0];
  return {
    allowed: true,
    reason: match.kind === "fieldAssignment" ? "approved_fieldwork" : "inside_work_site",
    location,
    distanceM: Math.round(match.distanceM),
    workSiteId: match.kind === "workSite" ? match.id : null,
    fieldAssignmentId: match.kind === "fieldAssignment" ? match.id : null,
    matchedName: match.name || ""
  };
}

function resolvePunchStatus(type, now, shift, graceMinutes = 0, effectiveEnd = null) {
  const date = todayKeyTaipei(now);
  if (type === "checkIn") {
    const start = taipeiDateTime(date, shift.workStart);
    return now.getTime() > start.getTime() + Number(graceMinutes || 0) * 60000 ? "late" : "normal";
  }
  const end = taipeiDateTime(date, effectiveEnd || shift.workEnd);
  return now.getTime() < end.getTime() ? "earlyLeave" : "normal";
}

function isRestDay(dateKey, settings = {}) {
  const noon = taipeiDateTime(dateKey, "12:00");
  const weekday = taipeiParts(noon).weekday;
  const holidays = new Set(Array.isArray(settings.holidayDates) ? settings.holidayDates : []);
  return weekday === 0 || weekday === 6 || holidays.has(dateKey);
}

function effectiveWorkEnd(dateKey, shift, settings = {}) {
  const closure = (Array.isArray(settings.specialClosureDates) ? settings.specialClosureDates : [])
    .find((item) => item?.date === dateKey && /^\d{2}:\d{2}$/.test(item.time || ""));
  return closure?.time || shift.workEnd;
}

function attendanceRanges(records) {
  const ordered = [...records].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const ranges = [];
  let start = null;
  for (const row of ordered) {
    const at = new Date(row.timestamp);
    if (row.type === "checkIn") start = at;
    if (row.type === "checkOut" && start && at > start) {
      ranges.push({ start, end: at });
      start = null;
    }
  }
  return ranges;
}

function overlapMinutes(start, end, blockStart, blockEnd) {
  return Math.max(0, (Math.min(end.getTime(), blockEnd.getTime()) - Math.max(start.getTime(), blockStart.getTime())) / 60000);
}

function calculateWorkHours(records, dateKey, settings = {}) {
  const lunchStart = taipeiDateTime(dateKey, settings.lunchStart || "12:00");
  const lunchEnd = taipeiDateTime(dateKey, settings.lunchEnd || "13:00");
  const minutes = attendanceRanges(records).reduce((sum, range) => {
    const gross = (range.end.getTime() - range.start.getTime()) / 60000;
    return sum + Math.max(0, gross - overlapMinutes(range.start, range.end, lunchStart, lunchEnd));
  }, 0);
  return Number((minutes / 60).toFixed(2));
}

function calculateHoursExcludingLunch(startValue, endValue, settings = {}) {
  const start = startValue?.toDate ? startValue.toDate() : new Date(startValue);
  const end = endValue?.toDate ? endValue.toDate() : new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;

  const firstDate = todayKeyTaipei(start);
  const lastDate = todayKeyTaipei(end);
  let dateKey = firstDate;
  let lunchMinutes = 0;
  while (dateKey <= lastDate) {
    lunchMinutes += overlapMinutes(
      start,
      end,
      taipeiDateTime(dateKey, settings.lunchStart || "12:00"),
      taipeiDateTime(dateKey, settings.lunchEnd || "13:00")
    );
    const nextDate = new Date(`${dateKey}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    dateKey = nextDate.toISOString().slice(0, 10);
  }

  const grossMinutes = (end.getTime() - start.getTime()) / 60000;
  return Number((Math.max(0, grossMinutes - lunchMinutes) / 60).toFixed(2));
}

function earliestCheckInsByUserDate(records) {
  const earliest = new Map();
  for (const record of records) {
    if (record.type && record.type !== "checkIn") continue;
    const timestamp = record.timestamp?.toDate ? record.timestamp.toDate() : new Date(record.timestamp);
    if (!record.userId || !record.date || Number.isNaN(timestamp.getTime())) continue;
    const key = `${record.userId}_${record.date}`;
    const current = earliest.get(key);
    if (!current || timestamp < current.timestampDate) {
      earliest.set(key, { ...record, timestampDate: timestamp });
    }
  }
  return Array.from(earliest.values());
}

module.exports = {
  attendanceRanges,
  calculateHoursExcludingLunch,
  calculateWorkHours,
  decideLocation,
  effectiveWorkEnd,
  earliestCheckInsByUserDate,
  haversineMeters,
  isRestDay,
  resolvePunchStatus,
  taipeiDateTime,
  taipeiParts,
  timeToMinutes,
  todayKeyTaipei,
  validateCoordinates
};
