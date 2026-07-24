"use strict";

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

const REGION = process.env.FUNCTIONS_REGION || "asia-east1";
const TIME_ZONE = process.env.TIME_ZONE || "Asia/Taipei";
const RP_ID = process.env.WEBAUTHN_RP_ID || "jimmore-workhub.web.app";
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "Jimmore WorkHub";
const EXPECTED_ORIGINS = csv(process.env.WEBAUTHN_ORIGINS
  || "https://jimmore-workhub.web.app,https://jimmore-workhub.firebaseapp.com");
const CHALLENGE_TTL_MS = Number(process.env.CHALLENGE_TTL_SECONDS || 300) * 1000;

if (!EXPECTED_ORIGINS.length) {
  throw new Error("WEBAUTHN_ORIGINS 至少需要一個 HTTPS 網址。");
}

const CALLABLE_OPTIONS = Object.freeze({
  region: REGION,
  minInstances: 0,
  memory: "256MiB",
  timeoutSeconds: 30,
  enforceAppCheck: process.env.APP_CHECK_ENFORCEMENT !== "false",
  cors: true
});

module.exports = {
  CALLABLE_OPTIONS,
  CHALLENGE_TTL_MS,
  EXPECTED_ORIGINS,
  REGION,
  RP_ID,
  RP_NAME,
  TIME_ZONE
};
