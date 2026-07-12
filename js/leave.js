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
const proxyCandidates = await loadProxyCandidates();

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
          <input class="form-control" id="endTime" type="datetime-local" step="3600" required>
          <div class="form-text">只計算班別上班時間，會自動扣除午休、六日與系統設定休息日；請假時數必須為整數小時，每天最多 ${settings.standardHours || 8} 小時。</div>
        </div>
        <div class="alert alert-secondary py-2" id="leaveHoursPreview">請選擇開始與結束時間。</div>
        <div class="mb-3">
          <label class="form-label" for="proxyUserId">職務代理人</label>
          <select class="form-select" id="proxyUserId">
            <option value="">未指定</option>
            ${proxyCandidates.map((user) => `<option value="${user.id}" ${profile.proxyUserId === user.id ? "selected" : ""}>${escapeHtml(user.name || user.email || user.id)}</option>`).join("")}
          </select>
          <div class="form-text">請假期間由代理人協助交接工作；預設值可由管理員在員工管理設定。</div>
        </div>
        <div class="mb-3"><label class="form-label" for="reason">原因</label><textarea class="form-control" id="reason" rows="3" required></textarea></div>
        <button class="btn btn-primary w-100">送出申請</button>
      </form>
    </div>
    <div class="col-lg-7">
      <div class="panel p-3">
        <h2 class="h5 mb-3">我的請假紀錄</h2>
        <div class="table-responsive"><table class="table align-middle mb-0">
          <thead><tr><th>假別</th><th>時間</th><th>時數</th><th>狀態</th><th>列印</th></tr></thead>
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
  if (!isWholeHourValue(hours)) {
    showToast("請假時數必須為整數小時，請調整結束時間", "warning");
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
  const proxyUserId = qs("#proxyUserId").value;
  const proxyUser = proxyCandidates.find((item) => item.id === proxyUserId);
  await addDoc(collection(db, "leaveRequests"), {
    userId: profile.id,
    userName: profile.name,
    department: profile.department || "",
    managerId: profile.managerId || "",
    managerName: profile.managerName || "",
    proxyUserId,
    proxyUserName: proxyUser?.name || proxyUser?.email || "",
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
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    qs("#rows").innerHTML = rows.length
      ? rows.map((row) => {
        return `<tr>
          <td>${leaveTypeLabel(row.leaveType)}</td>
          <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
          <td>${row.hours}</td>
          <td>${badge(row.status)}</td>
          <td><button class="btn btn-sm btn-outline-primary" data-print-leave="${row.id}">列印PDF</button></td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="5" class="muted">尚無請假紀錄</td></tr>`;

    qs("#rows").querySelectorAll("[data-print-leave]").forEach((button) => {
      const row = rows.find((item) => item.id === button.dataset.printLeave);
      button.addEventListener("click", () => openLeavePrintView(row));
    });
  } catch (error) {
    qs("#rows").innerHTML = `<tr><td colspan="5" class="text-danger">讀取請假紀錄失敗：${error.message}</td></tr>`;
  }
}

function openLeavePrintView(row) {
  if (!row) return;
  const popup = window.open("", "_blank", "width=980,height=620");
  if (!popup) {
    showToast("瀏覽器封鎖了列印視窗，請允許彈出視窗後再試一次。", "warning");
    return;
  }
  popup.document.open();
  popup.document.write(leavePrintHtml(row));
  popup.document.close();
  popup.focus();
}

function leavePrintHtml(row) {
  const start = toDate(row.startTime);
  const end = toDate(row.endTime);
  const hours = Number(row.hours || 0);
  const fullDays = Math.floor(hours / Number(settings.standardHours || 8));
  const remainingHours = Number((hours % Number(settings.standardHours || 8)).toFixed(2));
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>請假單 - ${escapeHtml(row.userName || profile.name || "")}</title>
  <style>
    @page { size: A4 portrait; margin: 9mm 12mm; }
    * { box-sizing: border-box; }
    html, body { width: 210mm; min-height: 297mm; }
    body { font-family: "DFKai-SB", "標楷體", "Microsoft JhengHei", serif; color: #000; margin: 0; background: #fff; }
    .sheet { width: 186mm; margin: 0 auto; page-break-inside: avoid; }
    .form-copy { min-height: 131mm; padding-top: 3mm; }
    .cut-line { border-top: 1px dashed #8a8a8a; margin: 5mm 0; }
    .company { text-align: center; font-size: 17pt; letter-spacing: .72em; padding-left: .72em; margin-bottom: 2.5mm; }
    .title { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: end; font-size: 15pt; margin-bottom: 5mm; border-bottom: 2px solid #000; padding-bottom: 1.2mm; }
    .title span { text-align: center; border-bottom: 1px solid #000; padding-bottom: 1mm; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11.5pt; line-height: 1.35; border: 2px solid #000; }
    td { border: 1px solid #000; height: 11.5mm; padding: 1.7mm 2.2mm; vertical-align: middle; overflow-wrap: anywhere; }
    .label { text-align: center; font-weight: 700; white-space: nowrap; }
    .center { text-align: center; }
    .date-cell { letter-spacing: .18em; }
    .period-label { text-align: center; font-weight: 700; font-size: 11pt; }
    .period-cell { font-size: 11pt; line-height: 1.45; padding-left: 4mm; white-space: nowrap; }
    .period-prefix { display: inline-block; width: 9mm; font-weight: 700; }
    .hours-cell { font-size: 12pt; letter-spacing: .12em; }
    .sign { height: 20mm; vertical-align: top; }
    .note { height: 21mm; vertical-align: top; padding: 3mm 4mm; }
    .print-actions { margin: 6mm auto 0; text-align: center; }
    .print-actions button { font: 16px "Microsoft JhengHei", sans-serif; padding: 8px 18px; }
    @media print {
      html, body { width: auto; min-height: auto; }
      .print-actions { display: none; }
      .sheet { width: 100%; }
      .form-copy { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${leavePrintFormCopy(row, start, end, fullDays, remainingHours)}
    <div class="cut-line"></div>
    ${leavePrintFormCopy(row, start, end, fullDays, remainingHours)}
    <div class="print-actions"><button onclick="window.print()">列印 / 另存 PDF</button></div>
  </div>
</body>
</html>`;
}

function leavePrintFormCopy(row, start, end, fullDays, remainingHours) {
  return `
    <div class="form-copy">
      <div class="company">竣貿國際股份有限公司</div>
      <div class="title"><span>請</span><span>假</span><span>單</span></div>
      <table>
        <colgroup>
          <col style="width: 12%;">
          <col style="width: 13%;">
          <col style="width: 12%;">
          <col style="width: 13%;">
          <col style="width: 10%;">
          <col style="width: 16%;">
          <col style="width: 12%;">
          <col style="width: 12%;">
        </colgroup>
        <tr>
          <td class="label">中華民國</td>
          <td colspan="5" class="center date-cell">${start.getFullYear() - 1911} 年 ${start.getMonth() + 1} 月 ${start.getDate()} 日</td>
          <td class="label">星期</td>
          <td class="center">${weekdayLabel(start)}</td>
        </tr>
        <tr>
          <td class="label">單位</td>
          <td class="center">${escapeHtml(row.department || profile.department || "")}</td>
          <td class="label">假別</td>
          <td class="center">${escapeHtml(leaveTypeLabel(row.leaveType))}</td>
          <td class="period-label">請假期間</td>
          <td colspan="3" class="period-cell"><span class="period-prefix">自</span>民國 ${start.getFullYear() - 1911} 年 ${start.getMonth() + 1} 月 ${start.getDate()} 日 ${pad2(start.getHours())} 時 ${pad2(start.getMinutes())} 分</td>
        </tr>
        <tr>
          <td class="label">姓名</td>
          <td class="center">${escapeHtml(row.userName || profile.name || "")}</td>
          <td class="label">事由</td>
          <td class="center">${escapeHtml(row.reason || "")}</td>
          <td></td>
          <td colspan="3" class="period-cell"><span class="period-prefix">至</span>民國 ${end.getFullYear() - 1911} 年 ${end.getMonth() + 1} 月 ${end.getDate()} 日 ${pad2(end.getHours())} 時 ${pad2(end.getMinutes())} 分</td>
        </tr>
        <tr>
          <td class="label" colspan="2">請假時數</td>
          <td colspan="6" class="center hours-cell">計 ${fullDays} 天 ${remainingHours} 小時 0 分</td>
        </tr>
        <tr>
          <td class="label" colspan="2">核准簽章</td>
          <td colspan="6" class="sign"></td>
        </tr>
        <tr>
          <td class="label" colspan="2">備註</td>
          <td colspan="6" class="note">職務代理人：${escapeHtml(row.proxyUserName || "")}</td>
        </tr>
      </table>
    </div>`;
}

async function loadProxyCandidates() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((user) => user.id !== profile.id && user.isActive !== false)
    .filter((user) => !profile.department || !user.department || user.department === profile.department)
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "zh-Hant"));
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

function toDate(value) {
  if (!value) return new Date("");
  return value.toDate ? value.toDate() : new Date(value);
}

function weekdayLabel(date) {
  return ["日", "一", "二", "三", "四", "五", "六"][date.getDay()] || "";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function syncMinimumEndTime() {
  const startInput = qs("#startTime");
  const endInput = qs("#endTime");
  if (!startInput.value) return;
  const minEnd = new Date(startInput.value);
  minEnd.setHours(minEnd.getHours() + 1);
  endInput.min = toDatetimeLocalValue(minEnd);
  endInput.step = "3600";
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
  const skippedDays = countSkippedRestDays(new Date(startInput.value), new Date(endInput.value));
  const wholeHour = isWholeHourValue(hours);
  preview.className = hours >= 1 && wholeHour ? "alert alert-info py-2" : "alert alert-warning py-2";
  const unitWarning = hours >= 1 && !wholeHour ? "；請假時數必須為整數小時，請調整結束時間" : "";
  preview.textContent = `預計請假時數：${hours} 小時（班別 ${assignedShift.name}，午休 ${settings.lunchStart} - ${settings.lunchEnd}、六日/休息日已扣除${skippedDays ? `，略過 ${skippedDays} 天休息日` : ""}）${unitWarning}`;
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

function isWholeHourValue(value) {
  return Math.abs(value - Math.round(value)) < 0.0001;
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
