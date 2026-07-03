import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, requireAuth, bindLogout, pageChrome, qs, badge, fmtDateTime } from "./app.js";

document.body.innerHTML = `<div class="app-shell d-flex">${pageChrome("儀表板", "今日出勤、假勤與待辦摘要")}</div>`;
const profile = await requireAuth();
bindLogout();

const content = qs("#pageContent");
content.innerHTML = `
  <div class="row g-3 mb-4">
    <div class="col-md-3"><div class="panel p-3"><div class="muted">特休剩餘</div><div class="stat-value" id="annualHours">-</div><div class="small muted">小時</div></div></div>
    <div class="col-md-3"><div class="panel p-3"><div class="muted">補休剩餘</div><div class="stat-value" id="compHours">-</div><div class="small muted">小時</div></div></div>
    <div class="col-md-3"><div class="panel p-3"><div class="muted">請假待審</div><div class="stat-value" id="leavePending">-</div><div class="small muted">筆</div></div></div>
    <div class="col-md-3"><div class="panel p-3"><div class="muted">加班待審</div><div class="stat-value" id="overtimePending">-</div><div class="small muted">筆</div></div></div>
  </div>
  <div class="row g-3">
    <div class="col-lg-7">
      <div class="panel p-3">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h2 class="h5 mb-0">最近打卡</h2>
          <a class="btn btn-sm btn-primary" href="attendance.html">前往打卡</a>
        </div>
        <div class="table-responsive">
          <table class="table align-middle mb-0">
            <thead><tr><th>時間</th><th>類型</th><th>狀態</th><th>位置</th></tr></thead>
            <tbody id="attendanceRows"><tr><td colspan="4" class="muted">載入中...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="col-lg-5">
      <div class="panel p-3">
        <h2 class="h5 mb-3">個人資訊</h2>
        <dl class="row mb-0">
          <dt class="col-4">姓名</dt><dd class="col-8">${profile.name || "-"}</dd>
          <dt class="col-4">部門</dt><dd class="col-8">${profile.department || "-"}</dd>
          <dt class="col-4">Email</dt><dd class="col-8">${profile.email || "-"}</dd>
        </dl>
      </div>
    </div>
  </div>`;

qs("#annualHours").textContent = profile.annualLeaveHours ?? 0;
qs("#compHours").textContent = profile.compensatoryLeaveHours ?? 0;

const [leaveSnap, overtimeSnap, attendanceSnap] = await Promise.all([
  getDocs(query(collection(db, "leaveRequests"), where("userId", "==", profile.id), where("status", "==", "pending"))),
  getDocs(query(collection(db, "overtimeRequests"), where("userId", "==", profile.id), where("status", "==", "pending"))),
  getDocs(query(collection(db, "attendance"), where("userId", "==", profile.id)))
]);

qs("#leavePending").textContent = leaveSnap.size;
qs("#overtimePending").textContent = overtimeSnap.size;
qs("#attendanceRows").innerHTML = attendanceSnap.empty
  ? `<tr><td colspan="4" class="muted">尚無打卡紀錄</td></tr>`
  : attendanceSnap.docs
  .map((docSnap) => docSnap.data())
  .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp))
  .slice(0, 6)
  .map((row) => {
    return `<tr>
      <td>${fmtDateTime(row.timestamp)}</td>
      <td>${row.type === "checkIn" ? "簽到" : "簽退"}</td>
      <td>${badge(row.status)}</td>
      <td>${row.latitude?.toFixed?.(5) || "-"}, ${row.longitude?.toFixed?.(5) || "-"}</td>
    </tr>`;
  }).join("");

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}
