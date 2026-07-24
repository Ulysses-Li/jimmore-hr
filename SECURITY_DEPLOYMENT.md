# 防代打安全功能部署清單

本功能採 fail-closed：Functions 尚未部署、App Check 尚未設定、沒有公司據點或員工沒有已核准 Passkey 時，安全打卡會被拒絕，不會退回舊的前端直接寫入模式。

## 1. Firebase 與費用保護

1. 將 `jimmore-workhub` 升級為 Blaze，連結公司計費帳戶。
2. 在 Google Cloud Billing 建立月預算與 50%、80%、100% 警示；預算警示不會自動停止服務。
3. Functions 維持 `minInstances: 0`，Scheduler 只有 `createMissingAttendanceCases` 一個工作。

## 2. App Check

1. Firebase Console → App Check，為 Web App 建立 reCAPTCHA Enterprise provider。
2. reCAPTCHA Enterprise Site Key 已設定於 `js/firebase-config.js`；它是公開金鑰，不是密碼。
3. 將 `workhub.cwli.dev` 加入允許網域。
4. Functions 正式預設 `enforceAppCheck: true`。
5. `localhost` / `127.0.0.1` 一般預覽預設不啟動 App Check，避免未登錄 Token 造成整站離線。若要測試 App Check，將 `enableAppCheckDebug` 改為 `true`；瀏覽器 Console 會顯示 Debug Token，只把該 Token 登錄到 Firebase Console → App Check → 管理 Debug Token，切勿寫入程式。
6. 完整 Emulator 測試可把 `appSecurityConfig.useEmulators` 改為 `true`，並使用 `.env.local` 的 Emulator Origins。
7. 目前 App Check 指標仍可能顯示未驗證流量。先確認新網頁版本產生「有效」請求，再逐一開啟 Firestore / Authentication 強制執行，避免鎖住全體使用者。

## 3. WebAuthn 網域

複製 `functions/.env.example` 為 `functions/.env.jimmore-workhub`。正式預設值為：

```env
WEBAUTHN_RP_ID=workhub.cwli.dev
WEBAUTHN_ORIGINS=https://workhub.cwli.dev
WEBAUTHN_RP_NAME=Jimmore WorkHub
```

Passkey 與 RP ID 綁定。若正式網址改變，必須更新以上設定並重新註冊裝置。正式網站必須使用 HTTPS。

Emulator 專用範例：

```env
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
APP_CHECK_ENFORCEMENT=false
```

不要把這組 Emulator 設定部署到正式環境。

## 4. 部署順序

前端由 GitHub Pages 發布至 `workhub.cwli.dev`，不使用 Firebase Hosting。

```powershell
npx firebase-tools login
npx firebase-tools use jimmore-workhub
npm install
npx firebase-tools deploy --only functions,firestore:rules,firestore:indexes
```

部署 Functions 前，專案必須先升級 Blaze。這會建立雲端資源與可能費用，因此應由專案負責人在確認預算警示後執行。

部署後先以管理員進入「系統設定」建立至少一個公司據點，再由少數測試員工走完：

1. 員工申請 Passkey。
2. 所屬主管當面核准。
3. 員工完成裝置註冊。
4. 在據點內完成簽到與簽退。
5. 驗證據點外打卡被拒絕、外勤配置期間可以打卡。

## 5. 本機驗證

Firestore Emulator 需要 Java 21 或更新版本：

```powershell
npx firebase-tools emulators:exec --only firestore "npm --prefix functions test"
```

未啟動 Emulator 時，純函式測試仍可執行，Rules 測試會自動標記 skip：

```powershell
npm --prefix functions test
npm --prefix functions audit --omit=dev
```

若只做語法與純邏輯驗證：

```powershell
npm --prefix functions run lint
node functions/test/core.test.js
node functions/test/config.test.js
```

## 6. 上線稽核

- 確認瀏覽器無法直接寫入 `attendance`、`attendanceDaily`、`attendanceExceptions`、`passkeyCredentials`、`auditEvents`、審核結果、員工假別餘額與 `workSettings`。
- 主管只能讀取與審核同部門案件，管理員才能補登與重設 Passkey。
- 每週查看 Functions 錯誤率、App Check 無效請求、Firestore 用量與未處理／逾期案件。
- Web GPS 仍可能被具備特殊工具的人偽造；Passkey、據點限制、外勤配置及不可變稽核是降低風險，不是絕對防偽保證。
- 商品化部署與未來多租戶邊界請見 `ARCHITECTURE.md`；目前共享一個 Firebase 專案給多家公司是不安全的。
