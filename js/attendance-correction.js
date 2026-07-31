const CORRECTION_VERSION = "attendance-correction-v1";
const DEFAULT_WINDOW_MINUTES = 13;

export function deterministicPunchMinute({
  employeeId,
  date,
  type,
  originalTime,
  windowMinutes = DEFAULT_WINDOW_MINUTES
}) {
  const size = normalizedWindowMinutes(windowMinutes);
  const originalMillis = normalizedDate(originalTime)?.getTime() ?? 0;
  const seed = [
    CORRECTION_VERSION,
    employeeId || "",
    date || "",
    type || "",
    originalMillis
  ].join("|");
  return stableHash32(seed) % size;
}

export function correctionDisplayTime({
  employeeId,
  date,
  type,
  originalTime,
  boundaryTime,
  windowMinutes = DEFAULT_WINDOW_MINUTES
}) {
  const original = normalizedDate(originalTime);
  const boundary = normalizedDate(boundaryTime);
  if (!original || !boundary || !["checkIn", "checkOut"].includes(type)) {
    return original;
  }

  const size = normalizedWindowMinutes(windowMinutes);
  const offset = deterministicPunchMinute({
    employeeId,
    date,
    type,
    originalTime: original,
    windowMinutes: size
  });

  if (type === "checkIn") {
    const earliestAllowed = addMinutes(boundary, -size);
    if (original >= earliestAllowed) return original;
    return addMinutes(earliestAllowed, offset);
  }

  const latestAllowed = addMinutes(boundary, size);
  if (original <= latestAllowed) return original;
  return addMinutes(boundary, offset + 1);
}

function normalizedWindowMinutes(value) {
  const minutes = Math.floor(Number(value));
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_WINDOW_MINUTES;
}

function normalizedDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function stableHash32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
