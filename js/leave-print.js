import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  db,
  fmtDateTime,
  leaveTypeLabel,
  requireAuth
} from "./app.js";

await requireAuth({ roles: ["manager", "admin"] });

const requestId = new URLSearchParams(location.search).get("id")?.trim();
const errorHost = document.querySelector("#printError");
const sheet = document.querySelector("#leavePrintSheet");
const printButton = document.querySelector("#printLeaveButton");

printButton.addEventListener("click", () => window.print());

try {
  if (!requestId) throw new Error("網址缺少假單編號，請回到請假審核頁重新開啟。");
  const requestSnap = await getDoc(doc(db, "leaveRequests", requestId));
  if (!requestSnap.exists()) throw new Error("找不到這張假單，資料可能已不存在或您沒有查看權限。");
  renderLeaveRequest({ id: requestSnap.id, ...requestSnap.data() });
} catch (error) {
  errorHost.textContent = error?.message || "假單載入失敗，請稍後再試。";
  errorHost.hidden = false;
  printButton.disabled = true;
}

function renderLeaveRequest(request) {
  setText("#printRequestId", request.id || "-");
  setText("#printUserName", request.userName || "-");
  setText("#printDepartment", request.department || "未設定部門");
  setText("#printLeaveType", leaveTypeLabel(request.leaveType));
  setText("#printHours", request.hours ?? "-");
  setText("#printStartTime", fmtDateTime(request.startTime));
  setText("#printEndTime", fmtDateTime(request.endTime));
  setText("#printProxy", request.proxyUserName || "-");
  setText("#printStatus", requestStatusText(request.status));
  setText("#printCreatedAt", request.createdAt ? fmtDateTime(request.createdAt) : "-");
  setText("#printReason", request.reason || "-");
  setText("#printGeneratedAt", new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date()));
  if (request.status === "voided" && request.voidReason) {
    const voidReason = document.querySelector("#printVoidReason");
    voidReason.textContent = `無效原因：${request.voidReason}`;
    voidReason.hidden = false;
  }
  document.title = `請假申請單 - ${request.userName || request.id}`;
  sheet.hidden = false;
}

function requestStatusText(status) {
  return { pending: "待審核", approved: "已核准", rejected: "已駁回", voided: "已無效" }[status] || status || "-";
}

function setText(selector, value) {
  document.querySelector(selector).textContent = String(value ?? "-");
}
