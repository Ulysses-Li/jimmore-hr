import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  callSecureFunction,
  db,
  fmtDateTime,
  showToast
} from "./app.js";

const statusLabels = {
  pending_employee_reason: "待員工填原因",
  pending_manager_review: "待主管審核",
  needs_more_info: "要求補充",
  approved: "已核准",
  rejected: "已駁回",
  overdue: "原因逾期"
};

export async function renderSecurityAdmin(mode, profile, content) {
  if (mode === "attendance") await renderAttendanceSecurity(profile, content);
  if (mode === "employees" && profile.role === "admin") await renderFieldAssignments(profile, content);
  if (mode === "settings" && profile.role === "admin") await renderWorkSites(content);
}

function scopedQuery(name, profile, extra = null) {
  if (profile.role === "admin") return extra ? query(collection(db, name), extra) : collection(db, name);
  return query(collection(db, name), where("managerId", "==", profile.id));
}

async function renderAttendanceSecurity(profile, content) {
  const [casesSnap, enrollmentsSnap] = await Promise.all([
    getDocs(scopedQuery("attendanceExceptions", profile)),
    getDocs(scopedQuery("passkeyEnrollmentRequests", profile, where("status", "==", "pending")))
  ]);
  const cases = casesSnap.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const enrollments = enrollmentsSnap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.status === "pending");
  const pendingReviewCount = cases.filter((item) => item.status === "pending_manager_review").length;
  const attentionStatuses = new Set(["pending_manager_review", "needs_more_info"]);
  const attentionCount = cases.filter((item) => attentionStatuses.has(item.status)).length;
  const waitingCount = cases.filter((item) => ["pending_employee_reason", "overdue"].includes(item.status)).length;
  const completedCount = cases.filter((item) => ["approved", "rejected"].includes(item.status)).length;
  const caseYears = [...new Set(cases.map((item) => String(item.date || "").slice(0, 4)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  const now = new Date();
  const currentYear = String(now.getFullYear());
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const latestDate = String(cases[0]?.date || "");
  const defaultCaseYear = caseYears.includes(currentYear) ? currentYear : latestDate.slice(0, 4);
  const defaultCaseMonth = cases.some((item) => String(item.date || "").startsWith(`${defaultCaseYear}-${currentMonth}`))
    ? currentMonth
    : latestDate.slice(5, 7);
  const host = document.createElement("div");
  host.id = "attendanceSecurityPanel";
  host.innerHTML = `
    <div class="panel p-3 mb-3">
      <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
        <div><h2 class="h5 mb-1">Passkey 裝置核准</h2><div class="small muted">主管須當面確認申請人與裝置後才能核准。</div></div>
        <span class="badge text-bg-${enrollments.length ? "warning" : "success"}">${enrollments.length} 筆待核准</span>
      </div>
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>員工</th><th>部門</th><th>裝置</th><th>申請時間</th><th></th></tr></thead>
        <tbody>${enrollments.length ? enrollments.map((row) => `<tr>
          <td>${escapeHtml(row.userName || row.userId)}</td><td>${escapeHtml(row.department || "-")}</td>
          <td>${escapeHtml(row.deviceLabel || "個人裝置")}</td><td>${fmtDateTime(row.requestedAt)}</td>
          <td><button class="btn btn-sm btn-primary" data-approve-passkey="${escapeHtml(row.userId)}">當面確認並核准</button></td>
        </tr>`).join("") : `<tr><td colspan="5" class="muted">目前沒有待核准裝置</td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="panel p-3 mb-3">
      <div class="d-flex justify-content-between align-items-center gap-3">
        <div>
          <h2 class="h5 mb-1">未打卡原因與審核</h2>
          <div class="small muted">預設收合；需要追蹤或審核時再展開。</div>
        </div>
        <button class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-2" type="button"
          data-bs-toggle="collapse" data-bs-target="#securityCaseCollapse"
          aria-expanded="false" aria-controls="securityCaseCollapse">
          ${pendingReviewCount ? `<span class="badge text-bg-warning">${pendingReviewCount} 筆待審</span>` : ""}
          <span>${cases.length} 筆紀錄</span>
          <span aria-hidden="true">展開</span>
        </button>
      </div>
      <div class="collapse" id="securityCaseCollapse">
        <div class="exception-workspace mt-3">
          <div class="exception-summary-grid">
            <button class="exception-summary-card is-active" type="button" data-case-filter="attention">
              <span>待主管處理</span><strong data-case-count="attention">${attentionCount}</strong>
            </button>
            <button class="exception-summary-card" type="button" data-case-filter="waiting">
              <span>待員工／逾期</span><strong data-case-count="waiting">${waitingCount}</strong>
            </button>
            <button class="exception-summary-card" type="button" data-case-filter="completed">
              <span>已完成</span><strong data-case-count="completed">${completedCount}</strong>
            </button>
            <button class="exception-summary-card" type="button" data-case-filter="all">
              <span>全部案件</span><strong data-case-count="all">${cases.length}</strong>
            </button>
          </div>
          <div class="exception-toolbar">
            <label>
              <span>年份</span>
              <select class="form-select form-select-sm" data-case-year>
                <option value="">全部年份</option>
                ${caseYears.map((year) => `<option value="${year}"${year === defaultCaseYear ? " selected" : ""}>${year} 年</option>`).join("")}
              </select>
            </label>
            <label>
              <span>月份</span>
              <select class="form-select form-select-sm" data-case-month>
                <option value="">全年</option>
                ${Array.from({ length: 12 }, (_, index) => {
                  const month = String(index + 1).padStart(2, "0");
                  return `<option value="${month}"${month === defaultCaseMonth ? " selected" : ""}>${index + 1} 月</option>`;
                }).join("")}
              </select>
            </label>
            <label class="exception-search-field">
              <span>搜尋</span>
              <input class="form-control form-control-sm" id="securityCaseSearch" type="search" placeholder="姓名、部門、日期或原因" data-case-search>
            </label>
            <span class="small muted" data-case-result-count></span>
          </div>
          <div class="exception-list" id="securityCaseList">${cases.length ? cases.slice(0, 100).map((row) => caseHtml(row, profile)).join("") : `<div class="muted">目前沒有未打卡案件</div>`}</div>
          <div class="exception-empty muted" data-case-empty hidden>目前篩選條件沒有案件。</div>
        </div>
      </div>
    </div>`;
  content.insertBefore(host, content.firstChild);

  host.querySelectorAll("[data-approve-passkey]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await callSecureFunction("approvePasskeyEnrollment", { userId: button.dataset.approvePasskey });
        showToast("已核准裝置，員工可完成生物辨識註冊", "success");
        button.closest("tr").remove();
      } catch (error) {
        showToast(error.message, "danger");
        button.disabled = false;
      }
    });
  });
  bindCaseFilters(host);
  bindCaseReviews(host);
}

function caseHtml(row, profile) {
  const pendingReview = row.status === "pending_manager_review";
  const correctionTime = row.requestedTime || timeMentionedInReason(row.reason) || row.workStart || "09:00";
  const group = pendingReview || row.status === "needs_more_info"
    ? "attention"
    : ["pending_employee_reason", "overdue"].includes(row.status) ? "waiting" : "completed";
  const searchableText = [
    row.date, row.userName, row.userId, row.department, row.shiftName, row.workStart,
    row.reason, statusLabels[row.status] || row.status
  ].filter(Boolean).join(" ").toLocaleLowerCase("zh-Hant");
  const statusTone = pendingReview ? "warning"
    : row.status === "approved" ? "success"
      : ["rejected", "overdue"].includes(row.status) ? "danger" : "secondary";
  return `<details class="exception-case" data-review-case="${escapeHtml(row.id)}"
    data-case-group="${group}" data-case-year="${escapeHtml(String(row.date || "").slice(0, 4))}"
    data-case-month="${escapeHtml(String(row.date || "").slice(5, 7))}"
    data-case-search-text="${escapeHtml(searchableText)}">
    <summary class="exception-case-summary">
      <span class="exception-case-date">${escapeHtml(row.date)}</span>
      <span class="exception-case-person">
        <strong>${escapeHtml(row.userName || row.userId)}</strong>
        <small>${escapeHtml(row.department || "未分部門")} · ${escapeHtml(row.shiftName || row.workStart || "班別")}</small>
      </span>
      <span class="badge text-bg-${statusTone}">${escapeHtml(statusLabels[row.status] || row.status)}</span>
      <span class="exception-case-toggle" aria-hidden="true">查看詳情</span>
    </summary>
    <div class="exception-case-body">
      <div class="exception-case-facts">
        <div><span>員工原因</span><strong>${escapeHtml(row.reason || "尚未填寫")}</strong></div>
        ${row.laterPunchAt ? `<div><span>後續打卡</span><strong>${fmtDateTime(row.laterPunchAt)}（${row.laterPunchType === "checkIn" ? "簽到" : "簽退"}）</strong></div>` : ""}
        ${row.reviewNote ? `<div><span>審核備註</span><strong>${escapeHtml(row.reviewNote)}</strong></div>` : ""}
      </div>
    ${pendingReview ? `<div class="row g-2 mt-1">
      <div class="col-md-2"><input class="form-control form-control-sm" type="time" data-correction-time value="${escapeHtml(correctionTime)}" aria-label="補登簽到時間"></div>
      <div class="col-md-5"><input class="form-control form-control-sm" data-review-note placeholder="審核備註或要求補充內容"></div>
      <div class="col-md-5 d-flex gap-1 flex-wrap">
        <button class="btn btn-sm btn-success" data-review-decision="approved">核准並補登</button>
        <button class="btn btn-sm btn-outline-warning" data-review-decision="needs_more_info">要求補充</button>
        <button class="btn btn-sm btn-outline-danger" data-review-decision="rejected">駁回</button>
      </div>
    </div>` : ""}
    ${row.status === "approved" && !row.manualCorrectionRecordId ? `<div class="d-flex gap-2 align-items-center mt-2" data-approved-repair>
      <input class="form-control form-control-sm" style="max-width: 9rem" type="time" value="${escapeHtml(correctionTime)}" aria-label="補回簽到時間">
      <button class="btn btn-sm btn-outline-primary" type="button" data-repair-approved>補回出勤表</button>
    </div>` : ""}
    ${profile.role === "admin" && ["approved", "rejected", "overdue", "pending_manager_review"].includes(row.status) ? manualCorrectionHtml(row) : ""}
    </div>
  </details>`;
}

function bindCaseFilters(host) {
  const buttons = [...host.querySelectorAll("[data-case-filter]")];
  const rows = [...host.querySelectorAll("[data-review-case]")];
  const search = host.querySelector("[data-case-search]");
  const year = host.querySelector("[data-case-year]");
  const month = host.querySelector("[data-case-month]");
  const resultCount = host.querySelector("[data-case-result-count]");
  const empty = host.querySelector("[data-case-empty]");
  if (!buttons.length || !search || !year || !month || !resultCount || !empty) return;
  let activeFilter = "attention";

  const apply = () => {
    const term = search.value.trim().toLocaleLowerCase("zh-Hant");
    const selectedYear = year.value;
    const selectedMonth = month.value;
    let visibleCount = 0;
    const groupCounts = { attention: 0, waiting: 0, completed: 0, all: 0 };
    rows.forEach((row) => {
      const periodMatches = (!selectedYear || row.dataset.caseYear === selectedYear)
        && (!selectedMonth || row.dataset.caseMonth === selectedMonth);
      const searchMatches = !term || row.dataset.caseSearchText.includes(term);
      if (periodMatches && searchMatches) {
        groupCounts[row.dataset.caseGroup] += 1;
        groupCounts.all += 1;
      }
      const groupMatches = activeFilter === "all" || row.dataset.caseGroup === activeFilter;
      const visible = groupMatches && periodMatches && searchMatches;
      row.hidden = !visible;
      if (!visible) row.open = false;
      if (visible) visibleCount += 1;
    });
    Object.entries(groupCounts).forEach(([group, count]) => {
      const target = host.querySelector(`[data-case-count="${group}"]`);
      if (target) target.textContent = String(count);
    });
    resultCount.textContent = `顯示 ${visibleCount} 筆`;
    empty.hidden = visibleCount !== 0;
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.caseFilter;
      buttons.forEach((item) => item.classList.toggle("is-active", item === button));
      apply();
    });
  });
  search.addEventListener("input", apply);
  year.addEventListener("change", apply);
  month.addEventListener("change", apply);
  apply();
}

function manualCorrectionHtml(row) {
  return `<details class="mt-2"><summary class="small text-primary">管理員補登打卡</summary>
    <form class="row g-2 mt-1" data-manual-form>
      <div class="col-md-2"><select class="form-select form-select-sm" name="type"><option value="checkIn">補簽到</option><option value="checkOut">補簽退</option></select></div>
      <div class="col-md-2"><input class="form-control form-control-sm" type="time" name="time" value="${row.workStart || "09:00"}" required></div>
      <div class="col-md-6"><input class="form-control form-control-sm" name="reason" placeholder="補登原因（必填）" required></div>
      <input type="hidden" name="userId" value="${escapeHtml(row.userId)}"><input type="hidden" name="date" value="${escapeHtml(row.date)}">
      <div class="col-md-2 d-grid"><button class="btn btn-sm btn-outline-primary">建立補登</button></div>
    </form>
  </details>`;
}

function timeMentionedInReason(reason) {
  const match = String(reason || "").match(/(?:^|\D)([01]?\d|2[0-3])[:：]([0-5]\d)(?:\D|$)/);
  return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : "";
}

function bindCaseReviews(host) {
  host.querySelectorAll("[data-review-decision]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-review-case]");
      const buttons = card.querySelectorAll("[data-review-decision]");
      buttons.forEach((item) => { item.disabled = true; });
      try {
        await callSecureFunction("reviewException", {
          caseId: card.dataset.reviewCase,
          decision: button.dataset.reviewDecision,
          note: card.querySelector("[data-review-note]").value.trim(),
          correctionTime: card.querySelector("[data-correction-time]")?.value || ""
        });
        showToast(button.dataset.reviewDecision === "approved" ? "已核准並補回出勤表" : "審核結果已記錄", "success");
        if (button.dataset.reviewDecision === "approved") {
          location.reload();
          return;
        }
        card.querySelector(".badge").textContent = statusLabels[button.dataset.reviewDecision] || button.dataset.reviewDecision;
        card.querySelector(".row")?.remove();
      } catch (error) {
        showToast(error.message, "danger");
        buttons.forEach((item) => { item.disabled = false; });
      }
    });
  });
  host.querySelectorAll("[data-repair-approved]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-review-case]");
      const repair = button.closest("[data-approved-repair]");
      button.disabled = true;
      try {
        await callSecureFunction("reviewException", {
          caseId: card.dataset.reviewCase,
          decision: "approved",
          note: "補回已核准的出勤紀錄",
          correctionTime: repair.querySelector("input[type=time]").value
        });
        showToast("已補回出勤表並重新計算月報", "success");
        location.reload();
      } catch (error) {
        showToast(error.message, "danger");
        button.disabled = false;
      }
    });
  });
  host.querySelectorAll("[data-manual-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        await callSecureFunction("createManualCorrection", {
          userId: form.elements.userId.value,
          date: form.elements.date.value,
          type: form.elements.type.value,
          time: form.elements.time.value,
          reason: form.elements.reason.value.trim(),
          exceptionId: form.closest("[data-review-case]").dataset.reviewCase
        });
        showToast("補登已建立並寫入稽核紀錄", "success");
        form.closest("details").remove();
      } catch (error) {
        showToast(error.message, "danger");
        button.disabled = false;
      }
    });
  });
}

async function renderWorkSites(content) {
  const snap = await getDocs(collection(db, "workSites"));
  const sites = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const host = document.createElement("div");
  host.className = "panel p-3 mt-3";
  host.innerHTML = `<h2 class="h5 mb-1">公司打卡據點</h2>
    <p class="small muted">半徑與 GPS 最大誤差可依現場收訊調整；預設半徑 150 公尺。Web GPS 可降低代打風險，但無法保證偵測所有定位偽造。</p>
    <form class="row g-2" id="workSiteForm">
      <div class="col-md-3"><label class="form-label">據點名稱</label><input class="form-control" name="name" required></div>
      <div class="col-md-2"><label class="form-label">緯度</label><input class="form-control" name="latitude" type="number" step="any" required></div>
      <div class="col-md-2"><label class="form-label">經度</label><input class="form-control" name="longitude" type="number" step="any" required></div>
      <div class="col-md-2"><label class="form-label">半徑（公尺）</label><input class="form-control" name="radiusM" type="number" min="20" max="5000" value="150" required></div>
      <div class="col-md-2"><label class="form-label">最大誤差</label><input class="form-control" name="maxAccuracyM" type="number" min="10" max="1000" value="100" required></div>
      <div class="col-md-1 d-grid align-items-end"><button class="btn btn-primary">新增</button></div>
    </form>
    <div class="table-responsive mt-3"><table class="table table-sm"><thead><tr><th>據點</th><th>座標</th><th>半徑</th><th>精度</th><th>狀態</th></tr></thead><tbody>
      ${sites.length ? sites.map((site) => `<tr><td>${escapeHtml(site.name)}</td><td>${site.latitude}, ${site.longitude}</td><td>${site.radiusM || 150} m</td><td>${site.maxAccuracyM || 100} m</td><td>${site.active === false ? "停用" : "啟用"}</td></tr>`).join("") : `<tr><td colspan="5" class="muted">尚未設定據點；設定前所有一般打卡都會被拒絕。</td></tr>`}
    </tbody></table></div>`;
  content.appendChild(host);
  host.querySelector("#workSiteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await callSecureFunction("saveWorkSite", {
        name: form.elements.name.value.trim(), latitude: Number(form.elements.latitude.value), longitude: Number(form.elements.longitude.value),
        radiusM: Number(form.elements.radiusM.value), maxAccuracyM: Number(form.elements.maxAccuracyM.value), active: true
      });
      showToast("公司據點已新增", "success");
      location.reload();
    } catch (error) {
      showToast(error.message, "danger");
      button.disabled = false;
    }
  });
}

async function renderFieldAssignments(profile, content) {
  const [usersSnap, assignmentSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "fieldAssignments"))
  ]);
  const users = usersSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((user) => user.isActive !== false);
  const assignments = assignmentSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => toMillis(b.startAt) - toMillis(a.startAt));
  const host = document.createElement("div");
  host.className = "panel p-3 mt-3";
  host.innerHTML = `<h2 class="h5 mb-1">外勤打卡配置</h2><p class="small muted">只有管理員能指定員工、核准時段與允許地點。</p>
    <form class="row g-2" id="fieldAssignmentForm">
      <div class="col-md-3"><label class="form-label">員工</label><select class="form-select" name="userId" required><option value="">請選員工</option>${users.map((user) => `<option value="${user.id}">${escapeHtml(user.name || user.email)}</option>`).join("")}</select></div>
      <div class="col-md-3"><label class="form-label">外勤名稱</label><input class="form-control" name="name" placeholder="客戶拜訪" required></div>
      <div class="col-md-3"><label class="form-label">開始</label><input class="form-control" type="datetime-local" name="startAt" required></div>
      <div class="col-md-3"><label class="form-label">結束</label><input class="form-control" type="datetime-local" name="endAt" required></div>
      <div class="col-md-2"><label class="form-label">緯度</label><input class="form-control" type="number" step="any" name="latitude" required></div>
      <div class="col-md-2"><label class="form-label">經度</label><input class="form-control" type="number" step="any" name="longitude" required></div>
      <div class="col-md-2"><label class="form-label">半徑</label><input class="form-control" type="number" min="20" max="5000" name="radiusM" value="150" required></div>
      <div class="col-md-4"><label class="form-label">配置原因</label><input class="form-control" name="reason" required></div>
      <div class="col-md-2 d-grid align-items-end"><button class="btn btn-primary">新增外勤</button></div>
    </form>
    <div class="table-responsive mt-3"><table class="table table-sm"><thead><tr><th>員工</th><th>外勤</th><th>期間</th><th>半徑</th><th>原因</th></tr></thead><tbody>
      ${assignments.length ? assignments.slice(0, 30).map((row) => `<tr><td>${escapeHtml(row.userName)}</td><td>${escapeHtml(row.name)}</td><td>${fmtDateTime(row.startAt)} ～ ${fmtDateTime(row.endAt)}</td><td>${row.radiusM} m</td><td>${escapeHtml(row.reason)}</td></tr>`).join("") : `<tr><td colspan="5" class="muted">目前沒有外勤配置</td></tr>`}
    </tbody></table></div>
    <hr><h3 class="h6">Passkey 遺失／換機重設</h3>
    <form class="row g-2" id="passkeyResetForm"><div class="col-md-4"><select class="form-select" name="userId" required><option value="">請選員工</option>${users.map((user) => `<option value="${user.id}">${escapeHtml(user.name || user.email)}</option>`).join("")}</select></div><div class="col-md-6"><input class="form-control" name="reason" placeholder="重設原因（必填）" required></div><div class="col-md-2 d-grid"><button class="btn btn-outline-danger">註銷舊 Passkey</button></div></form>`;
  content.appendChild(host);
  host.querySelector("#fieldAssignmentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await callSecureFunction("saveFieldAssignment", {
        userId: form.elements.userId.value, name: form.elements.name.value.trim(),
        startAt: new Date(form.elements.startAt.value).toISOString(), endAt: new Date(form.elements.endAt.value).toISOString(),
        latitude: Number(form.elements.latitude.value), longitude: Number(form.elements.longitude.value), radiusM: Number(form.elements.radiusM.value),
        maxAccuracyM: 150, reason: form.elements.reason.value.trim(), active: true
      });
      showToast("外勤配置已新增", "success");
      location.reload();
    } catch (error) {
      showToast(error.message, "danger");
      button.disabled = false;
    }
  });
  host.querySelector("#passkeyResetForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await callSecureFunction("resetPasskey", { userId: form.elements.userId.value, reason: form.elements.reason.value.trim() });
      showToast("舊 Passkey 已註銷；員工需重新申請並由主管當面核准", "success");
      form.reset();
    } catch (error) {
      showToast(error.message, "danger");
    } finally {
      button.disabled = false;
    }
  });
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}
