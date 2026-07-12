import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, requireAuth, bindLogout, pageChrome, qs, leaveTypeLabel, todayKey, timeToDate } from "./app.js";

document.body.innerHTML = `<div class="app-shell d-flex">${pageChrome("休假行事曆", "檢視已核准請假的團隊排程")}</div>`;
await requireAuth();
bindLogout();

let visibleMonth = startOfMonth(new Date());

qs("#pageContent").innerHTML = `
  <div class="panel p-3">
    <div class="calendar-title d-flex justify-content-between align-items-center mb-3">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <button class="btn btn-outline-secondary btn-sm" id="prevMonthBtn" type="button">上個月</button>
        <h2 class="h5 mb-0" id="calendarMonthTitle"></h2>
        <button class="btn btn-outline-secondary btn-sm" id="nextMonthBtn" type="button">下個月</button>
        <button class="btn btn-outline-primary btn-sm" id="todayMonthBtn" type="button">今天</button>
      </div>
      <span class="badge text-bg-primary">已核准請假</span>
    </div>
    <div class="calendar-grid" id="calendar"></div>
    <div class="calendar-list" id="calendarList"></div>
  </div>
  <div class="panel p-3 mt-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2 class="h5 mb-0">MVP 遲到王</h2>
      <span class="badge text-bg-warning">出勤統計</span>
    </div>
    <div class="row g-3">
      <div class="col-lg-6">
        <h3 class="h6 mb-2">今日排名</h3>
        <div id="todayLateRanking"></div>
      </div>
      <div class="col-lg-6">
        <h3 class="h6 mb-2">本月排名</h3>
        <div id="monthLateRanking"></div>
      </div>
    </div>
  </div>`;

const [leaveSnap, attendanceSnap] = await Promise.all([
  getDocs(query(collection(db, "leaveRequests"), where("status", "==", "approved"))),
  getDocs(query(collection(db, "attendance"), where("type", "==", "checkIn"), where("status", "==", "late")))
]);

const allLeaves = leaveSnap.docs.map((item) => item.data());
const allLateRecords = attendanceSnap.docs.map((item) => item.data());

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
    .map((item) => ({ ...item, lateMinutes: calculateAdjustedLateMinutes(item, events) }))
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
      lateMinutes: 0
    };
    current.lateCount += 1;
    current.lateMinutes += item.lateMinutes;
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
    ? `<th>#</th><th>員工</th><th>部門</th><th>遲到</th>`
    : `<th>#</th><th>員工</th><th>部門</th><th>次數</th><th>總分鐘</th>`;
  const body = rows.map((row, index) => type === "today"
    ? `<tr><td>${index + 1}</td><td>${row.userName}</td><td>${row.department || "-"}</td><td><span class="badge text-bg-danger">${row.lateMinutes} 分鐘</span></td></tr>`
    : `<tr><td>${index + 1}</td><td>${row.userName}</td><td>${row.department || "-"}</td><td>${row.lateCount}</td><td><span class="badge text-bg-danger">${row.lateMinutes}</span></td></tr>`
  ).join("");
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function calculateAdjustedLateMinutes(record, leaveEvents) {
  const actual = toDate(record.timestamp);
  const expected = timeToDate(record.date || todayKey(actual), record.workStart || "09:00");
  const diff = Math.ceil((actual.getTime() - expected.getTime()) / 60000);
  const rawLateMinutes = Math.max(0, diff);
  if (!rawLateMinutes) return 0;

  const coveredLeaveMinutes = leaveEvents
    .filter((item) => item.userId === record.userId)
    .reduce((sum, item) => sum + overlapMinutes(expected, actual, toDate(item.startTime), toDate(item.endTime)), 0);

  return Math.max(0, rawLateMinutes - coveredLeaveMinutes);
}

function overlapMinutes(start, end, blockStart, blockEnd) {
  const from = Math.max(start.getTime(), blockStart.getTime());
  const to = Math.min(end.getTime(), blockEnd.getTime());
  return Math.max(0, Math.ceil((to - from) / 60000));
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDate(value) {
  if (!value) return new Date("");
  return value.toDate ? value.toDate() : new Date(value);
}
