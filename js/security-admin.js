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
      <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
        <div><h2 class="h5 mb-1">未打卡原因與審核</h2><div class="small muted">補打卡不會刪除案件，原因與審核歷程會永久保留。</div></div>
        <span class="badge text-bg-secondary">${cases.length} 筆</span>
      </div>
      <div id="securityCaseList">${cases.length ? cases.slice(0, 100).map((row) => caseHtml(row, profile)).join("") : `<div class="muted">目前沒有未打卡案件</div>`}</div>
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
  bindCaseReviews(host);
}

function caseHtml(row, profile) {
  const pendingReview = row.status === "pending_manager_review";
  return `<section class="border rounded p-3 mb-2" data-review-case="${escapeHtml(row.id)}">
    <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
      <div>
        <strong>${escapeHtml(row.date)} · ${escapeHtml(row.userName || row.userId)}</strong>
        <div class="small muted">${escapeHtml(row.department || "-")} · ${escapeHtml(row.shiftName || row.workStart || "班別")}</div>
      </div>
      <span class="badge text-bg-${pendingReview ? "warning" : "secondary"}">${escapeHtml(statusLabels[row.status] || row.status)}</span>
    </div>
    <div class="mt-2 small"><strong>員工原因：</strong>${escapeHtml(row.reason || "尚未填寫")}</div>
    ${row.laterPunchAt ? `<div class="small"><strong>後續打卡：</strong>${fmtDateTime(row.laterPunchAt)}（${row.laterPunchType === "checkIn" ? "簽到" : "簽退"}）</div>` : ""}
    ${row.reviewNote ? `<div class="small"><strong>審核備註：</strong>${escapeHtml(row.reviewNote)}</div>` : ""}
    ${pendingReview ? `<div class="row g-2 mt-1">
      <div class="col-md-7"><input class="form-control form-control-sm" data-review-note placeholder="審核備註或要求補充內容"></div>
      <div class="col-md-5 d-flex gap-1 flex-wrap">
        <button class="btn btn-sm btn-success" data-review-decision="approved">核准原因</button>
        <button class="btn btn-sm btn-outline-warning" data-review-decision="needs_more_info">要求補充</button>
        <button class="btn btn-sm btn-outline-danger" data-review-decision="rejected">駁回</button>
      </div>
    </div>` : ""}
    ${profile.role === "admin" && ["approved", "rejected", "overdue", "pending_manager_review"].includes(row.status) ? manualCorrectionHtml(row) : ""}
  </section>`;
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
          note: card.querySelector("[data-review-note]").value.trim()
        });
        showToast("審核結果已記錄", "success");
        card.querySelector(".badge").textContent = statusLabels[button.dataset.reviewDecision] || button.dataset.reviewDecision;
        card.querySelector(".row")?.remove();
      } catch (error) {
        showToast(error.message, "danger");
        buttons.forEach((item) => { item.disabled = false; });
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
