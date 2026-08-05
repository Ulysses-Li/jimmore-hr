import { leaveTypeLabel } from "./app.js";

export const leavePrintStyles = `
  @page { size: A4 portrait; margin: 9mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .leave-print-sheet { width: 186mm; margin: 0 auto; color: #000; font-family: "DFKai-SB", "標楷體", "Microsoft JhengHei", serif; background: #fff; }
  .leave-print-sheet .form-copy { min-height: 131mm; padding-top: 3mm; page-break-inside: avoid; }
  .leave-print-sheet .company { text-align: center; font-size: 17pt; letter-spacing: .72em; padding-left: .72em; margin-bottom: 2.5mm; }
  .leave-print-sheet .title { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: end; font-size: 15pt; margin-bottom: 1.5mm; border-bottom: 2px solid #000; padding-bottom: 1.2mm; }
  .leave-print-sheet .title span { text-align: center; border-bottom: 1px solid #000; padding-bottom: 1mm; }
  .leave-print-sheet .document-id { min-height: 3.5mm; margin-bottom: 1.5mm; text-align: right; font: 8.5pt "Microsoft JhengHei", sans-serif; letter-spacing: .04em; }
  .leave-print-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11.5pt; line-height: 1.35; border: 2px solid #000; }
  .leave-print-sheet td { border: 1px solid #000; height: 11.5mm; padding: 1.7mm 2.2mm; vertical-align: middle; overflow-wrap: anywhere; }
  .leave-print-sheet .label { text-align: center; font-weight: 700; white-space: nowrap; }
  .leave-print-sheet .center { text-align: center; }
  .leave-print-sheet .date-cell { letter-spacing: .18em; }
  .leave-print-sheet .period-label { text-align: center; font-weight: 700; font-size: 11pt; line-height: 1.35; }
  .leave-print-sheet .period-cell { font-size: 10.5pt; padding: 1.7mm 2.2mm; white-space: nowrap; }
  .leave-print-sheet .period-line { display: flex; align-items: center; justify-content: space-between; gap: .6mm; width: 100%; }
  .leave-print-sheet .period-prefix { font-weight: 700; }
  .leave-print-sheet .hours-cell { font-size: 12pt; letter-spacing: .12em; }
  .leave-print-sheet .sign { height: 20mm; vertical-align: top; }
  .leave-print-sheet .note { height: 21mm; vertical-align: top; padding: 3mm 4mm; }
  .leave-print-sheet .void-banner { margin: 2mm 0 4mm; padding: 3mm; border: 2px solid #c00; color: #c00; text-align: center; font: 700 18pt "Microsoft JhengHei", sans-serif; }
  .leave-print-sheet .void-banner small { display: block; margin-top: 1mm; font-size: 10pt; font-weight: 500; }
  @media print {
    .leave-print-sheet { width: 100%; }
    .leave-print-sheet .form-copy { break-inside: avoid; }
  }
`;

export function leavePrintFormHtml(row, options = {}) {
  const start = toDate(row.startTime);
  const end = toDate(row.endTime);
  const appliedAt = row.createdAt ? toDate(row.createdAt) : start;
  const standardHours = Math.max(1, Number(options.standardHours || 8));
  const totalHours = Number(row.hours || 0);
  const fullDays = Math.floor(totalHours / standardHours);
  const remainingHours = Number((totalHours % standardHours).toFixed(2));
  const requestId = row.id || options.requestId || "-";
  const userName = row.userName || options.fallbackName || "";
  const department = row.department || options.fallbackDepartment || "";

  return `<div class="leave-print-sheet">
    ${row.status === "voided" ? `<div class="void-banner">已無效<small>原因：${escapeHtml(row.voidReason || "未填寫")}</small></div>` : ""}
    <div class="form-copy">
      <div class="company">竣貿國際股份有限公司</div>
      <div class="title"><span>請</span><span>假</span><span>單</span></div>
      <div class="document-id">單號：${escapeHtml(requestId)}</div>
      <table aria-label="請假單內容">
        <colgroup>
          <col style="width: 12%;"><col style="width: 13%;"><col style="width: 12%;"><col style="width: 13%;">
          <col style="width: 10%;"><col style="width: 16%;"><col style="width: 12%;"><col style="width: 12%;">
        </colgroup>
        <tr>
          <td class="label">中華民國</td>
          <td colspan="5" class="center date-cell">${rocDate(appliedAt)}</td>
          <td class="label">星期</td>
          <td class="center">${weekdayLabel(appliedAt)}</td>
        </tr>
        <tr>
          <td class="label">單位</td>
          <td class="center">${escapeHtml(department)}</td>
          <td class="label">假別</td>
          <td class="center">${escapeHtml(leaveTypeLabel(row.leaveType))}</td>
          <td rowspan="2" class="period-label">請假期間</td>
          <td colspan="3" class="period-cell">${periodLine("自", start)}</td>
        </tr>
        <tr>
          <td class="label">姓名</td>
          <td class="center">${escapeHtml(userName)}</td>
          <td class="label">事由</td>
          <td class="center">${escapeHtml(row.reason || "")}</td>
          <td colspan="3" class="period-cell">${periodLine("至", end)}</td>
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
          <td colspan="6" class="note">職務代理人：${escapeHtml(row.proxyUserName || "")}${row.status === "voided" ? `<br>本假單已無效：${escapeHtml(row.voidReason || "未填寫")}` : ""}</td>
        </tr>
      </table>
    </div>
  </div>`;
}

export function leavePrintDocumentHtml(row, options = {}) {
  const titleName = row.userName || options.fallbackName || "";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>請假單 - ${escapeHtml(titleName)}</title>
  <style>
    html, body { width: 210mm; min-height: 297mm; }
    body { margin: 0; background: #fff; }
    ${leavePrintStyles}
    .print-actions { margin: 6mm auto 0; text-align: center; }
    .print-actions button { font: 16px "Microsoft JhengHei", sans-serif; padding: 8px 18px; }
    @media print { html, body { width: auto; min-height: auto; } .print-actions { display: none; } }
  </style>
</head>
<body>
  ${leavePrintFormHtml(row, options)}
  <div class="print-actions"><button onclick="window.print()">列印／另存 PDF</button></div>
</body>
</html>`;
}

function rocDate(date) {
  return `${date.getFullYear() - 1911} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function periodLine(prefix, date) {
  return `<div class="period-line"><span class="period-prefix">${prefix}</span><span>民國</span><span>${date.getFullYear() - 1911}</span><span>年</span><span>${date.getMonth() + 1}</span><span>月</span><span>${date.getDate()}</span><span>日</span><span>${pad2(date.getHours())}</span><span>時</span><span>${pad2(date.getMinutes())}</span><span>分</span></div>`;
}

function toDate(value) {
  if (!value) return new Date(0);
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
