import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  db,
  getWorkSettings,
  requireAuth
} from "./app.js";
import { leavePrintFormHtml, leavePrintStyles } from "./leave-print-template.js";

await requireAuth({ roles: ["manager", "admin"] });

const requestId = new URLSearchParams(location.search).get("id")?.trim();
const errorHost = document.querySelector("#printError");
const printHost = document.querySelector("#leavePrintHost");
const printButton = document.querySelector("#printLeaveButton");

document.querySelector("#leavePrintSharedStyles").textContent = leavePrintStyles;

printButton.addEventListener("click", () => window.print());

try {
  if (!requestId) throw new Error("網址缺少假單編號，請回到請假審核頁重新開啟。");
  const requestSnap = await getDoc(doc(db, "leaveRequests", requestId));
  if (!requestSnap.exists()) throw new Error("找不到這張假單，資料可能已不存在或您沒有查看權限。");
  const settings = await getWorkSettings();
  renderLeaveRequest({ id: requestSnap.id, ...requestSnap.data() }, settings);
} catch (error) {
  errorHost.textContent = error?.message || "假單載入失敗，請稍後再試。";
  errorHost.hidden = false;
  printButton.disabled = true;
}

function renderLeaveRequest(request, settings) {
  printHost.innerHTML = leavePrintFormHtml(request, {
    standardHours: settings.standardHours || 8
  });
  document.title = `請假申請單 - ${request.userName || request.id}`;
  printHost.hidden = false;
}
