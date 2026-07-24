# Firebase Hosting 空白頁修正筆記

日期：2026-07-23
正式站台：<https://jimmore-workhub.web.app>

## 問題現象

- Firebase Hosting 登入成功後，管理首頁只顯示側邊欄與頁首，主要內容空白。
- 瀏覽器顯示 reCAPTCHA placeholder 不存在的錯誤。

## 原因

Firebase App Check 會在 `document.body` 建立一個隱藏的 reCAPTCHA Enterprise 驗證容器。各功能頁原本使用 `document.body.innerHTML = ...` 建立介面，這會把 App Check 容器刪除，使非同步驗證失敗，並中止後續資料載入。

## 已完成修正

1. 在 Google Cloud reCAPTCHA Enterprise 的 App Check 金鑰加入正式 Hosting 網域：
   - `jimmore-workhub.web.app`
   - `jimmore-workhub.firebaseapp.com`
2. Firebase 初始化順序改為先啟動 App Check，再取得 Authentication、Firestore 與 Functions。
3. 新增共用 `mountPageShell()`，改用保留既有 DOM 節點的方式掛載頁面。
4. 個人頁與管理頁全部改用共用掛載函式。
5. 管理頁新增載入失敗提示與重新載入按鈕，避免再次出現無提示空白頁。
6. 重新建置並部署 Firebase Hosting。

## 正式站驗證

以下 12 頁均已登入實測，主要標題與資料區塊正常呈現：

- 個人儀表板
- 出勤打卡
- 請假申請
- 加班申請
- 休假行事曆
- 個人資料
- 管理首頁
- 員工管理
- 出勤報表
- 請假審核
- 加班審核
- 系統設定

## 說明書截圖素材

1. [App Check 允許網域設定](screenshots/01-app-check-allowed-domains-before-save.png)
2. [正式版個人儀表板](screenshots/02-production-dashboard-working.png)
3. [正式版管理首頁](screenshots/03-production-admin-working.png)
4. [正式版出勤打卡頁](screenshots/04-production-attendance-working.png)
5. [正式版系統設定頁](screenshots/05-production-settings-working.png)
6. [手機版選單收合](screenshots/06-mobile-dashboard-menu-closed.png)
7. [手機版選單展開](screenshots/07-mobile-dashboard-menu-open.png)
8. [Functions 尚未部署時的 Passkey 錯誤](screenshots/08-passkey-functions-not-deployed.jpg)
9. [主管端 Passkey 待核准案件](screenshots/09-passkey-admin-pending-approval.png)
10. [員工端等待主管核准](screenshots/10-passkey-employee-waiting-approval.png)
11. [iPhone Passkey NotAllowedError](screenshots/11-ios-passkey-not-allowed.jpg)
12. [Passkey 註冊成功狀態](screenshots/12-passkey-registered-success.png)
13. [iPhone 定位權限被拒絕](screenshots/13-ios-location-permission-denied.jpg)
14. [員工休假行事曆恢復](screenshots/14-employee-calendar-restored.png)
15. [員工請假申請恢復](screenshots/15-employee-leave-restored.png)

## 手機版導覽修正

手機寬度下，Bootstrap 的 `d-flex` 規則會蓋過專案的響應式版面，使側邊欄維持桌面橫向排列，並將主內容寬度壓縮為 0。修正方式如下：

- 移除頁面外框的 Bootstrap `d-flex` 類別。
- 由 `.app-shell` 統一設定桌面版 `display: flex`。
- 900px 以下改為 `display: block`，選單預設收合。
- 驗證 455 × 1432 視窗下無水平溢出。
- 選單收合時導覽隱藏；按下漢堡按鈕後以兩欄方式展開，再次按下可正常收合。

## Passkey 正式後端部署阻擋

2026-07-23 實際部署 Functions 時，Firebase 回覆專案必須先從 Spark 升級為 Blaze，才能啟用：

- Cloud Functions API
- Cloud Build API
- Artifact Registry API

在 Blaze 尚未啟用前，「申請註冊此裝置」沒有正式後端可處理，因此會失敗。Hosting 已先更新 Logo 與較清楚的錯誤提示；完成 Blaze 升級後，需重新執行 Functions、Firestore Rules／Indexes 與 Hosting 的完整部署。

Blaze 啟用後已完成：

- 18 個 Firebase Functions 2nd gen 建立於 `asia-east1`。
- Firestore Rules 與 Indexes 正式發布。
- Hosting 正式發布。
- Artifact Registry 設定 7 天後自動清除舊 Functions 映像。
- 正式測試「申請註冊此裝置」成功，員工端顯示等待核准，主管端顯示 1 筆待核准。

測試申請由 Windows 瀏覽器送出，裝置標籤為 `Win32`，未直接核准。正式註冊 iPhone 時應由 iPhone 再送一次申請，主管確認裝置後才核准。

## iPhone Passkey `NotAllowedError`

員工端已顯示「主管已核准」，代表後端申請與核准成功。若按「完成已核准註冊」後出現 `The request is not allowed by the user agent or the platform...`，錯誤發生於 iPhone 的 WebAuthn／Face ID 階段。

排除順序：

1. 使用 Safari 一般分頁，不使用 LINE 內建瀏覽器；測試時先退出私密瀏覽以排除環境差異。
2. 確認 iPhone 已設定解鎖密碼與 Face ID。
3. 確認「設定 → Apple 帳號 → iCloud → 密碼與鑰匙圈」已開啟。
4. 回到正式網址重新整理，再按一次「完成已核准註冊」。
5. 若曾按取消，重新操作即可；若仍失敗，由管理員重設後重新申請。

前端已將 `NotAllowedError`、`InvalidStateError` 與 `SecurityError` 改為中文說明，並在 Passkey 卡片加入 iPhone 排除提示。

重新讀取正式資料後，該帳號狀態已是 `registered`，員工端顯示「此帳號已有可用 Passkey」。因此截圖中的 `NotAllowedError` 可能發生於成功後的再次嘗試或使用者取消；不應立即重設憑證，應先以一次實際打卡確認 Face ID 與 GPS 流程。

## iPhone 定位權限被拒絕

若打卡顯示「定位權限被拒絕」，網站無法自行覆寫 iOS 權限。員工需：

1. 點 Safari 網址列左側的頁面選單。
2. 在網站設定中將位置改為允許或詢問。
3. 若仍失敗，到「設定 → 隱私權與安全性 → 定位服務」，確認定位服務已開啟。
4. 進入 Safari 網站，選擇使用 App 期間並開啟精確位置。

前端已新增自動展開的 iPhone 定位修復區塊與「重新檢查定位」按鈕。只有定位成功後才能重新打卡；若裝置管控無法開啟定位，員工必須走未打卡原因與管理員補登流程，不提供略過 GPS 的打卡方式。

## 員工功能與 Firestore Rules 相容性修正

正式發布 Firestore Rules 後，「請假申請」原本直接讀取全部使用者作為職務代理人，「休假行事曆」原本直接讀取全部已核准請假與遲到紀錄；兩者均被新安全規則拒絕，造成頁面內容中途停止。

修正方式：

- 新增 `getEmployeeDirectory` Callable Function，只回傳同部門、啟用中員工的 ID、姓名與部門。
- 新增 `getTeamCalendar` Callable Function，只回傳可見部門的已核准假勤時間與遲到統計必要欄位。
- 不回傳 GPS、請假原因、Email、Passkey 或其他私人資料。
- 請假與行事曆頁面增加載入失敗降級處理，避免再次整頁空白。
- 正式以員工角色驗證，請假表單、職務代理人、個人紀錄、月份行事曆及遲到排名均正常，瀏覽器沒有權限錯誤。

## 後續操作手冊應包含

- Firebase Authentication、Firestore、Functions、Hosting 與 App Check 的設定方式
- reCAPTCHA Enterprise 網域允許清單
- 員工 Passkey 裝置申請與主管核准流程
- GPS 據點及外勤配置
- 未打卡原因填寫、主管審核與管理員補登
- iPhone、Android 與 Windows Hello 的測試清單
- 發布前檢查、回復方式及常見錯誤排除
