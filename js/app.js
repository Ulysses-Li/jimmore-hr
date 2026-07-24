import { bootstrap } from "./vendor.js";
export { bootstrap };
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
const jimmoreLogoUrl = new URL("../Jimmore_logo.ico", import.meta.url).href;
export { app, auth, db, functions, runtimeEnvironment } from "./platform/firebase-client.js";
export { callSecureFunction } from "./services/functions-client.js";
import { auth, db } from "./platform/firebase-client.js";

export const roleLabels = {
  employee: "員工",
  manager: "主管",
  admin: "管理員"
};

export const statusLabels = {
  normal: "正常",
  late: "遲到",
  earlyLeave: "早退",
  workTimeNotEnough: "工時不足",
  missing: "未打卡",
  incomplete: "資料不完整",
  pending: "待審核",
  approved: "已核准",
  rejected: "已駁回",
  voided: "已無效"
};

export const statusBadges = {
  normal: "success",
  late: "warning",
  earlyLeave: "danger",
  workTimeNotEnough: "danger",
  missing: "danger",
  incomplete: "secondary",
  pending: "secondary",
  approved: "success",
  rejected: "danger",
  voided: "secondary"
};

export const leaveTypes = [
  { value: "annual", label: "特休" },
  { value: "compensatory", label: "補休" },
  { value: "personal", label: "事假" },
  { value: "sick", label: "普通傷病假" },
  { value: "occupational_sick", label: "公傷病假" },
  { value: "official", label: "公假" },
  { value: "marriage", label: "婚假" },
  { value: "bereavement", label: "喪假" },
  { value: "menstrual", label: "生理假" },
  { value: "maternity", label: "產假" },
  { value: "prenatal_checkup", label: "產檢假" },
  { value: "paternity_prenatal", label: "陪產檢及陪產假" },
  { value: "family_care", label: "家庭照顧假" },
  { value: "parental_leave", label: "育嬰留職停薪" },
  { value: "pregnancy_bed_rest", label: "安胎休養" }
];

export function leaveTypeLabel(type) {
  return leaveTypes.find((item) => item.value === type)?.label || type || "-";
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function fmtDate(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(date);
}

export function fmtDateTime(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function fmtTime(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("zh-TW", { timeStyle: "short" }).format(date);
}

export function todayKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function badge(status) {
  const color = statusBadges[status] || "secondary";
  return `<span class="badge text-bg-${color}">${statusLabels[status] || status || "-"}</span>`;
}

export function hoursBetween(start, end) {
  const from = start instanceof Date ? start : new Date(start);
  const to = end instanceof Date ? end : new Date(end);
  return Math.max(0, (to.getTime() - from.getTime()) / 36e5);
}

export function timeToDate(dateKey, hhmm) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const date = new Date(`${dateKey}T00:00:00`);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export async function getCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) {
    return { id: snap.id, ...snap.data(), authUser: user };
  }

  const profile = {
    name: user.displayName || user.email?.split("@")[0] || "New User",
    email: user.email || "",
    department: "",
    role: "employee",
    annualLeaveHours: 0,
    compensatoryLeaveHours: 0,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, "users", user.uid), profile);
  return { id: user.uid, ...profile, authUser: user };
}

export async function requireAuth(options = {}) {
  const allowedRoles = options.roles || ["employee", "manager", "admin"];
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          location.href = pathToRoot() + "login.html";
          return;
        }

        const profile = await getCurrentUserProfile();
        if (!profile?.isActive) {
          await signOut(auth);
          location.href = pathToRoot() + "login.html?inactive=1";
          return;
        }

        if (!allowedRoles.includes(profile.role)) {
          location.href = profile.role === "admin"
            ? pathToRoot() + "admin/index.html"
            : pathToRoot() + "dashboard.html";
          return;
        }

        renderShellProfile(profile);
        resolve(profile);
      } catch (error) {
        renderStartupError(error);
        reject(error);
      }
    });
  });
}

function renderStartupError(error) {
  const container = qs("#pageContent") || qs("main") || document.body;
  container.innerHTML = `
    <div class="alert alert-danger m-3" role="alert">
      <h2 class="h5">資料載入失敗</h2>
      <p class="mb-2" data-startup-error></p>
      <button class="btn btn-outline-danger btn-sm" type="button" data-reload-page>重新載入</button>
    </div>`;
  qs("[data-startup-error]", container).textContent =
    error?.message || "無法連線至 Firebase，請檢查網路與 App Check 設定。";
  qs("[data-reload-page]", container)?.addEventListener("click", () => location.reload());
}

export function pathToRoot() {
  return location.pathname.includes("/admin/") ? "../" : "";
}

export function renderShellProfile(profile) {
  qsa("[data-user-name]").forEach((el) => { el.textContent = profile.name || profile.email; });
  qsa("[data-user-role]").forEach((el) => { el.textContent = roleLabels[profile.role] || profile.role; });
  qsa("[data-admin-nav]").forEach((el) => {
    if (profile.role === "employee") el.remove();
  });
  const current = location.pathname.split("/").pop() || "index.html";
  qsa("[data-nav]").forEach((link) => {
    if (link.getAttribute("href")?.endsWith(current)) link.classList.add("active");
  });
}

export function bindLogout() {
  qsa("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      await signOut(auth);
      location.href = pathToRoot() + "login.html";
    });
  });

  qsa("[data-nav-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const sidebar = button.closest(".sidebar");
      const isOpen = sidebar?.classList.toggle("nav-open") || false;
      button.setAttribute("aria-expanded", String(isOpen));
    });
  });

  qsa(".sidebar [data-nav]").forEach((link) => {
    link.addEventListener("click", () => {
      const sidebar = link.closest(".sidebar");
      const toggle = sidebar?.querySelector("[data-nav-toggle]");
      sidebar?.classList.remove("nav-open");
      toggle?.setAttribute("aria-expanded", "false");
    });
  });
}

export async function getWorkSettings() {
  const ref = doc(db, "workSettings", "default");
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const defaults = {
    workStart: "09:00",
    workEnd: "18:00",
    workShifts: [
      { id: "shift_0800", name: "早班 08:00", workStart: "08:00", workEnd: "17:00" },
      { id: "shift_0830", name: "早班 08:30", workStart: "08:30", workEnd: "17:30" },
      { id: "shift_0900", name: "日班 09:00", workStart: "09:00", workEnd: "18:00" }
    ],
    lunchStart: "12:00",
    lunchEnd: "13:00",
    holidayDates: [],
    specialClosureDates: [],
    standardHours: 8,
    lateGraceMinutes: 5
  };
  return defaults;
}

export async function updateProfileFields(userId, fields) {
  await updateDoc(doc(db, "users", userId), {
    name: fields.name,
    ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
    updatedAt: serverTimestamp()
  });
}

export function showToast(message, variant = "primary") {
  const host = qs("#toastHost");
  if (!host) {
    alert(message);
    return;
  }
  const item = document.createElement("div");
  item.className = `toast align-items-center text-bg-${variant} border-0`;
  item.setAttribute("role", "status");
  item.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>`;
  host.appendChild(item);
  bootstrap.Toast.getOrCreateInstance(item, { delay: 3200 }).show();
  item.addEventListener("hidden.bs.toast", () => item.remove());
}

export function pageChrome(title, subtitle = "") {
  const root = pathToRoot();
  return `
    <aside class="sidebar p-3">
      <div class="sidebar-head d-flex align-items-center gap-2 mb-4">
        <div class="d-flex align-items-center gap-2 min-w-0">
          <span class="brand-mark">
            <img src="${jimmoreLogoUrl}" alt="Jimmore">
          </span>
          <div class="min-w-0">
            <div class="fw-bold text-truncate">Jimmore HR</div>
            <div class="small text-white-50 text-truncate">人事出勤管理</div>
          </div>
        </div>
        <button class="nav-toggle" type="button" data-nav-toggle aria-label="開啟選單" aria-expanded="false">
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>
      <nav class="nav flex-column gap-1">
        <a data-nav class="nav-link" href="${root}dashboard.html">個人儀表板</a>
        <a data-nav class="nav-link" href="${root}attendance.html">出勤打卡</a>
        <a data-nav class="nav-link" href="${root}leave.html">請假申請</a>
        <a data-nav class="nav-link" href="${root}overtime.html">加班申請</a>
        <a data-nav class="nav-link" href="${root}calendar.html">休假行事曆</a>
        <a data-nav class="nav-link" href="${root}profile.html">個人資料</a>
        <hr data-admin-nav class="border-secondary">
        <a data-nav data-admin-nav class="nav-link" href="${root}admin/index.html">管理首頁</a>
        <a data-nav data-admin-nav class="nav-link" href="${root}admin/employees.html">員工管理</a>
        <a data-nav data-admin-nav class="nav-link" href="${root}admin/attendance.html">出勤報表</a>
        <a data-nav data-admin-nav class="nav-link" href="${root}admin/leave.html">請假審核</a>
        <a data-nav data-admin-nav class="nav-link" href="${root}admin/overtime.html">加班審核</a>
        <a data-nav data-admin-nav class="nav-link" href="${root}admin/settings.html">系統設定</a>
      </nav>
    </aside>
    <main class="content">
      <header class="topbar px-3 py-2 d-flex justify-content-between align-items-center">
        <div>
          <h1 class="h4 mb-0">${title}</h1>
          <div class="small muted">${subtitle}</div>
        </div>
        <div class="d-flex align-items-center gap-3">
          <div class="text-end">
            <div class="fw-semibold" data-user-name>...</div>
            <div class="small muted" data-user-role>...</div>
          </div>
          <button class="btn btn-outline-secondary btn-sm" data-logout>登出</button>
        </div>
      </header>
      <div class="page-wrap">
        <div id="pageContent"></div>
      </div>
      <div id="toastHost" class="toast-container position-fixed bottom-0 end-0 p-3"></div>
    </main>`;
}

export function mountPageShell(title, subtitle = "") {
  document.querySelector(".app-shell")?.remove();
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div class="app-shell">${pageChrome(title, subtitle)}</div>`
  );
}
