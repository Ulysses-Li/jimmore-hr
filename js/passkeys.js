// 保留既有匯入路徑，避免舊頁面或客製模組升級時中斷。
export {
  authenticateAndPunch,
  registerApprovedPasskey,
  requestPasskeyEnrollment
} from "./services/passkey-service.js";
