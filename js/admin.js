import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  db,
  requireAuth,
  bindLogout,
  mountPageShell,
  qs,
  badge,
  fmtDateTime,
  fmtTime,
  getWorkSettings,
  hoursBetween,
  showToast,
  timeToDate,
  todayKey,
  roleLabels,
  leaveTypeLabel,
  bootstrap
} from "./app.js";
import { callSecureFunction } from "./app.js";
import { renderSecurityAdmin } from "./security-admin.js?v=20260724-2";

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
mountPageShell(title, subtitle);
const adminProfile = await requireAuth({ roles: ["manager", "admin"] });
bindLogout();

const content = qs("#pageContent");

let managedUsersPromise;

function managedUsersSnapshot() {
  if (!managedUsersPromise) {
    managedUsersPromise = getDocs(query(
      collection(db, "users"),
      where("managerId", "==", adminProfile.id)
    ));
  }
  return managedUsersPromise;
}

async function getReviewerDocs(collectionName, ...adminConstraints) {
  if (adminProfile.role === "admin") {
    const source = adminConstraints.length
      ? query(collection(db, collectionName), ...adminConstraints)
      : collection(db, collectionName);
    return getDocs(source);
  }
  if (collectionName === "users") return managedUsersSnapshot();
  if (["leaveRequests", "overtimeRequests"].includes(collectionName)) {
    return getDocs(query(collection(db, collectionName), where("managerId", "==", adminProfile.id)));
  }
  if (["attendance", "attendanceDaily"].includes(collectionName)) {
    const managedUsers = await managedUsersSnapshot();
    const snapshots = await Promise.all(managedUsers.docs.map((user) => (
      getDocs(query(collection(db, collectionName), where("userId", "==", user.id)))
    )));
    const docs = snapshots.flatMap((snapshot) => snapshot.docs);
    return { docs, size: docs.length };
  }
  return getDocs(query(collection(db, collectionName), where("department", "==", adminProfile.department || "")));
}

try {
  if (mode === "home") await renderHome();
  if (mode === "employees") await renderEmployees();
  if (mode === "attendance") await renderAttendanceReport();
  if (mode === "leave") await renderRequests("leaveRequests");
  if (mode === "overtime") await renderRequests("overtimeRequests");
  if (mode === "settings") await renderSettings();
} catch (error) {
  console.error("Admin page failed to load", error);
  content.innerHTML = `
    <div class="alert alert-danger" role="alert">
      <h2 class="h5">管理資料載入失敗</h2>
      <p class="mb-2">${escapeHtml(error?.message || "無法連線 Firebase，請稍後再試。")}</p>
      <button class="btn btn-outline-danger btn-sm" type="button" data-reload-page>重新載入</button>
    </div>`;
  content.querySelector("[data-reload-page]")?.addEventListener("click", () => location.reload());
}

try {
  await renderSecurityAdmin(mode, adminProfile, content);
} catch (error) {
  console.error("Security admin module failed to load", error);
}

async function renderHome() {
  const [users, leavePending, overtimePending, attendance] = await Promise.all([
    getReviewerDocs("users"),
    getReviewerDocs("leaveRequests", where("status", "==", "pending")),
    getReviewerDocs("overtimeRequests", where("status", "==", "pending")),
    getReviewerDocs("attendanceDaily")
  ]);
  const userRows = users.docs.map((item) => ({ id: item.id, ...item.data() }));
  const usersById = Object.fromEntries(userRows.map((user) => [user.id, user]));
  const visibleLeavePending = leavePending.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.status === "pending")
    .filter((item) => requestVisibleToReviewer(item, usersById));
  const visibleOvertimePending = overtimePending.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.status === "pending")
    .filter((item) => requestVisibleToReviewer(item, usersById));
  content.innerHTML = `
    <div class="row g-3 mb-4">
      <div class="col-md-3"><div class="panel p-3"><div class="muted">員工數</div><div class="stat-value">${userRows.length}</div></div></div>
      <div class="col-md-3"><div class="panel p-3"><div class="muted">請假待審</div><div class="stat-value">${visibleLeavePending.length}</div></div></div>
      <div class="col-md-3"><div class="panel p-3"><div class="muted">加班待審</div><div class="stat-value">${visibleOvertimePending.length}</div></div></div>
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
  const [snap, settings] = await Promise.all([
    getReviewerDocs("users"),
    getWorkSettings()
  ]);
  const shifts = normalizeWorkShifts(settings);
  const users = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant"));
  const usersById = Object.fromEntries(users.map((user) => [user.id, user]));
  const departments = buildDepartmentOptions(users);
  content.innerHTML = `
    <div class="panel p-3 mb-3">
      <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-3">
        <div>
          <h2 class="h5 mb-1">建立員工帳號</h2>
          <div class="muted small">只有管理員可以建立帳號；新帳號預設為一般員工。</div>
        </div>
        <button class="btn btn-primary" type="button" data-bs-toggle="collapse" data-bs-target="#createEmployeePanel" aria-expanded="false" aria-controls="createEmployeePanel">新增員工</button>
      </div>
      <div class="collapse" id="createEmployeePanel">
        <form id="createEmployeeForm" class="row g-3">
          <div class="col-md-6">
            <label class="form-label" for="createEmployeeName">姓名</label>
            <input class="form-control" id="createEmployeeName" autocomplete="name" required>
          </div>
          <div class="col-md-6">
            <label class="form-label" for="createEmployeeDepartment">部門</label>
            <input class="form-control" id="createEmployeeDepartment" list="departmentOptions">
          </div>
          <div class="col-md-6">
            <label class="form-label" for="createEmployeeEmail">Email</label>
            <input class="form-control" id="createEmployeeEmail" type="email" autocomplete="off" required>
          </div>
          <div class="col-md-6">
            <label class="form-label" for="createEmployeePassword">初始密碼</label>
            <input class="form-control" id="createEmployeePassword" type="password" autocomplete="new-password" minlength="8" required>
          </div>
          <div class="col-12 d-flex justify-content-end">
            <button class="btn btn-primary" type="submit" data-create-employee>建立帳號</button>
          </div>
        </form>
      </div>
    </div>
    <div class="panel p-3">
      <datalist id="departmentOptions">
        ${departments.map((department) => `<option value="${department}"></option>`).join("")}
      </datalist>
      <div class="employee-filter-bar mb-3">
        <div>
          <label class="form-label" for="employeeSearch">搜尋</label>
          <input class="form-control form-control-sm" id="employeeSearch" placeholder="姓名或 Email">
        </div>
        <div>
          <label class="form-label" for="employeeDepartmentFilter">部門</label>
          <select class="form-select form-select-sm" id="employeeDepartmentFilter">
            <option value="">全部部門</option>
            ${departments.map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="form-label" for="employeeRoleFilter">角色</label>
          <select class="form-select form-select-sm" id="employeeRoleFilter">
            <option value="">全部角色</option>
            ${["employee", "manager", "admin"].map((role) => `<option value="${role}">${roleLabels[role]}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="form-label" for="employeeActiveFilter">狀態</label>
          <select class="form-select form-select-sm" id="employeeActiveFilter">
            <option value="">全部狀態</option>
            <option value="active">啟用</option>
            <option value="inactive">停用</option>
          </select>
        </div>
        <div class="employee-filter-count" id="employeeFilterCount">${users.length} 人</div>
      </div>
      <div class="employee-editor-list">
        ${users.map((row) => employeeEditorCard(row, users, shifts)).join("")}
      </div>
    </div>`;

  bindCreateEmployeeForm();

  content.querySelectorAll("[data-save-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tr = button.closest("[data-id]");
      const payload = {};
      tr.querySelectorAll("[data-field]").forEach((input) => {
        const field = input.dataset.field;
        if (input.type === "checkbox") payload[field] = input.checked;
        else if (input.type === "number") payload[field] = Number(input.value || 0);
        else payload[field] = input.value.trim();
      });
      button.disabled = true;
      try {
        await callSecureFunction("updateEmployee", {
          userId: tr.dataset.id,
          ...payload
        });
        showToast("員工資料已更新", "success");
      } catch (error) {
        showToast(`更新失敗：${error.message}`, "danger");
      } finally {
        button.disabled = false;
      }
    });
  });
  bindEmployeeFilters(users.length);
  collapseEmployeeDetailsOnMobile();
}

function employeeEditorCard(row, users, shifts) {
  const role = roleLabels[row.role] || row.role || "未設定";
  const enabled = row.isActive !== false;
  const searchText = `${row.name || ""} ${row.email || ""}`.toLowerCase();
  return `<section class="employee-editor-card" data-id="${row.id}" data-search="${escapeHtml(searchText)}" data-department="${escapeHtml(row.department || "")}" data-role="${row.role || ""}" data-active="${enabled ? "active" : "inactive"}">
    <div class="employee-editor-head">
      <div>
        <div class="employee-editor-name">${escapeHtml(row.name || "未命名員工")}</div>
        <div class="employee-editor-email">${escapeHtml(row.email || "")}</div>
      </div>
      <div class="employee-editor-actions">
        <span class="badge text-bg-${enabled ? "success" : "secondary"}">${enabled ? "啟用" : "停用"}</span>
        <span class="badge text-bg-light text-dark">${escapeHtml(role)}</span>
        <button class="btn btn-sm btn-primary" data-save-user>儲存</button>
      </div>
    </div>
      <div class="employee-editor-grid">
      <div class="employee-editor-section employee-editor-basic">
        <div class="employee-editor-section-title">基本資料</div>
        <div class="employee-field">
          <label class="form-label">姓名</label>
          <input class="form-control form-control-sm" data-field="name" value="${escapeHtml(row.name || "")}">
        </div>
        <div class="employee-field">
          <label class="form-label">部門</label>
          <input class="form-control form-control-sm" data-field="department" list="departmentOptions" value="${escapeHtml(row.department || "")}" placeholder="選擇或輸入部門">
        </div>
      </div>
      <details class="employee-editor-more" open>
        <summary>主管、代理人與假別</summary>
        <div class="employee-editor-more-grid">
      <div class="employee-editor-section employee-editor-relations">
        <div class="employee-editor-section-title">權限與歸屬</div>
        <div class="employee-field">
          <label class="form-label">角色</label>
          <select class="form-select form-select-sm" data-field="role">
            ${["employee", "manager", "admin"].map((item) => `<option value="${item}" ${row.role === item ? "selected" : ""}>${roleLabels[item]}</option>`).join("")}
          </select>
        </div>
        <div class="employee-field">
          <label class="form-label">直屬主管</label>
          <select class="form-select form-select-sm" data-field="managerId">${managerOptions(users, row)}</select>
        </div>
        <div class="employee-field">
          <label class="form-label">職務代理人</label>
          <select class="form-select form-select-sm" data-field="proxyUserId">${proxyOptions(users, row)}</select>
        </div>
      </div>
      <div class="employee-editor-section employee-editor-work">
        <div class="employee-editor-section-title">班別與假別</div>
        <div class="employee-field">
          <label class="form-label">預設班別</label>
          <select class="form-select form-select-sm" data-field="defaultShiftId">
            ${shifts.map((shift) => `<option value="${shift.id}" ${(row.defaultShiftId || shifts[0].id) === shift.id ? "selected" : ""}>${shift.name}</option>`).join("")}
          </select>
        </div>
        <div class="employee-editor-inline">
          <div class="employee-field">
            <label class="form-label">特休</label>
            <input class="form-control form-control-sm" type="number" data-field="annualLeaveHours" value="${row.annualLeaveHours ?? 0}">
          </div>
          <div class="employee-field">
            <label class="form-label">補休</label>
            <input class="form-control form-control-sm" type="number" data-field="compensatoryLeaveHours" value="${row.compensatoryLeaveHours ?? 0}">
          </div>
        </div>
        <label class="form-check employee-enabled">
          <input class="form-check-input" type="checkbox" data-field="isActive" ${enabled ? "checked" : ""}>
          <span class="form-check-label">帳號啟用</span>
        </label>
      </div>
        </div>
      </details>
    </div>
  </section>`;
}

function collapseEmployeeDetailsOnMobile() {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  content.querySelectorAll(".employee-editor-more").forEach((item) => {
    item.removeAttribute("open");
  });
}

function bindEmployeeFilters(total) {
  const search = qs("#employeeSearch");
  const department = qs("#employeeDepartmentFilter");
  const role = qs("#employeeRoleFilter");
  const active = qs("#employeeActiveFilter");
  const count = qs("#employeeFilterCount");
  const cards = Array.from(content.querySelectorAll(".employee-editor-card"));
  const applyFilters = () => {
    const keyword = search.value.trim().toLowerCase();
    const departmentValue = department.value;
    const roleValue = role.value;
    const activeValue = active.value;
    let visible = 0;
    cards.forEach((card) => {
      const matched = (!keyword || card.dataset.search.includes(keyword))
        && (!departmentValue || card.dataset.department === departmentValue)
        && (!roleValue || card.dataset.role === roleValue)
        && (!activeValue || card.dataset.active === activeValue);
      card.hidden = !matched;
      if (matched) visible += 1;
    });
    count.textContent = `${visible} / ${total} 人`;
  };
  [search, department, role, active].forEach((input) => input.addEventListener("input", applyFilters));
  [department, role, active].forEach((input) => input.addEventListener("change", applyFilters));
}

function managerOptions(users, row) {
  const managers = users.filter((user) => user.id !== row.id && ["manager", "admin"].includes(user.role));
  return [
    `<option value="">未指定</option>`,
    ...managers.map((user) => `<option value="${user.id}" ${row.managerId === user.id ? "selected" : ""}>${escapeHtml(user.name || user.email || user.id)}</option>`)
  ].join("");
}

function proxyOptions(users, row) {
  const candidates = users.filter((user) => user.id !== row.id && user.isActive !== false);
  return [
    `<option value="">未指定</option>`,
    ...candidates.map((user) => `<option value="${user.id}" ${row.proxyUserId === user.id ? "selected" : ""}>${escapeHtml(user.name || user.email || user.id)}</option>`)
  ].join("");
}

function buildDepartmentOptions(users) {
  const existing = users
    .map((user) => String(user.department || "").trim())
    .filter(Boolean);
  return Array.from(new Set(existing)).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

async function renderAttendanceReport() {
  const [usersSnap, attendanceSnap, leaveSnap, settings] = await Promise.all([
    getReviewerDocs("users"),
    getReviewerDocs("attendance"),
    getReviewerDocs("leaveRequests"),
    getWorkSettings()
  ]);
  const users = usersSnap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "zh-Hant"));
  const usersById = Object.fromEntries(users.map((item) => [item.id, item]));
  const departments = Array.from(new Set(users.map((user) => user.department || "未分部門"))).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const allAttendanceRows = attendanceSnap.docs
    .map((item) => item.data())
    .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
  const allLeaveRows = leaveSnap.docs
    .map((item) => item.data())
    .sort((a, b) => toMillis(b.startTime) - toMillis(a.startTime));
  const approvedLeaveRows = allLeaveRows.filter((item) => item.status === "approved");
  const now = new Date();
  const today = todayKey(now);
  const years = buildAttendanceYears(allAttendanceRows, now.getFullYear());
  const todayMissingUsers = buildTodayMissingClockInUsers(users, allAttendanceRows, settings, today);

  content.innerHTML = `
    <div class="panel p-3 mb-3">
      <div class="row g-3">
        <div class="col-md-3">
          <label class="form-label" for="attendanceYearFilter">年度</label>
          <select class="form-select" id="attendanceYearFilter">
            ${years.map((year) => `<option value="${year}" ${year === now.getFullYear() ? "selected" : ""}>${year} 年</option>`).join("")}
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label" for="attendanceMonthFilter">月份</label>
          <select class="form-select" id="attendanceMonthFilter">
            ${Array.from({ length: 12 }, (_, index) => {
              const month = index + 1;
              return `<option value="${month}" ${month === now.getMonth() + 1 ? "selected" : ""}>${month} 月</option>`;
            }).join("")}
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label" for="attendanceDepartmentFilter">先選部門</label>
          <select class="form-select" id="attendanceDepartmentFilter">
            <option value="">請選擇部門</option>
            ${departments.map((department) => `<option value="${department}">${department}</option>`).join("")}
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label" for="attendanceUserFilter">再選人員</label>
          <select class="form-select" id="attendanceUserFilter" disabled>
            <option value="">請先選擇部門</option>
          </select>
        </div>
      </div>
      <div class="form-text">人事月報以月份為單位；切換 1 到 12 月後，彙總與原始明細都只顯示該月資料。</div>
      <div class="d-flex justify-content-end gap-2 flex-wrap mt-3">
        <button class="btn btn-outline-primary" id="attendanceCompanyExportCsv" type="button">${adminProfile.role === "admin" ? "全公司" : escapeHtml(adminProfile.department || "所屬部門")}出勤紀錄 EXCEL</button>
        <button class="btn btn-outline-primary" id="attendanceCompanyExportCorrection" type="button">${adminProfile.role === "admin" ? "全公司" : escapeHtml(adminProfile.department || "所屬部門")}出勤紀錄改</button>
      </div>
    </div>
    ${todayMissingAttendanceHtml(todayMissingUsers, today, settings)}
    <div class="panel p-3 mb-3">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2 class="h5 mb-1">出缺勤月報</h2>
          <div class="small muted" id="attendancePeriodLabel">請選擇員工</div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="badge text-bg-secondary" id="attendanceSummaryBadge">尚未選擇員工</span>
          <button class="btn btn-sm btn-outline-secondary" id="attendancePrintSheet" disabled>列印出勤表</button>
          <button class="btn btn-sm btn-outline-secondary" id="attendancePrintCorrectionSheet" disabled>出勤表改正</button>
          <button class="btn btn-sm btn-outline-primary" id="attendanceExportCsv" disabled>下載 CSV</button>
        </div>
      </div>
      <div class="row g-2 mb-3" id="attendanceMonthlyStats">
        <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">出勤日數</div><div class="fw-bold">-</div></div></div>
        <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">總工時</div><div class="fw-bold">-</div></div></div>
        <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">遲到</div><div class="fw-bold">-</div></div></div>
        <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">早退 / 異常</div><div class="fw-bold">-</div></div></div>
      </div>
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>日期</th><th>員工</th><th>部門</th><th>班別</th><th>簽到</th><th>簽退</th><th>工時</th><th>遲到</th><th>早退</th><th>狀態</th><th>處理</th></tr></thead>
        <tbody id="attendanceSummaryRows"><tr><td colspan="11" class="muted">請先選擇員工</td></tr></tbody>
      </table></div>
    </div>
    <div class="panel p-3 mb-3">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2 class="h5 mb-1">當月請假紀錄</h2>
          <div class="small muted" id="attendanceLeavePeriodLabel">請選擇員工</div>
        </div>
        <span class="badge text-bg-secondary" id="attendanceLeaveBadge">尚未選擇員工</span>
      </div>
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>假別</th><th>時間</th><th>時數</th><th>狀態</th><th>原因</th></tr></thead>
        <tbody id="attendanceLeaveRows"><tr><td colspan="5" class="muted">請先選擇員工</td></tr></tbody>
      </table></div>
    </div>
    <details class="panel p-3">
      <summary class="d-flex justify-content-between align-items-center">
        <span class="h5 mb-0">原始打卡明細（查核用）</span>
        <span class="badge text-bg-secondary" id="attendanceDetailBadge">尚未選擇員工</span>
      </summary>
      <div class="table-responsive mt-3"><table class="table align-middle mb-0">
        <thead><tr><th>時間</th><th>員工</th><th>角色</th><th>部門</th><th>班別</th><th>類型</th><th>狀態</th><th>GPS</th></tr></thead>
        <tbody id="attendanceDetailRows"><tr><td colspan="8" class="muted">請先選擇員工</td></tr></tbody>
      </table></div>
    </details>`;

  const renderCurrentSelection = () => {
    const userId = qs("#attendanceUserFilter").value;
    renderSelectedAttendance(userId, usersById, allAttendanceRows, allLeaveRows, approvedLeaveRows, settings, selectedAttendancePeriod());
  };

  qs("#attendanceDepartmentFilter").addEventListener("change", (event) => {
    renderAttendanceUserOptions(event.target.value, users);
    renderSelectedAttendance("", usersById, allAttendanceRows, allLeaveRows, approvedLeaveRows, settings, selectedAttendancePeriod());
  });
  qs("#attendanceUserFilter").addEventListener("change", renderCurrentSelection);
  qs("#attendanceYearFilter").addEventListener("change", renderCurrentSelection);
  qs("#attendanceMonthFilter").addEventListener("change", renderCurrentSelection);
  qs("#attendanceCompanyExportCsv").addEventListener("click", () => {
    downloadCompanyAttendanceWorkbook(users, allAttendanceRows, approvedLeaveRows, settings, selectedAttendancePeriod());
  });
  qs("#attendanceCompanyExportCorrection").addEventListener("click", () => {
    openCompanyAttendancePrintView(users, allAttendanceRows, approvedLeaveRows, settings, selectedAttendancePeriod(), true);
  });
}

function buildTodayMissingClockInUsers(users, attendanceRows, settings, today) {
  if (isCompanyRestDay(today, settings)) return [];
  const checkedInUserIds = new Set(
    attendanceRows
      .filter((row) => (row.date || dateKeyFromTimestamp(row.timestamp)) === today && row.type === "checkIn")
      .map((row) => row.userId)
      .filter(Boolean)
  );
  const shifts = normalizeWorkShifts(settings);
  return users
    .filter((user) => user.isActive !== false && !checkedInUserIds.has(user.id))
    .map((user) => {
      const shift = shifts.find((item) => item.id === user.defaultShiftId) || shifts[0] || {};
      return { ...user, shiftName: shift.name || "未設定班別", workStart: shift.workStart || "-" };
    })
    .sort((a, b) => String(a.department || "").localeCompare(String(b.department || ""), "zh-Hant")
      || String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "zh-Hant"));
}

function todayMissingAttendanceHtml(users, today, settings) {
  if (isCompanyRestDay(today, settings)) {
    return `
      <div class="panel p-3 mb-3">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <h2 class="h5 mb-1">今日尚未打卡人員</h2>
            <div class="small muted">${today}</div>
          </div>
          <span class="badge text-bg-secondary">今日為休息日</span>
        </div>
      </div>`;
  }
  return `
    <div class="panel p-3 mb-3">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2 class="h5 mb-1">今日尚未打卡人員</h2>
          <div class="small muted">${today}，供人事主管關切未簽到原因</div>
        </div>
        <span class="badge ${users.length ? "text-bg-warning" : "text-bg-success"}">${users.length ? `${users.length} 人` : "全員已簽到"}</span>
      </div>
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>姓名</th><th>Email</th><th>部門</th><th>角色</th><th>班別</th><th>上班時間</th></tr></thead>
        <tbody>${users.length ? users.map((user) => `<tr>
          <td>${user.name || "-"}</td>
          <td>${user.email || "-"}</td>
          <td>${user.department || "未分部門"}</td>
          <td>${roleLabels[user.role] || user.role || "-"}</td>
          <td>${user.shiftName}</td>
          <td>${user.workStart}</td>
        </tr>`).join("") : `<tr><td colspan="6" class="muted">今天沒有尚未打卡人員</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

function isCompanyRestDay(dateKey, settings) {
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();
  const holidayDates = new Set(Array.isArray(settings.holidayDates) ? settings.holidayDates : []);
  return day === 0 || day === 6 || holidayDates.has(dateKey);
}

function renderAttendanceUserOptions(department, users) {
  const userSelect = qs("#attendanceUserFilter");
  if (!department) {
    userSelect.disabled = true;
    userSelect.innerHTML = `<option value="">請先選擇部門</option>`;
    return;
  }
  const filteredUsers = users.filter((user) => (user.department || "未分部門") === department);
  userSelect.disabled = false;
  userSelect.innerHTML = `
    <option value="">請選擇人員</option>
    ${filteredUsers.map((user) => `<option value="${user.id}">${user.name || user.email || user.id} - ${roleLabels[user.role] || user.role || "-"}</option>`).join("")}
  `;
}

function renderSelectedAttendance(userId, usersById, allAttendanceRows, allLeaveRows, approvedLeaveRows, settings, period) {
  const summaryBody = qs("#attendanceSummaryRows");
  const summaryBadge = qs("#attendanceSummaryBadge");
  const leaveBody = qs("#attendanceLeaveRows");
  const leaveBadge = qs("#attendanceLeaveBadge");
  const leavePeriodLabel = qs("#attendanceLeavePeriodLabel");
  const detailBody = qs("#attendanceDetailRows");
  const detailBadge = qs("#attendanceDetailBadge");
  const periodLabel = qs("#attendancePeriodLabel");
  const statsHost = qs("#attendanceMonthlyStats");
  const exportButton = qs("#attendanceExportCsv");
  const printButton = qs("#attendancePrintSheet");
  const correctionPrintButton = qs("#attendancePrintCorrectionSheet");

  if (!userId) {
    summaryBadge.className = "badge text-bg-secondary";
    summaryBadge.textContent = "尚未選擇員工";
    leaveBadge.className = "badge text-bg-secondary";
    leaveBadge.textContent = "尚未選擇員工";
    detailBadge.className = "badge text-bg-secondary";
    detailBadge.textContent = "尚未選擇員工";
    periodLabel.textContent = `${period.year} 年 ${period.month} 月`;
    leavePeriodLabel.textContent = `${period.year} 年 ${period.month} 月`;
    statsHost.innerHTML = monthlyStatsHtml(null);
    exportButton.disabled = true;
    exportButton.onclick = null;
    printButton.disabled = true;
    printButton.onclick = null;
    correctionPrintButton.disabled = true;
    correctionPrintButton.onclick = null;
    summaryBody.innerHTML = `<tr><td colspan="11" class="muted">請先選擇員工</td></tr>`;
    leaveBody.innerHTML = `<tr><td colspan="5" class="muted">請先選擇員工</td></tr>`;
    detailBody.innerHTML = `<tr><td colspan="8" class="muted">請先選擇員工</td></tr>`;
    return;
  }

  const user = usersById[userId] || {};
  const attendanceRows = allAttendanceRows.filter((row) => row.userId === userId && isRowInPeriod(row, period));
  const leaveRows = allLeaveRows.filter((row) => row.userId === userId && isLeaveInPeriod(row, period));
  const userApprovedLeaves = approvedLeaveRows.filter((row) => row.userId === userId);
  const summaryRows = buildAttendanceSummaryRows(attendanceRows, user, settings, userApprovedLeaves, period);
  const monthlyStats = buildMonthlyAttendanceStats(summaryRows);

  periodLabel.textContent = `${period.year} 年 ${period.month} 月 - ${user.name || user.email || "已選員工"}`;
  leavePeriodLabel.textContent = `${period.year} 年 ${period.month} 月 - ${user.name || user.email || "已選員工"}`;
  summaryBadge.className = "badge text-bg-primary";
  summaryBadge.textContent = `${user.name || user.email || "已選員工"}，${summaryRows.length} 天`;
  leaveBadge.className = leaveRows.length ? "badge text-bg-primary" : "badge text-bg-secondary";
  leaveBadge.textContent = `${leaveRows.length} 筆`;
  detailBadge.className = "badge text-bg-primary";
  detailBadge.textContent = `${user.name || user.email || "已選員工"}，${attendanceRows.length} 筆`;
  statsHost.innerHTML = monthlyStatsHtml(monthlyStats);
  exportButton.disabled = !summaryRows.length;
  exportButton.onclick = () => downloadAttendanceCsv(summaryRows, user, period);
  printButton.disabled = !summaryRows.length;
  printButton.onclick = () => openAttendancePrintView(user, summaryRows, attendanceRows, userApprovedLeaves, settings, period);
  correctionPrintButton.disabled = !summaryRows.length;
  correctionPrintButton.onclick = () => openAttendancePrintView(user, summaryRows, attendanceRows, userApprovedLeaves, settings, period, true);

  summaryBody.innerHTML = summaryRows.length ? summaryRows.map((row) => {
    return `<tr>
      <td>${row.date}</td>
      <td>${row.userName}</td>
      <td>${row.department}</td>
      <td>${row.shiftName}</td>
      <td>${row.checkInText}</td>
      <td>${row.checkOutText}</td>
      <td>${row.workHours}</td>
      <td>${row.lateMinutes ? `${row.lateMinutes} 分` : "-"}</td>
      <td>${row.earlyLeaveMinutes ? `${row.earlyLeaveMinutes} 分` : "-"}</td>
      <td>${summaryStatusBadge(row)}</td>
      <td>${manualPunchActionHtml(row)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="11" class="muted">此員工尚無出勤資料</td></tr>`;

  summaryBody.querySelectorAll("[data-manual-punch]").forEach((button) => {
    button.addEventListener("click", async () => {
      await createManualAttendanceRecord(button.dataset, usersById, settings);
    });
  });

  leaveBody.innerHTML = leaveRows.length ? leaveRows.map((row) => {
    return `<tr>
      <td>${leaveTypeLabel(row.leaveType)}</td>
      <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
      <td>${row.hours ?? "-"}</td>
      <td>${badge(row.status)}</td>
      <td>${row.reason || "-"}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="5" class="muted">此員工本月尚無請假紀錄</td></tr>`;

  detailBody.innerHTML = attendanceRows.length ? attendanceRows.map((row) => {
    return `<tr>
      <td>${fmtDateTime(row.timestamp)}</td>
      <td>${row.userName || user.name || "-"}</td>
      <td>${roleLabels[user.role] || user.role || "-"}</td>
      <td>${row.department || user.department || "-"}</td>
      <td>${row.shiftName || "-"}</td>
      <td>${row.type === "checkIn" ? "簽到" : "簽退"}</td>
      <td>${badge(row.status)}</td>
      <td>${mapLink(row.latitude, row.longitude)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" class="muted">此員工尚無打卡明細</td></tr>`;
}

function selectedAttendancePeriod() {
  return {
    year: Number(qs("#attendanceYearFilter").value),
    month: Number(qs("#attendanceMonthFilter").value)
  };
}

function buildAttendanceYears(attendanceRows, currentYear) {
  const years = attendanceRows
    .map((row) => row.date || dateKeyFromTimestamp(row.timestamp))
    .filter(Boolean)
    .map((date) => Number(date.slice(0, 4)))
    .filter(Boolean);
  return Array.from(new Set([currentYear - 1, currentYear, currentYear + 1, ...years])).sort((a, b) => b - a);
}

function isRowInPeriod(row, period) {
  const date = row.date || dateKeyFromTimestamp(row.timestamp);
  if (!date) return false;
  return date.slice(0, 7) === `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function isLeaveInPeriod(row, period) {
  const monthStart = new Date(period.year, period.month - 1, 1);
  const monthEnd = new Date(period.year, period.month, 0, 23, 59, 59);
  const start = timestampToDate(row.startTime);
  const end = timestampToDate(row.endTime);
  return start <= monthEnd && end >= monthStart;
}

function buildMonthlyAttendanceStats(summaryRows) {
  const workHours = Number(summaryRows.reduce((sum, row) => sum + Number(row.workHours || 0), 0).toFixed(2));
  const leaveHours = Number(summaryRows.reduce((sum, row) => sum + Number(row.creditedLeaveHours || 0), 0).toFixed(2));
  const expectedHours = Number(summaryRows.reduce((sum, row) => sum + Number(row.expectedHours || 0), 0).toFixed(2));
  const creditedHours = Number((workHours + leaveHours).toFixed(2));
  return {
    days: summaryRows.length,
    expectedHours,
    workHours,
    leaveHours,
    creditedHours,
    shortageHours: Number(Math.max(0, expectedHours - creditedHours).toFixed(2)),
    lateCount: summaryRows.filter((row) => row.lateMinutes > 0).length,
    lateMinutes: summaryRows.reduce((sum, row) => sum + Number(row.lateMinutes || 0), 0),
    earlyLeaveCount: summaryRows.filter((row) => row.earlyLeaveMinutes > 0).length,
    earlyLeaveMinutes: summaryRows.reduce((sum, row) => sum + Number(row.earlyLeaveMinutes || 0), 0),
    abnormalCount: summaryRows.filter((row) => row.status !== "normal").length
  };
}

function monthlyStatsHtml(stats) {
  if (!stats) {
    return `
      <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">出勤日數</div><div class="fw-bold">-</div></div></div>
      <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">應出勤</div><div class="fw-bold">-</div></div></div>
      <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">實際出勤</div><div class="fw-bold">-</div></div></div>
      <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">核准請假</div><div class="fw-bold">-</div></div></div>
      <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">認列合計</div><div class="fw-bold">-</div></div></div>
      <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">異常</div><div class="fw-bold">-</div></div></div>`;
  }
  return `
    <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">出勤日數</div><div class="fw-bold">${stats.days} 天</div></div></div>
    <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">應出勤</div><div class="fw-bold">${stats.expectedHours} 小時</div></div></div>
    <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">實際出勤</div><div class="fw-bold">${stats.workHours} 小時</div></div></div>
    <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">核准請假</div><div class="fw-bold">${stats.leaveHours} 小時</div></div></div>
    <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">認列合計</div><div class="fw-bold">${stats.creditedHours} 小時</div><div class="small muted">不足 ${stats.shortageHours} 小時</div></div></div>
    <div class="col-md-2"><div class="border rounded p-2"><div class="small muted">異常</div><div class="fw-bold">${stats.abnormalCount} 天</div><div class="small muted">遲到 ${stats.lateCount} 次 / 早退 ${stats.earlyLeaveCount} 次</div></div></div>`;
}

function bindCreateEmployeeForm() {
  const form = qs("#createEmployeeForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = qs("[data-create-employee]", form);
    const name = qs("#createEmployeeName").value.trim();
    const department = qs("#createEmployeeDepartment").value.trim();
    const email = qs("#createEmployeeEmail").value.trim();
    const password = qs("#createEmployeePassword").value;
    submitButton.disabled = true;

    try {
      await createEmployeeAccount({ name, department, email, password });
      showToast(`已建立 ${name} 的員工帳號`, "success");
      form.reset();
      await renderEmployees();
    } catch (error) {
      showToast(`建立帳號失敗：${authErrorMessage(error)}`, "danger");
      submitButton.disabled = false;
    }
  });
}

async function createEmployeeAccount({ name, department, email, password }) {
  await callSecureFunction("createEmployeeAccount", { name, department, email, password });
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "這個 Email 已經有人使用。",
    "auth/invalid-email": "Email 格式不正確。",
    "auth/weak-password": "密碼強度不足，請至少輸入 8 個字元。",
    "functions/already-exists": "這個 Email 已經有人使用。"
  };
  return messages[error?.code] || error?.message || "請稍後再試。";
}

function openAttendancePrintView(user, summaryRows, attendanceRows, approvedLeaves, settings, period, correctDailyHours = false) {
  const popup = window.open("", "_blank", "width=1200,height=820");
  if (!popup) {
    showToast("瀏覽器封鎖列印視窗，請允許彈出視窗後再試一次。", "warning");
    return;
  }
  popup.document.open();
  popup.document.write(attendancePrintHtml(user, summaryRows, attendanceRows, approvedLeaves, settings, period, correctDailyHours));
  popup.document.close();
  popup.focus();
}

function openCompanyAttendancePrintView(users, allAttendanceRows, approvedLeaveRows, settings, period, correctDailyHours = false) {
  const activeUsers = users
    .filter((user) => user.isActive !== false)
    .sort((a, b) => String(a.department || "").localeCompare(String(b.department || ""), "zh-Hant")
      || String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "zh-Hant"));
  if (!activeUsers.length) {
    showToast("沒有可列印的啟用員工。", "warning");
    return;
  }

  const sheets = activeUsers.map((user) => {
    const attendanceRows = allAttendanceRows.filter((row) => row.userId === user.id && isRowInPeriod(row, period));
    const userApprovedLeaves = approvedLeaveRows.filter((row) => row.userId === user.id);
    const summaryRows = buildAttendanceSummaryRows(attendanceRows, user, settings, userApprovedLeaves, period)
      .sort((a, b) => a.date.localeCompare(b.date));
    return { user, summaryRows, attendanceRows, approvedLeaves: userApprovedLeaves };
  });

  const popup = window.open("", "_blank", "width=1200,height=820");
  if (!popup) {
    showToast("瀏覽器封鎖列印視窗，請允許彈出視窗後再試一次。", "warning");
    return;
  }
  popup.document.open();
  popup.document.write(companyAttendancePrintHtml(sheets, settings, period, correctDailyHours));
  popup.document.close();
  popup.focus();
}

function attendancePrintHtml(user, summaryRows, attendanceRows, approvedLeaves, settings, period, correctDailyHours = false) {
  const rows = buildAttendancePrintRows(user, summaryRows, attendanceRows, approvedLeaves, settings, period, correctDailyHours);
  const totalWorkHours = correctDailyHours
    ? Number(rows.reduce((sum, row) => sum + Number(row.workHours || 0), 0).toFixed(2))
    : Number(summaryRows.reduce((sum, row) => sum + Number(row.workHours || 0), 0).toFixed(2));
  const totalLeaveHours = Number(summaryRows.reduce((sum, row) => sum + Number(row.creditedLeaveHours || 0), 0).toFixed(2));
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>出勤紀錄 - ${escapeHtml(user.name || user.email || "")}</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #fff; color: #000; font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; }
    .sheet { width: 285mm; min-height: 198mm; margin: 0 auto; padding: 1.5mm 0; }
    .topline { display: grid; grid-template-columns: 1.5fr .8fr 1fr; align-items: end; gap: 5mm; margin-bottom: 2mm; }
    .company { text-align: center; font-weight: 700; font-size: 14pt; letter-spacing: .06em; }
    .meta { font-size: 10pt; white-space: nowrap; }
    .meta strong { display: inline-block; min-width: 19mm; border-bottom: 1px solid #000; text-align: center; padding: 0 1mm; }
    .tables { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1.5px solid #000; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.4pt; line-height: 1.05; }
    .left-table { border-right: 1.5px solid #000; }
    th, td { border: 1px solid #000; text-align: center; vertical-align: middle; padding: .35mm .25mm; height: 7.8mm; overflow: hidden; }
    th { font-weight: 700; }
    thead th { height: 6.4mm; }
    .day { width: 5.5mm; font-size: 8pt; }
    .week { width: 5mm; font-size: 8pt; }
    .time { width: 10.2mm; }
    .hours { width: 7.5mm; }
    .leave-hours { width: 7.5mm; }
    .leave-type { width: 10mm; }
    .note { width: 14mm; font-size: 6.5pt; }
    .punch-time { white-space: pre-line; font-size: 6.8pt; line-height: 1.05; }
    .lunch-note { margin-top: 1.5mm; text-align: left; font-size: 8pt; }
    .rest-day td, .empty-day td { background: #aaa !important; }
    .empty-day td { color: transparent; }
    .summary-row td { height: 8mm; font-size: 9pt; background: #fff; }
    .print-actions { margin-top: 4mm; text-align: center; }
    .print-actions button { font: 15px "Microsoft JhengHei", sans-serif; padding: 8px 18px; }
    @media print {
      .print-actions { display: none; }
      .sheet { width: 285mm; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="topline">
      <div class="company">竣貿國際股份有限公司 出勤紀錄</div>
      <div class="meta">員工姓名：<strong>${escapeHtml(user.name || "")}</strong></div>
      <div class="meta">紀錄年月：<strong>${period.year - 1911}</strong> 年 <strong>${period.month}</strong> 月</div>
    </div>
    <div class="tables">
      ${attendancePrintTable(rows.slice(0, 16), "left-table", settings)}
      ${attendancePrintTable(rows.slice(16, 32), "", settings)}
      <table class="left-table"><tr class="summary-row"><td>出勤總時數統計</td><td>${totalWorkHours} 小時</td></tr></table>
      <table><tr class="summary-row"><td>請假總時數統計</td><td>${totalLeaveHours} 小時</td></tr></table>
    </div>
    <div class="lunch-note">${escapeHtml(printLunchSummary(settings))}</div>
    <div class="print-actions"><button onclick="window.print()">列印 / 另存 PDF</button></div>
  </div>
</body>
</html>`;
}

function companyAttendancePrintHtml(sheets, settings, period, correctDailyHours = false) {
  const sheetHtml = sheets.map(({ user, summaryRows, attendanceRows, approvedLeaves }) => {
    const rows = buildAttendancePrintRows(user, summaryRows, attendanceRows, approvedLeaves, settings, period, correctDailyHours);
    const totalWorkHours = correctDailyHours
      ? Number(rows.reduce((sum, row) => sum + Number(row.workHours || 0), 0).toFixed(2))
      : Number(summaryRows.reduce((sum, row) => sum + Number(row.workHours || 0), 0).toFixed(2));
    const totalLeaveHours = Number(summaryRows.reduce((sum, row) => sum + Number(row.creditedLeaveHours || 0), 0).toFixed(2));
    return `<section class="sheet">
      <div class="topline">
        <div class="company">竣貿國際股份有限公司 出勤紀錄</div>
        <div class="meta">員工姓名：<strong>${escapeHtml(user.name || "")}</strong></div>
        <div class="meta">紀錄年月：<strong>${period.year - 1911}</strong> 年 <strong>${period.month}</strong> 月</div>
      </div>
      <div class="tables">
        ${attendancePrintTable(rows.slice(0, 16), "left-table", settings)}
        ${attendancePrintTable(rows.slice(16, 32), "", settings)}
        <table class="left-table"><tr class="summary-row"><td>出勤總時數統計</td><td>${totalWorkHours} 小時</td></tr></table>
        <table><tr class="summary-row"><td>請假總時數統計</td><td>${totalLeaveHours} 小時</td></tr></table>
      </div>
      <div class="lunch-note">${escapeHtml(printLunchSummary(settings))}</div>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>${period.year}-${String(period.month).padStart(2, "0")} 全公司出勤紀錄改</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #fff; color: #000; font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; }
    .sheet { width: 285mm; min-height: 198mm; margin: 0 auto; padding: 1.5mm 0; break-after: page; page-break-after: always; }
    .sheet:last-of-type { break-after: auto; page-break-after: auto; }
    .topline { display: grid; grid-template-columns: 1.5fr .8fr 1fr; align-items: end; gap: 5mm; margin-bottom: 2mm; }
    .company { text-align: center; font-weight: 700; font-size: 14pt; letter-spacing: .06em; }
    .meta { font-size: 10pt; white-space: nowrap; }
    .meta strong { display: inline-block; min-width: 19mm; border-bottom: 1px solid #000; text-align: center; padding: 0 1mm; }
    .tables { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1.5px solid #000; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.4pt; line-height: 1.05; }
    .left-table { border-right: 1.5px solid #000; }
    th, td { border: 1px solid #000; text-align: center; vertical-align: middle; padding: .35mm .25mm; height: 7.8mm; overflow: hidden; }
    th { font-weight: 700; }
    thead th { height: 6.4mm; }
    .day { width: 5.5mm; font-size: 8pt; }
    .week { width: 5mm; font-size: 8pt; }
    .time { width: 10.2mm; }
    .hours { width: 7.5mm; }
    .leave-hours { width: 7.5mm; }
    .leave-type { width: 10mm; }
    .note { width: 14mm; font-size: 6.5pt; }
    .punch-time { white-space: pre-line; font-size: 6.8pt; line-height: 1.05; }
    .lunch-note { margin-top: 1.5mm; text-align: left; font-size: 8pt; }
    .rest-day td, .empty-day td { background: #aaa !important; }
    .empty-day td { color: transparent; }
    .summary-row td { height: 8mm; font-size: 9pt; background: #fff; }
    .print-actions { position: sticky; top: 0; z-index: 2; padding: 10px; text-align: center; background: rgba(255, 255, 255, .94); border-bottom: 1px solid #ddd; }
    .print-actions button { font: 15px "Microsoft JhengHei", sans-serif; padding: 8px 18px; }
    @media print {
      .print-actions { display: none; }
      .sheet { width: 285mm; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="print-actions"><button onclick="window.print()">列印全公司 / 另存 PDF</button></div>
  ${sheetHtml}
</body>
</html>`;
}

function attendancePrintTable(rows, className, settings) {
  return `<table class="${className}">
    <colgroup>
      <col class="day"><col class="week">
      <col class="time"><col class="time"><col class="time">
      <col class="time"><col class="time"><col class="time">
      <col class="hours"><col class="leave-hours"><col class="leave-type"><col class="note">
    </colgroup>
    <thead>
      <tr>
        <th colspan="2" rowspan="2">日期</th>
        <th colspan="3">上午出勤</th>
        <th colspan="3">下午出勤</th>
        <th rowspan="2">出勤<br>時數</th>
        <th rowspan="2">請假<br>時數</th>
        <th rowspan="2">假<br>別</th>
        <th rowspan="2">備註</th>
      </tr>
      <tr>
        <th>簽到</th><th>簽退</th><th>簽到</th>
        <th>簽退</th><th>簽到</th><th>簽退</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => attendancePrintRow(row, settings)).join("")}
    </tbody>
  </table>`;
}

function attendancePrintRow(row) {
  if (!row.day) {
    return `<tr class="empty-day"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  }
  const className = row.isRestDay ? "rest-day" : "";
  return `<tr class="${className}">
    <td>${row.day}</td>
    <td>${row.weekday}</td>
    <td class="punch-time">${escapeHtml(row.morningIn1)}</td>
    <td class="punch-time">${escapeHtml(row.morningOut1)}</td>
    <td class="punch-time">${escapeHtml(row.morningIn2)}</td>
    <td class="punch-time">${escapeHtml(row.afternoonOut1)}</td>
    <td class="punch-time">${escapeHtml(row.afternoonIn1)}</td>
    <td class="punch-time">${escapeHtml(row.afternoonOut2)}</td>
    <td>${row.workHours || ""}</td>
    <td>${row.leaveHours || ""}</td>
    <td>${escapeHtml(row.leaveTypes)}</td>
    <td>${escapeHtml(row.note)}</td>
  </tr>`;
}

function buildAttendancePrintRows(user, summaryRows, attendanceRows, approvedLeaves, settings, period, correctDailyHours = false) {
  const summaryByDate = new Map(summaryRows.map((row) => [row.date, row]));
  const rowsByDate = new Map();
  attendanceRows.forEach((row) => {
    const date = row.date || dateKeyFromTimestamp(row.timestamp);
    if (!date) return;
    if (!rowsByDate.has(date)) rowsByDate.set(date, []);
    rowsByDate.get(date).push(row);
  });

  const daysInMonth = new Date(period.year, period.month, 0).getDate();
  const rows = [];
  for (let day = 1; day <= 32; day += 1) {
    if (day > daysInMonth) {
      rows.push({ day: "" });
      continue;
    }
    const date = `${period.year}-${String(period.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const summary = summaryByDate.get(date);
    const dayLeaves = approvedLeaves.filter((item) => isLeaveOnDate(item, date));
    const leaveRanges = formatPrintLeaveRanges(dayLeaves, date);
    const isWorkTimeNotEnough = summary?.status === "workTimeNotEnough";
    const statusNote = summary && summary.status !== "normal" && !(correctDailyHours && isWorkTimeNotEnough)
      ? summaryStatusText(summary.status)
      : "";
    const leaveHours = Number(summary?.creditedLeaveHours || 0);
    const originalWorkHours = Number(summary?.workHours || 0);
    const availableWorkHours = Math.max(0, Number(settings.standardHours || 8) - leaveHours);
    const correctedWorkHours = correctDailyHours
      ? Math.min(originalWorkHours, availableWorkHours)
      : originalWorkHours;
    const workHours = correctDailyHours && isWorkTimeNotEnough
      ? Math.min(Math.round(correctedWorkHours), availableWorkHours)
      : correctedWorkHours;
    rows.push({
      day,
      weekday: weekdayShort(new Date(`${date}T00:00:00`)),
      isRestDay: isCompanyRestDay(date, settings),
      ...attendancePrintPunches(date, rowsByDate.get(date) || [], settings),
      workHours: workHours ? workHours.toFixed(2).replace(/\.00$/, "") : "",
      leaveHours: leaveHours ? leaveHours.toFixed(2).replace(/\.00$/, "") : "",
      leaveTypes: Array.from(new Set(dayLeaves.map((item) => leaveTypeLabel(item.leaveType)))).join("、"),
      note: [leaveRanges, statusNote].filter(Boolean).join(" / ")
    });
  }
  return [...rows.slice(0, 16), ...rows.slice(16, 32)];
}

function formatPrintLeaveRanges(leaves, date) {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);
  return leaves
    .map((item) => {
      const start = timestampToDate(item.startTime);
      const end = timestampToDate(item.endTime);
      if (!start || !end) return "";
      const clippedStart = start < dayStart ? dayStart : start;
      const clippedEnd = end > dayEnd ? dayEnd : end;
      return `${printClockTime(clippedStart)}-${printClockTime(clippedEnd)}`;
    })
    .filter(Boolean)
    .join("; ");
}

function printClockTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function attendancePrintPunches(date, rows, settings) {
  const lunchEnd = timeToDate(date, settings.lunchEnd || "13:00");
  const ordered = [...rows]
    .map((row) => ({ ...row, punchTime: timestampToDate(row.timestamp) }))
    .filter((row) => row.punchTime && !Number.isNaN(row.punchTime.getTime()))
    .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
  const morningRows = ordered.filter((row) => row.punchTime < lunchEnd);
  const afternoonRows = ordered.filter((row) => row.punchTime >= lunchEnd);
  const timesByType = (list, type, index) => {
    const times = list
      .filter((row) => row.type === type)
      .map((row) => printTime(row.punchTime));
    if (index === 0) return times[0] || "";
    return times.slice(index).join("\n");
  };
  const afternoonCheckOuts = afternoonRows
    .filter((row) => row.type === "checkOut")
    .map((row) => printTime(row.punchTime));
  const finalAfternoonOut = afternoonCheckOuts.at(-1) || "";
  const midAfternoonOuts = afternoonCheckOuts.length > 1 ? afternoonCheckOuts.slice(0, -1).join("\n") : "";
  return {
    morningIn1: timesByType(morningRows, "checkIn", 0),
    morningOut1: timesByType(morningRows, "checkOut", 0),
    morningIn2: timesByType(morningRows, "checkIn", 1),
    afternoonOut1: midAfternoonOuts,
    afternoonIn1: timesByType(afternoonRows, "checkIn", 0),
    afternoonOut2: finalAfternoonOut
  };
}

function printTime(value) {
  return value ? fmtTime(value) : "";
}

function printLunchLabel(settings) {
  const start = settings.lunchStart || "12:00";
  const end = settings.lunchEnd || "13:00";
  return `${start}\n${end}`;
}

function printLunchSummary(settings) {
  const start = settings.lunchStart || "12:00";
  const end = settings.lunchEnd || "13:00";
  return `休息時間：${start} - ${end}`;
}

function weekdayShort(date) {
  return ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
}

function downloadAttendanceCsv(summaryRows, user, period) {
  const headers = ["日期", "員工", "部門", "班別", "簽到", "簽退", "工時", "遲到分鐘", "早退分鐘", "狀態"];
  const rows = summaryRows.map((row) => [
    row.date,
    row.userName,
    row.department,
    row.shiftName,
    row.checkInText,
    row.checkOutText,
    row.workHours,
    row.lateMinutes || 0,
    row.earlyLeaveMinutes || 0,
    summaryStatusText(row.status)
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${period.year}-${String(period.month).padStart(2, "0")}_${user.name || user.email || "attendance"}_出缺勤月報.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadCompanyAttendanceWorkbook(users, allAttendanceRows, approvedLeaveRows, settings, period) {
  const activeUsers = users
    .filter((user) => user.isActive !== false)
    .sort((a, b) => String(a.department || "").localeCompare(String(b.department || ""), "zh-Hant")
      || String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "zh-Hant"));
  if (!activeUsers.length) {
    showToast("沒有可匯出的啟用員工。", "warning");
    return;
  }

  const sheets = activeUsers.map((user) => {
    const attendanceRows = allAttendanceRows.filter((row) => row.userId === user.id && isRowInPeriod(row, period));
    const userApprovedLeaves = approvedLeaveRows.filter((row) => row.userId === user.id);
    const rows = buildAttendanceSummaryRows(attendanceRows, user, settings, userApprovedLeaves, period)
      .sort((a, b) => a.date.localeCompare(b.date));
    const printRows = buildAttendancePrintRows(user, rows, attendanceRows, userApprovedLeaves, settings, period);
    return { user, summaryRows: rows, printRows };
  });

  const workbook = companyAttendanceWorkbookXml(sheets, settings, period);
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${period.year}-${String(period.month).padStart(2, "0")}_全公司出勤紀錄.xls`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function companyAttendanceWorkbookXml(sheets, settings, period) {
  const usedSheetNames = new Set();
  const worksheets = sheets.map(({ user, summaryRows, printRows }) => {
    const name = uniqueExcelSheetName(user.name || user.email || user.id || "員工", usedSheetNames);
    return excelAttendancePrintWorksheetXml(name, user, summaryRows, printRows, settings, period);
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Microsoft JhengHei" ss:Size="10"/></Style>
    <Style ss:ID="Title"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft JhengHei" ss:Bold="1" ss:Size="16"/></Style>
    <Style ss:ID="Meta"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft JhengHei" ss:Size="11"/></Style>
    <Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft JhengHei" ss:Bold="1" ss:Size="10"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="Cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="Rest"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Interior ss:Color="#A6A6A6" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="Summary"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft JhengHei" ss:Size="11"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="2"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2"/></Borders></Style>
  </Styles>
  ${worksheets}
</Workbook>`;
}

function excelAttendancePrintWorksheetXml(name, user, summaryRows, printRows, settings, period) {
  const leftRows = printRows.slice(0, 16);
  const rightRows = printRows.slice(16, 32);
  const totalWorkHours = Number(summaryRows.reduce((sum, row) => sum + Number(row.workHours || 0), 0).toFixed(2));
  const totalLeaveHours = Number(summaryRows.reduce((sum, row) => sum + Number(row.creditedLeaveHours || 0), 0).toFixed(2));
  const tableRows = leftRows.map((left, index) => excelAttendancePrintRow(left, rightRows[index]));
  const rows = [
    [
      { value: "竣貿國際股份有限公司 出勤紀錄", style: "Title", mergeAcross: 9 },
      { value: `員工姓名：${user.name || ""}`, style: "Meta", mergeAcross: 3 },
      { value: `紀錄年月：${period.year - 1911} 年 ${period.month} 月`, style: "Meta", mergeAcross: 9 }
    ],
    [],
    ...excelAttendanceHeaderRows(),
    ...tableRows,
    [
      { value: "出勤總時數統計", style: "Summary", mergeAcross: 5 },
      { value: `${totalWorkHours} 小時`, style: "Summary", mergeAcross: 5 },
      { value: "請假總時數統計", style: "Summary", mergeAcross: 5 },
      { value: `${totalLeaveHours} 小時`, style: "Summary", mergeAcross: 5 }
    ],
    [{ value: printLunchSummary(settings), style: "Meta", mergeAcross: 23 }]
  ];

  return `
  <Worksheet ss:Name="${xmlEscape(name)}">
    <Table ss:ExpandedColumnCount="24">
      ${excelAttendanceColumnsXml()}
      ${rows.map((row) => excelRowXml(row)).join("")}
    </Table>
  </Worksheet>`;
}

function excelAttendanceColumnsXml() {
  const widths = [28, 26, 58, 58, 58, 58, 58, 58, 42, 42, 54, 78];
  return [...widths, ...widths]
    .map((width) => `<Column ss:Width="${width}"/>`)
    .join("");
}

function excelAttendanceHeaderRows() {
  const side = [
    { value: "日期", style: "Header", mergeAcross: 1 },
    { value: "上午出勤", style: "Header", mergeAcross: 2 },
    { value: "下午出勤", style: "Header", mergeAcross: 2 },
    { value: "出勤\n時數", style: "Header" },
    { value: "請假\n時數", style: "Header" },
    { value: "假\n別", style: "Header" },
    { value: "備註", style: "Header" }
  ];
  const sub = [
    { value: "", style: "Header" },
    { value: "", style: "Header" },
    { value: "簽到", style: "Header" },
    { value: "簽退", style: "Header" },
    { value: "簽到", style: "Header" },
    { value: "簽退", style: "Header" },
    { value: "簽到", style: "Header" },
    { value: "簽退", style: "Header" },
    { value: "", style: "Header" },
    { value: "", style: "Header" },
    { value: "", style: "Header" },
    { value: "", style: "Header" }
  ];
  return [[...side, ...side], [...sub, ...sub]];
}

function excelAttendancePrintRow(left, right) {
  return [...excelAttendancePrintSide(left), ...excelAttendancePrintSide(right)];
}

function excelAttendancePrintSide(row) {
  const style = !row.day || row.isRestDay ? "Rest" : "Cell";
  if (!row.day) return Array.from({ length: 12 }, () => ({ value: "", style }));
  return [
    row.day,
    row.weekday,
    row.morningIn1,
    row.morningOut1,
    row.morningIn2,
    row.afternoonOut1,
    row.afternoonIn1,
    row.afternoonOut2,
    row.workHours || "",
    row.leaveHours || "",
    row.leaveTypes || "",
    row.note || ""
  ].map((value) => ({ value, style }));
}

function excelRowXml(row) {
  return `<Row>${row.map((cell) => excelCellXml(cell)).join("")}</Row>`;
}

function excelCellXml(cell) {
  const data = typeof cell === "object" && cell !== null ? cell : { value: cell };
  const value = data.value ?? "";
  const isNumber = typeof value === "number" && Number.isFinite(value);
  const style = data.style ? ` ss:StyleID="${data.style}"` : "";
  const mergeAcross = data.mergeAcross ? ` ss:MergeAcross="${data.mergeAcross}"` : "";
  return `<Cell${style}${mergeAcross}><Data ss:Type="${isNumber ? "Number" : "String"}">${xmlEscape(value)}</Data></Cell>`;
}

function uniqueExcelSheetName(value, usedSheetNames) {
  const base = String(value)
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "員工";
  let name = base;
  let index = 2;
  while (usedSheetNames.has(name)) {
    const suffix = ` ${index}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  usedSheetNames.add(name);
  return name;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

function summaryStatusText(status) {
  const labels = {
    normal: "正常",
    late: "遲到",
    earlyLeave: "早退",
    workTimeNotEnough: "工時不足",
    missing: "未打卡",
    incomplete: "資料不完整"
  };
  return labels[status] || status || "-";
}

function buildAttendanceSummaryRows(attendanceRows, user, settings, approvedLeaves = [], period = null) {
  const groups = new Map();
  attendanceRows.forEach((row) => {
    const date = row.date || dateKeyFromTimestamp(row.timestamp);
    if (!date) return;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(row);
  });

  if (period) {
    expectedWorkDates(period, settings).forEach((date) => {
      if (!groups.has(date)) groups.set(date, []);
    });
  }

  return Array.from(groups.entries())
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
    .map(([date, rows]) => {
      const ordered = [...rows].sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
      const checkIns = ordered.filter((row) => row.type === "checkIn");
      const checkOuts = ordered.filter((row) => row.type === "checkOut");
      const firstIn = checkIns[0] || null;
      const lastOut = checkOuts[checkOuts.length - 1] || null;
      const source = firstIn || lastOut || ordered[0] || {};
      const shift = resolveReportShift(source, user, settings);
      const checkInDate = firstIn ? timestampToDate(firstIn.timestamp) : null;
      const checkOutDate = lastOut ? timestampToDate(lastOut.timestamp) : null;
      const dayLeaves = approvedLeaves.filter((item) => isLeaveOnDate(item, date));
      const expectedHours = scheduledWorkHours(date, shift, settings);
      const creditedLeaveHours = calculateReportApprovedLeaveWorkHours(date, dayLeaves, shift, settings);
      const workHours = calculateReportWorkHours(date, ordered, settings, dayLeaves);
      const lateMinutes = checkInDate ? calculateAdjustedLateMinutes(date, checkInDate, shift, settings, dayLeaves) : 0;
      const earlyLeaveMinutes = checkOutDate ? calculateAdjustedEarlyLeaveMinutes(date, checkOutDate, shift, settings, dayLeaves) : 0;
      const status = resolveReportStatus(firstIn, lastOut, workHours + creditedLeaveHours, lateMinutes, earlyLeaveMinutes, expectedHours);

      return {
        date,
        userId: user.id,
        userName: source.userName || user.name || "-",
        department: source.department || user.department || "-",
        role: user.role || "employee",
        shiftId: shift.id || source.shiftId || user.defaultShiftId || "default",
        shiftName: shift.name || source.shiftName || "-",
        workStart: shift.workStart || settings.workStart || "09:00",
        workEnd: shift.workEnd || settings.workEnd || "18:00",
        effectiveWorkEnd: effectiveWorkEndTime(date, shift, settings),
        expectedHours,
        checkInText: checkInDate ? fmtTime(checkInDate) : "-",
        checkOutText: checkOutDate ? fmtTime(checkOutDate) : "-",
        missingType: !firstIn ? "checkIn" : (!lastOut ? "checkOut" : ""),
        workHours,
        creditedLeaveHours,
        lateMinutes,
        earlyLeaveMinutes,
        status
      };
    });
}

function expectedWorkDates(period, settings) {
  const today = todayKey();
  const dates = [];
  const daysInMonth = new Date(period.year, period.month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(period.year, period.month - 1, day);
    const dateKey = localDateKey(date);
    if (dateKey > today) continue;
    if (!isCompanyRestDay(dateKey, settings)) dates.push(dateKey);
  }
  return dates;
}

function localDateKey(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function resolveReportShift(row, user, settings) {
  const shifts = normalizeWorkShifts(settings);
  const id = row.shiftId || user.defaultShiftId;
  const shift = shifts.find((item) => item.id === id);
  if (shift) return shift;
  return {
    id: row.shiftId || "default",
    name: row.shiftName || settings.shiftName || "預設班別",
    workStart: row.workStart || settings.workStart || "09:00",
    workEnd: row.workEnd || settings.workEnd || "18:00"
  };
}

function calculateReportWorkHours(date, orderedRows, settings, approvedLeaves = []) {
  const lunchStart = timeToDate(date, settings.lunchStart || "12:00");
  const lunchEnd = timeToDate(date, settings.lunchEnd || "13:00");
  const pairedRanges = attendanceWorkRanges(orderedRows);
  const minutes = pairedRanges.reduce((sum, range) => {
    const lunchMinutes = overlapMinutes(range.start, range.end, lunchStart, lunchEnd);
    const leaveMinutes = approvedLeaves.reduce((leaveSum, item) => {
      return leaveSum + workMinutesInRange(range.start, range.end, timestampToDate(item.startTime), timestampToDate(item.endTime), lunchStart, lunchEnd);
    }, 0);
    return sum + Math.max(0, overlapMinutes(range.start, range.end, range.start, range.end) - lunchMinutes - leaveMinutes);
  }, 0);
  return Number((minutes / 60).toFixed(2));
}

function attendanceWorkRanges(orderedRows) {
  const ranges = [];
  let activeIn = null;
  orderedRows.forEach((row) => {
    const at = timestampToDate(row.timestamp);
    if (!at || Number.isNaN(at.getTime())) return;
    if (row.type === "checkIn") {
      if (!activeIn) activeIn = at;
      return;
    }
    if (row.type === "checkOut" && activeIn && at > activeIn) {
      ranges.push({ start: activeIn, end: at });
      activeIn = null;
    }
  });
  return ranges;
}

function calculateAdjustedLateMinutes(date, checkInDate, shift, settings, approvedLeaves) {
  const expected = timeToDate(date, shift.workStart || settings.workStart || "09:00");
  const rawLateMinutes = minutesAfter(checkInDate, expected) - Number(settings.lateGraceMinutes || 0);
  if (rawLateMinutes <= 0) return 0;
  return Math.max(0, rawLateMinutes - leaveOverlapMinutes(expected, checkInDate, approvedLeaves));
}

function calculateAdjustedEarlyLeaveMinutes(date, checkOutDate, shift, settings, approvedLeaves) {
  const expected = timeToDate(date, effectiveWorkEndTime(date, shift, settings));
  const rawEarlyLeaveMinutes = minutesAfter(expected, checkOutDate);
  if (rawEarlyLeaveMinutes <= 0) return 0;
  return Math.max(0, rawEarlyLeaveMinutes - leaveOverlapMinutes(checkOutDate, expected, approvedLeaves));
}

function calculateReportApprovedLeaveWorkHours(date, approvedLeaves, shift, settings) {
  const workStart = timeToDate(date, shift.workStart || settings.workStart || "09:00");
  const workEnd = timeToDate(date, effectiveWorkEndTime(date, shift, settings));
  const lunchStart = timeToDate(date, settings.lunchStart || "12:00");
  const lunchEnd = timeToDate(date, settings.lunchEnd || "13:00");
  const minutes = approvedLeaves.reduce((sum, item) => {
    return sum + workMinutesInRange(workStart, workEnd, timestampToDate(item.startTime), timestampToDate(item.endTime), lunchStart, lunchEnd);
  }, 0);
  return minutes / 60;
}

function effectiveWorkEndTime(date, shift, settings) {
  const shiftEnd = shift.workEnd || settings.workEnd || "18:00";
  const closure = specialClosureForDate(date, settings);
  if (!closure?.closeTime) return shiftEnd;
  return timeToMinutes(closure.closeTime) < timeToMinutes(shiftEnd) ? closure.closeTime : shiftEnd;
}

function scheduledWorkHours(date, shift, settings) {
  const workStart = timeToDate(date, shift.workStart || settings.workStart || "09:00");
  const workEnd = timeToDate(date, effectiveWorkEndTime(date, shift, settings));
  const lunchStart = timeToDate(date, settings.lunchStart || "12:00");
  const lunchEnd = timeToDate(date, settings.lunchEnd || "13:00");
  const lunchOverlap = Math.max(0, Math.min(workEnd, lunchEnd) - Math.max(workStart, lunchStart)) / 36e5;
  return Number(Math.max(0, hoursBetween(workStart, workEnd) - lunchOverlap).toFixed(2));
}

function specialClosureForDate(date, settings) {
  return (Array.isArray(settings.specialClosureDates) ? settings.specialClosureDates : [])
    .find((item) => item?.date === date && /^\d{2}:\d{2}$/.test(item.closeTime || ""));
}

function leaveOverlapMinutes(start, end, approvedLeaves) {
  if (!start || !end || end <= start) return 0;
  return approvedLeaves.reduce((sum, item) => {
    return sum + overlapMinutes(start, end, timestampToDate(item.startTime), timestampToDate(item.endTime));
  }, 0);
}

function workMinutesInRange(start, end, blockStart, blockEnd, lunchStart, lunchEnd) {
  if (!start || !end || !blockStart || !blockEnd || end <= start || blockEnd <= blockStart) return 0;
  if ([start, end, blockStart, blockEnd, lunchStart, lunchEnd].some((date) => Number.isNaN(date.getTime()))) return 0;
  const minutes = overlapMinutes(start, end, blockStart, blockEnd);
  const lunchRangeStart = new Date(Math.max(start.getTime(), lunchStart.getTime()));
  const lunchRangeEnd = new Date(Math.min(end.getTime(), lunchEnd.getTime()));
  const lunchMinutes = lunchRangeEnd > lunchRangeStart
    ? overlapMinutes(lunchRangeStart, lunchRangeEnd, blockStart, blockEnd)
    : 0;
  return Math.max(0, minutes - lunchMinutes);
}

function overlapMinutes(start, end, blockStart, blockEnd) {
  const from = Math.max(start.getTime(), blockStart.getTime());
  const to = Math.min(end.getTime(), blockEnd.getTime());
  return Math.max(0, Math.ceil((to - from) / 60000));
}

function isLeaveOnDate(item, date) {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);
  return timestampToDate(item.startTime) <= dayEnd && timestampToDate(item.endTime) >= dayStart;
}

function resolveReportStatus(firstIn, lastOut, creditedHours, lateMinutes, earlyLeaveMinutes, expectedHours) {
  const requiredHours = Number(expectedHours || 0);
  if (!firstIn && !lastOut && creditedHours >= requiredHours) return "normal";
  if (!firstIn && !lastOut) return "missing";
  if (!firstIn || !lastOut) return "incomplete";
  if (lateMinutes > 0) return "late";
  if (earlyLeaveMinutes > 0) return "earlyLeave";
  if (creditedHours < requiredHours) return "workTimeNotEnough";
  return "normal";
}

function summaryStatusBadge(row) {
  if (row.status === "missing") return `<span class="badge text-bg-danger">未打卡</span>`;
  if (row.status === "incomplete") return `<span class="badge text-bg-secondary">資料不完整</span>`;
  return badge(row.status);
}

function manualPunchActionHtml(row) {
  if (!row.missingType) return "-";
  if (adminProfile.role !== "admin") return `<span class="small muted">需管理員</span>`;
  const label = row.missingType === "checkIn" ? "補簽到" : "補簽退";
  return `<button class="btn btn-sm btn-outline-primary" data-manual-punch data-user-id="${row.userId}" data-date="${row.date}" data-type="${row.missingType}">${label}</button>`;
}

async function createManualAttendanceRecord(dataset, usersById, settings) {
  if (adminProfile.role !== "admin") {
    showToast("只有管理員可以補登打卡。", "warning");
    return;
  }

  const user = usersById[dataset.userId];
  if (!user) {
    showToast("找不到員工資料，無法補登。", "danger");
    return;
  }

  const shift = resolveReportShift({}, user, settings);
  const type = dataset.type;
  const date = dataset.date;
  const defaultTime = type === "checkIn" ? shift.workStart : shift.workEnd;
  const typeLabel = type === "checkIn" ? "簽到" : "簽退";
  const time = window.prompt(`請輸入補登${typeLabel}時間（HH:mm）`, defaultTime);
  if (time === null) return;
  if (!/^\d{2}:\d{2}$/.test(time) || !isTimeValueValid(time)) {
    showToast("補登時間格式錯誤，請使用 HH:mm，例如 18:00。", "warning");
    return;
  }

  const reason = window.prompt("請輸入補登原因，例如：員工忘記打卡、設備異常");
  if (reason === null) return;
  if (!reason.trim()) {
    showToast("補登原因必填，方便日後查核。", "warning");
    return;
  }

  const timestamp = timeToDate(date, time);
  await callSecureFunction("createManualCorrection", {
    userId: user.id,
    date,
    type,
    time,
    reason: reason.trim()
  });
  showToast(`${user.name || user.email} ${date} 已補登${typeLabel}`, "success");
  await renderAttendanceReport();
}

function minutesAfter(later, earlier) {
  return Math.max(0, Math.ceil((later.getTime() - earlier.getTime()) / 60000));
}

function timestampToDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  return new Date(value);
}

function dateKeyFromTimestamp(value) {
  const date = timestampToDate(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

async function renderRequests(collectionName) {
  const isLeave = collectionName === "leaveRequests";
  const [snap, usersSnap] = await Promise.all([
    getReviewerDocs(collectionName),
    getReviewerDocs("users")
  ]);
  const users = usersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const usersById = Object.fromEntries(users.map((user) => [user.id, user]));
  const requests = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => requestVisibleToReviewer(item, usersById))
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  content.innerHTML = `
    <div class="panel p-3">
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>申請人</th><th>類型</th><th>時間</th><th>時數</th><th>職務代理人</th><th>原因</th><th>狀態</th><th></th></tr></thead>
        <tbody>${requests.length ? requests.map((row) => {
          const type = isLeave ? leaveTypeLabel(row.leaveType) : (row.convertToCompTime ? "加班轉補休" : "加班費");
          return `<tr data-id="${row.id}" data-user-id="${row.userId}" data-hours="${row.hours}" data-kind="${row.leaveType || ""}" data-comp="${row.convertToCompTime ? "1" : "0"}">
            <td>${row.userName}<br><span class="muted small">${row.department || ""}</span></td>
            <td>${type}</td>
            <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
            <td>${row.hours}</td>
            <td>${isLeave ? escapeHtml(row.proxyUserName || "-") : "-"}</td>
            <td>${row.reason || "-"}</td>
            <td>${badge(row.status)}${row.status === "voided" && row.voidReason ? `<div class="small text-danger mt-1">${escapeHtml(row.voidReason)}</div>` : ""}</td>
            <td>${row.status === "pending"
              ? `<div class="btn-group btn-group-sm"><button class="btn btn-success" data-approve>核准</button><button class="btn btn-outline-danger" data-reject>駁回</button></div>`
              : isLeave && row.status === "approved" && adminProfile.role === "admin"
                ? `<button class="btn btn-sm btn-outline-danger" data-void-leave="${row.id}">無效</button>`
                : "-"}</td>
          </tr>`;
        }).join("") : `<tr><td colspan="8" class="muted">尚無資料</td></tr>`}</tbody>
      </table></div>
    </div>
    ${isLeave && adminProfile.role === "admin" ? `
      <div class="modal fade" id="voidLeaveModal" tabindex="-1" aria-labelledby="voidLeaveModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <form class="modal-content" id="voidLeaveForm">
            <div class="modal-header">
              <h2 class="modal-title fs-5" id="voidLeaveModalLabel">將已核准假單設為無效</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="關閉"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="voidLeaveRequestId">
              <div class="alert alert-warning py-2" id="voidLeaveSummary"></div>
              <label class="form-label" for="voidLeaveReason">無效原因</label>
              <textarea class="form-control" id="voidLeaveReason" rows="3" maxlength="300" required placeholder="例如：員工取消原定請假"></textarea>
              <div class="form-text">若為特休或補休，確認後會立即歸還本張假單扣除的時數。</div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>
              <button type="submit" class="btn btn-danger" data-confirm-void-leave>確認設為無效</button>
            </div>
          </form>
        </div>
      </div>` : ""}`;

  content.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => reviewRequest(collectionName, button.closest("tr"), "approved"));
  });
  content.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => reviewRequest(collectionName, button.closest("tr"), "rejected"));
  });
  if (isLeave && adminProfile.role === "admin") bindVoidLeaveActions(requests);
}

function bindVoidLeaveActions(requests) {
  const modalElement = qs("#voidLeaveModal");
  const form = qs("#voidLeaveForm");
  const modal = bootstrap.Modal.getOrCreateInstance(modalElement);

  content.querySelectorAll("[data-void-leave]").forEach((button) => {
    button.addEventListener("click", () => {
      const request = requests.find((item) => item.id === button.dataset.voidLeave);
      if (!request) return;
      qs("#voidLeaveRequestId").value = request.id;
      qs("#voidLeaveSummary").textContent = `${request.userName || "員工"}｜${leaveTypeLabel(request.leaveType)}｜${fmtDateTime(request.startTime)} 至 ${fmtDateTime(request.endTime)}｜${request.hours || 0} 小時`;
      qs("#voidLeaveReason").value = "";
      modal.show();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const requestId = qs("#voidLeaveRequestId").value;
    const reason = qs("#voidLeaveReason").value.trim();
    const submitButton = qs("[data-confirm-void-leave]", form);
    if (!reason) {
      showToast("請填寫無效原因。", "warning");
      qs("#voidLeaveReason").focus();
      return;
    }

    submitButton.disabled = true;
    let result;
    try {
      result = await voidApprovedLeave(requestId, reason);
    } catch (error) {
      showToast(`無法將假單設為無效：${error.message}`, "danger");
      submitButton.disabled = false;
      return;
    }

    modal.hide();
    const refundText = result.refundedHours
      ? `，已歸還${leaveTypeLabel(result.leaveType)} ${result.refundedHours} 小時`
      : "";
    showToast(`假單已設為無效${refundText}`, "success");
    await renderRequests("leaveRequests");
  });
}

async function voidApprovedLeave(requestId, reason) {
  if (adminProfile.role !== "admin") throw new Error("只有管理員可以將假單設為無效。");
  return callSecureFunction("voidApprovedLeave", { requestId, reason });
}

function requestVisibleToReviewer(request, usersById) {
  if (adminProfile.role === "admin") return true;
  if (request.userId === adminProfile.id) return false;
  const user = usersById[request.userId] || {};
  if (user.managerId === adminProfile.id || request.managerId === adminProfile.id) return true;
  const hasExplicitManager = Boolean(user.managerId || request.managerId);
  return !hasExplicitManager && Boolean(adminProfile.department) && user.department === adminProfile.department;
}

function mapLink(latitude, longitude) {
  if (typeof latitude !== "number" || typeof longitude !== "number") return "-";
  const label = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  const url = `https://www.google.com/maps?q=${latitude},${longitude}`;
  return `<a class="btn btn-sm btn-outline-primary" href="${url}" target="_blank" rel="noopener">${label}</a>`;
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

async function reviewRequest(collectionName, tr, status) {
  const id = tr.dataset.id;
  const hours = Number(tr.dataset.hours || 0);
  if (status === "approved" && collectionName === "leaveRequests" && !isWholeHourValue(hours)) {
    showToast("請假時數必須為整數小時，請先駁回並請員工重新送單", "warning");
    return;
  }
  try {
    await callSecureFunction("reviewHrRequest", {
      collectionName,
      requestId: id,
      status
    });
    showToast(status === "approved" ? "已核准" : "已駁回", status === "approved" ? "success" : "danger");
    await renderRequests(collectionName);
  } catch (error) {
    showToast(`審核失敗：${error.message}`, "danger");
  }
}

async function renderSettings() {
  if (adminProfile.role !== "admin") {
    content.innerHTML = `<div class="alert alert-warning">只有管理員可以修改系統設定。</div>`;
    return;
  }
  const settings = await getWorkSettings();
  const shifts = normalizeWorkShifts(settings);
  content.innerHTML = `
    <form class="panel p-3" id="settingsForm">
      <h2 class="h5 mb-3">班別設定</h2>
      <div class="row g-3">
        ${shifts.map((shift, index) => `<div class="col-lg-4">
          <div class="border rounded p-3 h-100">
            <h3 class="h6 mb-3">上班時段 ${index + 1}</h3>
            <input type="hidden" data-shift-field="id" data-shift-index="${index}" value="${shift.id}">
            <div class="mb-2"><label class="form-label" for="shiftName${index}">班別名稱</label><input class="form-control" id="shiftName${index}" data-shift-field="name" data-shift-index="${index}" value="${shift.name}" required></div>
            <div class="mb-2"><label class="form-label" for="shiftStart${index}">上班時間</label><input class="form-control" id="shiftStart${index}" type="time" data-shift-field="workStart" data-shift-index="${index}" value="${shift.workStart}" required></div>
            <div><label class="form-label" for="shiftEnd${index}">下班時間</label><input class="form-control" id="shiftEnd${index}" type="time" data-shift-field="workEnd" data-shift-index="${index}" value="${shift.workEnd}" required></div>
          </div>
        </div>`).join("")}
      </div>
      <hr>
      <h2 class="h5 mb-3">共用規則</h2>
      <div class="row g-3">
        <div class="col-md-3"><label class="form-label" for="standardHours">標準工時</label><input class="form-control" id="standardHours" type="number" step="0.5" value="${settings.standardHours}" required></div>
        <div class="col-md-3"><label class="form-label" for="lunchStart">午休開始</label><input class="form-control" id="lunchStart" type="time" value="${settings.lunchStart}" required></div>
        <div class="col-md-3"><label class="form-label" for="lunchEnd">午休結束</label><input class="form-control" id="lunchEnd" type="time" value="${settings.lunchEnd}" required></div>
        <div class="col-md-3"><label class="form-label" for="lateGraceMinutes">遲到寬限分鐘</label><input class="form-control" id="lateGraceMinutes" type="number" value="${settings.lateGraceMinutes}" required></div>
        <div class="col-12">
          <label class="form-label" for="holidayDates">休息日 / 國定假日</label>
          <textarea class="form-control" id="holidayDates" rows="4" placeholder="每行一個日期，例如 2026-01-01">${formatHolidayDates(settings.holidayDates)}</textarea>
          <div class="form-text">六日會自動排除；這裡只需要填政府公告國定假日、補假或公司指定休息日，格式 YYYY-MM-DD。</div>
        </div>
        <div class="col-12">
          <label class="form-label" for="specialClosureDates">特殊提早下班日</label>
          <textarea class="form-control" id="specialClosureDates" rows="4" placeholder="每行一筆：2026-07-10 17:00 颱風提早關門">${formatSpecialClosureDates(settings.specialClosureDates)}</textarea>
          <div class="form-text">格式：YYYY-MM-DD HH:mm 原因。例：2026-07-10 17:00 颱風提早關門。當天早退與應達工時會改用這個關門時間。</div>
        </div>
      </div>
      <button class="btn btn-primary mt-3">儲存設定</button>
    </form>`;

  qs("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const workShifts = readShiftSettings();
    const invalidShift = workShifts.find((shift) => !isTimeRangeValid(shift.workStart, shift.workEnd));
    if (invalidShift) {
      showToast(`${invalidShift.name} 的下班時間必須晚於上班時間`, "warning");
      return;
    }
    try {
      await callSecureFunction("saveWorkSettings", {
        workStart: workShifts[0].workStart,
        workEnd: workShifts[0].workEnd,
        workShifts,
        lunchStart: qs("#lunchStart").value,
        lunchEnd: qs("#lunchEnd").value,
        holidayDates: readHolidayDates(),
        specialClosureDates: readSpecialClosureDates(),
        standardHours: Number(qs("#standardHours").value),
        lateGraceMinutes: Number(qs("#lateGraceMinutes").value)
      });
      showToast("設定已更新", "success");
    } catch (error) {
      showToast(`設定儲存失敗：${error.message}`, "danger");
    }
  });
}

function normalizeWorkShifts(settings) {
  const fallback = [
    { id: "shift_0800", name: "早班 08:00", workStart: "08:00", workEnd: "17:00" },
    { id: "shift_0830", name: "早班 08:30", workStart: "08:30", workEnd: "17:30" },
    { id: "shift_0900", name: "日班 09:00", workStart: settings.workStart || "09:00", workEnd: settings.workEnd || "18:00" }
  ];
  const source = Array.isArray(settings.workShifts) && settings.workShifts.length
    ? settings.workShifts
    : fallback;
  return [0, 1, 2].map((index) => source[index] || fallback[index]);
}

function readShiftSettings() {
  return [0, 1, 2].map((index) => {
    const getValue = (field) => qs(`[data-shift-index="${index}"][data-shift-field="${field}"]`).value.trim();
    return {
      id: getValue("id") || `shift_${index + 1}`,
      name: getValue("name"),
      workStart: getValue("workStart"),
      workEnd: getValue("workEnd")
    };
  });
}

function isTimeRangeValid(start, end) {
  return timeToMinutes(end) > timeToMinutes(start);
}

function isTimeValueValid(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isWholeHourValue(value) {
  return Math.abs(value - Math.round(value)) < 0.0001;
}

function formatHolidayDates(value) {
  if (!Array.isArray(value)) return "";
  return value.filter(Boolean).sort().join("\n");
}

function formatSpecialClosureDates(value) {
  if (!Array.isArray(value)) return "";
  return value
    .filter((item) => item?.date && item?.closeTime)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => `${item.date} ${item.closeTime}${item.reason ? ` ${item.reason}` : ""}`)
    .join("\n");
}

function readHolidayDates() {
  return qs("#holidayDates").value
    .split(/\s|,|，/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, array) => /^\d{4}-\d{2}-\d{2}$/.test(item) && array.indexOf(item) === index)
    .sort();
}

function readSpecialClosureDates() {
  const byDate = new Map();
  qs("#specialClosureDates").value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?:\s+(.+))?$/);
      if (!match || !isTimeValueValid(match[2])) return;
      byDate.set(match[1], {
        date: match[1],
        closeTime: match[2],
        reason: (match[3] || "").trim()
      });
    });
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
