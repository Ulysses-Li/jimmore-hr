const DEFAULT_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 0
});

export async function acquirePunchLocation(options = {}) {
  if (!window.isSecureContext) {
    throw new Error("定位與 Passkey 只能在 HTTPS 或 localhost 安全環境使用。");
  }
  if (!navigator.geolocation) {
    throw new Error("此瀏覽器不支援 GPS 定位。");
  }

  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      ...DEFAULT_OPTIONS,
      ...options
    });
  }).catch((error) => {
    const messages = {
      1: "定位權限被拒絕，請在網址列的網站權限中允許位置。",
      2: "目前無法取得定位，請開啟裝置定位服務後重試。",
      3: "取得定位逾時，請移到較空曠處或確認網路後重試。"
    };
    const locationError = new Error(messages[error?.code] || "取得定位失敗，請稍後再試。");
    locationError.code = Number(error?.code || 0);
    throw locationError;
  });

  return Object.freeze({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    capturedAt: new Date(position.timestamp).toISOString()
  });
}
