import {
  startAuthentication,
  startRegistration
} from "https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13.3.0/+esm";
import { callSecureFunction } from "./functions-client.js";

function assertPasskeySupport() {
  if (!window.isSecureContext) {
    throw new Error("Passkey 只能在 HTTPS 或 localhost 安全環境使用。");
  }
  if (!window.PublicKeyCredential) {
    throw new Error("此瀏覽器或裝置不支援 Passkey／生物辨識。");
  }
}

function passkeyOperationError(error) {
  const errorName = String(error?.name || "");
  if (errorName === "NotAllowedError") {
    return new Error(
      "Face ID／Passkey 未完成。請使用 Safari 一般分頁，確認已設定 Face ID、iPhone 解鎖密碼，"
      + "並在「設定 → Apple 帳號 → iCloud → 密碼與鑰匙圈」開啟同步；若剛才按了取消，請重新操作。"
    );
  }
  if (errorName === "InvalidStateError") {
    return new Error("這部裝置可能已註冊過 Passkey；請重新整理，若仍失敗請由管理員重設舊憑證。");
  }
  if (errorName === "SecurityError") {
    return new Error("Passkey 網域驗證失敗，請確認使用正式網址 jimmore-workhub.web.app。");
  }
  return error instanceof Error ? error : new Error("Passkey 操作未完成，請重新整理後再試。");
}

export async function requestPasskeyEnrollment(deviceLabel) {
  assertPasskeySupport();
  return callSecureFunction("requestPasskeyEnrollment", { deviceLabel });
}

export async function registerApprovedPasskey() {
  assertPasskeySupport();
  try {
    const optionsJSON = await callSecureFunction("beginPasskeyRegistration");
    const response = await startRegistration({ optionsJSON });
    return await callSecureFunction("finishPasskeyRegistration", { response });
  } catch (error) {
    throw passkeyOperationError(error);
  }
}

export async function authenticateAndPunch(type, location) {
  assertPasskeySupport();
  try {
    const optionsJSON = await callSecureFunction("beginPunch", { type });
    const response = await startAuthentication({ optionsJSON });
    return await callSecureFunction("finishPunch", {
      response,
      type,
      location,
      deviceInfo: navigator.userAgent
    });
  } catch (error) {
    throw passkeyOperationError(error);
  }
}
