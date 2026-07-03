import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, requireAuth, bindLogout, pageChrome, qs, badge, fmtDateTime, hoursBetween, showToast, leaveTypes, leaveTypeLabel } from "./app.js";

document.body.innerHTML = `<div class="app-shell d-flex">${pageChrome("請假申請", "建立請假單並追蹤審核狀態")}</div>`;
const profile = await requireAuth();
bindLogout();

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
        <div class="mb-3"><label class="form-label" for="endTime">結束時間</label><input class="form-control" id="endTime" type="datetime-local" required></div>
        <div class="mb-3"><label class="form-label" for="reason">原因</label><textarea class="form-control" id="reason" rows="3" required></textarea></div>
        <button class="btn btn-primary w-100">送出申請</button>
      </form>
    </div>
    <div class="col-lg-7">
      <div class="panel p-3">
        <h2 class="h5 mb-3">我的請假紀錄</h2>
        <div class="table-responsive"><table class="table align-middle mb-0">
          <thead><tr><th>假別</th><th>時間</th><th>時數</th><th>狀態</th></tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
      </div>
    </div>
  </div>`;

qs("#leaveForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const start = new Date(qs("#startTime").value);
  const end = new Date(qs("#endTime").value);
  const hours = hoursBetween(start, end);
  if (hours <= 0) {
    showToast("結束時間必須晚於開始時間", "warning");
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
  await addDoc(collection(db, "leaveRequests"), {
    userId: profile.id,
    userName: profile.name,
    department: profile.department || "",
    leaveType: type,
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
      .map((item) => item.data())
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    qs("#rows").innerHTML = rows.length
      ? rows.map((row) => {
        return `<tr>
          <td>${leaveTypeLabel(row.leaveType)}</td>
          <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
          <td>${row.hours}</td>
          <td>${badge(row.status)}</td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="4" class="muted">尚無請假紀錄</td></tr>`;
  } catch (error) {
    qs("#rows").innerHTML = `<tr><td colspan="4" class="text-danger">讀取請假紀錄失敗：${error.message}</td></tr>`;
  }
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

await render();
