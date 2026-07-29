# Jimmore WorkHub 商品化架構

## 產品邊界

目前版本是「單一公司、單一 Firebase 專案」的安全出勤版本。程式已將品牌設定、Firebase 平台層、瀏覽器服務層、Cloud Functions 共用安全層與純計算核心拆開，方便未來換品牌、網域或新增模組。

這不是完整 SaaS 多租戶版本。若要讓不同客戶共用同一 Firebase 專案，必須先加入 `tenantId`、租戶成員關係、每份文件的租戶隔離 Rules、租戶級索引與計費/保留政策；在這些隔離完成前，應採「每客戶一個 Firebase 專案」部署，風險最低。

## 模組

```text
js/
  firebase-config.js              # Firebase、App Check、產品公開設定
  platform/firebase-client.js     # Auth / Firestore / Functions / App Check 初始化
  services/functions-client.js    # Callable API、錯誤正規化、連線逾時
  services/geolocation-service.js # 安全環境、GPS 權限與精度資料
  services/attendance-service.js  # 經 Cloud Functions 執行打卡
  app.js                          # UI 共用工具與舊版相容匯出

functions/src/
  config.js                       # 地區、時區與 App Check 策略
  core.js                         # 無 Firebase 相依的日期/GPS/工時計算
  lib/security-runtime.js         # 身分、角色、速率限制與稽核
  lib/admin-service.js            # 員工、審核、作廢假單、班別設定
  index.js                        # 出勤、異常、據點與排程端點
```

## 安全不變條件

- 瀏覽器不得直接寫入出勤、每日彙總、異常案件、稽核、審核結果、假別餘額與班別設定。
- 所有打卡時間由伺服器產生；前端時間只用於顯示與提早提示。
- 每次簽到、簽退都必須通過 Firebase Auth、App Check、GPS/外勤範圍與打卡順序。
- 系統不再要求 Passkey 或裝置生物辨識；帳密外流或共用裝置會提高代打卡風險。
- 管理員補登必須留下原因、操作者與原始異常案件關聯。
- 公開 Firebase Web Config 與 reCAPTCHA Site Key 不是秘密；服務帳號、Debug Token、私鑰不可提交版本控制。

## 商品化演進建議

1. **每客戶獨立專案**：先以部署參數產生品牌與 Firebase config。
2. **版本化資料模型**：以 `productConfig.schemaVersion` 控制遷移；部署前備份 Firestore。
3. **模組開關**：將出勤、請假、加班、薪資做成 feature flags，但後端仍須逐端點授權。
4. **租戶化**：若改為共享專案，所有路徑與查詢先加入 tenant scope，再撰寫跨租戶拒絕測試。
5. **營運能力**：加入錯誤告警、稽核匯出、資料保留政策、客戶備份/刪除程序及服務條款。

## 發行閘門

- `npm --prefix functions test`
- Firestore Emulator Rules 測試全部通過
- 測試環境完成據點內打卡、據點外拒絕、外勤與補登
- App Check 指標已有驗證流量後，才對 Firestore / Authentication 分階段強制
- 正式網域 HTTPS、Blaze、預算警示、備份與復原演練完成
