"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/config");

test("production runtime defaults are safe and regionalized", () => {
  assert.equal(config.REGION, "asia-east1");
  assert.equal(config.TIME_ZONE, "Asia/Taipei");
  assert.equal(config.RP_ID, "workhub.cwli.dev");
  assert.deepEqual(config.EXPECTED_ORIGINS, [
    "https://workhub.cwli.dev"
  ]);
  assert.equal(config.CALLABLE_OPTIONS.minInstances, 0);
  assert.equal(config.CALLABLE_OPTIONS.enforceAppCheck, true);
  assert.equal(config.CHALLENGE_TTL_MS, 300000);
});
