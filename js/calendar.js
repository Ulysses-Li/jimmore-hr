import { requireAuth, bindLogout, mountPageShell, qs, leaveTypeLabel, callSecureFunction } from "./app.js";

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
  </div>`;

let teamCalendar = { leaves: [] };
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

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDate(value) {
  if (!value) return new Date("");
  return value.toDate ? value.toDate() : new Date(value);
}
