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
import { callSecureFunction } from "./app.js";
import { acquirePunchLocation } from "./services/geolocation-service.js";
import { submitPunch } from "./services/attendance-service.js";

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
          打卡必須取得符合精度要求的 GPS 定位。若個人手機無法正常定位，請改用公務機；
          共用公務機使用完畢後務必登出。
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
    <div class="col-12">
      <div class="panel p-3 h-100 attendance-exception-panel">
        <div class="attendance-exception-header">
          <div>
            <h2 class="h5 mb-1">未打卡處理</h2>
            <div class="small muted">填寫實際到達時間與原因後，送交主管審核。</div>
          </div>
          <span class="attendance-exception-count" id="exceptionCount">0 筆待處理</span>
        </div>
        <div class="attendance-exception-note">
          <span aria-hidden="true">i</span>
          補打卡仍會保留案件與審核紀錄。
        </div>
        <div class="attendance-exception-tabs" role="tablist" aria-label="未打卡案件分類">
          <button type="button" class="is-active" data-exception-tab="action" role="tab">待處理 <span>0</span></button>
          <button type="button" data-exception-tab="review" role="tab">審核中 <span>0</span></button>
          <button type="button" data-exception-tab="completed" role="tab">已完成 <span>0</span></button>
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
    if (!canPunchOutsideWindow()) assertPunchWindowOpen(at, shift);
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
    await submitPunch(type, location);
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

function canPunchOutsideWindow() {
  return profile.workMode === "field";
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

  if (profile.attendanceRequired === false) {
    hint.className = "alert alert-info py-2 mb-3";
    hint.textContent = "此帳號已設定為免打卡人員，不需要進行簽到或簽退。";
    checkInBtn.disabled = true;
    checkOutBtn.disabled = true;
    return;
  }

  if (!assignedShift) {
    hint.className = "alert alert-warning py-2 mb-3";
    hint.textContent = "尚未分配班別，請管理員先到員工管理設定。";
    checkInBtn.disabled = true;
    checkOutBtn.disabled = true;
    return;
  }

  const now = new Date();
  const todayWindow = attendancePunchWindow(now, assignedShift);
  if (!canPunchOutsideWindow() && (now < todayWindow.openAt || now > todayWindow.closeAt)) {
    hint.className = "alert alert-warning py-2 mb-3";
    hint.textContent = `目前非打卡開放時間。今日開放時間為 ${punchWindowText(now, assignedShift)}。`;
    checkInBtn.disabled = true;
    checkOutBtn.disabled = true;
    return;
  }

  if (!lastRecord) {
    hint.className = "alert alert-info py-2 mb-3";
    hint.textContent = canPunchOutsideWindow()
      ? "外勤人員不限打卡時段。請先停妥車輛並確認安全，再按「上班簽到」。"
      : `今日尚未簽到。打卡開放時間為 ${punchWindowText(now, assignedShift)}，請先按「上班簽到」。`;
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

const exceptionCategoryLabels = {
  forgot: "忘記打卡",
  device_failure: "裝置故障",
  fieldwork: "外勤配置問題",
  leave_pending: "請假尚待核准",
  other: "其他"
};

function formatExceptionDate(value) {
  const parts = String(value || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return escapeHtml(value || "-");
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][new Date(parts[0], parts[1] - 1, parts[2]).getDay()];
  return `${String(parts[1]).padStart(2, "0")}/${String(parts[2]).padStart(2, "0")}（${weekday}）`;
}

function exceptionCategoryOptions(selectedValue) {
  return [
    ["", "選擇原因"],
    ...Object.entries(exceptionCategoryLabels)
  ].map(([value, label]) => (
    `<option value="${escapeHtml(value)}"${selectedValue === value ? " selected" : ""}>${escapeHtml(label)}</option>`
  )).join("");
}

function employeeExceptionCard(row, index, editable) {
  const status = exceptionStatusLabels[row.status] || row.status;
  const statusClass = row.status === "overdue"
    ? "is-overdue"
    : row.status === "approved" ? "is-approved" : row.status === "rejected" ? "is-rejected" : "";
  const workStart = row.workStart || row.shiftName || "09:00";
  return `<details class="attendance-exception-case ${statusClass}" data-case-id="${escapeHtml(row.id)}"${editable && index === 0 ? " open" : ""}>
    <summary class="attendance-exception-summary">
      <time datetime="${escapeHtml(row.date)}">${formatExceptionDate(row.date)}</time>
      <span class="attendance-exception-title">
        <strong>上班未打卡</strong>
        <small>${escapeHtml(row.shiftName || "當日班別")} · 應到 ${escapeHtml(workStart)}</small>
      </span>
      <span class="attendance-exception-status">${escapeHtml(status)}</span>
      <span class="attendance-exception-toggle" aria-hidden="true">展開</span>
    </summary>
    <div class="attendance-exception-body">
      ${row.reviewNote ? `<div class="attendance-exception-reply"><strong>主管回覆</strong><span>${escapeHtml(row.reviewNote)}</span></div>` : ""}
      ${editable ? `<form data-exception-form>
        <div class="attendance-exception-fields">
          <label>
            <span>未打卡原因</span>
            <select class="form-select" name="category" required>
              ${exceptionCategoryOptions(row.reasonCategory || "")}
            </select>
          </label>
          <label>
            <span>實際到達時間</span>
            <input class="form-control" type="time" name="requestedTime" value="${escapeHtml(row.requestedTime || row.workStart || "09:00")}" required>
          </label>
          <label class="attendance-exception-reason">
            <span>補充說明</span>
            <textarea class="form-control" name="reason" maxlength="1000" rows="2" placeholder="請簡要說明未打卡原因" required>${escapeHtml(row.reason || "")}</textarea>
          </label>
        </div>
        <div class="attendance-exception-actions">
          <span>送出後可在「審核中」查看進度</span>
          <button class="btn btn-primary">送出審核</button>
        </div>
      </form>` : `<dl class="attendance-exception-facts">
        <div><dt>填報原因</dt><dd>${escapeHtml(exceptionCategoryLabels[row.reasonCategory] || row.reasonCategory || "未分類")}</dd></div>
        <div><dt>實際到達</dt><dd>${escapeHtml(row.requestedTime || row.workStart || "-")}</dd></div>
        <div><dt>補充說明</dt><dd>${escapeHtml(row.reason || "尚無說明")}</dd></div>
      </dl>`}
    </div>
  </details>`;
}

async function renderExceptions() {
  const snap = await getDocs(query(
    collection(db, "attendanceExceptions"),
    where("userId", "==", profile.id)
  ));
  const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const openRows = rows.filter((row) => ["pending_employee_reason", "needs_more_info", "overdue"].includes(row.status));
  const reviewRows = rows.filter((row) => row.status === "pending_manager_review");
  const completedRows = rows.filter((row) => !openRows.includes(row) && !reviewRows.includes(row));
  qs("#exceptionCount").textContent = `${openRows.length} 筆待處理`;
  const groups = [
    ["action", openRows, "目前沒有需要你處理的案件"],
    ["review", reviewRows, "目前沒有審核中的案件"],
    ["completed", completedRows, "目前沒有已完成的案件"]
  ];
  const defaultTab = openRows.length ? "action" : reviewRows.length ? "review" : "completed";
  document.querySelectorAll("[data-exception-tab]").forEach((button) => {
    const group = groups.find(([name]) => name === button.dataset.exceptionTab);
    button.querySelector("span").textContent = group[1].length;
    button.classList.toggle("is-active", button.dataset.exceptionTab === defaultTab);
    button.setAttribute("aria-selected", String(button.dataset.exceptionTab === defaultTab));
  });
  qs("#exceptionList").innerHTML = groups.map(([name, groupRows, emptyText]) => `
    <div class="attendance-exception-list" data-exception-panel="${name}"${name === defaultTab ? "" : " hidden"}>
      ${groupRows.length
        ? groupRows.slice(0, 8).map((row, index) => employeeExceptionCard(row, index, name === "action")).join("")
        : `<div class="attendance-exception-empty">${escapeHtml(emptyText)}</div>`}
    </div>
  `).join("");

  document.querySelectorAll("[data-exception-tab]").forEach((button) => {
    button.onclick = () => {
      document.querySelectorAll("[data-exception-tab]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      qs("#exceptionList").querySelectorAll("[data-exception-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.exceptionPanel !== button.dataset.exceptionTab;
      });
    };
  });

  qs("#exceptionList").querySelectorAll(".attendance-exception-case").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      details.closest("[data-exception-panel]").querySelectorAll(".attendance-exception-case[open]").forEach((item) => {
        if (item !== details) item.open = false;
      });
    });
  });

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
          requestedTime: form.elements.requestedTime.value,
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

qs("#checkInBtn").addEventListener("click", () => punch("checkIn"));
qs("#checkOutBtn").addEventListener("click", () => punch("checkOut"));
await Promise.all([render(), renderExceptions()]);
