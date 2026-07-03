import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, requireAuth, bindLogout, pageChrome, qs, badge, fmtDateTime, hoursBetween, showToast } from "./app.js";

document.body.innerHTML = `<div class="app-shell d-flex">${pageChrome("加班申請", "建立加班單並選擇是否轉補休")}</div>`;
const profile = await requireAuth();
bindLogout();

qs("#pageContent").innerHTML = `
  <div class="row g-3">
    <div class="col-lg-5">
      <form class="panel p-3" id="overtimeForm">
        <h2 class="h5 mb-3">新增加班單</h2>
        <div class="mb-3"><label class="form-label" for="startTime">開始時間</label><input class="form-control" id="startTime" type="datetime-local" required></div>
        <div class="mb-3"><label class="form-label" for="endTime">結束時間</label><input class="form-control" id="endTime" type="datetime-local" required></div>
        <div class="mb-3"><label class="form-label" for="reason">原因</label><textarea class="form-control" id="reason" rows="3" required></textarea></div>
        <div class="form-check form-switch mb-3">
          <input class="form-check-input" type="checkbox" id="convertToCompTime" checked>
          <label class="form-check-label" for="convertToCompTime">核准後轉為補休</label>
        </div>
        <button class="btn btn-primary w-100">送出申請</button>
      </form>
    </div>
    <div class="col-lg-7">
      <div class="panel p-3">
        <h2 class="h5 mb-3">我的加班紀錄</h2>
        <div class="table-responsive"><table class="table align-middle mb-0">
          <thead><tr><th>時間</th><th>時數</th><th>補休</th><th>狀態</th></tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
      </div>
    </div>
  </div>`;

qs("#overtimeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const start = new Date(qs("#startTime").value);
  const end = new Date(qs("#endTime").value);
  const hours = hoursBetween(start, end);
  if (hours <= 0) {
    showToast("結束時間必須晚於開始時間", "warning");
    return;
  }
  await addDoc(collection(db, "overtimeRequests"), {
    userId: profile.id,
    userName: profile.name,
    department: profile.department || "",
    startTime: start,
    endTime: end,
    hours: Number(hours.toFixed(2)),
    reason: qs("#reason").value.trim(),
    convertToCompTime: qs("#convertToCompTime").checked,
    status: "pending",
    approvedBy: "",
    approvedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  event.target.reset();
  qs("#convertToCompTime").checked = true;
  showToast("加班申請已送出", "success");
  await render();
});

async function render() {
  try {
    const snap = await getDocs(query(
      collection(db, "overtimeRequests"),
      where("userId", "==", profile.id)
    ));
    const rows = snap.docs
      .map((item) => item.data())
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    qs("#rows").innerHTML = rows.length
      ? rows.map((row) => {
        return `<tr>
          <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
          <td>${row.hours}</td>
          <td>${row.convertToCompTime ? "是" : "否"}</td>
          <td>${badge(row.status)}</td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="4" class="muted">尚無加班紀錄</td></tr>`;
  } catch (error) {
    qs("#rows").innerHTML = `<tr><td colspan="4" class="text-danger">讀取加班紀錄失敗：${error.message}</td></tr>`;
  }
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

await render();
