import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  db,
  requireAuth,
  bindLogout,
  pageChrome,
  qs,
  badge,
  fmtDateTime,
  getWorkSettings,
  showToast,
  roleLabels
} from "./app.js";

const mode = document.body.dataset.adminMode;
const titleMap = {
  home: ["管理首頁", "管理員與主管審核工作台"],
  employees: ["員工管理", "維護員工角色、部門與假別餘額"],
  attendance: ["出勤報表", "查詢每日工時與異常狀態"],
  leave: ["請假審核", "核准或駁回員工請假申請"],
  overtime: ["加班審核", "核准或駁回加班申請"],
  settings: ["系統設定", "設定上下班、午休與遲到寬限"]
};
const [title, subtitle] = titleMap[mode] || titleMap.home;
document.body.innerHTML = `<div class="app-shell d-flex">${pageChrome(title, subtitle)}</div>`;
const adminProfile = await requireAuth({ roles: ["manager", "admin"] });
bindLogout();

const content = qs("#pageContent");

if (mode === "home") await renderHome();
if (mode === "employees") await renderEmployees();
if (mode === "attendance") await renderAttendanceReport();
if (mode === "leave") await renderRequests("leaveRequests");
if (mode === "overtime") await renderRequests("overtimeRequests");
if (mode === "settings") await renderSettings();

async function renderHome() {
  const [users, leavePending, overtimePending, attendance] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(query(collection(db, "leaveRequests"), where("status", "==", "pending"))),
    getDocs(query(collection(db, "overtimeRequests"), where("status", "==", "pending"))),
    getDocs(collection(db, "attendanceDaily"))
  ]);
  content.innerHTML = `
    <div class="row g-3 mb-4">
      <div class="col-md-3"><div class="panel p-3"><div class="muted">員工數</div><div class="stat-value">${users.size}</div></div></div>
      <div class="col-md-3"><div class="panel p-3"><div class="muted">請假待審</div><div class="stat-value">${leavePending.size}</div></div></div>
      <div class="col-md-3"><div class="panel p-3"><div class="muted">加班待審</div><div class="stat-value">${overtimePending.size}</div></div></div>
      <div class="col-md-3"><div class="panel p-3"><div class="muted">出勤彙總</div><div class="stat-value">${attendance.size}</div></div></div>
    </div>
    <div class="panel p-3">
      <h2 class="h5 mb-3">快速操作</h2>
      <div class="d-flex gap-2 flex-wrap">
        <a class="btn btn-primary" href="leave.html">請假審核</a>
        <a class="btn btn-outline-primary" href="overtime.html">加班審核</a>
        <a class="btn btn-outline-secondary" href="attendance.html">出勤報表</a>
        ${adminProfile.role === "admin" ? `<a class="btn btn-outline-secondary" href="settings.html">系統設定</a>` : ""}
      </div>
    </div>`;
}

async function renderEmployees() {
  if (adminProfile.role !== "admin") {
    content.innerHTML = `<div class="alert alert-warning">只有管理員可以維護員工資料。</div>`;
    return;
  }
  const snap = await getDocs(query(collection(db, "users"), orderBy("name")));
  content.innerHTML = `
    <div class="panel p-3">
      <div class="table-responsive"><table class="table align-middle">
        <thead><tr><th>姓名</th><th>Email</th><th>部門</th><th>角色</th><th>特休</th><th>補休</th><th>啟用</th><th></th></tr></thead>
        <tbody>
          ${snap.docs.map((item) => {
            const row = item.data();
            return `<tr data-id="${item.id}">
              <td><input class="form-control form-control-sm" data-field="name" value="${row.name || ""}"></td>
              <td>${row.email || ""}</td>
              <td><input class="form-control form-control-sm" data-field="department" value="${row.department || ""}"></td>
              <td><select class="form-select form-select-sm" data-field="role">
                ${["employee", "manager", "admin"].map((role) => `<option value="${role}" ${row.role === role ? "selected" : ""}>${roleLabels[role]}</option>`).join("")}
              </select></td>
              <td><input class="form-control form-control-sm" type="number" data-field="annualLeaveHours" value="${row.annualLeaveHours ?? 0}"></td>
              <td><input class="form-control form-control-sm" type="number" data-field="compensatoryLeaveHours" value="${row.compensatoryLeaveHours ?? 0}"></td>
              <td><input class="form-check-input" type="checkbox" data-field="isActive" ${row.isActive !== false ? "checked" : ""}></td>
              <td><button class="btn btn-sm btn-primary" data-save-user>儲存</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>
    </div>`;

  content.querySelectorAll("[data-save-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tr = button.closest("tr");
      const payload = {};
      tr.querySelectorAll("[data-field]").forEach((input) => {
        const field = input.dataset.field;
        if (input.type === "checkbox") payload[field] = input.checked;
        else if (input.type === "number") payload[field] = Number(input.value || 0);
        else payload[field] = input.value.trim();
      });
      payload.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "users", tr.dataset.id), payload);
      showToast("員工資料已更新", "success");
    });
  });
}

async function renderAttendanceReport() {
  const snap = await getDocs(query(collection(db, "attendanceDaily"), orderBy("date", "desc")));
  content.innerHTML = `
    <div class="panel p-3">
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>日期</th><th>員工</th><th>部門</th><th>簽到</th><th>簽退</th><th>工時</th><th>狀態</th><th>滿 8 小時</th></tr></thead>
        <tbody>${snap.empty ? `<tr><td colspan="8" class="muted">尚無資料</td></tr>` : snap.docs.map((item) => {
          const row = item.data();
          return `<tr>
            <td>${row.date}</td>
            <td>${row.userName}</td>
            <td>${row.department || "-"}</td>
            <td>${fmtDateTime(row.checkInTime)}</td>
            <td>${fmtDateTime(row.checkOutTime)}</td>
            <td>${row.totalWorkHours ?? 0}</td>
            <td>${badge(row.status)}</td>
            <td>${row.isEightHoursReached ? "是" : "否"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>`;
}

async function renderRequests(collectionName) {
  const isLeave = collectionName === "leaveRequests";
  const snap = await getDocs(query(collection(db, collectionName), orderBy("createdAt", "desc")));
  content.innerHTML = `
    <div class="panel p-3">
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>申請人</th><th>類型</th><th>時間</th><th>時數</th><th>原因</th><th>狀態</th><th></th></tr></thead>
        <tbody>${snap.empty ? `<tr><td colspan="7" class="muted">尚無資料</td></tr>` : snap.docs.map((item) => {
          const row = item.data();
          const type = isLeave ? leaveTypeLabel(row.leaveType) : (row.convertToCompTime ? "加班轉補休" : "加班費");
          return `<tr data-id="${item.id}" data-user-id="${row.userId}" data-hours="${row.hours}" data-kind="${row.leaveType || ""}" data-comp="${row.convertToCompTime ? "1" : "0"}">
            <td>${row.userName}<br><span class="muted small">${row.department || ""}</span></td>
            <td>${type}</td>
            <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
            <td>${row.hours}</td>
            <td>${row.reason || "-"}</td>
            <td>${badge(row.status)}</td>
            <td>${row.status === "pending" ? `<div class="btn-group btn-group-sm"><button class="btn btn-success" data-approve>核准</button><button class="btn btn-outline-danger" data-reject>駁回</button></div>` : "-"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>`;

  content.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => reviewRequest(collectionName, button.closest("tr"), "approved"));
  });
  content.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => reviewRequest(collectionName, button.closest("tr"), "rejected"));
  });
}

async function reviewRequest(collectionName, tr, status) {
  const id = tr.dataset.id;
  const userId = tr.dataset.userId;
  const hours = Number(tr.dataset.hours || 0);
  await updateDoc(doc(db, collectionName, id), {
    status,
    approvedBy: adminProfile.id,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  if (status === "approved" && collectionName === "leaveRequests") {
    const leaveField = tr.dataset.kind === "compensatory" ? "compensatoryLeaveHours" : tr.dataset.kind === "annual" ? "annualLeaveHours" : "";
    if (leaveField) await updateDoc(doc(db, "users", userId), { [leaveField]: increment(-hours), updatedAt: serverTimestamp() });
  }
  if (status === "approved" && collectionName === "overtimeRequests" && tr.dataset.comp === "1") {
    await updateDoc(doc(db, "users", userId), { compensatoryLeaveHours: increment(hours), updatedAt: serverTimestamp() });
  }

  showToast(status === "approved" ? "已核准" : "已駁回", status === "approved" ? "success" : "danger");
  await renderRequests(collectionName);
}

async function renderSettings() {
  if (adminProfile.role !== "admin") {
    content.innerHTML = `<div class="alert alert-warning">只有管理員可以修改系統設定。</div>`;
    return;
  }
  const settings = await getWorkSettings();
  content.innerHTML = `
    <form class="panel p-3" id="settingsForm">
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label" for="workStart">上班時間</label><input class="form-control" id="workStart" type="time" value="${settings.workStart}" required></div>
        <div class="col-md-4"><label class="form-label" for="workEnd">下班時間</label><input class="form-control" id="workEnd" type="time" value="${settings.workEnd}" required></div>
        <div class="col-md-4"><label class="form-label" for="standardHours">標準工時</label><input class="form-control" id="standardHours" type="number" step="0.5" value="${settings.standardHours}" required></div>
        <div class="col-md-4"><label class="form-label" for="lunchStart">午休開始</label><input class="form-control" id="lunchStart" type="time" value="${settings.lunchStart}" required></div>
        <div class="col-md-4"><label class="form-label" for="lunchEnd">午休結束</label><input class="form-control" id="lunchEnd" type="time" value="${settings.lunchEnd}" required></div>
        <div class="col-md-4"><label class="form-label" for="lateGraceMinutes">遲到寬限分鐘</label><input class="form-control" id="lateGraceMinutes" type="number" value="${settings.lateGraceMinutes}" required></div>
      </div>
      <button class="btn btn-primary mt-3">儲存設定</button>
    </form>`;

  qs("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await setDoc(doc(db, "workSettings", "default"), {
      workStart: qs("#workStart").value,
      workEnd: qs("#workEnd").value,
      lunchStart: qs("#lunchStart").value,
      lunchEnd: qs("#lunchEnd").value,
      standardHours: Number(qs("#standardHours").value),
      lateGraceMinutes: Number(qs("#lateGraceMinutes").value),
      updatedAt: serverTimestamp(),
      updatedBy: adminProfile.id
    }, { merge: true });
    showToast("設定已更新", "success");
  });
}

function leaveTypeLabel(type) {
  return {
    annual: "特休",
    compensatory: "補休",
    personal: "事假",
    sick: "病假",
    official: "公假"
  }[type] || type;
}
