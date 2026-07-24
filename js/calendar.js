import { requireAuth, bindLogout, mountPageShell, qs, leaveTypeLabel, todayKey, timeToDate, callSecureFunction } from "./app.js";

mountPageShell("休假行事曆", "檢視已核准請假的團隊排程");
await requireAuth();
bindLogout();

let visibleMonth = startOfMonth(new Date());

qs("#pageContent").innerHTML = `
  <div class="panel p-3">
    <div class="calendar-title calendar-title-with-controls d-flex justify-content-between align-items-center mb-3">
      <div class="calendar-month-heading d-flex align-items-center gap-2 flex-wrap">
        <h2 class="h5 mb-0" id="calendarMonthTitle"></h2>
        <span class="badge text-bg-primary">已核准請假</span>
      </div>
      <div class="calendar-month-controls d-flex align-items-center gap-2 flex-wrap">
        <button class="btn btn-outline-secondary btn-sm" id="prevMonthBtn" type="button">上個月</button>
        <button class="btn btn-outline-primary btn-sm" id="todayMonthBtn" type="button">今天</button>
        <button class="btn btn-outline-secondary btn-sm" id="nextMonthBtn" type="button">下個月</button>
      </div>
    </div>
    <div class="calendar-grid" id="calendar"></div>
    <div class="calendar-list" id="calendarList"></div>
  </div>
  <div class="panel p-3 mt-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2 class="h5 mb-0">遲到統計</h2>
      <span class="badge text-bg-warning">出勤統計</span>
    </div>
    <div class="row g-3">
      <div class="col-lg-6">
        <h3 class="h6 mb-2">今日</h3>
        <div id="todayLateRanking"></div>
      </div>
      <div class="col-lg-6">
        <h3 class="h6 mb-2">本月</h3>
        <div id="monthLateRanking"></div>
      </div>
    </div>
  </div>`;

let teamCalendar = { leaves: [], lateRecords: [] };
try {
  teamCalendar = await callSecureFunction("getTeamCalendar");
} catch (error) {
  qs("#pageContent").insertAdjacentHTML(
    "afterbegin",
    `<div class="alert alert-danger">
      <strong>團隊行事曆資料載入失敗。</strong>
      <div data-calendar-load-error></div>
    </div>`
  );
  qs("[data-calendar-load-error]").textContent =
    error?.message || "請重新整理後再試。";
  console.error("團隊行事曆資料載入失敗", error);
}
const allLeaves = Array.isArray(teamCalendar?.leaves) ? teamCalendar.leaves : [];
const allLateRecords = Array.isArray(teamCalendar?.lateRecords) ? teamCalendar.lateRecords : [];
const attendanceSettings = teamCalendar?.attendanceSettings || {
  lateGraceMinutes: 0,
  lunchStart: "12:00",
  lunchEnd: "13:00"
};

qs("#prevMonthBtn").addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendarMonth();
});

qs("#nextMonthBtn").addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendarMonth();
});

qs("#todayMonthBtn").addEventListener("click", () => {
  visibleMonth = startOfMonth(new Date());
  renderCalendarMonth();
});

renderCalendarMonth();

function renderCalendarMonth() {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
  const events = allLeaves.filter((item) => {
    const start = toDate(item.startTime);
    const end = toDate(item.endTime);
    return start <= monthEnd && end >= monthStart;
  });

  qs("#calendarMonthTitle").textContent = `${year} 年 ${month + 1} 月`;
  renderLeaveCalendar(year, month, monthStart, monthEnd, events);

  const lateRecords = allLateRecords
    .filter((item) => {
      const date = toDate(item.timestamp);
      return date >= monthStart && date <= monthEnd;
    })
    .map((item) => ({ ...item, ...calculateLateEvidence(item, events) }))
    .filter((item) => item.lateMinutes > 0);

  renderLateRankings(lateRecords, monthStart, monthEnd);
}

function renderLeaveCalendar(year, month, monthStart, monthEnd, events) {
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const cells = days.map((day) => `<div class="calendar-head">${day}</div>`);
  const listItems = [];

  for (let i = 0; i < monthStart.getDay(); i += 1) {
    cells.push(`<div class="calendar-cell bg-light"></div>`);
  }

  for (let day = 1; day <= monthEnd.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const dayEvents = events.filter((item) => isEventOnDate(item, date));
    cells.push(`<div class="calendar-cell">
      <div class="fw-semibold">${day}</div>
      ${dayEvents.map((item) => `<div class="calendar-event">${item.userName} ${leaveTypeLabel(item.leaveType)}</div>`).join("")}
    </div>`);

    if (dayEvents.length) {
      listItems.push(`<div class="calendar-list-item">
        <div class="calendar-list-date">
          <span class="calendar-list-day">${day}</span>
          <span class="calendar-list-week">${days[date.getDay()]}</span>
        </div>
        <div class="calendar-list-events">
          ${dayEvents.map((item) => `<div class="calendar-list-event">
            <strong>${item.userName}</strong>
            <span>${leaveTypeLabel(item.leaveType)}</span>
          </div>`).join("")}
        </div>
      </div>`);
    }
  }

  qs("#calendar").innerHTML = cells.join("");
  qs("#calendarList").innerHTML = listItems.length
    ? listItems.join("")
    : `<div class="muted py-3">本月沒有已核准請假紀錄。</div>`;
}

function isEventOnDate(item, date) {
  const start = toDate(item.startTime);
  const end = toDate(item.endTime);
  return start <= new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
    && end >= new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function renderLateRankings(records, monthStart, monthEnd) {
  const today = todayKey();
  const todayInVisibleMonth = new Date() >= monthStart && new Date() <= monthEnd;
  const todayRows = todayInVisibleMonth
    ? records
      .filter((item) => item.date === today)
      .sort((a, b) => b.lateMinutes - a.lateMinutes)
      .slice(0, 10)
    : [];

  const monthly = new Map();
  records.forEach((item) => {
    const key = item.userId || item.userName || "unknown";
    const current = monthly.get(key) || {
      userName: item.userName || "未命名",
      department: item.department || "-",
      lateCount: 0,
      lateMinutes: 0,
      records: []
    };
    current.lateCount += 1;
    current.lateMinutes += item.lateMinutes;
    current.records.push(item);
    monthly.set(key, current);
  });

  const monthRows = Array.from(monthly.values())
    .sort((a, b) => b.lateCount - a.lateCount || b.lateMinutes - a.lateMinutes)
    .slice(0, 10);

  qs("#todayLateRanking").innerHTML = todayInVisibleMonth
    ? rankingTable(todayRows, "today")
    : `<div class="muted border rounded p-3">目前顯示的月份不是本月，今日排名不適用。</div>`;
  qs("#monthLateRanking").innerHTML = rankingTable(monthRows, "month");
}

function rankingTable(rows, type) {
  if (!rows.length) return `<div class="muted border rounded p-3">目前沒有遲到紀錄。</div>`;
  const headers = type === "today"
    ? `<th>#</th><th>員工</th><th>部門</th><th>遲到</th><th></th>`
    : `<th>#</th><th>員工</th><th>部門</th><th>次數</th><th>總分鐘</th><th></th>`;
  const body = rows.map((row, index) => {
    const records = type === "today" ? [row] : row.records;
    const detailId = `lateEvidence_${type}_${index}`;
    const summary = type === "today"
      ? `<tr><td>${index + 1}</td><td>${escapeHtml(row.userName)}</td><td>${escapeHtml(row.department || "-")}</td><td><span class="badge text-bg-danger">${row.lateMinutes} 分鐘</span></td>`
      : `<tr><td>${index + 1}</td><td>${escapeHtml(row.userName)}</td><td>${escapeHtml(row.department || "-")}</td><td>${row.lateCount}</td><td><span class="badge text-bg-danger">${row.lateMinutes}</span></td>`;
    return `${summary}<td><button class="btn btn-link btn-sm p-0 text-nowrap" type="button"
      data-bs-toggle="collapse" data-bs-target="#${detailId}" aria-expanded="false"
      aria-controls="${detailId}">查看依據</button></td></tr>
      <tr class="collapse late-evidence-row" id="${detailId}"><td colspan="${type === "today" ? 5 : 6}">
        ${lateEvidenceHtml(records)}
      </td></tr>`;
  }).join("");
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function calculateLateEvidence(record, leaveEvents) {
  const actual = toDate(record.timestamp);
  const expected = timeToDate(record.date || todayKey(actual), record.workStart || "09:00");
  const rawLateMinutes = Math.max(0, Math.ceil((actual.getTime() - expected.getTime()) / 60000));
  const graceMinutes = Math.max(0, Number(record.lateGraceMinutes ?? attendanceSettings.lateGraceMinutes ?? 0));
  const lunchStart = timeToDate(record.date || todayKey(actual), attendanceSettings.lunchStart || "12:00");
  const lunchEnd = timeToDate(record.date || todayKey(actual), attendanceSettings.lunchEnd || "13:00");
  const coveredLeaveMinutes = leaveEvents
    .filter((item) => item.userId === record.userId)
    .reduce((sum, item) => sum + workMinutesInRange(
      expected,
      actual,
      toDate(item.startTime),
      toDate(item.endTime),
      lunchStart,
      lunchEnd
    ), 0);

  return {
    lateMinutes: Math.max(0, rawLateMinutes - graceMinutes - coveredLeaveMinutes),
    rawLateMinutes,
    graceMinutes,
    coveredLeaveMinutes,
    expectedAt: expected,
    actualAt: actual
  };
}

function overlapMinutes(start, end, blockStart, blockEnd) {
  const from = Math.max(start.getTime(), blockStart.getTime());
  const to = Math.min(end.getTime(), blockEnd.getTime());
  return Math.max(0, Math.ceil((to - from) / 60000));
}

function workMinutesInRange(start, end, blockStart, blockEnd, lunchStart, lunchEnd) {
  const minutes = overlapMinutes(start, end, blockStart, blockEnd);
  const lunchFrom = new Date(Math.max(start.getTime(), lunchStart.getTime()));
  const lunchTo = new Date(Math.min(end.getTime(), lunchEnd.getTime()));
  const lunchMinutes = lunchTo > lunchFrom
    ? overlapMinutes(lunchFrom, lunchTo, blockStart, blockEnd)
    : 0;
  return Math.max(0, minutes - lunchMinutes);
}

function lateEvidenceHtml(records) {
  return `<div class="late-evidence-list">${records
    .sort((a, b) => toDate(b.timestamp) - toDate(a.timestamp))
    .map((record) => `<article class="late-evidence-card">
      <div class="late-evidence-head">
        <strong>${escapeHtml(record.date || "-")}</strong>
        <span>${escapeHtml(record.shiftName || "班別")} · 上班 ${escapeHtml(record.workStart || "09:00")}</span>
        <span class="badge text-bg-danger">${record.lateMinutes} 分鐘</span>
      </div>
      <div class="late-evidence-grid">
        <div><span>實際簽到</span><strong>${formatTime(record.actualAt)}</strong></div>
        <div><span>原始差額</span><strong>${record.rawLateMinutes} 分鐘</strong></div>
        <div><span>寬限扣除</span><strong>${record.graceMinutes} 分鐘</strong></div>
        <div><span>請假扣除</span><strong>${record.coveredLeaveMinutes} 分鐘</strong></div>
      </div>
      <div class="late-evidence-formula">${record.rawLateMinutes} − ${record.graceMinutes} − ${record.coveredLeaveMinutes} = <strong>${record.lateMinutes} 分鐘</strong></div>
      <div class="late-evidence-meta">
        <span>來源：${sourceLabel(record.source)}</span>
        ${record.correctionReason ? `<span>補登原因：${escapeHtml(record.correctionReason)}</span>` : ""}
        ${record.correctedByName ? `<span>補登人：${escapeHtml(record.correctedByName)}</span>` : ""}
        <span>紀錄編號：${escapeHtml(record.id || "-")}</span>
        ${record.graceSource === "current_settings" ? `<span>註：舊紀錄使用目前系統寬限設定</span>` : ""}
      </div>
    </article>`).join("")}</div>`;
}

function sourceLabel(source) {
  return ({
    passkey_web: "Passkey 生物辨識打卡",
    admin_manual_correction: "管理員補登",
    manager_approved_exception: "主管核准補登"
  })[source] || source || "系統打卡紀錄";
}

function formatTime(value) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDate(value) {
  if (!value) return new Date("");
  return value.toDate ? value.toDate() : new Date(value);
}
