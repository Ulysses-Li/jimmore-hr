import { callSecureFunction } from "../app.js";

export async function submitPunch(type, location) {
  return callSecureFunction("punch", {
    type,
    location,
    deviceInfo: navigator.userAgent
  });
}
