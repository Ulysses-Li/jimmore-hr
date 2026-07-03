import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, requireAuth, bindLogout, pageChrome, qs, badge, fmtDateTime, hoursBetween, showToast, leaveTypes, leaveTypeLabel, getWorkSettings, timeToDate, todayKey } from "./app.js";

document.body.innerHTML = `<div class="app-shell d-flex">${pageChrome("請假申請", "建立請假單並追蹤審核狀態")}</div>`;
const profile = await requireAuth();
bindLogout();
const settings = await getWorkSettings();
const assignedShift = getAssignedShift();
const assignedShiftValid = isTimeRangeValid(assignedShift.workStart, assignedShift.workEnd);

qs("#pageContent").innerHTML = `
  <div class="row g-3">
    <div class="col-lg-5">
      <form class="panel p-3" id="leaveForm">
        <h2 class="h5 mb-3">新增請假單</h2>
        <div class="mb-3">
          <label class="form-label" for="leaveType">假別</label>
          <select class="form-select" id="leaveType" required>
            ${leaveTypes.map((item) => `<option value="${item.value}">${item.label}</option>`).join("")}
          </select>
        </div>
        <div class="mb-3"><label class="form-label" for="startTime">開始時間</label><input class="form-control" id="startTime" type="datetime-local" required></div>
        <div class="mb-3">
          <label class="form-label" for="endTime">結束時間</label>
          <input class="form-control" id="endTime" type="datetime-local" required>
          <div class="form-text">只計算班別上班時間，會自動扣除午休、六日與系統設定休息日；每天最多 ${settings.standardHours || 8} 小時。</div>
        </div>
        <div class="alert alert-secondary py-2" id="leaveHoursPreview">請選擇開始與結束時間。</div>
        <div class="mb-3"><label class="form-label" for="reason">原因</label><textarea class="form-control" id="reason" rows="3" required></textarea></div>
        <button class="btn btn-primary w-100">送出申請</button>
      </form>
    </div>
    <div class="col-lg-7">
      <div class="panel p-3">
        <h2 class="h5 mb-3">我的請假紀錄</h2>
        <div class="table-responsive"><table class="table align-middle mb-0">
          <thead><tr><th>假別</th><th>時間</th><th>時數</th><th>狀態</th></tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
      </div>
    </div>
  </div>`;

qs("#leaveForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const start = new Date(qs("#startTime").value);
  const end = new Date(qs("#endTime").value);
  if (!assignedShiftValid) {
    showToast(`班別 ${assignedShift.name} 時間設定錯誤，請管理員修正上班/下班時間`, "danger");
    return;
  }
  const hours = calculateWorkingLeaveHours(start, end);
  if (hours < 1) {
    showToast("有效請假時間最少要 1 小時，且必須落在員工班別上班時間內", "warning");
    return;
  }
  const type = qs("#leaveType").value;
  if (type === "annual" && hours > Number(profile.annualLeaveHours || 0)) {
    showToast("特休餘額不足", "warning");
    return;
  }
  if (type === "compensatory" && hours > Number(profile.compensatoryLeaveHours || 0)) {
    showToast("補休餘額不足", "warning");
    return;
  }
  await addDoc(collection(db, "leaveRequests"), {
    userId: profile.id,
    userName: profile.name,
    department: profile.department || "",
    leaveType: type,
    shiftId: assignedShift.id,
    shiftName: assignedShift.name,
    workStart: assignedShift.workStart,
    workEnd: assignedShift.workEnd,
    startTime: start,
    endTime: end,
    hours: Number(hours.toFixed(2)),
    reason: qs("#reason").value.trim(),
    status: "pending",
    approvedBy: "",
    approvedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  event.target.reset();
  showToast("請假申請已送出", "success");
  await render();
});

async function render() {
  try {
    const snap = await getDocs(query(
      collection(db, "leaveRequests"),
      where("userId", "==", profile.id)
    ));
    const rows = snap.docs
      .map((item) => item.data())
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    qs("#rows").innerHTML = rows.length
      ? rows.map((row) => {
        return `<tr>
          <td>${leaveTypeLabel(row.leaveType)}</td>
          <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
          <td>${row.hours}</td>
          <td>${badge(row.status)}</td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="4" class="muted">尚無請假紀錄</td></tr>`;
  } catch (error) {
    qs("#rows").innerHTML = `<tr><td colspan="4" class="text-danger">讀取請假紀錄失敗：${error.message}</td></tr>`;
  }
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

function syncMinimumEndTime() {
  const startInput = qs("#startTime");
  const endInput = qs("#endTime");
  if (!startInput.value) return;
  const minEnd = new Date(startInput.value);
  minEnd.setHours(minEnd.getHours() + 1);
  endInput.min = toDatetimeLocalValue(minEnd);
  if (!endInput.value || new Date(endInput.value) < minEnd) {
    endInput.value = endInput.min;
  }
}

function updateLeaveHoursPreview() {
  const startInput = qs("#startTime");
  const endInput = qs("#endTime");
  const preview = qs("#leaveHoursPreview");
  if (!startInput.value || !endInput.value) {
    preview.className = "alert alert-secondary py-2";
    preview.textContent = assignedShiftValid
      ? "請選擇開始與結束時間。"
      : `班別 ${assignedShift.name} 時間設定錯誤：${assignedShift.workStart} - ${assignedShift.workEnd}。請管理員修正。`;
    return;
  }
  if (!assignedShiftValid) {
    preview.className = "alert alert-danger py-2";
    preview.textContent = `班別 ${assignedShift.name} 時間設定錯誤：下班時間必須晚於上班時間。`;
    return;
  }
  const hours = calculateWorkingLeaveHours(new Date(startInput.value), new Date(endInput.value));
  preview.className = hours >= 1 ? "alert alert-info py-2" : "alert alert-warning py-2";
  const skippedDays = countSkippedRestDays(new Date(startInput.value), new Date(endInput.value));
  preview.textContent = `預計請假時數：${hours} 小時（班別 ${assignedShift.name}，午休 ${settings.lunchStart} - ${settings.lunchEnd}、六日/休息日已扣除${skippedDays ? `，略過 ${skippedDays} 天休息日` : ""}）`;
}

function calculateWorkingLeaveHours(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) return 0;
  let total = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const finalDay = new Date(end);
  finalDay.setHours(0, 0, 0, 0);

  while (cursor <= finalDay) {
    const dateKey = todayKey(cursor);
    if (isRestDay(cursor, dateKey)) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }
    const workStart = timeToDate(dateKey, assignedShift.workStart);
    const workEnd = timeToDate(dateKey, assignedShift.workEnd);
    const lunchStart = timeToDate(dateKey, settings.lunchStart);
    const lunchEnd = timeToDate(dateKey, settings.lunchEnd);

    const segmentStart = maxDate(start, workStart);
    const segmentEnd = minDate(end, workEnd);
    let dayHours = hoursBetween(segmentStart, segmentEnd);
    dayHours -= overlapHours(segmentStart, segmentEnd, lunchStart, lunchEnd);
    dayHours = Math.max(0, Math.min(dayHours, Number(settings.standardHours || 8)));
    total += dayHours;
    cursor.setDate(cursor.getDate() + 1);
  }

  return Number(total.toFixed(2));
}

function countSkippedRestDays(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const finalDay = new Date(end);
  finalDay.setHours(0, 0, 0, 0);

  while (cursor <= finalDay) {
    const dateKey = todayKey(cursor);
    if (isRestDay(cursor, dateKey)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
}

function isRestDay(date, dateKey = todayKey(date)) {
  return isWeekend(date) || configuredHolidayDates().has(dateKey);
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function configuredHolidayDates() {
  return new Set(Array.isArray(settings.holidayDates) ? settings.holidayDates : []);
}

function overlapHours(start, end, blockStart, blockEnd) {
  return hoursBetween(maxDate(start, blockStart), minDate(end, blockEnd));
}

function maxDate(a, b) {
  return a > b ? a : b;
}

function minDate(a, b) {
  return a < b ? a : b;
}

function getAssignedShift() {
  const shifts = Array.isArray(settings.workShifts) && settings.workShifts.length
    ? settings.workShifts
    : [{ id: "default", name: "預設班別", workStart: settings.workStart || "09:00", workEnd: settings.workEnd || "18:00" }];
  return shifts.find((shift) => shift.id === profile.defaultShiftId) || shifts[0];
}

function isTimeRangeValid(start, end) {
  return timeToMinutes(end) > timeToMinutes(start);
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function toDatetimeLocalValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

qs("#startTime").addEventListener("change", () => {
  syncMinimumEndTime();
  updateLeaveHoursPreview();
});
qs("#endTime").addEventListener("change", updateLeaveHoursPreview);
updateLeaveHoursPreview();
await render();
