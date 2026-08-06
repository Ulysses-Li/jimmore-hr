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
  getWorkSettings,
  timeToDate,
  todayKey
} from "./app.js";

mountPageShell("個人儀表板", "今日出勤、假勤與待辦摘要");
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
  <div class="row g-3 mb-4">
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
  </div>
  <div class="panel p-3" id="personalLateStatistics">
    <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
      <div>
        <h2 class="h5 mb-1">我的遲到統計</h2>
        <div class="muted small">只顯示自己的遲到紀錄</div>
      </div>
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <button class="btn btn-outline-secondary btn-sm" id="personalLatePrevMonthBtn" type="button">上個月</button>
        <button class="btn btn-outline-primary btn-sm" id="personalLateCurrentMonthBtn" type="button">這個月</button>
        <button class="btn btn-outline-secondary btn-sm" id="personalLateNextMonthBtn" type="button">下個月</button>
      </div>
    </div>
    <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
      <h3 class="h6 mb-0" id="personalLateMonthTitle"></h3>
      <span class="muted small" id="personalLateMonthSummary"></span>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-sm-6"><div class="border rounded p-3 h-100"><div class="muted small">遲到次數</div><div class="stat-value" id="personalLateCount">0</div><div class="small muted">次</div></div></div>
      <div class="col-sm-6"><div class="border rounded p-3 h-100"><div class="muted small">遲到總分鐘</div><div class="stat-value" id="personalLateMinutes">0</div><div class="small muted">分鐘</div></div></div>
    </div>
    <div id="personalLateRows"><div class="muted border rounded p-3">載入中…</div></div>
  </div>`;

qs("#annualHours").textContent = profile.annualLeaveHours ?? 0;
qs("#compHours").textContent = profile.compensatoryLeaveHours ?? 0;

const [leaveSnap, overtimeSnap, attendanceSnap, workSettings] = await Promise.all([
  getDocs(query(collection(db, "leaveRequests"), where("userId", "==", profile.id))),
  getDocs(query(collection(db, "overtimeRequests"), where("userId", "==", profile.id), where("status", "==", "pending"))),
  getDocs(query(collection(db, "attendance"), where("userId", "==", profile.id))),
  getWorkSettings()
]);

const leaveRows = leaveSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
const attendanceRows = attendanceSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
qs("#leavePending").textContent = leaveRows.filter((row) => row.status === "pending").length;
qs("#overtimePending").textContent = overtimeSnap.size;
qs("#attendanceRows").innerHTML = attendanceSnap.empty
  ? `<tr><td colspan="4" class="muted">尚無打卡紀錄</td></tr>`
  : attendanceRows
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

setupPersonalLateStatistics(attendanceRows, leaveRows, workSettings);

function setupPersonalLateStatistics(allAttendance, allLeaves, settings) {
  let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const render = () => renderPersonalLateMonth(visibleMonth, allAttendance, allLeaves, settings);
  qs("#personalLatePrevMonthBtn").addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    render();
  });
  qs("#personalLateCurrentMonthBtn").addEventListener("click", () => {
    visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    render();
  });
  qs("#personalLateNextMonthBtn").addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    render();
  });
  render();
}

function renderPersonalLateMonth(visibleMonth, allAttendance, allLeaves, settings) {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
  const approvedLeaves = allLeaves.filter((item) => {
    const start = toDate(item.startTime);
    const end = toDate(item.endTime);
    return item.status === "approved" && start <= monthEnd && end >= monthStart;
  });
  const records = earliestPersonalCheckIns(allAttendance)
    .filter((item) => {
      const date = toDate(item.timestamp);
      return date >= monthStart && date <= monthEnd;
    })
    .map((item) => ({ ...item, ...calculatePersonalLateEvidence(item, approvedLeaves, settings) }))
    .filter((item) => item.lateMinutes > 0)
    .sort((a, b) => toDate(b.timestamp) - toDate(a.timestamp));
  const totalMinutes = records.reduce((sum, item) => sum + item.lateMinutes, 0);

  qs("#personalLateMonthTitle").textContent = `${year} 年 ${month + 1} 月`;
  qs("#personalLateMonthSummary").textContent = records.length
    ? `${records.length} 次，共 ${totalMinutes} 分鐘`
    : "本月無遲到";
  qs("#personalLateCount").textContent = records.length;
  qs("#personalLateMinutes").textContent = totalMinutes;
  qs("#personalLateRows").innerHTML = personalLateTable(records, year, month);
}

function earliestPersonalCheckIns(records) {
  const earliest = new Map();
  records.forEach((record) => {
    if (record.type !== "checkIn" || !record.date) return;
    const timestamp = toDate(record.timestamp);
    if (Number.isNaN(timestamp.getTime())) return;
    const current = earliest.get(record.date);
    if (!current || timestamp < toDate(current.timestamp)) earliest.set(record.date, record);
  });
  return Array.from(earliest.values());
}

function calculatePersonalLateEvidence(record, approvedLeaves, settings) {
  const actual = toDate(record.timestamp);
  const date = record.date || todayKey(actual);
  const expected = timeToDate(date, record.workStart || settings.workStart || "09:00");
  const lunchStart = timeToDate(date, settings.lunchStart || "12:00");
  const lunchEnd = timeToDate(date, settings.lunchEnd || "13:00");
  const rawLateMinutes = personalWorkMinutesInRange(expected, actual, expected, actual, lunchStart, lunchEnd);
  const graceMinutes = Math.max(0, Number(record.lateGraceMinutes ?? settings.lateGraceMinutes ?? 0));
  const coveredLeaveMinutes = approvedLeaves.reduce((sum, item) => sum + personalWorkMinutesInRange(
    expected,
    actual,
    toDate(item.startTime),
    toDate(item.endTime),
    lunchStart,
    lunchEnd
  ), 0);
  return {
    actual,
    expected,
    rawLateMinutes,
    graceMinutes,
    coveredLeaveMinutes,
    lateMinutes: Math.max(0, rawLateMinutes - graceMinutes - coveredLeaveMinutes)
  };
}

function personalLateTable(records, year, month) {
  if (!records.length) return `<div class="muted border rounded p-3">這個月沒有遲到紀錄。</div>`;
  const body = records.map((record, index) => {
    const detailId = `personalLateEvidence_${year}_${month + 1}_${index}`;
    return `<tr>
      <td>${escapeHtml(record.date || "-")}</td>
      <td>${escapeHtml(record.shiftName || "班別")}</td>
      <td>${formatTime(record.actual)}</td>
      <td><span class="badge text-bg-danger">${record.lateMinutes} 分鐘</span></td>
      <td><button class="btn btn-link btn-sm p-0 text-nowrap" type="button"
        data-bs-toggle="collapse" data-bs-target="#${detailId}" aria-expanded="false"
        aria-controls="${detailId}">查看依據</button></td>
    </tr>
    <tr class="collapse late-evidence-row" id="${detailId}"><td colspan="5">
      <article class="late-evidence-card">
        <div class="late-evidence-grid">
          <div><span>預定上班</span><strong>${formatTime(record.expected)}</strong></div>
          <div><span>原始差額</span><strong>${record.rawLateMinutes} 分鐘</strong></div>
          <div><span>寬限扣除</span><strong>${record.graceMinutes} 分鐘</strong></div>
          <div><span>請假扣除</span><strong>${record.coveredLeaveMinutes} 分鐘</strong></div>
        </div>
        <div class="late-evidence-formula">${record.rawLateMinutes} − ${record.graceMinutes} − ${record.coveredLeaveMinutes} = <strong>${record.lateMinutes} 分鐘</strong></div>
        <div class="late-evidence-meta"><span>紀錄編號：${escapeHtml(record.id || "-")}</span></div>
      </article>
    </td></tr>`;
  }).join("");
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
    <thead><tr><th>日期</th><th>班別</th><th>實際簽到</th><th>遲到</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function personalWorkMinutesInRange(start, end, blockStart, blockEnd, lunchStart, lunchEnd) {
  const minutes = personalOverlapMinutes(start, end, blockStart, blockEnd);
  const lunchFrom = new Date(Math.max(start.getTime(), lunchStart.getTime()));
  const lunchTo = new Date(Math.min(end.getTime(), lunchEnd.getTime()));
  const lunchMinutes = lunchTo > lunchFrom
    ? personalOverlapMinutes(lunchFrom, lunchTo, blockStart, blockEnd)
    : 0;
  return Math.max(0, minutes - lunchMinutes);
}

function personalOverlapMinutes(start, end, blockStart, blockEnd) {
  const from = Math.max(start.getTime(), blockStart.getTime());
  const to = Math.min(end.getTime(), blockEnd.getTime());
  return Math.max(0, Math.ceil((to - from) / 60000));
}

function formatTime(value) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function toDate(value) {
  if (!value) return new Date("");
  return value.toDate ? value.toDate() : new Date(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}
