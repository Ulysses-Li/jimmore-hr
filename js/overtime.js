import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { db, requireAuth, bindLogout, mountPageShell, qs, badge, fmtDateTime, getWorkSettings, hoursBetween, showToast } from "./app.js";

mountPageShell("加班申請", "建立加班單並選擇是否轉補休");
const profile = await requireAuth();
const settings = await getWorkSettings();
const maxOvertimeHours = 8;
bindLogout();

qs("#pageContent").innerHTML = `
  <div class="row g-3">
    <div class="col-lg-5">
      <form class="panel p-3" id="overtimeForm">
        <h2 class="h5 mb-3">新增加班單</h2>
        <div class="mb-3"><label class="form-label" for="startTime">開始時間</label><input class="form-control" id="startTime" type="datetime-local" required></div>
        <div class="mb-3">
          <label class="form-label" for="endTime">結束時間</label>
          <input class="form-control" id="endTime" type="datetime-local" required>
          <div class="form-text">最少加班 1 小時、單筆最多 ${maxOvertimeHours} 小時；跨過午休 ${settings.lunchStart || "12:00"}–${settings.lunchEnd || "13:00"} 會自動扣除。</div>
        </div>
        <div class="alert alert-info py-2" id="overtimeHoursPreview">請選擇開始與結束時間。</div>
        <div class="mb-3">
          <label class="form-label" for="location">地點</label>
          <input class="form-control" id="location" type="text" maxlength="100" placeholder="例如：公司、台北客戶辦公室" required>
        </div>
        <div class="mb-3"><label class="form-label" for="reason">原因</label><textarea class="form-control" id="reason" rows="3" required></textarea></div>
        <div class="form-check form-switch mb-3">
          <input class="form-check-input" type="checkbox" id="convertToCompTime" checked>
          <label class="form-check-label" for="convertToCompTime">核准後轉為補休</label>
        </div>
        <button class="btn btn-primary w-100">送出申請</button>
      </form>
    </div>
    <div class="col-lg-7">
      <div class="panel p-3">
        <h2 class="h5 mb-3">我的加班紀錄</h2>
        <div class="table-responsive"><table class="table align-middle mb-0">
          <thead><tr><th>時間</th><th>地點</th><th>時數</th><th>補休</th><th>狀態</th><th>列印</th></tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
      </div>
    </div>
  </div>`;

qs("#overtimeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const start = new Date(qs("#startTime").value);
  const end = new Date(qs("#endTime").value);
  const hours = calculateOvertimeHours(start, end);
  if (hours < 1) {
    showToast("加班時間最少要 1 小時", "warning");
    return;
  }
  await addDoc(collection(db, "overtimeRequests"), {
    userId: profile.id,
    userName: profile.name,
    department: profile.department || "",
    managerId: profile.managerId || "",
    managerName: profile.managerName || "",
    startTime: start,
    endTime: end,
    hours: Number(hours.toFixed(2)),
    location: qs("#location").value.trim(),
    reason: qs("#reason").value.trim(),
    convertToCompTime: qs("#convertToCompTime").checked,
    status: "pending",
    approvedBy: "",
    approvedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  event.target.reset();
  qs("#convertToCompTime").checked = true;
  showToast("加班申請已送出", "success");
  await render();
});

async function render() {
  try {
    const snap = await getDocs(query(
      collection(db, "overtimeRequests"),
      where("userId", "==", profile.id)
    ));
    const rows = snap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    qs("#rows").innerHTML = rows.length
      ? rows.map((row) => {
        return `<tr>
          <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
          <td>${escapeHtml(row.location || "-")}</td>
          <td>${cappedOvertimeHours(row.hours)}</td>
          <td>${row.convertToCompTime ? "是" : "否"}</td>
          <td>${badge(row.status)}</td>
          <td><button class="btn btn-sm btn-outline-primary" type="button" data-print-overtime="${row.id}">列印PDF</button></td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="6" class="muted">尚無加班紀錄</td></tr>`;

    qs("#rows").querySelectorAll("[data-print-overtime]").forEach((button) => {
      const row = rows.find((item) => item.id === button.dataset.printOvertime);
      button.addEventListener("click", () => openOvertimePrintView(row));
    });
  } catch (error) {
    qs("#rows").innerHTML = `<tr><td colspan="6" class="text-danger">讀取加班紀錄失敗：${error.message}</td></tr>`;
  }
}

function openOvertimePrintView(row) {
  if (!row) return;
  const popup = window.open("", "_blank", "width=980,height=760");
  if (!popup) {
    showToast("瀏覽器封鎖了列印視窗，請允許彈出視窗後再試一次。", "warning");
    return;
  }
  popup.document.open();
  popup.document.write(overtimePrintHtml(row));
  popup.document.close();
  popup.focus();
}

function overtimePrintHtml(row) {
  const start = toDate(row.startTime);
  const end = toDate(row.endTime);
  const totalMinutes = Math.round(cappedOvertimeHours(row.hours) * 60);
  const days = Math.floor(totalMinutes / 1440);
  const remainingMinutes = totalMinutes % 1440;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>加班申請單 - ${escapeHtml(row.userName || profile.name || "")}</title>
  <style>
    @page { size: A4 portrait; margin: 9mm 12mm; }
    * { box-sizing: border-box; }
    html, body { width: 210mm; min-height: 297mm; }
    body { margin: 0; background: #fff; color: #000; font-family: "DFKai-SB", "標楷體", "Microsoft JhengHei", serif; }
    .sheet { width: 186mm; margin: 0 auto; page-break-inside: avoid; }
    .form-copy { min-height: 131mm; padding-top: 3mm; }
    .company { text-align: center; font-size: 17pt; letter-spacing: .42em; padding-left: .42em; margin-bottom: 3mm; }
    .title { text-align: center; font-size: 20pt; font-weight: 700; letter-spacing: .32em; padding: 0 0 2.5mm .32em; margin-bottom: 5mm; border-bottom: 3px double #000; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11.5pt; line-height: 1.35; border: 2px solid #000; }
    td { border: 1px solid #000; height: 11.5mm; padding: 1.7mm 2.2mm; vertical-align: middle; overflow-wrap: anywhere; }
    .label { text-align: center; font-weight: 700; white-space: nowrap; }
    .center { text-align: center; }
    .date-cell { letter-spacing: .18em; }
    .period-label { text-align: center; font-weight: 700; font-size: 11pt; line-height: 1.35; }
    .period-cell { font-size: 10.5pt; padding: 1.7mm 2.2mm; white-space: nowrap; }
    .period-line { display: flex; align-items: center; justify-content: space-between; gap: .6mm; width: 100%; }
    .period-prefix { font-weight: 700; }
    .hours-cell { font-size: 12pt; letter-spacing: .12em; }
    .description-label { text-align: center; font-weight: 700; font-size: 12pt; line-height: 1.5; }
    .description { height: 30mm; vertical-align: top; padding: 3mm 4mm; white-space: pre-wrap; }
    .method { text-align: center; font-size: 12pt; }
    .signature { height: 19mm; text-align: center; vertical-align: bottom; padding-bottom: 3mm; }
    .print-actions { margin: 6mm auto 0; text-align: center; }
    .print-actions button { font: 16px "Microsoft JhengHei", sans-serif; padding: 8px 18px; }
    @media print {
      html, body { width: auto; min-height: auto; }
      .sheet { width: 100%; }
      .form-copy { break-inside: avoid; }
      .print-actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="form-copy">
      <div class="company">竣貿國際股份有限公司</div>
      <div class="title">加班申請單</div>
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
          <td class="label">地點</td>
          <td class="center">${escapeHtml(row.location || "")}</td>
          <td rowspan="2" class="period-label">加班期間</td>
          <td colspan="3" class="period-cell">${rocPeriodLine("自", start)}</td>
        </tr>
        <tr>
          <td class="label">姓名</td>
          <td class="center">${escapeHtml(row.userName || profile.name || "")}</td>
          <td class="label">申請方式</td>
          <td class="center">${row.convertToCompTime ? "時數補休" : "請領加班費"}</td>
          <td colspan="3" class="period-cell">${rocPeriodLine("至", end)}</td>
        </tr>
        <tr>
          <td class="label" colspan="2">加班時數</td>
          <td colspan="6" class="center hours-cell">計 ${days} 天 ${hours} 小時 ${minutes} 分</td>
        </tr>
        <tr>
          <td colspan="2" class="description-label">備註及工作說明</td>
          <td colspan="6" class="description">${escapeHtml(row.reason || "")}</td>
        </tr>
        <tr>
          <td colspan="2" class="label">勾選申請方式</td>
          <td colspan="3" class="method">${row.convertToCompTime ? "☑" : "□"} 時數補休</td>
          <td colspan="3" class="method">${row.convertToCompTime ? "□" : "☑"} 請領加班費</td>
        </tr>
        <tr>
          <td colspan="2" class="label">核准簽章</td>
          <td colspan="2" class="signature">${escapeHtml(row.approvedByName || "")}</td>
          <td colspan="2" class="label">會計人員</td>
          <td colspan="2" class="signature"></td>
        </tr>
      </table>
    </div>
    <div class="print-actions"><button onclick="window.print()">列印 / 另存 PDF</button></div>
  </div>
</body>
</html>`;
}

function toDate(value) {
  if (!value) return new Date("");
  return value.toDate ? value.toDate() : new Date(value);
}

function weekdayLabel(date) {
  return ["日", "一", "二", "三", "四", "五", "六"][date.getDay()] || "";
}

function rocPeriodLine(prefix, date) {
  return `<div class="period-line"><span class="period-prefix">${prefix}</span><span>民國</span><span>${date.getFullYear() - 1911}</span><span>年</span><span>${date.getMonth() + 1}</span><span>月</span><span>${date.getDate()}</span><span>日</span><span>${String(date.getHours()).padStart(2, "0")}</span><span>時</span><span>${String(date.getMinutes()).padStart(2, "0")}</span><span>分</span></div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
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

function calculateOvertimeHours(start, end) {
  return Math.min(
    maxOvertimeHours,
    calculateHoursExcludingLunch(start, end, settings.lunchStart || "12:00", settings.lunchEnd || "13:00")
  );
}

function cappedOvertimeHours(hours) {
  return Math.min(maxOvertimeHours, Math.max(0, Number(hours || 0)));
}

function calculateHoursExcludingLunch(start, end, lunchStart, lunchEnd) {
  let lunchMilliseconds = 0;
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  const lastDay = new Date(end);
  lastDay.setHours(0, 0, 0, 0);
  while (day <= lastDay) {
    const lunchFrom = new Date(day);
    const lunchTo = new Date(day);
    const [startHour, startMinute] = lunchStart.split(":").map(Number);
    const [endHour, endMinute] = lunchEnd.split(":").map(Number);
    lunchFrom.setHours(startHour, startMinute, 0, 0);
    lunchTo.setHours(endHour, endMinute, 0, 0);
    lunchMilliseconds += Math.max(
      0,
      Math.min(end.getTime(), lunchTo.getTime()) - Math.max(start.getTime(), lunchFrom.getTime())
    );
    day.setDate(day.getDate() + 1);
  }
  return Number(Math.max(0, hoursBetween(start, end) - lunchMilliseconds / 36e5).toFixed(2));
}

function updateHoursPreview() {
  const start = new Date(qs("#startTime").value);
  const end = new Date(qs("#endTime").value);
  const preview = qs("#overtimeHoursPreview");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    preview.textContent = "請選擇有效的開始與結束時間。";
    preview.className = "alert alert-warning py-2";
    return;
  }
  const rawHours = calculateHoursExcludingLunch(start, end, settings.lunchStart || "12:00", settings.lunchEnd || "13:00");
  const hours = Math.min(maxOvertimeHours, rawHours);
  preview.textContent = rawHours > maxOvertimeHours
    ? `預計加班時數：${hours} 小時（扣除午休後原為 ${rawHours} 小時，依單筆上限計算）`
    : `預計加班時數：${hours} 小時（已扣除重疊的午休時間）`;
  preview.className = hours >= 1 ? "alert alert-info py-2" : "alert alert-warning py-2";
}

function toDatetimeLocalValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

qs("#startTime").addEventListener("change", () => {
  syncMinimumEndTime();
  updateHoursPreview();
});
qs("#endTime").addEventListener("change", updateHoursPreview);
await render();
