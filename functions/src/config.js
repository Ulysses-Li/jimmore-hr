"use strict";

const REGION = process.env.FUNCTIONS_REGION || "asia-east1";
const TIME_ZONE = process.env.TIME_ZONE || "Asia/Taipei";

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
  REGION,
  TIME_ZONE
};
