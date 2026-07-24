// Firebase 網頁設定不是密碼，可以提交版本控制；真正的秘密只能放在
// Cloud Functions secrets / 環境變數。
export const firebaseConfig = {
  apiKey: "AIzaSyCdPO9KK2vKEQX-u8-Pg5EHY35zgZZXqMI",
  authDomain: "jimmore-workhub.firebaseapp.com",
  projectId: "jimmore-workhub",
  storageBucket: "jimmore-workhub.firebasestorage.app",
  messagingSenderId: "467336023812",
  appId: "1:467336023812:web:793e0d93e82218a9dbca51"
};

export const appSecurityConfig = Object.freeze({
  appCheckSiteKey: "6LeIMmAtAAAAAO9CW2L4ontnB3e3a1JRfpqlzqn3",
  functionsRegion: "asia-east1",
  emulatorHost: "127.0.0.1",
  // 一般 localhost 預覽預設不啟動 App Check，避免未登錄的 Debug Token
  // 讓 Firestore 整站進入離線。需要測試 App Check 時才改為 true，
  // 並先到 Firebase Console 登錄瀏覽器顯示的 Debug Token。
  enableAppCheckDebug: false,
  // 完整 Emulator 測試時改為 true。
  useEmulators: false,
  enforcementDate: ""
});

export const productConfig = Object.freeze({
  productName: "Jimmore WorkHub",
  edition: "attendance-security",
  schemaVersion: 1,
  timezone: "Asia/Taipei",
  defaultLocale: "zh-TW"
});
