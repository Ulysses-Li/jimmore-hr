import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, requireAuth, bindLogout, pageChrome, qs } from "./app.js";

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
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2 class="h5 mb-0">${year} 年 ${month + 1} 月</h2>
      <span class="badge text-bg-primary">已核准請假</span>
    </div>
    <div class="calendar-grid" id="calendar"></div>
  </div>`;

const snap = await getDocs(query(collection(db, "leaveRequests"), where("status", "==", "approved")));
const events = snap.docs.map((item) => item.data()).filter((item) => {
  const start = item.startTime.toDate ? item.startTime.toDate() : new Date(item.startTime);
  const end = item.endTime.toDate ? item.endTime.toDate() : new Date(item.endTime);
  return start <= monthEnd && end >= monthStart;
});

const leaveTypeLabels = {
  annual: "特休",
  compensatory: "補休",
  personal: "事假",
  sick: "病假",
  official: "公假"
};

const days = ["日", "一", "二", "三", "四", "五", "六"];
const cells = days.map((day) => `<div class="calendar-head">${day}</div>`);
for (let i = 0; i < monthStart.getDay(); i += 1) cells.push(`<div class="calendar-cell bg-light"></div>`);

for (let day = 1; day <= monthEnd.getDate(); day += 1) {
  const date = new Date(year, month, day);
  const dayEvents = events.filter((item) => {
    const start = item.startTime.toDate ? item.startTime.toDate() : new Date(item.startTime);
    const end = item.endTime.toDate ? item.endTime.toDate() : new Date(item.endTime);
    return start <= new Date(year, month, day, 23, 59, 59) && end >= date;
  });
  cells.push(`<div class="calendar-cell">
    <div class="fw-semibold">${day}</div>
    ${dayEvents.map((item) => `<div class="calendar-event">${item.userName} ${leaveTypeLabels[item.leaveType] || item.leaveType}</div>`).join("")}
  </div>`);
}

qs("#calendar").innerHTML = cells.join("");
