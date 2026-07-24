"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/config");

test("production runtime defaults are safe and regionalized", () => {
  assert.equal(config.REGION, "asia-east1");
  assert.equal(config.TIME_ZONE, "Asia/Taipei");
  assert.equal(config.RP_ID, "jimmore-workhub.web.app");
  assert.deepEqual(config.EXPECTED_ORIGINS, [
    "https://jimmore-workhub.web.app",
    "https://jimmore-workhub.firebaseapp.com"
  ]);
  assert.equal(config.CALLABLE_OPTIONS.minInstances, 0);
  assert.equal(config.CALLABLE_OPTIONS.enforceAppCheck, true);
  assert.equal(config.CHALLENGE_TTL_MS, 300000);
});
