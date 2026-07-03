import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, requireAuth, bindLogout, pageChrome, qs, leaveTypeLabel } from "./app.js";

document.body.innerHTML = `<div class="app-shell d-flex">${pageChrome("休假行事曆", "檢視已核准請假的團隊排程")}</div>`;
await requireAuth();
bindLogout();

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth();
const monthStart = new Date(year, month, 1);
const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

qs("#pageContent").innerHTML = `
  <div class="panel p-3">
    <div class="calendar-title d-flex justify-content-between align-items-center mb-3">
      <h2 class="h5 mb-0">${year} 年 ${month + 1} 月</h2>
      <span class="badge text-bg-primary">已核准請假</span>
    </div>
    <div class="calendar-grid" id="calendar"></div>
    <div class="calendar-list" id="calendarList"></div>
  </div>`;

const snap = await getDocs(query(collection(db, "leaveRequests"), where("status", "==", "approved")));
const events = snap.docs.map((item) => item.data()).filter((item) => {
  const start = item.startTime.toDate ? item.startTime.toDate() : new Date(item.startTime);
  const end = item.endTime.toDate ? item.endTime.toDate() : new Date(item.endTime);
  return start <= monthEnd && end >= monthStart;
});

const days = ["日", "一", "二", "三", "四", "五", "六"];
const cells = days.map((day) => `<div class="calendar-head">${day}</div>`);
const listItems = [];
for (let i = 0; i < monthStart.getDay(); i += 1) cells.push(`<div class="calendar-cell bg-light"></div>`);

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
  : `<div class="muted py-3">本月尚無已核准請假。</div>`;

function isEventOnDate(item, date) {
  const start = item.startTime.toDate ? item.startTime.toDate() : new Date(item.startTime);
  const end = item.endTime.toDate ? item.endTime.toDate() : new Date(item.endTime);
  return start <= new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
    && end >= new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
