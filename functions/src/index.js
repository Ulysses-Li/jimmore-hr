"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} = require("@simplewebauthn/server");
const {
  EXPECTED_ORIGINS,
  REGION,
  RP_ID,
  RP_NAME,
  TIME_ZONE
} = require("./config");
const { createSecurityRuntime } = require("./lib/security-runtime");
const { createAdminHandlers } = require("./lib/admin-service");
const {
  calculateWorkHours,
  decideLocation,
  effectiveWorkEnd,
  isRestDay,
  taipeiDateTime,
  todayKeyTaipei
} = require("./core");

initializeApp();
const db = getFirestore();
const {
  audit,
  callable,
  challengeRef,
  cleanText,
  loadChallenge,
  profileFor,
  requireAdmin,
  requireReviewer,
  saveChallenge,
  timestampDate
} = createSecurityRuntime(db);
const adminHandlers = createAdminHandlers({
  db,
  audit,
  cleanText,
  profileFor,
  requireAdmin,
  requireReviewer
});

exports.createEmployeeAccount = callable(adminHandlers.createEmployeeAccount);
exports.updateEmployee = callable(adminHandlers.updateEmployee);
exports.reviewHrRequest = callable(adminHandlers.reviewHrRequest);
exports.recalculateOvertimeRequest = callable(adminHandlers.recalculateOvertimeRequest);
exports.voidApprovedLeave = callable(adminHandlers.voidApprovedLeave);
exports.saveWorkSettings = callable(adminHandlers.saveWorkSettings);

exports.getEmployeeDirectory = callable(async function getEmployeeDirectory(request) {
  const viewer = await profileFor(request.auth.uid);
  const users = await db.collection("users").get();
  const employees = users.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((employee) => employee.isActive !== false && employee.id !== viewer.id)
    .filter((employee) => !viewer.department || employee.department === viewer.department)
    .map((employee) => ({
      id: employee.id,
      name: cleanText(employee.name, 100),
      department: cleanText(employee.department, 100)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  return { employees };
});

exports.getTeamCalendar = callable(async function getTeamCalendar(request) {
  await profileFor(request.auth.uid);
  const [leaveSnap, attendanceSnap] = await Promise.all([
    db.collection("leaveRequests").where("status", "==", "approved").get(),
    db.collection("attendance").where("type", "==", "checkIn").where("status", "==", "late").get()
  ]);
  const toIso = (value) => {
    const date = timestampDate(value);
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  };
  const leaves = leaveSnap.docs
    .map((docSnap) => docSnap.data())
    .map((leave) => ({
      userId: cleanText(leave.userId, 128),
      userName: cleanText(leave.userName, 100),
      department: cleanText(leave.department, 100),
      leaveType: cleanText(leave.leaveType, 50),
      startTime: toIso(leave.startTime),
      endTime: toIso(leave.endTime)
    }))
    .filter((leave) => leave.startTime && leave.endTime);
  const lateRecords = attendanceSnap.docs
    .map((docSnap) => docSnap.data())
    .map((record) => ({
      userId: cleanText(record.userId, 128),
      userName: cleanText(record.userName, 100),
      department: cleanText(record.department, 100),
      date: cleanText(record.date, 10),
      workStart: cleanText(record.workStart, 5),
      timestamp: toIso(record.timestamp)
    }))
    .filter((record) => record.timestamp);
  return { leaves, lateRecords };
}, { enforceAppCheck: false });

function normalizedShift(profile, settings) {
  const shifts = Array.isArray(settings.workShifts) ? settings.workShifts : [];
  return shifts.find((item) => item.id === profile.defaultShiftId)
    || shifts[0]
    || { id: "default", name: "日班 09:00", workStart: settings.workStart || "09:00", workEnd: settings.workEnd || "18:00" };
}

exports.requestPasskeyEnrollment = callable(async function requestPasskeyEnrollment(request) {
  const employee = await profileFor(request.auth.uid);
  const deviceLabel = cleanText(request.data?.deviceLabel, 80) || "個人裝置";
  await db.doc(`passkeyEnrollmentRequests/${employee.id}`).set({
    userId: employee.id,
    userName: employee.name || employee.email || "",
    department: employee.department || "",
    managerId: employee.managerId || "",
    deviceLabel,
    status: "pending",
    requestedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await audit("passkey.enrollment_requested", employee, { targetUserId: employee.id, department: employee.department, deviceLabel });
  return { status: "pending" };
});

exports.approvePasskeyEnrollment = callable(async function approvePasskeyEnrollment(request) {
  const reviewer = await profileFor(request.auth.uid);
  const userId = cleanText(request.data?.userId, 128);
  const employee = await profileFor(userId);
  requireReviewer(reviewer, employee);
  const ref = db.doc(`passkeyEnrollmentRequests/${userId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data().status !== "pending") throw new HttpsError("failed-precondition", "沒有待核准的裝置申請。");
  await ref.update({
    status: "approved",
    approvedBy: reviewer.id,
    approvedByName: reviewer.name || reviewer.email || "",
    approvedAt: FieldValue.serverTimestamp(),
    approvalExpiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    updatedAt: FieldValue.serverTimestamp()
  });
  await audit("passkey.enrollment_approved", reviewer, { targetUserId: userId, department: employee.department });
  return { status: "approved" };
});

exports.beginPasskeyRegistration = callable(async function beginPasskeyRegistration(request) {
  const employee = await profileFor(request.auth.uid);
  const enrollment = await db.doc(`passkeyEnrollmentRequests/${employee.id}`).get();
  if (!enrollment.exists || enrollment.data().status !== "approved") {
    throw new HttpsError("failed-precondition", "裝置註冊尚未經主管核准。");
  }
  if (timestampDate(enrollment.data().approvalExpiresAt).getTime() < Date.now()) {
    throw new HttpsError("deadline-exceeded", "主管核准已逾期，請重新申請。");
  }
  const credentials = await db.collection("passkeyCredentials").where("userId", "==", employee.id).get();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: employee.email || employee.id,
    userDisplayName: employee.name || employee.email || employee.id,
    userID: Buffer.from(employee.id, "utf8"),
    attestationType: "none",
    excludeCredentials: credentials.docs.filter((docSnap) => docSnap.data().status === "active").map((docSnap) => ({
      id: docSnap.id,
      transports: docSnap.data().transports || []
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required"
    }
  });
  await saveChallenge(employee.id, "registration", options.challenge);
  return options;
});

exports.finishPasskeyRegistration = callable(async function finishPasskeyRegistration(request) {
  const employee = await profileFor(request.auth.uid);
  const challenge = await loadChallenge(employee.id, "registration");
  const response = request.data?.response;
  if (!response?.id) throw new HttpsError("invalid-argument", "缺少 Passkey 註冊結果。");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: EXPECTED_ORIGINS,
    expectedRPID: RP_ID,
    requireUserVerification: true
  });
  if (!verification.verified || !verification.registrationInfo) throw new HttpsError("permission-denied", "Passkey 驗證失敗。");
  const info = verification.registrationInfo;
  const credential = info.credential || {
    id: response.id,
    publicKey: info.credentialPublicKey,
    counter: info.counter,
    transports: response.response?.transports || []
  };
  const publicKey = Buffer.from(credential.publicKey).toString("base64url");
  const enrollmentRef = db.doc(`passkeyEnrollmentRequests/${employee.id}`);
  const credentialRef = db.doc(`passkeyCredentials/${credential.id || response.id}`);
  const batch = db.batch();
  batch.set(credentialRef, {
    userId: employee.id,
    userName: employee.name || employee.email || "",
    department: employee.department || "",
    publicKey,
    counter: Number(credential.counter || 0),
    transports: credential.transports || response.response?.transports || [],
    deviceType: info.credentialDeviceType || "unknown",
    backedUp: Boolean(info.credentialBackedUp),
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  batch.set(enrollmentRef, { status: "registered", registeredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.delete(challengeRef(employee.id, "registration"));
  await batch.commit();
  await audit("passkey.registered", employee, { targetUserId: employee.id, department: employee.department, credentialId: credential.id || response.id });
  return { verified: true };
});

exports.beginPunch = callable(async function beginPunch(request) {
  const employee = await profileFor(request.auth.uid);
  const type = request.data?.type;
  if (!['checkIn', 'checkOut'].includes(type)) throw new HttpsError("invalid-argument", "打卡類型錯誤。");
  const credentialSnap = await db.collection("passkeyCredentials").where("userId", "==", employee.id).get();
  const credentials = credentialSnap.docs.filter((docSnap) => docSnap.data().status === "active");
  if (!credentials.length) throw new HttpsError("failed-precondition", "尚未完成經主管核准的 Passkey 註冊。");
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
    allowCredentials: credentials.map((docSnap) => ({ id: docSnap.id, transports: docSnap.data().transports || [] }))
  });
  await saveChallenge(employee.id, "punch", options.challenge, { punchType: type });
  return options;
});

async function activeFieldAssignments(userId, now) {
  const snap = await db.collection("fieldAssignments").where("userId", "==", userId).get();
  return snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => {
    const start = timestampDate(item.startAt);
    const end = timestampDate(item.endAt);
    return item.active !== false && start && end && start <= now && end >= now;
  });
}

async function currentLocationDecision(userId, now, location) {
  const [siteSnap, assignments] = await Promise.all([
    db.collection("workSites").where("active", "==", true).get(),
    activeFieldAssignments(userId, now)
  ]);
  return decideLocation(location,
    siteSnap.docs.map((item) => ({ id: item.id, ...item.data() })),
    assignments);
}

function assertPunchWindow(now, date, shift, settings) {
  const minutes = Number(settings.punchWindowMinutes || 13);
  const openAt = new Date(taipeiDateTime(date, shift.workStart).getTime() - minutes * 60000);
  const closeAt = new Date(taipeiDateTime(date, effectiveWorkEnd(date, shift, settings)).getTime() + minutes * 60000);
  if (now < openAt || now > closeAt) throw new HttpsError("failed-precondition", "目前不在允許的打卡時段內。");
}

async function recordsForDate(userId, date) {
  const snap = await db.collection("attendance")
    .where("userId", "==", userId).where("date", "==", date).get();
  return snap.docs.map((item) => ({ id: item.id, ...item.data(), timestamp: timestampDate(item.data().timestamp) }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function validatePunchSequence(type, rows) {
  const last = rows.at(-1);
  if (type === "checkIn" && last?.type === "checkIn") throw new HttpsError("already-exists", "目前已有未簽退的簽到紀錄。");
  if (type === "checkOut" && (!last || last.type !== "checkIn")) throw new HttpsError("failed-precondition", "必須先完成簽到才能簽退。");
}

async function approvedLeavesForDate(userId, date) {
  const snap = await db.collection("leaveRequests").where("userId", "==", userId).get();
  const dayStart = taipeiDateTime(date, "00:00");
  const dayEnd = taipeiDateTime(date, "23:59");
  return snap.docs.map((item) => item.data()).filter((leave) => leave.status === "approved"
    && timestampDate(leave.startTime) <= dayEnd && timestampDate(leave.endTime) >= dayStart);
}

function overlapMinutes(start, end, blockStart, blockEnd) {
  return Math.max(0, (Math.min(end.getTime(), blockEnd.getTime()) - Math.max(start.getTime(), blockStart.getTime())) / 60000);
}

function leaveCoverageMinutes(start, end, leaveRows, date, settings) {
  if (end <= start) return 0;
  const lunchStart = taipeiDateTime(date, settings.lunchStart || "12:00");
  const lunchEnd = taipeiDateTime(date, settings.lunchEnd || "13:00");
  return leaveRows.reduce((sum, leave) => {
    const leaveStart = timestampDate(leave.startTime);
    const leaveEnd = timestampDate(leave.endTime);
    const gross = overlapMinutes(start, end, leaveStart, leaveEnd);
    const lunch = overlapMinutes(
      new Date(Math.max(start.getTime(), lunchStart.getTime())),
      new Date(Math.min(end.getTime(), lunchEnd.getTime())),
      leaveStart,
      leaveEnd
    );
    return sum + Math.max(0, gross - lunch);
  }, 0);
}

function scheduledHours(date, shift, settings) {
  const start = taipeiDateTime(date, shift.workStart);
  const end = taipeiDateTime(date, effectiveWorkEnd(date, shift, settings));
  const lunchStart = taipeiDateTime(date, settings.lunchStart || "12:00");
  const lunchEnd = taipeiDateTime(date, settings.lunchEnd || "13:00");
  const gross = (end.getTime() - start.getTime()) / 60000;
  return Number(((gross - overlapMinutes(start, end, lunchStart, lunchEnd)) / 60).toFixed(2));
}

function resolveStatusWithLeaves(type, at, date, shift, settings, leaveRows) {
  if (type === "checkIn") {
    const start = taipeiDateTime(date, shift.workStart);
    const lateMinutes = Math.ceil((at - start) / 60000)
      - Number(settings.lateGraceMinutes || 0)
      - leaveCoverageMinutes(start, at, leaveRows, date, settings);
    return lateMinutes > 0 ? "late" : "normal";
  }
  const end = taipeiDateTime(date, effectiveWorkEnd(date, shift, settings));
  const earlyMinutes = Math.ceil((end - at) / 60000)
    - leaveCoverageMinutes(at, end, leaveRows, date, settings);
  return earlyMinutes > 0 ? "earlyLeave" : "normal";
}

async function rebuildAttendanceDaily(employee, date, settings) {
  const [rows, approvedLeaves] = await Promise.all([
    recordsForDate(employee.id, date),
    approvedLeavesForDate(employee.id, date)
  ]);
  const firstIn = rows.find((row) => row.type === "checkIn");
  const lastOut = [...rows].reverse().find((row) => row.type === "checkOut");
  const shift = normalizedShift(employee, settings);
  const hours = calculateWorkHours(rows, date, settings);
  const expectedHours = scheduledHours(date, shift, settings);
  const creditedLeaveHours = Number((leaveCoverageMinutes(
    taipeiDateTime(date, shift.workStart),
    taipeiDateTime(date, effectiveWorkEnd(date, shift, settings)),
    approvedLeaves,
    date,
    settings
  ) / 60).toFixed(2));
  let status = "incomplete";
  if (!firstIn && !lastOut) status = "missing";
  else if (firstIn && lastOut) {
    const checkInStatus = resolveStatusWithLeaves("checkIn", firstIn.timestamp, date, shift, settings, approvedLeaves);
    const checkOutStatus = resolveStatusWithLeaves("checkOut", lastOut.timestamp, date, shift, settings, approvedLeaves);
    status = checkInStatus === "late" ? "late"
      : checkOutStatus === "earlyLeave" ? "earlyLeave"
        : hours + creditedLeaveHours >= expectedHours ? "normal" : "workTimeNotEnough";
  }
  await db.doc(`attendanceDaily/${date}_${employee.id}`).set({
    userId: employee.id,
    userName: employee.name || employee.email || "",
    department: employee.department || "",
    date,
    shiftId: shift.id,
    shiftName: shift.name,
    workStart: shift.workStart,
    workEnd: shift.workEnd,
    effectiveWorkEnd: effectiveWorkEnd(date, shift, settings),
    checkInTime: firstIn ? Timestamp.fromDate(firstIn.timestamp) : null,
    checkOutTime: lastOut ? Timestamp.fromDate(lastOut.timestamp) : null,
    totalWorkHours: hours,
    creditedLeaveHours,
    expectedHours,
    status,
    isEightHoursReached: hours + creditedLeaveHours >= expectedHours,
    hasManualCorrection: rows.some((row) => row.manualCorrection),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

exports.finishPunch = callable(async function finishPunch(request) {
  const employee = await profileFor(request.auth.uid);
  const challenge = await loadChallenge(employee.id, "punch");
  const response = request.data?.response;
  if (!response?.id) throw new HttpsError("invalid-argument", "缺少 Passkey 驗證結果。");
  const credentialRef = db.doc(`passkeyCredentials/${response.id}`);
  const credentialSnap = await credentialRef.get();
  if (!credentialSnap.exists || credentialSnap.data().userId !== employee.id || credentialSnap.data().status !== "active") {
    throw new HttpsError("permission-denied", "Passkey 不屬於目前使用者或已失效。");
  }
  const credentialData = credentialSnap.data();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: EXPECTED_ORIGINS,
    expectedRPID: RP_ID,
    requireUserVerification: true,
    credential: {
      id: credentialSnap.id,
      publicKey: Buffer.from(credentialData.publicKey, "base64url"),
      counter: Number(credentialData.counter || 0),
      transports: credentialData.transports || []
    }
  });
  if (!verification.verified) throw new HttpsError("permission-denied", "生物辨識驗證失敗。");

  const now = new Date();
  const date = todayKeyTaipei(now);
  const settingsSnap = await db.doc("workSettings/default").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const shift = normalizedShift(employee, settings);
  assertPunchWindow(now, date, shift, settings);
  const rows = await recordsForDate(employee.id, date);
  validatePunchSequence(challenge.punchType, rows);
  const locationDecision = await currentLocationDecision(employee.id, now, request.data?.location);
  if (!locationDecision.allowed) {
    throw new HttpsError("permission-denied", locationDecision.reason === "gps_accuracy_too_low"
      ? "定位精度不足，請移至可接收 GPS 的位置後重試。" : "目前位置不在公司據點或核准外勤範圍內。");
  }
  const approvedLeaves = await approvedLeavesForDate(employee.id, date);
  const status = resolveStatusWithLeaves(challenge.punchType, now, date, shift, settings, approvedLeaves);
  const exceptionRef = db.doc(`attendanceExceptions/${date}_${employee.id}`);
  const exceptionSnap = await exceptionRef.get();
  const recordRef = db.collection("attendance").doc();
  const guardRef = db.doc(`punchGuards/${date}_${employee.id}`);
  await db.runTransaction(async (transaction) => {
    const guard = await transaction.get(guardRef);
    if (guard.exists && guard.data().lastType === challenge.punchType
      && Date.now() - timestampDate(guard.data().updatedAt).getTime() < 60_000) {
      throw new HttpsError("already-exists", "重複打卡已被阻擋。");
    }
    transaction.create(recordRef, {
      userId: employee.id,
      userName: employee.name || employee.email || "",
      department: employee.department || "",
      type: challenge.punchType,
      shiftId: shift.id,
      shiftName: shift.name,
      workStart: shift.workStart,
      workEnd: shift.workEnd,
      timestamp: Timestamp.fromDate(now),
      serverReceivedAt: FieldValue.serverTimestamp(),
      date,
      latitude: locationDecision.location.latitude,
      longitude: locationDecision.location.longitude,
      gpsAccuracyM: locationDecision.location.accuracy,
      locationDecision: locationDecision.reason,
      locationDistanceM: locationDecision.distanceM,
      workSiteId: locationDecision.workSiteId || null,
      fieldAssignmentId: locationDecision.fieldAssignmentId || null,
      status,
      source: "passkey_web",
      credentialId: credentialSnap.id,
      exceptionId: exceptionSnap.exists ? exceptionSnap.id : null,
      deviceInfo: cleanText(request.data?.deviceInfo, 300),
      createdAt: FieldValue.serverTimestamp()
    });
    transaction.set(credentialRef, { counter: verification.authenticationInfo.newCounter, lastUsedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(guardRef, { userId: employee.id, date, lastType: challenge.punchType, updatedAt: FieldValue.serverTimestamp() });
    transaction.delete(challengeRef(employee.id, "punch"));
    if (exceptionSnap.exists) {
      transaction.set(exceptionRef, { laterPunchAt: Timestamp.fromDate(now), laterPunchType: challenge.punchType, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
  await rebuildAttendanceDaily(employee, date, settings);
  await audit("attendance.punched", employee, {
    targetUserId: employee.id,
    department: employee.department,
    recordId: recordRef.id,
    type: challenge.punchType,
    locationDecision: locationDecision.reason
  });
  return { success: true, recordId: recordRef.id, timestamp: now.toISOString(), status, locationDecision: locationDecision.reason };
});

exports.resetPasskey = callable(async function resetPasskey(request) {
  const admin = await profileFor(request.auth.uid);
  requireAdmin(admin);
  const userId = cleanText(request.data?.userId, 128);
  const reason = cleanText(request.data?.reason);
  if (!reason) throw new HttpsError("invalid-argument", "重設原因必填。");
  const employee = await profileFor(userId);
  const snap = await db.collection("passkeyCredentials").where("userId", "==", userId).get();
  const batch = db.batch();
  snap.docs.forEach((item) => batch.set(item.ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: admin.id, revokeReason: reason }, { merge: true }));
  batch.set(db.doc(`passkeyEnrollmentRequests/${userId}`), { status: "reset", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  await audit("passkey.reset", admin, { targetUserId: userId, department: employee.department, reason });
  return { revoked: snap.size };
});

exports.submitExceptionReason = callable(async function submitExceptionReason(request) {
  const employee = await profileFor(request.auth.uid);
  const caseId = cleanText(request.data?.caseId, 128);
  const category = cleanText(request.data?.category, 40);
  const reason = cleanText(request.data?.reason, 1000);
  const requestedTime = cleanText(request.data?.requestedTime, 5);
  if (!caseId || !["forgot", "device_failure", "fieldwork", "leave_pending", "other"].includes(category)
    || !reason || !/^\d{2}:\d{2}$/.test(requestedTime)) {
    throw new HttpsError("invalid-argument", "請選擇原因分類，並填寫實際到達時間與說明。");
  }
  const ref = db.doc(`attendanceExceptions/${caseId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data().userId !== employee.id) throw new HttpsError("permission-denied", "你無權處理此案件。");
  await ref.update({
    reasonCategory: category,
    reason,
    requestedTime,
    status: "pending_manager_review",
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    timeline: FieldValue.arrayUnion({ action: "reason_submitted", actorId: employee.id, at: new Date().toISOString() })
  });
  await audit("attendance_exception.reason_submitted", employee, { targetUserId: employee.id, department: employee.department, caseId, category });
  return { status: "pending_manager_review" };
});

exports.reviewException = callable(async function reviewException(request) {
  const reviewer = await profileFor(request.auth.uid);
  const caseId = cleanText(request.data?.caseId, 128);
  const decision = cleanText(request.data?.decision, 40);
  const note = cleanText(request.data?.note, 1000);
  if (!["approved", "rejected", "needs_more_info"].includes(decision)) throw new HttpsError("invalid-argument", "審核決定無效。");
  const ref = db.doc(`attendanceExceptions/${caseId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "找不到未打卡案件。");
  const exception = snap.data();
  const employee = await profileFor(exception.userId);
  requireReviewer(reviewer, employee);
  const status = decision === "needs_more_info" ? "needs_more_info" : decision;
  let correctionRecordId = exception.manualCorrectionRecordId || "";
  let correctionTime = "";
  if (decision === "approved") {
    correctionTime = cleanText(request.data?.correctionTime, 5)
      || cleanText(exception.requestedTime, 5)
      || timeMentionedInReason(exception.reason)
      || cleanText(exception.workStart, 5)
      || "09:00";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(correctionTime)) {
      throw new HttpsError("invalid-argument", "補登時間格式不正確。");
    }
    const rows = await recordsForDate(employee.id, exception.date);
    const existingCheckIn = rows.find((row) => row.type === "checkIn");
    if (existingCheckIn) {
      correctionRecordId = existingCheckIn.id;
    } else {
      const settingsSnap = await db.doc("workSettings/default").get();
      const settings = settingsSnap.exists ? settingsSnap.data() : {};
      const shift = normalizedShift(employee, settings);
      const timestamp = taipeiDateTime(exception.date, correctionTime);
      const approvedLeaves = await approvedLeavesForDate(employee.id, exception.date);
      const correctionRef = db.doc(`attendance/exception_${caseId}_checkIn`);
      correctionRecordId = correctionRef.id;
      await correctionRef.set({
        userId: employee.id,
        userName: employee.name || employee.email || "",
        department: employee.department || "",
        type: "checkIn",
        shiftId: shift.id,
        shiftName: shift.name,
        workStart: shift.workStart,
        workEnd: shift.workEnd,
        timestamp: Timestamp.fromDate(timestamp),
        serverReceivedAt: FieldValue.serverTimestamp(),
        date: exception.date,
        latitude: null,
        longitude: null,
        locationDecision: "manager_approved_exception",
        status: resolveStatusWithLeaves("checkIn", timestamp, exception.date, shift, settings, approvedLeaves),
        source: "manager_approved_exception",
        manualCorrection: true,
        correctionReason: exception.reason || note || "主管核准未打卡原因",
        correctedBy: reviewer.id,
        correctedByName: reviewer.name || reviewer.email || "",
        exceptionId: caseId,
        createdAt: FieldValue.serverTimestamp()
      }, { merge: true });
      await rebuildAttendanceDaily(employee, exception.date, settings);
      await audit("attendance.manager_correction", reviewer, {
        targetUserId: employee.id,
        department: employee.department,
        recordId: correctionRecordId,
        date: exception.date,
        time: correctionTime,
        caseId
      });
    }
  }
  await ref.update({
    status,
    reviewNote: note,
    ...(decision === "approved" ? { requestedTime: correctionTime, manualCorrectionRecordId: correctionRecordId } : {}),
    reviewedBy: reviewer.id,
    reviewedByName: reviewer.name || reviewer.email || "",
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    timeline: FieldValue.arrayUnion({ action: `review_${decision}`, actorId: reviewer.id, at: new Date().toISOString(), note })
  });
  await audit("attendance_exception.reviewed", reviewer, { targetUserId: employee.id, department: employee.department, caseId, decision, note });
  return { status };
});

function timeMentionedInReason(reason) {
  const match = String(reason || "").match(/(?:^|\D)([01]?\d|2[0-3])[:：]([0-5]\d)(?:\D|$)/);
  return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : "";
}

exports.saveWorkSite = callable(async function saveWorkSite(request) {
  const admin = await profileFor(request.auth.uid);
  requireAdmin(admin);
  const data = request.data || {};
  const name = cleanText(data.name, 100);
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  const radiusM = Number(data.radiusM || 150);
  const maxAccuracyM = Number(data.maxAccuracyM || 100);
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || radiusM < 20 || radiusM > 5000 || maxAccuracyM < 10 || maxAccuracyM > 1000) {
    throw new HttpsError("invalid-argument", "據點名稱、座標、半徑或定位精度設定無效。");
  }
  const ref = data.id ? db.doc(`workSites/${cleanText(data.id, 128)}`) : db.collection("workSites").doc();
  await ref.set({ name, latitude, longitude, radiusM, maxAccuracyM, active: data.active !== false, updatedBy: admin.id, updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() }, { merge: true });
  await audit("work_site.saved", admin, { siteId: ref.id, name, latitude, longitude, radiusM, maxAccuracyM });
  return { id: ref.id };
});

exports.saveFieldAssignment = callable(async function saveFieldAssignment(request) {
  const admin = await profileFor(request.auth.uid);
  requireAdmin(admin);
  const data = request.data || {};
  const employee = await profileFor(cleanText(data.userId, 128));
  const startAt = new Date(data.startAt);
  const endAt = new Date(data.endAt);
  const reason = cleanText(data.reason, 500);
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  const radiusM = Number(data.radiusM || 150);
  if (!reason || !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt
    || !Number.isFinite(latitude) || !Number.isFinite(longitude) || radiusM < 20 || radiusM > 5000) {
    throw new HttpsError("invalid-argument", "外勤時段、地點、半徑或原因無效。");
  }
  const ref = data.id ? db.doc(`fieldAssignments/${cleanText(data.id, 128)}`) : db.collection("fieldAssignments").doc();
  await ref.set({
    userId: employee.id,
    userName: employee.name || employee.email || "",
    department: employee.department || "",
    name: cleanText(data.name, 100) || "核准外勤",
    startAt: Timestamp.fromDate(startAt),
    endAt: Timestamp.fromDate(endAt),
    latitude,
    longitude,
    radiusM,
    maxAccuracyM: Number(data.maxAccuracyM || 150),
    reason,
    active: data.active !== false,
    assignedBy: admin.id,
    assignedByName: admin.name || admin.email || "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await audit("field_assignment.saved", admin, { targetUserId: employee.id, department: employee.department, assignmentId: ref.id, reason });
  return { id: ref.id };
});

exports.createManualCorrection = callable(async function createManualCorrection(request) {
  const admin = await profileFor(request.auth.uid);
  requireAdmin(admin);
  const data = request.data || {};
  const employee = await profileFor(cleanText(data.userId, 128));
  const date = cleanText(data.date, 10);
  const type = data.type;
  const time = cleanText(data.time, 5);
  const reason = cleanText(data.reason, 1000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)
    || !["checkIn", "checkOut"].includes(type) || !reason) {
    throw new HttpsError("invalid-argument", "補登日期、時間、類型及原因必須完整。");
  }
  const timestamp = taipeiDateTime(date, time);
  const settingsSnap = await db.doc("workSettings/default").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const shift = normalizedShift(employee, settings);
  const approvedLeaves = await approvedLeavesForDate(employee.id, date);
  const status = resolveStatusWithLeaves(type, timestamp, date, shift, settings, approvedLeaves);
  const ref = db.collection("attendance").doc();
  const exceptionId = cleanText(data.exceptionId, 128) || null;
  await ref.set({
    userId: employee.id,
    userName: employee.name || employee.email || "",
    department: employee.department || "",
    type,
    shiftId: shift.id,
    shiftName: shift.name,
    workStart: shift.workStart,
    workEnd: shift.workEnd,
    timestamp: Timestamp.fromDate(timestamp),
    serverReceivedAt: FieldValue.serverTimestamp(),
    date,
    latitude: null,
    longitude: null,
    locationDecision: "manual_correction",
    status,
    source: "admin_manual_correction",
    manualCorrection: true,
    correctionReason: reason,
    correctedBy: admin.id,
    correctedByName: admin.name || admin.email || "",
    exceptionId,
    createdAt: FieldValue.serverTimestamp()
  });
  if (exceptionId) {
    await db.doc(`attendanceExceptions/${exceptionId}`).set({ manualCorrectionRecordId: ref.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await rebuildAttendanceDaily(employee, date, settings);
  await audit("attendance.manual_correction", admin, { targetUserId: employee.id, department: employee.department, recordId: ref.id, date, time, type, reason, exceptionId });
  return { recordId: ref.id };
});

function leaveCoversShift(leaveRows, userId, date, shift) {
  const start = taipeiDateTime(date, shift.workStart);
  const end = taipeiDateTime(date, shift.workEnd);
  return leaveRows.some((leave) => leave.userId === userId && leave.status === "approved"
    && timestampDate(leave.startTime) <= start && timestampDate(leave.endTime) >= end);
}

exports.createMissingAttendanceCases = onSchedule({
  region: REGION,
  schedule: "every 5 minutes",
  timeZone: TIME_ZONE,
  minInstances: 0,
  memory: "256MiB",
  timeoutSeconds: 120
}, async () => {
  const now = new Date();
  const date = todayKeyTaipei(now);
  const [settingsSnap, usersSnap, attendanceSnap, leaveSnap, exceptionSnap] = await Promise.all([
    db.doc("workSettings/default").get(),
    db.collection("users").get(),
    db.collection("attendance").where("date", "==", date).get(),
    db.collection("leaveRequests").where("status", "==", "approved").get(),
    db.collection("attendanceExceptions").get()
  ]);
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const users = usersSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((user) => user.isActive !== false);
  const attendance = attendanceSnap.docs.map((item) => item.data());
  const leaves = leaveSnap.docs.map((item) => item.data());
  let created = 0;

  for (const employee of users) {
    if (isRestDay(date, settings)) break;
    const shift = normalizedShift(employee, settings);
    const dueAt = new Date(taipeiDateTime(date, shift.workStart).getTime() + Number(settings.lateGraceMinutes || 0) * 60000);
    if (now < dueAt) continue;
    if (attendance.some((row) => row.userId === employee.id && row.type === "checkIn")) continue;
    if (leaveCoversShift(leaves, employee.id, date, shift)) continue;
    const ref = db.doc(`attendanceExceptions/${date}_${employee.id}`);
    try {
      await ref.create({
        userId: employee.id,
        userName: employee.name || employee.email || "",
        department: employee.department || "",
        managerId: employee.managerId || "",
        date,
        shiftId: shift.id,
        shiftName: shift.name,
        workStart: shift.workStart,
        dueAt: Timestamp.fromDate(dueAt),
        status: "pending_employee_reason",
        reasonCategory: "",
        reason: "",
        timeline: [{ action: "case_created", actorId: "system", at: now.toISOString() }],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      created += 1;
    } catch (error) {
      if (error.code !== 6 && error.code !== "already-exists") throw error;
    }
  }

  const overdueBatch = db.batch();
  exceptionSnap.docs.forEach((item) => {
    const row = item.data();
    if (row.date < date && row.status === "pending_employee_reason") {
      overdueBatch.update(item.ref, { status: "overdue", updatedAt: FieldValue.serverTimestamp() });
    }
  });
  await overdueBatch.commit();
  logger.info("Missing attendance scan completed", { date, created, users: users.length });
});
