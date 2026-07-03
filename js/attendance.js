import {
  addDoc,
  collection,
  doc,
  getDocs,
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
const workShifts = normalizeWorkShifts(settings);
const assignedShift = findShift(profile.defaultShiftId);

qs("#pageContent").innerHTML = `
  <div class="row g-3">
    <div class="col-lg-5">
      <div class="panel p-3">
        <h2 class="h5 mb-3">今日操作</h2>
        <div class="alert alert-info py-2 mb-3" id="attendanceHint">正在讀取今日狀態...</div>
        <div class="mb-3">
          <label class="form-label">今日班別</label>
          <div class="form-control bg-light" id="assignedShiftDisplay">
            ${assignedShift ? shiftText(assignedShift) : "尚未設定班別"}
          </div>
          ${assignedShift ? "" : `<div class="form-text text-danger">請管理員先到員工管理分配預設班別。</div>`}
        </div>
        <div class="small muted mb-3">
          打卡需要瀏覽器定位權限。若看到定位被拒絕，請點網址列左側圖示，將位置權限改為允許後重新整理。
        </div>
        <div class="d-grid gap-2">
          <button class="btn btn-success btn-lg" id="checkInBtn">上班簽到</button>
          <button class="btn btn-warning btn-lg" id="checkOutBtn">下班簽退</button>
        </div>
        <hr>
        <dl class="row mb-0">
          <dt class="col-5">班別</dt><dd class="col-7" id="shiftSummary">-</dd>
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
  const shift = getAssignedShift();
  if (type === "checkIn") {
    const start = timeToDate(dateKey, shift.workStart);
    start.setMinutes(start.getMinutes() + Number(settings.lateGraceMinutes || 0));
    return at > start ? "late" : "normal";
  }
  const end = timeToDate(dateKey, shift.workEnd);
  return at < end ? "earlyLeave" : "normal";
}

async function punch(type) {
  setPunching(true, type);
  try {
    const at = new Date();
    const pos = await getPosition();
    const shift = getAssignedShift();
    const status = resolveStatus(type, at);
    const record = {
      userId: profile.id,
      userName: profile.name,
      department: profile.department || "",
      type,
      shiftId: shift.id,
      shiftName: shift.name,
      workStart: shift.workStart,
      workEnd: shift.workEnd,
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
    showToast(`${type === "checkIn" ? "上班簽到" : "下班簽退"}完成`, "success");
    await render();
  } catch (error) {
    showToast(`打卡失敗：${friendlyPunchError(error)}`, "danger");
  } finally {
    setPunching(false, type);
  }
}

async function updateDaily(now) {
  const date = todayKey(now);
  const snap = await getDocs(query(
    collection(db, "attendance"),
    where("userId", "==", profile.id),
    where("date", "==", date)
  ));
  const records = snap.docs.map((item) => item.data()).sort(byTimestampAsc);
  const firstIn = records.find((item) => item.type === "checkIn");
  const lastOut = records.filter((item) => item.type === "checkOut").at(-1);
  if (!firstIn || !lastOut) return;
  const shift = findShift(firstIn.shiftId) || {
    id: firstIn.shiftId || "default",
    name: firstIn.shiftName || "預設班別",
    workStart: firstIn.workStart || settings.workStart,
    workEnd: firstIn.workEnd || settings.workEnd
  };

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
    shiftId: shift.id,
    shiftName: shift.name,
    workStart: shift.workStart,
    workEnd: shift.workEnd,
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
    where("date", "==", date)
  ));
  const rows = snap.docs.map((item) => item.data()).sort(byTimestampAsc).slice(0, 20);
  qs("#rows").innerHTML = rows.length
    ? rows.map((row) => `<tr>
      <td>${fmtDateTime(row.timestamp)}</td>
      <td>${row.type === "checkIn" ? "簽到" : "簽退"}</td>
      <td>${badge(row.status)}</td>
      <td>${mapLink(row.latitude, row.longitude)}</td>
    </tr>`).join("")
    : `<tr><td colspan="4" class="muted">今日尚無紀錄</td></tr>`;

  const firstIn = rows.find((item) => item.type === "checkIn");
  const lastOut = rows.filter((item) => item.type === "checkOut").at(-1);
  updateActionState(firstIn, lastOut);
  updateShiftSummary(firstIn);
  qs("#todaySummary").innerHTML = `
    <span class="me-3">簽到：${fmtTime(firstIn?.timestamp)}</span>
    <span>簽退：${fmtTime(lastOut?.timestamp)}</span>`;
}

function normalizeWorkShifts(value) {
  if (Array.isArray(value.workShifts) && value.workShifts.length) return value.workShifts;
  return [
    { id: "shift_0900", name: "日班 09:00", workStart: value.workStart || "09:00", workEnd: value.workEnd || "18:00" }
  ];
}

function getSelectedShift() {
  return getAssignedShift();
}

function findShift(id) {
  return workShifts.find((shift) => shift.id === id);
}

function getAssignedShift() {
  const shift = findShift(profile.defaultShiftId);
  if (!shift) throw new Error("尚未分配班別，請聯絡管理員設定。");
  return shift;
}

function updateShiftSummary(firstIn) {
  const selected = firstIn
    ? findShift(firstIn.shiftId) || {
      name: firstIn.shiftName || "今日簽到班別",
      workStart: firstIn.workStart || settings.workStart,
      workEnd: firstIn.workEnd || settings.workEnd
    }
    : assignedShift;
  qs("#shiftSummary").textContent = selected ? shiftText(selected) : "尚未設定班別";
}

function updateActionState(firstIn, lastOut) {
  const hint = qs("#attendanceHint");
  const checkInBtn = qs("#checkInBtn");
  const checkOutBtn = qs("#checkOutBtn");

  checkInBtn.classList.toggle("btn-success", !firstIn);
  checkInBtn.classList.toggle("btn-outline-success", Boolean(firstIn));
  checkOutBtn.classList.toggle("btn-warning", Boolean(firstIn && !lastOut));
  checkOutBtn.classList.toggle("btn-outline-warning", !firstIn || Boolean(lastOut));

  if (!assignedShift) {
    hint.className = "alert alert-warning py-2 mb-3";
    hint.textContent = "尚未分配班別，請管理員先到員工管理設定。";
    checkInBtn.disabled = true;
    checkOutBtn.disabled = true;
    return;
  }

  if (!firstIn) {
    hint.className = "alert alert-info py-2 mb-3";
    hint.textContent = "今日尚未簽到。請先按「上班簽到」。";
    return;
  }
  if (!lastOut) {
    hint.className = "alert alert-success py-2 mb-3";
    hint.textContent = `今日已於 ${fmtTime(firstIn.timestamp)} 簽到。下班時請按「下班簽退」。`;
    return;
  }
  hint.className = "alert alert-secondary py-2 mb-3";
  hint.textContent = `今日已完成：簽到 ${fmtTime(firstIn.timestamp)}，簽退 ${fmtTime(lastOut.timestamp)}。`;
}

function setPunching(isPunching, type) {
  const checkInBtn = qs("#checkInBtn");
  const checkOutBtn = qs("#checkOutBtn");
  checkInBtn.disabled = isPunching;
  checkOutBtn.disabled = isPunching;
  if (isPunching) {
    const label = type === "checkIn" ? "正在取得定位並簽到..." : "正在取得定位並簽退...";
    (type === "checkIn" ? checkInBtn : checkOutBtn).textContent = label;
    return;
  }
  checkInBtn.textContent = "上班簽到";
  checkOutBtn.textContent = "下班簽退";
}

function friendlyPunchError(error) {
  if (error?.code === 1 || /denied geolocation/i.test(error?.message || "")) {
    return "定位權限被拒絕。請點網址列左側圖示，允許位置權限後再試一次。";
  }
  if (error?.code === 2) return "目前無法取得定位，請確認定位服務已開啟。";
  if (error?.code === 3) return "取得定位逾時，請稍後再試。";
  return error?.message || "未知錯誤";
}

function mapLink(latitude, longitude) {
  if (typeof latitude !== "number" || typeof longitude !== "number") return "-";
  const label = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  const url = `https://www.google.com/maps?q=${latitude},${longitude}`;
  return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
}

function shiftText(shift) {
  return `${shift.name}（${shift.workStart} - ${shift.workEnd}）`;
}

function byTimestampAsc(a, b) {
  return toMillis(a.timestamp) - toMillis(b.timestamp);
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime();
}

qs("#checkInBtn").addEventListener("click", () => punch("checkIn"));
qs("#checkOutBtn").addEventListener("click", () => punch("checkOut"));
await render();
