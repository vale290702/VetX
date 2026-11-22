import assert from "node:assert/strict";
import { test } from "node:test";
import { dayRange, localMinute, minuteInstant, moveDay } from "../src/care-time.ts";

test("native input rejects rollover and missing wall times; unchanged repeated times retain their original instant", () => {
  process.env.TZ = "America/New_York";
  for (const input of [
    "",
    "2025-02-29 08:30",
    "2026-03-08 02:30",
    "2026-11-01 26:10",
    "0000-01-01 11:00",
  ]) {
    assert.equal(minuteInstant(input), undefined, input);
  }
  assert.equal(minuteInstant("2026-11-01 01:30"), undefined);
  const late = "2026-11-01T06:30:15.000Z";
  assert.equal(localMinute(new Date(late)), "2026-11-01 01:30");
  assert.equal(minuteInstant("2026-11-01 01:30", late), late);
  assert.equal(minuteInstant("2026-07-01 12:35"), "2026-07-01T16:35:00.000Z");
});
test("calendar day bounds use local midnights through time and month changes", () => {
  process.env.TZ = "America/New_York";
  assert.deepEqual(dayRange("2026-03-08"), {
    from: "2026-03-08T05:00:00.000Z",
    to: "2026-03-09T04:00:00.000Z",
  });
  assert.equal(dayRange("2026-02-31"), undefined);
  assert.equal(dayRange("9999-12-31"), undefined);
  assert.equal(moveDay("2026-12-31", 1), "2027-01-01");
  assert.equal(moveDay("2026-11-01", -1), "2026-10-31");
});
