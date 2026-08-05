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
    <dialog class="calendar-detail-dialog" id="calendarDetailDialog" aria-labelledby="calendarDetailTitle">
      <div class="calendar-detail-header">
        <div>
          <div class="small muted">休假詳情</div>
          <h3 class="h5 mb-0" id="calendarDetailTitle"></h3>
        </div>
        <button class="calendar-detail-close" type="button" data-calendar-detail-close aria-label="關閉">×</button>
      </div>
      <dl class="calendar-detail-grid mb-0">
        <div><dt>部門</dt><dd id="calendarDetailDepartment"></dd></div>
        <div><dt>假別</dt><dd id="calendarDetailType"></dd></div>
        <div class="calendar-detail-wide"><dt>請假時間</dt><dd id="calendarDetailTime"></dd></div>
        <div class="calendar-detail-wide"><dt>核准時數</dt><dd id="calendarDetailHours"></dd></div>
      </dl>
      <div class="calendar-detail-actions">
        <button class="btn btn-primary" type="button" data-calendar-detail-close>關閉</button>
      </div>
    </dialog>
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

qs("#pageContent").addEventListener("click", (event) => {
  const eventButton = event.target.closest("[data-calendar-event-index]");
  if (eventButton) {
    openCalendarDetail(allLeaves[Number(eventButton.dataset.calendarEventIndex)]);
    return;
  }
  if (event.target.closest("[data-calendar-detail-close]")) {
    qs("#calendarDetailDialog").close();
  }
});

qs("#calendarDetailDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
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
      ${dayEvents.map((item) => calendarEventHtml(item)).join("")}
    </div>`);

    if (dayEvents.length) {
      listItems.push(`<div class="calendar-list-item">
        <div class="calendar-list-date">
          <span class="calendar-list-day">${day}</span>
          <span class="calendar-list-week">${days[date.getDay()]}</span>
        </div>
        <div class="calendar-list-events">
          ${dayEvents.map((item) => `<button class="calendar-list-event" type="button" data-calendar-event-index="${allLeaves.indexOf(item)}">
            <div class="calendar-list-event-person">
              <strong>${escapeHtml(item.userName)}</strong>
              <span>${escapeHtml(leaveTypeLabel(item.leaveType))}</span>
            </div>
            <span class="calendar-event-arrow" aria-hidden="true">›</span>
          </button>`).join("")}
        </div>
      </div>`);
    }
  }

  qs("#calendar").innerHTML = cells.join("");
  qs("#calendarList").innerHTML = listItems.length
    ? listItems.join("")
    : `<div class="muted py-3">本月沒有已核准請假紀錄。</div>`;
}

function calendarEventHtml(item) {
  const name = escapeHtml(item.userName);
  const leaveType = escapeHtml(leaveTypeLabel(item.leaveType));
  const details = escapeHtml(calendarEventDetails(item));
  return `<button class="calendar-event" type="button" data-calendar-event-index="${allLeaves.indexOf(item)}" title="${details}" aria-label="查看 ${name} ${leaveType}的休假詳情">
    <span class="calendar-event-person"><strong>${name}</strong> ${leaveType}</span>
    <span class="calendar-event-arrow" aria-hidden="true">›</span>
  </button>`;
}

function openCalendarDetail(item) {
  if (!item) return;
  const start = toDate(item.startTime);
  const end = toDate(item.endTime);
  qs("#calendarDetailTitle").textContent = item.userName || "員工";
  qs("#calendarDetailDepartment").textContent = item.department || "-";
  qs("#calendarDetailType").textContent = leaveTypeLabel(item.leaveType);
  qs("#calendarDetailTime").textContent = `${formatDateTime(start)} 至 ${formatDateTime(end)}`;
  qs("#calendarDetailHours").textContent = formatLeaveHours(resolveLeaveHours(item)) || "未提供";
  qs("#calendarDetailDialog").showModal();
}

function calendarEventDetails(item) {
  const start = toDate(item.startTime);
  const end = toDate(item.endTime);
  const hours = formatLeaveHours(resolveLeaveHours(item));
  return `${item.userName}｜${leaveTypeLabel(item.leaveType)}｜${formatDateTime(start)} 至 ${formatDateTime(end)}${hours ? `｜${hours}` : ""}`;
}

function resolveLeaveHours(item) {
  const approvedHours = Number(item.hours);
  if (Number.isFinite(approvedHours) && approvedHours > 0) return approvedHours;

  const start = toDate(item.startTime);
  const end = toDate(item.endTime);
  if (!sameDate(start, end)) return 0;

  const settings = teamCalendar?.attendanceSettings || {};
  const lunchStart = timeOnDate(start, settings.lunchStart || "12:00");
  const lunchEnd = timeOnDate(start, settings.lunchEnd || "13:00");
  const totalMinutes = Math.max(0, (end.getTime() - start.getTime()) / 60000);
  const lunchOverlapMinutes = Math.max(
    0,
    (Math.min(end.getTime(), lunchEnd.getTime()) - Math.max(start.getTime(), lunchStart.getTime())) / 60000
  );
  return Math.max(0, totalMinutes - lunchOverlapMinutes) / 60;
}

function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function timeOnDate(date, value) {
  const [hours, minutes] = String(value).split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours || 0, minutes || 0);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatLeaveHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return "";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小時`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);
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
