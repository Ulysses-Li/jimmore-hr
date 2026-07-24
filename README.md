# Jimmore HR 人事出勤管理平台

Jimmore 的 Web 人事出勤平台。前端原始碼由 GitHub 管理，日常修改使用 VS Code Live Server，正式前端使用 GitHub Pages 與 `workhub.cwli.dev`。Firebase 只提供 Authentication、Firestore 與 Cloud Functions 後端服務。

## 功能範圍

- Email / Password 登入與員工帳號建立
- 角色導向頁面：employee、manager、admin
- Passkey 生物辨識 + GPS 簽到 / 簽退
- 遲到、早退、工時不足與滿 8 小時判定
- 請假申請與審核
- 加班申請與審核，核准後可轉補休
- 休假行事曆
- 員工管理、出勤報表、系統工時設定
- 未打卡異常、主管審核、外勤配置與不可變稽核
- 管理員高權限操作全部經 Cloud Functions 執行

## 假別

目前內建假別包含：特休、補休、事假、普通傷病假、公傷病假、公假、婚假、喪假、生理假、產假、產檢假、陪產檢及陪產假、家庭照顧假、育嬰留職停薪、安胎休養。

假別名稱主要參考全國法規資料庫的《勞工請假規則》與《性別平等工作法》。實際給假日數、薪資與證明文件規則仍應依最新法規與公司規章設定。

## 專案結構

```text
jimmore-hr/
  index.html
  login.html
  dashboard.html
  attendance.html
  leave.html
  overtime.html
  calendar.html
  profile.html
  admin/
    index.html
    employees.html
    attendance.html
    leave.html
    overtime.html
    settings.html
  css/style.css
  js/
    firebase-config.js
    vendor.js
    platform/
    services/
    app.js
    auth.js
    attendance.js
    leave.js
    overtime.js
    calendar.js
    admin.js
  functions/
    src/
      index.js
      core.js
      lib/security-runtime.js
      lib/admin-service.js
  vite.config.js
  firebase.json
```

## Firebase 設定

1. 建立 Firebase 專案。
2. 啟用 Authentication 的 Email/Password provider。
3. 啟用 Firestore Database。
4. 將 Firebase Web App 設定貼到 `js/firebase-config.js`。
5. 升級 Blaze 後部署 Functions，並設定 App Check 與正式 WebAuthn 網域。
6. 建立第一個帳號後，到 Firestore 的 `users/{uid}` 將 `role` 改成 `admin`。

## Firestore Collections

- `users`
- `attendance`
- `attendanceDaily`
- `leaveRequests`
- `overtimeRequests`
- `workSettings/default`
- `attendanceExceptions`
- `passkeyEnrollmentRequests`
- `passkeyCredentials`
- `workSites`
- `fieldAssignments`
- `auditEvents`

`workSettings/default` 若不存在，前端會使用安全預設值顯示；只有管理員透過 Functions 儲存時才會建立文件。

## 本機執行

### 日常前端修改（優先方式）

1. 用 VS Code 開啟 `jimmore-hr` 資料夾。
2. 開啟 `login.html`。
3. 按右下角 **Go Live**，或在檔案上按右鍵選 **Open with Live Server**。
4. 修改 HTML、CSS 或 JavaScript 後，瀏覽器會自動重新整理。

若 VS Code 開啟的是上一層 `WorkHub` 資料夾，網址會是：

```text
http://127.0.0.1:5500/jimmore-hr/login.html
```

Live Server 可測試一般畫面、登入與 Firestore 資料。需要 App Check、Passkey 或受保護 Cloud Functions 的功能時，請使用 Firebase Emulator，或到正式測試網址驗證。

### 定版檢查

準備正式版本時執行：

```powershell
npm install
npm run check
```

## 部署

### 前端：GitHub Pages

前端直接使用儲存庫中的 HTML、CSS、JavaScript 與 `CNAME`。推送到 GitHub 的發布分支後，由 GitHub Pages 更新 `workhub.cwli.dev`。

### 後端：Firebase

只有 Firestore Rules、Indexes 或 Cloud Functions 有修改時才部署：

```powershell
npx firebase-tools deploy --only functions,firestore:rules,firestore:indexes
```

專案不使用 Firebase Hosting。完整後端上線順序與安全檢查請見 `SECURITY_DEPLOYMENT.md`。
