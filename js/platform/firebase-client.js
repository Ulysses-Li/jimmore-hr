import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js";
import { firebaseConfig, appSecurityConfig } from "../firebase-config.js";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const isLocal = localHosts.has(location.hostname);

export const app = initializeApp(firebaseConfig);

const shouldInitializeAppCheck = Boolean(appSecurityConfig.appCheckSiteKey)
  && !appSecurityConfig.useEmulators
  && (!isLocal || appSecurityConfig.enableAppCheckDebug);

// App Check 必須在任何其他 Firebase 服務之前初始化，否則 Auth / Firestore
// 可能先建立未受 App Check 管理的 provider，導致正式站權杖取得失敗。
if (shouldInitializeAppCheck) {
  if (isLocal) {
    // Firebase 會在主控台輸出一次性 Debug Token。只將 Token 登錄到
    // Firebase App Check 後台，不要寫進原始碼或版本控制。
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appSecurityConfig.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, appSecurityConfig.functionsRegion);

if (appSecurityConfig.useEmulators) {
  connectAuthEmulator(auth, `http://${appSecurityConfig.emulatorHost}:9099`, {
    disableWarnings: true
  });
  connectFirestoreEmulator(db, appSecurityConfig.emulatorHost, 8080);
  connectFunctionsEmulator(functions, appSecurityConfig.emulatorHost, 5001);
}

export const runtimeEnvironment = Object.freeze({
  isLocal,
  appCheckEnabled: shouldInitializeAppCheck,
  emulatorsEnabled: Boolean(appSecurityConfig.useEmulators)
});
