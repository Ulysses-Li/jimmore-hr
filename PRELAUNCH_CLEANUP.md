# 2026-08-03 正式上線資料清理

這個工具只供 `jimmore-workhub` 在 2026-08-03 00:00（Asia/Taipei）正式上線前使用。它不會刪除 Firebase Authentication 帳號，也不會修改員工假別餘額。

## 保留與清除範圍

- 保留：`users`、`workSettings`、`workSites`、`fieldAssignments`。
- 清除：`attendance`、`attendanceDaily`、`attendanceExceptions`、`leaveRequests`、`overtimeRequests`、`punchGuards`、`rateLimits`。
- 清除舊功能資料：`passkeyCredentials`、`passkeyEnrollmentRequests`、`securityChallenges`。
- 清除既有 `auditEvents`，完成後只建立一筆正式上線起點事件。

## 操作順序

請先讓執行環境具備 Firebase Admin 的 Application Default Credentials，並在 `functions` 目錄執行。

```powershell
npm run prelaunch:preview
```

預覽只會讀取並顯示各集合筆數，不會寫入或刪除資料。確認數量後才執行：

```powershell
npm run prelaunch:apply -- --confirm "DELETE jimmore-workhub BEFORE 2026-08-03"
```

正式清除前會自動建立：

- `firestore-backup.json`：待刪資料與保留設定的完整快照。
- `manifest.json`：各集合的文件數與 SHA-256。
- `employee-leave-balances.csv`：逐員特休與補休餘額。

檔案會存放於 `functions/.prelaunch-backups/`，此目錄已排除於 Git。請將整個備份目錄另外複製到受控、安全的位置。

## 安全限制

- 專案 ID、確認字串任一不符即停止。
- 到達正式上線時間後，即使確認字串正確也拒絕刪除。
- 備份寫入成功前不會開始刪除。
- 完成後會重新讀取所有清除與保留集合，筆數不符即報錯。
- 重複執行不會重複建立上線起點事件。

正式資料不會由安裝或部署自動清除；必須由管理者手動執行上述命令。
