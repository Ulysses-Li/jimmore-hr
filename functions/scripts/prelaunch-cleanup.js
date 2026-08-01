"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const {
  CONFIRMATION,
  CUTOVER_AT,
  DELETE_COLLECTIONS,
  PRESERVE_COLLECTIONS,
  PROJECT_ID,
  applyCleanup,
  buildCleanupSnapshot,
  employeeBalances
} = require("../src/lib/prelaunch-cleanup");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function balancesCsv(rows) {
  const headers = ["userId", "name", "email", "department", "annualLeaveHours", "compensatoryLeaveHours"];
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function stamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function writeBackup(snapshot) {
  const backupId = `jimmore-workhub-prelaunch-${stamp()}`;
  const directory = path.resolve(process.cwd(), ".prelaunch-backups", backupId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "firestore-backup.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(snapshot.manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(directory, "employee-leave-balances.csv"), `\uFEFF${balancesCsv(employeeBalances(snapshot))}\r\n`, "utf8");
  return { backupId, directory };
}

function printPreview(snapshot) {
  console.log(`專案：${PROJECT_ID}`);
  console.log(`正式上線界線：${CUTOVER_AT.toISOString()} (2026-08-03 00:00 Asia/Taipei)`);
  console.log("\n預計刪除：");
  DELETE_COLLECTIONS.forEach((name) => console.log(`  ${name}: ${snapshot.manifest[name].count}`));
  console.log("\n確認保留：");
  PRESERVE_COLLECTIONS.forEach((name) => console.log(`  ${name}: ${snapshot.manifest[name].count}`));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmation = argumentValue("--confirm");
  initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();
  const snapshot = await buildCleanupSnapshot(db);
  printPreview(snapshot);

  if (!apply) {
    console.log(`\n目前是 dry-run，沒有修改資料。正式執行：npm run prelaunch:apply -- --confirm "${CONFIRMATION}"`);
    return;
  }

  const backup = await writeBackup(snapshot);
  console.log(`\n備份已完成：${backup.directory}`);
  const result = await applyCleanup(db, snapshot, {
    projectId: PROJECT_ID,
    confirmation,
    now: new Date(),
    backupId: backup.backupId,
    serverTimestamp: () => FieldValue.serverTimestamp()
  });
  console.log("\n正式資料清理完成：");
  Object.entries(result.deleted).forEach(([name, count]) => console.log(`  ${name}: ${count}`));
  console.log(`上線起點稽核事件：${result.markerCreated ? "已建立" : "已存在"}`);
}

main().catch((error) => {
  console.error(`\n清理工具停止：${error.message}`);
  process.exitCode = 1;
});
