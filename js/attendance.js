import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  db,
  requireAuth,
  bindLogout,
  mountPageShell,
  qs,
  badge,
  fmtDateTime,
  fmtTime,
  todayKey,
  getWorkSettings,
  timeToDate,
  hoursBetween,
  showToast
} from "./app.js";
import {
  authenticateAndPunch,
  registerApprovedPasskey,
  requestPasskeyEnrollment
} from "./passkeys.js";
import { callSecureFunction } from "./app.js";
import { acquirePunchLocation } from "./services/geolocation-service.js";

mountPageShell("出勤打卡", "GPS 簽到簽退與每日工時判定");
const profile = await requireAuth();
bindLogout();
const settings = await getWorkSettings();
const workShifts = normalizeWorkShifts(settings);
const assignedShift = findShift(profile.defaultShiftId);
const PUNCH_WINDOW_MINUTES = 13;

qs("#pageContent").innerHTML = `
  <div class="row g-3">
    <div class="col-lg-5">
      <div class="panel p-3">
        <h2 class="h5 mb-3">今日操作</h2>
        <div class="alert alert-info py-2 mb-3" id="attendanceHint">正在讀取今日狀態...</div>
        <div class="mb-3">
          <label class="form-label">今日班別</label>
          <div class="form-control bg-light" id="assignedShiftDisplay">
            ${assignedShift ? shiftText(assignedShift) : "尚未設定班別"}
          </div>
          ${assignedShift ? "" : `<div class="form-text text-danger">請管理員先到員工管理分配預設班別。</div>`}
        </div>
        <div class="small muted mb-3">
          打卡需要瀏覽器定位權限。若看到定位被拒絕，請點網址列左側圖示，將位置權限改為允許後重新整理。
        </div>
        <div class="d-grid gap-2">
          <button class="btn btn-success btn-lg" id="checkInBtn">上班簽到</button>
          <button class="btn btn-warning btn-lg" id="checkOutBtn">下班簽退</button>
        </div>
        <div class="alert alert-warning mt-3 d-none" id="locationPermissionHelp" role="alert">
          <div class="fw-bold mb-2">iPhone 定位權限修復</div>
          <ol class="small mb-2 ps-3">
            <li>點 Safari 網址列左側的「頁面選單」圖示。</li>
            <li>開啟「網站設定」，將「位置」改為「允許」或「詢問」。</li>
            <li>若仍被拒絕：到「設定 → 隱私權與安全性 → 定位服務」，開啟定位服務。</li>
            <li>進入「Safari 網站」，選擇「使用 App 期間」並開啟「精確位置」。</li>
          </ol>
          <button class="btn btn-sm btn-outline-dark" id="retryLocationBtn" type="button">重新檢查定位</button>
          <div class="small mt-2">若裝置受公司管理或螢幕使用時間限制，請聯絡管理員解除定位限制。</div>
        </div>
        <hr>
        <dl class="row mb-0">
          <dt class="col-5">班別</dt><dd class="col-7" id="shiftSummary">-</dd>
          <dt class="col-5">午休扣除</dt><dd class="col-7">${settings.lunchStart} - ${settings.lunchEnd}</dd>
          <dt class="col-5">標準工時</dt><dd class="col-7">${settings.standardHours} 小時</dd>
          <dt class="col-5">今日應達</dt><dd class="col-7">${assignedShift ? scheduledWorkHours(todayKey(), assignedShift) : "-"} 小時${todayClosureText()}</dd>
        </dl>
      </div>
    </div>
    <div class="col-lg-7">
      <div class="panel p-3">
        <h2 class="h5 mb-3">今日紀錄</h2>
        <div id="todaySummary" class="mb-3 muted">載入中...</div>
        <div class="table-responsive">
          <table class="table align-middle mb-0">
            <thead><tr><th>時間</th><th>類型</th><th>狀態</th><th>GPS</th></tr></thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
  <div class="row g-3 mt-1">
    <div class="col-lg-5">
      <div class="panel p-3 h-100">
        <h2 class="h5 mb-2">Passkey 生物辨識</h2>
        <p class="small muted">第一次使用先提出裝置申請，由主管當面核准後，再完成 Face ID、指紋或 Windows Hello 註冊。</p>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-primary" id="requestPasskeyBtn">申請註冊此裝置</button>
          <button class="btn btn-primary" id="registerPasskeyBtn">完成已核准註冊</button>
        </div>
        <div class="form-text mt-2" id="passkeyStatus">正在讀取註冊狀態...</div>
        <div class="small muted mt-2">
          iPhone 若無法叫出 Face ID：請改用 Safari 一般分頁，確認已設定 Face ID、解鎖密碼，
          並開啟 iCloud「密碼與鑰匙圈」。
        </div>
      </div>
    </div>
    <div class="col-lg-7">
      <div class="panel p-3 h-100">
        <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
          <div>
            <h2 class="h5 mb-1">未打卡原因待辦</h2>
            <div class="small muted">補打卡不會刪除案件，仍需填寫原因並由主管審核。</div>
          </div>
          <span class="badge text-bg-secondary" id="exceptionCount">0 筆</span>
        </div>
        <div id="exceptionList"><div class="muted">載入中...</div></div>
      </div>
    </div>
  </div>`;

function resolveStatus(type, at, approvedLeaves = [], shiftOverride = null) {
  const dateKey = todayKey(at);
  const shift = shiftOverride || getAssignedShift();
  if (type === "checkIn") {
    const start = timeToDate(dateKey, shift.workStart);
    const coveredMinutes = leaveOverlapMinutes(start, at, approvedLeaves);
    const lateMinutes = Math.ceil((at.getTime() - start.getTime()) / 60000) - coveredMinutes - Number(settings.lateGraceMinutes || 0);
    return lateMinutes > 0 ? "late" : "normal";
  }
  const end = timeToDate(dateKey, effectiveWorkEndTime(dateKey, shift));
  const coveredMinutes = leaveOverlapMinutes(at, end, approvedLeaves);
  const earlyMinutes = Math.ceil((end.getTime() - at.getTime()) / 60000) - coveredMinutes;
  return earlyMinutes > 0 ? "earlyLeave" : "normal";
}

async function punch(type) {
  setPunching(true, type);
  try {
    const at = new Date();
    const shift = getAssignedShift();
    assertPunchWindowOpen(at, shift);
    const todayRecords = await loadTodayRecords(todayKey(at));
    const lastRecord = todayRecords.at(-1);
    if (type === "checkIn" && lastRecord?.type === "checkIn") {
      throw new Error(`目前已於 ${fmtTime(lastRecord.timestamp)} 簽到，請先簽退後再簽到。`);
    }
    if (type === "checkOut" && !todayRecords.some((item) => item.type === "checkIn")) {
      throw new Error("今日尚未簽到，請先完成上班簽到。");
    }
    if (type === "checkOut" && lastRecord?.type !== "checkIn") {
      throw new Error(`目前已於 ${fmtTime(lastRecord?.timestamp)} 簽退，如需再次外出前請先簽到。`);
    }

    const location = await acquirePunchLocation();
    hideLocationPermissionHelp();
    await authenticateAndPunch(type, location);
    showToast(`${type === "checkIn" ? "上班簽到" : "下班簽退"}完成`, "success");
  } catch (error) {
    if (isLocationPermissionDenied(error)) showLocationPermissionHelp();
    showToast(`打卡失敗：${friendlyPunchError(error)}`, "danger");
  } finally {
    setPunching(false, type);
    await render();
  }
}

function calculateAttendanceWorkHours(records, approvedLeaves, lunchStart, lunchEnd) {
  const minutes = attendanceWorkRanges(records).reduce((sum, range) => {
    const lunchMinutes = overlapMinutes(range.start, range.end, lunchStart, lunchEnd);
    const leaveMinutes = calculateApprovedLeaveWorkMinutesInRange(
      range.start,
      range.end,
      approvedLeaves,
      lunchStart,
      lunchEnd
    );
    return sum + Math.max(0, overlapMinutes(range.start, range.end, range.start, range.end) - lunchMinutes - leaveMinutes);
  }, 0);
  return minutes / 60;
}

function calculateAttendanceLunchHours(records, lunchStart, lunchEnd) {
  const minutes = attendanceWorkRanges(records).reduce((sum, range) => {
    return sum + overlapMinutes(range.start, range.end, lunchStart, lunchEnd);
  }, 0);
  return minutes / 60;
}

function attendanceWorkRanges(records) {
  const ranges = [];
  let activeIn = null;
  records.forEach((row) => {
    const at = toDate(row.timestamp);
    if (!at || Number.isNaN(at.getTime())) return;
    if (row.type === "checkIn") {
      if (!activeIn) activeIn = at;
      return;
    }
    if (row.type === "checkOut" && activeIn && at > activeIn) {
      ranges.push({ start: activeIn, end: at });
      activeIn = null;
    }
  });
  return ranges;
}

async function render() {
  const date = todayKey();
  const approvedLeaves = await loadApprovedLeavesForDate(date);
  const rows = await loadTodayRecords(date);
  const firstIn = rows.find((item) => item.type === "checkIn");
  const lastOut = rows.filter((item) => item.type === "checkOut").at(-1);
  qs("#rows").innerHTML = rows.length
    ? rows.map((row) => `<tr>
      <td>${fmtDateTime(row.timestamp)}</td>
      <td>${row.type === "checkIn" ? "簽到" : "簽退"}</td>
      <td>${badge(resolveDisplayStatus(row, approvedLeaves, firstIn, lastOut))}</td>
      <td>${mapLink(row.latitude, row.longitude)}</td>
    </tr>`).join("")
    : `<tr><td colspan="4" class="muted">今日尚無紀錄</td></tr>`;

  updateActionState(rows);
  updateShiftSummary(firstIn);
  qs("#todaySummary").innerHTML = `
    <span class="me-3">簽到：${fmtTime(firstIn?.timestamp)}</span>
    <span>簽退：${fmtTime(lastOut?.timestamp)}</span>`;
}

async function loadTodayRecords(date) {
  const snap = await getDocs(query(
    collection(db, "attendance"),
    where("userId", "==", profile.id),
    where("date", "==", date)
  ));
  return snap.docs.map((item) => item.data()).sort(byTimestampAsc);
}

async function loadApprovedLeavesForDate(date) {
  const snap = await getDocs(query(
    collection(db, "leaveRequests"),
    where("userId", "==", profile.id)
  ));
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);
  return snap.docs
    .map((item) => item.data())
    .filter((item) => item.status === "approved")
    .filter((item) => toDate(item.startTime) <= dayEnd && toDate(item.endTime) >= dayStart);
}

function resolveDisplayStatus(row, approvedLeaves, firstIn, lastOut) {
  if (row.type === "checkIn" && row !== firstIn) return "normal";
  if (row.type === "checkOut" && row !== lastOut) return "normal";
  const at = toDate(row.timestamp);
  const shift = findShift(row.shiftId) || {
    id: row.shiftId || "default",
    name: row.shiftName || "預設班別",
    workStart: row.workStart || settings.workStart || "09:00",
    workEnd: row.workEnd || settings.workEnd || "18:00"
  };
  return resolveStatus(row.type, at, approvedLeaves, shift);
}

function calculateApprovedLeaveWorkHours(date, approvedLeaves, shift) {
  const workStart = timeToDate(date, shift.workStart);
  const workEnd = timeToDate(date, effectiveWorkEndTime(date, shift));
  const lunchStart = timeToDate(date, settings.lunchStart);
  const lunchEnd = timeToDate(date, settings.lunchEnd);
  const minutes = calculateApprovedLeaveWorkMinutesInRange(workStart, workEnd, approvedLeaves, lunchStart, lunchEnd);
  return minutes / 60;
}

function calculateApprovedLeaveWorkMinutesInRange(start, end, approvedLeaves, lunchStart, lunchEnd) {
  if (!start || !end || end <= start) return 0;
  return approvedLeaves.reduce((sum, item) => {
    return sum + workMinutesInRange(start, end, toDate(item.startTime), toDate(item.endTime), lunchStart, lunchEnd);
  }, 0);
}

function workMinutesInRange(start, end, blockStart, blockEnd, lunchStart, lunchEnd) {
  if (!start || !end || !blockStart || !blockEnd || end <= start || blockEnd <= blockStart) return 0;
  if ([start, end, blockStart, blockEnd, lunchStart, lunchEnd].some((date) => Number.isNaN(date.getTime()))) return 0;
  const minutes = overlapMinutes(start, end, blockStart, blockEnd);
  const lunchRangeStart = new Date(Math.max(start.getTime(), lunchStart.getTime()));
  const lunchRangeEnd = new Date(Math.min(end.getTime(), lunchEnd.getTime()));
  const lunchMinutes = lunchRangeEnd > lunchRangeStart
    ? overlapMinutes(lunchRangeStart, lunchRangeEnd, blockStart, blockEnd)
    : 0;
  return Math.max(0, minutes - lunchMinutes);
}

function effectiveWorkEndTime(date, shift) {
  const shiftEnd = shift.workEnd || settings.workEnd || "18:00";
  const closure = specialClosureForDate(date);
  if (!closure?.closeTime) return shiftEnd;
  return timeToMinutes(closure.closeTime) < timeToMinutes(shiftEnd) ? closure.closeTime : shiftEnd;
}

function scheduledWorkHours(date, shift) {
  const workStart = timeToDate(date, shift.workStart || settings.workStart || "09:00");
  const workEnd = timeToDate(date, effectiveWorkEndTime(date, shift));
  const lunchStart = timeToDate(date, settings.lunchStart || "12:00");
  const lunchEnd = timeToDate(date, settings.lunchEnd || "13:00");
  const lunchOverlap = overlapHours(workStart, workEnd, lunchStart, lunchEnd);
  return Number(Math.max(0, hoursBetween(workStart, workEnd) - lunchOverlap).toFixed(2));
}

function specialClosureForDate(date) {
  return (Array.isArray(settings.specialClosureDates) ? settings.specialClosureDates : [])
    .find((item) => item?.date === date && /^\d{2}:\d{2}$/.test(item.closeTime || ""));
}

function todayClosureText() {
  const closure = specialClosureForDate(todayKey());
  if (!closure?.closeTime) return "";
  return `（${closure.closeTime} 提早關門${closure.reason ? `：${closure.reason}` : ""}）`;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function leaveOverlapMinutes(start, end, approvedLeaves) {
  if (end <= start) return 0;
  return approvedLeaves.reduce((sum, item) => sum + overlapMinutes(start, end, toDate(item.startTime), toDate(item.endTime)), 0);
}

function overlapHours(start, end, blockStart, blockEnd) {
  return overlapMinutes(start, end, blockStart, blockEnd) / 60;
}

function overlapMinutes(start, end, blockStart, blockEnd) {
  const from = Math.max(start.getTime(), blockStart.getTime());
  const to = Math.min(end.getTime(), blockEnd.getTime());
  return Math.max(0, Math.ceil((to - from) / 60000));
}

function toDate(value) {
  if (!value) return new Date("");
  return value.toDate ? value.toDate() : new Date(value);
}

function normalizeWorkShifts(value) {
  if (Array.isArray(value.workShifts) && value.workShifts.length) return value.workShifts;
  return [
    { id: "shift_0900", name: "日班 09:00", workStart: value.workStart || "09:00", workEnd: value.workEnd || "18:00" }
  ];
}

function getSelectedShift() {
  return getAssignedShift();
}

function findShift(id) {
  return workShifts.find((shift) => shift.id === id);
}

function getAssignedShift() {
  const shift = findShift(profile.defaultShiftId);
  if (!shift) throw new Error("尚未分配班別，請聯絡管理員設定。");
  return shift;
}

function attendancePunchWindow(date, shift) {
  const dateKey = typeof date === "string" ? date : todayKey(date);
  const openAt = addMinutes(timeToDate(dateKey, shift.workStart || settings.workStart || "09:00"), -PUNCH_WINDOW_MINUTES);
  const closeAt = addMinutes(timeToDate(dateKey, effectiveWorkEndTime(dateKey, shift)), PUNCH_WINDOW_MINUTES);
  return { openAt, closeAt };
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function assertPunchWindowOpen(at, shift) {
  const window = attendancePunchWindow(at, shift);
  if (at >= window.openAt && at <= window.closeAt) return;
  throw new Error(`目前非打卡開放時間，開放時間為 ${fmtTime(window.openAt)} - ${fmtTime(window.closeAt)}。`);
}

function punchWindowText(date, shift) {
  const window = attendancePunchWindow(date, shift);
  return `${fmtTime(window.openAt)} - ${fmtTime(window.closeAt)}`;
}

function updateShiftSummary(firstIn) {
  const selected = firstIn
    ? findShift(firstIn.shiftId) || {
      name: firstIn.shiftName || "今日簽到班別",
      workStart: firstIn.workStart || settings.workStart,
      workEnd: firstIn.workEnd || settings.workEnd
    }
    : assignedShift;
  qs("#shiftSummary").textContent = selected ? shiftText(selected) : "尚未設定班別";
}

function updateActionState(rows) {
  const hint = qs("#attendanceHint");
  const checkInBtn = qs("#checkInBtn");
  const checkOutBtn = qs("#checkOutBtn");
  const lastRecord = rows.at(-1);
  const nextAction = !lastRecord || lastRecord.type === "checkOut" ? "checkIn" : "checkOut";

  checkInBtn.classList.toggle("btn-success", nextAction === "checkIn");
  checkInBtn.classList.toggle("btn-outline-success", nextAction !== "checkIn");
  checkOutBtn.classList.toggle("btn-warning", nextAction === "checkOut");
  checkOutBtn.classList.toggle("btn-outline-warning", nextAction !== "checkOut");

  if (!assignedShift) {
    hint.className = "alert alert-warning py-2 mb-3";
    hint.textContent = "尚未分配班別，請管理員先到員工管理設定。";
    checkInBtn.disabled = true;
    checkOutBtn.disabled = true;
    return;
  }

  const now = new Date();
  const todayWindow = attendancePunchWindow(now, assignedShift);
  if (now < todayWindow.openAt || now > todayWindow.closeAt) {
    hint.className = "alert alert-warning py-2 mb-3";
    hint.textContent = `目前非打卡開放時間。今日開放時間為 ${punchWindowText(now, assignedShift)}。`;
    checkInBtn.disabled = true;
    checkOutBtn.disabled = true;
    return;
  }

  if (!lastRecord) {
    hint.className = "alert alert-info py-2 mb-3";
    hint.textContent = `今日尚未簽到。打卡開放時間為 ${punchWindowText(now, assignedShift)}，請先按「上班簽到」。`;
    checkInBtn.disabled = false;
    checkOutBtn.disabled = true;
    return;
  }
  if (lastRecord.type === "checkIn") {
    hint.className = "alert alert-success py-2 mb-3";
    hint.textContent = `目前已於 ${fmtTime(lastRecord.timestamp)} 簽到。外出或下班時請按「下班簽退」。`;
    checkInBtn.disabled = true;
    checkOutBtn.disabled = false;
    return;
  }
  hint.className = "alert alert-secondary py-2 mb-3";
  hint.textContent = `目前已於 ${fmtTime(lastRecord.timestamp)} 簽退。如需返回上班，可再次按「上班簽到」。`;
  checkInBtn.disabled = false;
  checkOutBtn.disabled = true;
}

function setPunching(isPunching, type) {
  const checkInBtn = qs("#checkInBtn");
  const checkOutBtn = qs("#checkOutBtn");
  checkInBtn.disabled = isPunching;
  checkOutBtn.disabled = isPunching;
  if (isPunching) {
    const label = type === "checkIn" ? "正在取得定位並簽到..." : "正在取得定位並簽退...";
    (type === "checkIn" ? checkInBtn : checkOutBtn).textContent = label;
    return;
  }
  checkInBtn.textContent = "上班簽到";
  checkOutBtn.textContent = "下班簽退";
}

function friendlyPunchError(error) {
  if (isLocationPermissionDenied(error)) {
    return "定位權限被拒絕。請點網址列左側圖示，允許位置權限後再試一次。";
  }
  if (error?.code === 2) return "目前無法取得定位，請確認定位服務已開啟。";
  if (error?.code === 3) return "取得定位逾時，請稍後再試。";
  return error?.message || "未知錯誤";
}

function isLocationPermissionDenied(error) {
  return error?.code === 1 || /denied geolocation|定位權限被拒絕/i.test(error?.message || "");
}

function showLocationPermissionHelp() {
  qs("#locationPermissionHelp")?.classList.remove("d-none");
}

function hideLocationPermissionHelp() {
  qs("#locationPermissionHelp")?.classList.add("d-none");
}

function mapLink(latitude, longitude) {
  if (typeof latitude !== "number" || typeof longitude !== "number") return "-";
  const label = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  const url = `https://www.google.com/maps?q=${latitude},${longitude}`;
  return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
}

function shiftText(shift) {
  return `${shift.name}（${shift.workStart} - ${shift.workEnd}）`;
}

function byTimestampAsc(a, b) {
  return toMillis(a.timestamp) - toMillis(b.timestamp);
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

const exceptionStatusLabels = {
  pending_employee_reason: "待填原因",
  pending_manager_review: "待主管審核",
  needs_more_info: "需補充",
  approved: "已核准",
  rejected: "已駁回",
  overdue: "已逾期"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

async function renderPasskeyStatus() {
  const snap = await getDocs(query(
    collection(db, "passkeyEnrollmentRequests"),
    where("userId", "==", profile.id)
  ));
  const row = snap.docs.map((item) => item.data()).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt))[0];
  const labels = {
    pending: "等待主管當面核准",
    approved: "主管已核准，請按「完成已核准註冊」",
    registered: "此帳號已有可用 Passkey",
    reset: "原 Passkey 已重設，請重新提出申請"
  };
  qs("#passkeyStatus").textContent = row ? labels[row.status] || row.status : "尚未提出裝置註冊申請";
  qs("#registerPasskeyBtn").disabled = row?.status !== "approved";
}

async function renderExceptions() {
  const snap = await getDocs(query(
    collection(db, "attendanceExceptions"),
    where("userId", "==", profile.id)
  ));
  const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const openRows = rows.filter((row) => ["pending_employee_reason", "needs_more_info", "overdue"].includes(row.status));
  qs("#exceptionCount").textContent = `${openRows.length} 筆待處理`;
  qs("#exceptionList").innerHTML = rows.length ? rows.slice(0, 8).map((row) => {
    const editable = ["pending_employee_reason", "needs_more_info", "overdue"].includes(row.status);
    return `<section class="border rounded p-3 mb-2 exception-card" data-case-id="${escapeHtml(row.id)}">
      <div class="d-flex justify-content-between gap-2 mb-2">
        <div><strong>${escapeHtml(row.date)}</strong> · ${escapeHtml(row.shiftName || row.workStart || "班別")}</div>
        <span class="badge text-bg-${editable ? "warning" : "secondary"}">${escapeHtml(exceptionStatusLabels[row.status] || row.status)}</span>
      </div>
      ${row.reviewNote ? `<div class="alert alert-light py-2 small">主管回覆：${escapeHtml(row.reviewNote)}</div>` : ""}
      ${editable ? `<form data-exception-form>
        <div class="row g-2">
          <div class="col-md-4"><select class="form-select form-select-sm" name="category" required>
            <option value="">選擇原因</option>
            <option value="forgot">忘記打卡</option>
            <option value="device_failure">裝置／Passkey 故障</option>
            <option value="fieldwork">外勤配置問題</option>
            <option value="leave_pending">請假尚待核准</option>
            <option value="other">其他</option>
          </select></div>
          <div class="col-md-6"><input class="form-control form-control-sm" name="reason" maxlength="1000" placeholder="請說明未打卡原因跟實際到達時間" value="${escapeHtml(row.reason || "")}" required></div>
          <div class="col-md-2 d-grid"><button class="btn btn-sm btn-primary">送主管審核</button></div>
        </div>
      </form>` : `<div class="small">${escapeHtml(row.reason || "尚無說明")}</div>`}
    </section>`;
  }).join("") : `<div class="muted">目前沒有未打卡案件</div>`;

  qs("#exceptionList").querySelectorAll("[data-exception-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const card = form.closest("[data-case-id]");
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        await callSecureFunction("submitExceptionReason", {
          caseId: card.dataset.caseId,
          category: form.elements.category.value,
          reason: form.elements.reason.value.trim()
        });
        showToast("原因已送交主管審核", "success");
        await renderExceptions();
      } catch (error) {
        showToast(error.message, "danger");
        button.disabled = false;
      }
    });
  });
}

qs("#requestPasskeyBtn").addEventListener("click", async () => {
  const button = qs("#requestPasskeyBtn");
  button.disabled = true;
  try {
    await requestPasskeyEnrollment(`${navigator.platform || "裝置"} · ${new Date().toLocaleDateString("zh-TW")}`);
    showToast("裝置申請已送出，請主管當面核准", "success");
    await renderPasskeyStatus();
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    button.disabled = false;
  }
});

qs("#retryLocationBtn").addEventListener("click", async () => {
  const button = qs("#retryLocationBtn");
  button.disabled = true;
  try {
    const location = await acquirePunchLocation();
    hideLocationPermissionHelp();
    showToast(`定位成功，精度約 ${Math.round(location.accuracy)} 公尺，可以重新打卡。`, "success");
  } catch (error) {
    showLocationPermissionHelp();
    showToast(friendlyPunchError(error), "danger");
  } finally {
    button.disabled = false;
  }
});

qs("#registerPasskeyBtn").addEventListener("click", async () => {
  const button = qs("#registerPasskeyBtn");
  button.disabled = true;
  try {
    await registerApprovedPasskey();
    showToast("Passkey 註冊完成，之後每次打卡都會要求生物辨識", "success");
    await renderPasskeyStatus();
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    button.disabled = false;
  }
});

qs("#checkInBtn").addEventListener("click", () => punch("checkIn"));
qs("#checkOutBtn").addEventListener("click", () => punch("checkOut"));
await Promise.all([render(), renderPasskeyStatus(), renderExceptions()]);
