import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, requireAuth, bindLogout, pageChrome, qs, badge, fmtDateTime, hoursBetween, showToast } from "./app.js";

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
            <option value="annual">特休</option>
            <option value="compensatory">補休</option>
            <option value="personal">事假</option>
            <option value="sick">病假</option>
            <option value="official">公假</option>
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

const leaveTypeLabels = {
  annual: "特休",
  compensatory: "補休",
  personal: "事假",
  sick: "病假",
  official: "公假"
};

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
  const snap = await getDocs(query(
    collection(db, "leaveRequests"),
    where("userId", "==", profile.id),
    orderBy("createdAt", "desc")
  ));
  qs("#rows").innerHTML = snap.empty
    ? `<tr><td colspan="4" class="muted">尚無請假紀錄</td></tr>`
    : snap.docs.map((item) => {
      const row = item.data();
      return `<tr>
        <td>${leaveTypeLabels[row.leaveType] || row.leaveType}</td>
        <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
        <td>${row.hours}</td>
        <td>${badge(row.status)}</td>
      </tr>`;
    }).join("");
}

await render();
