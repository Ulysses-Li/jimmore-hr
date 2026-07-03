import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  db,
  requireAuth,
  bindLogout,
  pageChrome,
  qs,
  badge,
  fmtDateTime,
  fmtTime,
  todayKey,
  getWorkSettings,
  timeToDate,
  hoursBetween,
  showToast
} from "./app.js";

document.body.innerHTML = `<div class="app-shell d-flex">${pageChrome("出勤打卡", "GPS 簽到簽退與每日工時判定")}</div>`;
const profile = await requireAuth();
bindLogout();
const settings = await getWorkSettings();

qs("#pageContent").innerHTML = `
  <div class="row g-3">
    <div class="col-lg-5">
      <div class="panel p-3">
        <h2 class="h5 mb-3">今日操作</h2>
        <div class="d-grid gap-2">
          <button class="btn btn-primary btn-lg" id="checkInBtn">簽到</button>
          <button class="btn btn-outline-primary btn-lg" id="checkOutBtn">簽退</button>
        </div>
        <hr>
        <dl class="row mb-0">
          <dt class="col-5">上班時間</dt><dd class="col-7">${settings.workStart}</dd>
          <dt class="col-5">下班時間</dt><dd class="col-7">${settings.workEnd}</dd>
          <dt class="col-5">午休扣除</dt><dd class="col-7">${settings.lunchStart} - ${settings.lunchEnd}</dd>
          <dt class="col-5">標準工時</dt><dd class="col-7">${settings.standardHours} 小時</dd>
        </dl>
      </div>
    </div>
    <div class="col-lg-7">
      <div class="panel p-3">
        <h2 class="h5 mb-3">今日紀錄</h2>
        <div id="todaySummary" class="mb-3 muted">載入中...</div>
        <div class="table-responsive">
          <table class="table align-middle mb-0">
            <thead><tr><th>時間</th><th>類型</th><th>狀態</th><th>GPS</th></tr></thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;

async function getPosition() {
  if (!navigator.geolocation) throw new Error("此瀏覽器不支援 Geolocation");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    });
  });
}

function resolveStatus(type, at) {
  const dateKey = todayKey(at);
  if (type === "checkIn") {
    const start = timeToDate(dateKey, settings.workStart);
    start.setMinutes(start.getMinutes() + Number(settings.lateGraceMinutes || 0));
    return at > start ? "late" : "normal";
  }
  const end = timeToDate(dateKey, settings.workEnd);
  return at < end ? "earlyLeave" : "normal";
}

async function punch(type) {
  try {
    const at = new Date();
    const pos = await getPosition();
    const status = resolveStatus(type, at);
    const record = {
      userId: profile.id,
      userName: profile.name,
      department: profile.department || "",
      type,
      timestamp: at,
      date: todayKey(at),
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      status,
      deviceInfo: navigator.userAgent,
      createdAt: serverTimestamp()
    };
    await addDoc(collection(db, "attendance"), record);
    if (type === "checkOut") await updateDaily(at);
    showToast(`${type === "checkIn" ? "簽到" : "簽退"}完成`, "success");
    await render();
  } catch (error) {
    showToast(`打卡失敗：${error.message}`, "danger");
  }
}

async function updateDaily(now) {
  const date = todayKey(now);
  const snap = await getDocs(query(
    collection(db, "attendance"),
    where("userId", "==", profile.id),
    where("date", "==", date),
    orderBy("timestamp", "asc")
  ));
  const records = snap.docs.map((item) => item.data());
  const firstIn = records.find((item) => item.type === "checkIn");
  const lastOut = records.filter((item) => item.type === "checkOut").at(-1);
  if (!firstIn || !lastOut) return;

  const lunchHours = hoursBetween(timeToDate(date, settings.lunchStart), timeToDate(date, settings.lunchEnd));
  const total = Math.max(0, hoursBetween(firstIn.timestamp.toDate ? firstIn.timestamp.toDate() : firstIn.timestamp, lastOut.timestamp.toDate ? lastOut.timestamp.toDate() : lastOut.timestamp) - lunchHours);
  const reached = total >= Number(settings.standardHours || 8);
  const dailyStatus = lastOut.status === "earlyLeave"
    ? "earlyLeave"
    : reached
      ? (firstIn.status === "late" ? "late" : "normal")
      : "workTimeNotEnough";

  await setDoc(doc(db, "attendanceDaily", `${date}_${profile.id}`), {
    userId: profile.id,
    userName: profile.name,
    department: profile.department || "",
    date,
    checkInTime: firstIn.timestamp,
    checkOutTime: lastOut.timestamp,
    totalWorkHours: Number(total.toFixed(2)),
    lunchDeductHours: Number(lunchHours.toFixed(2)),
    status: dailyStatus,
    isEightHoursReached: reached,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function render() {
  const date = todayKey();
  const snap = await getDocs(query(
    collection(db, "attendance"),
    where("userId", "==", profile.id),
    where("date", "==", date),
    orderBy("timestamp", "asc"),
    limit(20)
  ));
  const rows = snap.docs.map((item) => item.data());
  qs("#rows").innerHTML = rows.length
    ? rows.map((row) => `<tr>
      <td>${fmtDateTime(row.timestamp)}</td>
      <td>${row.type === "checkIn" ? "簽到" : "簽退"}</td>
      <td>${badge(row.status)}</td>
      <td>${row.latitude?.toFixed?.(5) || "-"}, ${row.longitude?.toFixed?.(5) || "-"}</td>
    </tr>`).join("")
    : `<tr><td colspan="4" class="muted">今日尚無紀錄</td></tr>`;

  const firstIn = rows.find((item) => item.type === "checkIn");
  const lastOut = rows.filter((item) => item.type === "checkOut").at(-1);
  qs("#todaySummary").innerHTML = `
    <span class="me-3">簽到：${fmtTime(firstIn?.timestamp)}</span>
    <span>簽退：${fmtTime(lastOut?.timestamp)}</span>`;
}

qs("#checkInBtn").addEventListener("click", () => punch("checkIn"));
qs("#checkOutBtn").addEventListener("click", () => punch("checkOut"));
await render();
