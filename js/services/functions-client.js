import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";
import { getIdToken } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  auth,
  functions,
  runtimeEnvironment
} from "../platform/firebase-client.js";

const callableCache = new Map();

function callableFor(name) {
  if (!callableCache.has(name)) {
    callableCache.set(name, httpsCallable(functions, name, { timeout: 30000 }));
  }
  return callableCache.get(name);
}

export async function callSecureFunction(name, data = {}) {
  let error;
  try {
    const result = await callableFor(name)(data);
    return result.data;
  } catch (initialError) {
    error = initialError;
  }

  const initialCode = String(error?.code || "");
  if (initialCode.endsWith("/unauthenticated") && auth.currentUser) {
    try {
      await getIdToken(auth.currentUser, true);
      const result = await callableFor(name)(data);
      return result.data;
    } catch (retryError) {
      error = retryError;
    }
  }

  const code = String(error?.code || "");
  if (code.endsWith("/not-found")) {
    throw new Error("安全打卡後端尚未部署，請管理員完成 Firebase Functions 上線。");
  }
  if (code.endsWith("/failed-precondition")) {
    throw new Error(String(error?.message || "安全服務尚未完成必要設定。")
      .replace(/^FirebaseError:\s*/i, "")
      .replace(/^functions\/[a-z-]+:\s*/i, ""));
  }
  if (code.endsWith("/unauthenticated")) {
    if (
      runtimeEnvironment.isLocal
      && !runtimeEnvironment.appCheckEnabled
      && !runtimeEnvironment.emulatorsEnabled
    ) {
      throw new Error(
        "本機預覽未啟用 App Check，無法呼叫正式安全服務。請啟用並登錄 App Check Debug Token，或改用 Firebase Emulator。"
      );
    }
    throw new Error("登入驗證失效，請登出後重新登入再試。");
  }
  if (code.endsWith("/internal")) {
    throw new Error("後端服務暫時發生錯誤，請稍後再試或通知系統管理員。");
  }
  const message = String(error?.message || "")
    .replace(/^FirebaseError:\s*/i, "")
    .replace(/^functions\/[a-z-]+:\s*/i, "");
  throw new Error(message || "安全服務暫時無法使用，請稍後再試。");
}
