import assert from "node:assert/strict";
import { test } from "node:test";
import { startCodeExpiry } from "../src/code-expiry.ts";

test("clears once on expiry even for a lifetime beyond the native timer limit", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const limit = 2_147_483_647;
  let cleared = 0;
  const watch = startCodeExpiry(new Date(limit + 10).toISOString(), () => cleared++);
  t.mock.timers.tick(limit);
  assert.equal(cleared, 0);
  t.mock.timers.tick(10);
  assert.equal(cleared, 1);
  watch.check();
  assert.equal(cleared, 1);
});

test("foreground recheck clears a code when the OS suspended the expiry timer", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  let cleared = 0;
  const watch = startCodeExpiry(new Date(100).toISOString(), () => cleared++);
  t.mock.timers.setTime(200);
  watch.check();
  assert.equal(cleared, 1);
  t.mock.timers.tick(100);
  assert.equal(cleared, 1);
});

test("dismissal stops a previous timer and expired or invalid responses clear immediately", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  let cleared = 0;
  const watch = startCodeExpiry(new Date(200).toISOString(), () => cleared++);
  watch.stop();
  t.mock.timers.tick(200);
  watch.check();
  assert.equal(cleared, 0);
  startCodeExpiry(new Date(100).toISOString(), () => cleared++);
  startCodeExpiry("invalid", () => cleared++);
  assert.equal(cleared, 2);
});
