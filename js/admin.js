import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
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
  fmtTime,
  getWorkSettings,
  hoursBetween,
  showToast,
  timeToDate,
  todayKey,
  roleLabels,
  leaveTypeLabel
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
  const [snap, settings] = await Promise.all([
    getDocs(collection(db, "users")),
    getWorkSettings()
  ]);
  const shifts = normalizeWorkShifts(settings);
  const users = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant"));
  const departments = buildDepartmentOptions(users);
  content.innerHTML = `
    <div class="panel p-3">
      <datalist id="departmentOptions">
        ${departments.map((department) => `<option value="${department}"></option>`).join("")}
      </datalist>
      <div class="table-responsive"><table class="table align-middle">
        <thead><tr><th>姓名</th><th>Email</th><th>部門</th><th>角色</th><th>預設班別</th><th>特休</th><th>補休</th><th>啟用</th><th></th></tr></thead>
        <tbody>
          ${users.map((row) => {
            return `<tr data-id="${row.id}">
              <td><input class="form-control form-control-sm" data-field="name" value="${row.name || ""}"></td>
              <td>${row.email || ""}</td>
              <td><input class="form-control form-control-sm" data-field="department" list="departmentOptions" value="${row.department || ""}" placeholder="選擇或輸入部門"></td>
              <td><select class="form-select form-select-sm" data-field="role">
                ${["employee", "manager", "admin"].map((role) => `<option value="${role}" ${row.role === role ? "selected" : ""}>${roleLabels[role]}</option>`).join("")}
              </select></td>
              <td><select class="form-select form-select-sm" data-field="defaultShiftId">
                ${shifts.map((shift) => `<option value="${shift.id}" ${(row.defaultShiftId || shifts[0].id) === shift.id ? "selected" : ""}>${shift.name}</option>`).join("")}
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

function buildDepartmentOptions(users) {
  const defaults = ["管理", "產品管理", "工程", "研發", "製造", "品保", "生管", "採購", "財務", "會計", "人資", "行政", "業務", "行銷", "內銷", "外銷", "總經理"];
  const existing = users.map((user) => user.department).filter(Boolean);
  return Array.from(new Set([...existing, ...defaults])).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

async function renderAttendanceReport() {
  const [usersSnap, attendanceSnap, leaveSnap, settings] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "attendance")),
    getDocs(collection(db, "leaveRequests")),
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
  return {
    days: summaryRows.length,
    workHours: Number(summaryRows.reduce((sum, row) => sum + Number(row.workHours || 0), 0).toFixed(2)),
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
      <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">出勤日數</div><div class="fw-bold">-</div></div></div>
      <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">總工時</div><div class="fw-bold">-</div></div></div>
      <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">遲到</div><div class="fw-bold">-</div></div></div>
      <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">早退 / 異常</div><div class="fw-bold">-</div></div></div>`;
  }
  return `
    <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">出勤日數</div><div class="fw-bold">${stats.days} 天</div></div></div>
    <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">總工時</div><div class="fw-bold">${stats.workHours} 小時</div></div></div>
    <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">遲到</div><div class="fw-bold">${stats.lateCount} 次 / ${stats.lateMinutes} 分</div></div></div>
    <div class="col-md-3"><div class="border rounded p-2"><div class="small muted">早退 / 異常</div><div class="fw-bold">${stats.earlyLeaveCount} 次 / ${stats.abnormalCount} 天</div></div></div>`;
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
      const workHours = calculateReportWorkHours(date, checkInDate, checkOutDate, settings);
      const creditedLeaveHours = calculateReportApprovedLeaveWorkHours(date, dayLeaves, shift, settings);
      const lateMinutes = checkInDate ? calculateAdjustedLateMinutes(date, checkInDate, shift, settings, dayLeaves) : 0;
      const earlyLeaveMinutes = checkOutDate ? calculateAdjustedEarlyLeaveMinutes(date, checkOutDate, shift, dayLeaves) : 0;
      const status = resolveReportStatus(firstIn, lastOut, workHours + creditedLeaveHours, lateMinutes, earlyLeaveMinutes, settings);

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

function calculateReportWorkHours(date, checkInDate, checkOutDate, settings) {
  if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) return 0;
  const lunchStart = timeToDate(date, settings.lunchStart || "12:00");
  const lunchEnd = timeToDate(date, settings.lunchEnd || "13:00");
  const lunchOverlap = Math.max(0, Math.min(checkOutDate, lunchEnd) - Math.max(checkInDate, lunchStart)) / 36e5;
  return Number(Math.max(0, hoursBetween(checkInDate, checkOutDate) - lunchOverlap).toFixed(2));
}

function calculateAdjustedLateMinutes(date, checkInDate, shift, settings, approvedLeaves) {
  const expected = timeToDate(date, shift.workStart || settings.workStart || "09:00");
  const rawLateMinutes = minutesAfter(checkInDate, expected) - Number(settings.lateGraceMinutes || 0);
  if (rawLateMinutes <= 0) return 0;
  return Math.max(0, rawLateMinutes - leaveOverlapMinutes(expected, checkInDate, approvedLeaves));
}

function calculateAdjustedEarlyLeaveMinutes(date, checkOutDate, shift, approvedLeaves) {
  const expected = timeToDate(date, shift.workEnd || "18:00");
  const rawEarlyLeaveMinutes = minutesAfter(expected, checkOutDate);
  if (rawEarlyLeaveMinutes <= 0) return 0;
  return Math.max(0, rawEarlyLeaveMinutes - leaveOverlapMinutes(checkOutDate, expected, approvedLeaves));
}

function calculateReportApprovedLeaveWorkHours(date, approvedLeaves, shift, settings) {
  const workStart = timeToDate(date, shift.workStart || settings.workStart || "09:00");
  const workEnd = timeToDate(date, shift.workEnd || settings.workEnd || "18:00");
  const lunchStart = timeToDate(date, settings.lunchStart || "12:00");
  const lunchEnd = timeToDate(date, settings.lunchEnd || "13:00");
  const minutes = approvedLeaves.reduce((sum, item) => {
    const leaveStart = timestampToDate(item.startTime);
    const leaveEnd = timestampToDate(item.endTime);
    const workMinutes = overlapMinutes(workStart, workEnd, leaveStart, leaveEnd);
    const lunchMinutes = overlapMinutes(lunchStart, lunchEnd, leaveStart, leaveEnd);
    return sum + Math.max(0, workMinutes - lunchMinutes);
  }, 0);
  return minutes / 60;
}

function leaveOverlapMinutes(start, end, approvedLeaves) {
  if (!start || !end || end <= start) return 0;
  return approvedLeaves.reduce((sum, item) => {
    return sum + overlapMinutes(start, end, timestampToDate(item.startTime), timestampToDate(item.endTime));
  }, 0);
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

function resolveReportStatus(firstIn, lastOut, creditedHours, lateMinutes, earlyLeaveMinutes, settings) {
  if (!firstIn && !lastOut && creditedHours >= Number(settings.standardHours || 8)) return "normal";
  if (!firstIn && !lastOut) return "missing";
  if (!firstIn || !lastOut) return "incomplete";
  if (lateMinutes > 0) return "late";
  if (earlyLeaveMinutes > 0) return "earlyLeave";
  if (creditedHours < Number(settings.standardHours || 8)) return "workTimeNotEnough";
  return "normal";
}

function summaryStatusBadge(row) {
  if (row.status === "missing") return `<span class="badge text-bg-danger">未打卡</span>`;
  if (row.status === "incomplete") return `<span class="badge text-bg-secondary">資料不完整</span>`;
  return badge(row.status);
}

function manualPunchActionHtml(row) {
  if (!row.missingType) return "-";
  const label = row.missingType === "checkIn" ? "補簽到" : "補簽退";
  return `<button class="btn btn-sm btn-outline-primary" data-manual-punch data-user-id="${row.userId}" data-date="${row.date}" data-type="${row.missingType}">${label}</button>`;
}

async function createManualAttendanceRecord(dataset, usersById, settings) {
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
  await addDoc(collection(db, "attendance"), {
    userId: user.id,
    userName: user.name || user.email || "",
    department: user.department || "",
    type,
    shiftId: shift.id || user.defaultShiftId || "default",
    shiftName: shift.name || "預設班別",
    workStart: shift.workStart || settings.workStart || "09:00",
    workEnd: shift.workEnd || settings.workEnd || "18:00",
    timestamp,
    date,
    latitude: null,
    longitude: null,
    status: "normal",
    deviceInfo: "manual correction by admin",
    manualCorrection: true,
    correctionReason: reason.trim(),
    correctedBy: adminProfile.id,
    correctedByName: adminProfile.name || adminProfile.email || "",
    createdAt: serverTimestamp()
  });

  await rebuildAttendanceDaily(user.id, date, user, settings);
  showToast(`${user.name || user.email} ${date} 已補登${typeLabel}`, "success");
  await renderAttendanceReport();
}

async function rebuildAttendanceDaily(userId, date, user, settings) {
  const [attendanceSnap, leaveSnap] = await Promise.all([
    getDocs(query(collection(db, "attendance"), where("userId", "==", userId), where("date", "==", date))),
    getDocs(query(collection(db, "leaveRequests"), where("userId", "==", userId)))
  ]);
  const rows = attendanceSnap.docs.map((item) => item.data()).sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
  const approvedLeaves = leaveSnap.docs
    .map((item) => item.data())
    .filter((item) => item.status === "approved");
  const summary = buildAttendanceSummaryRows(rows, user, settings, approvedLeaves)[0];
  if (!summary) return;
  const firstIn = rows.find((row) => row.type === "checkIn");
  const lastOut = rows.filter((row) => row.type === "checkOut").at(-1);

  await setDoc(doc(db, "attendanceDaily", `${date}_${userId}`), {
    userId,
    userName: user.name || user.email || "",
    department: user.department || "",
    date,
    shiftId: summary.shiftId,
    shiftName: summary.shiftName,
    workStart: summary.workStart,
    workEnd: summary.workEnd,
    checkInTime: firstIn?.timestamp || null,
    checkOutTime: lastOut?.timestamp || null,
    totalWorkHours: Number(summary.workHours || 0),
    creditedLeaveHours: Number(summary.creditedLeaveHours || 0),
    status: summary.status,
    isEightHoursReached: Number(summary.workHours || 0) + Number(summary.creditedLeaveHours || 0) >= Number(settings.standardHours || 8),
    updatedAt: serverTimestamp(),
    updatedBy: adminProfile.id,
    hasManualCorrection: rows.some((row) => row.manualCorrection)
  }, { merge: true });
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
  const snap = await getDocs(collection(db, collectionName));
  const requests = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  content.innerHTML = `
    <div class="panel p-3">
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>申請人</th><th>類型</th><th>時間</th><th>時數</th><th>原因</th><th>狀態</th><th></th></tr></thead>
        <tbody>${requests.length ? requests.map((row) => {
          const type = isLeave ? leaveTypeLabel(row.leaveType) : (row.convertToCompTime ? "加班轉補休" : "加班費");
          return `<tr data-id="${row.id}" data-user-id="${row.userId}" data-hours="${row.hours}" data-kind="${row.leaveType || ""}" data-comp="${row.convertToCompTime ? "1" : "0"}">
            <td>${row.userName}<br><span class="muted small">${row.department || ""}</span></td>
            <td>${type}</td>
            <td>${fmtDateTime(row.startTime)}<br><span class="muted">${fmtDateTime(row.endTime)}</span></td>
            <td>${row.hours}</td>
            <td>${row.reason || "-"}</td>
            <td>${badge(row.status)}</td>
            <td>${row.status === "pending" ? `<div class="btn-group btn-group-sm"><button class="btn btn-success" data-approve>核准</button><button class="btn btn-outline-danger" data-reject>駁回</button></div>` : "-"}</td>
          </tr>`;
        }).join("") : `<tr><td colspan="7" class="muted">尚無資料</td></tr>`}</tbody>
      </table></div>
    </div>`;

  content.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => reviewRequest(collectionName, button.closest("tr"), "approved"));
  });
  content.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => reviewRequest(collectionName, button.closest("tr"), "rejected"));
  });
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
  const userId = tr.dataset.userId;
  const hours = Number(tr.dataset.hours || 0);
  if (status === "approved" && collectionName === "leaveRequests" && !isWholeHourValue(hours)) {
    showToast("請假時數必須為整數小時，請先駁回並請員工重新送單", "warning");
    return;
  }
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
    await setDoc(doc(db, "workSettings", "default"), {
      workStart: workShifts[0].workStart,
      workEnd: workShifts[0].workEnd,
      workShifts,
      lunchStart: qs("#lunchStart").value,
      lunchEnd: qs("#lunchEnd").value,
      holidayDates: readHolidayDates(),
      standardHours: Number(qs("#standardHours").value),
      lateGraceMinutes: Number(qs("#lateGraceMinutes").value),
      updatedAt: serverTimestamp(),
      updatedBy: adminProfile.id
    }, { merge: true });
    showToast("設定已更新", "success");
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

function readHolidayDates() {
  return qs("#holidayDates").value
    .split(/\s|,|，/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, array) => /^\d{4}-\d{2}-\d{2}$/.test(item) && array.indexOf(item) === index)
    .sort();
}
