import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClinical, canRelease } from "../src/clinical-record-forms.ts";
import { localMinute } from "../src/care-time.ts";

const stamp = "2026-04-01T17:20:21.123Z";
const version = (kind, data) => ({
  kind,
  data,
  revision: 3,
  encounterId: "enc",
  occurredAt: stamp,
});
const write = (r, op, values, time = stamp) =>
  buildClinical(r.kind, op, "other", time, values, "Reason", r);
test("admission and progress stay private, discharge requires a fresh signed summary and terminal corrections retain their timestamp", () => {
  const admit = buildClinical(
    "hospitalization",
    "new",
    "enc",
    stamp,
    { ward: " Ward A ", note: "Internal", summary: "Hidden" },
    "",
  );
  assert.deepEqual(admit.data, { status: "ADMITTED", ward: "Ward A", note: "Internal" });
  const r = version(admit.kind, admit.data),
    fields = { ward: "Ward B", location: "Bay A", note: "Round", summary: "Home" };
  assert.equal(canRelease(r), false);
  assert.equal(write(r, "progress", fields, "2026-01-01T00:00:00Z"), undefined);
  assert.deepEqual(write(r, "progress", fields).data, {
    status: "PROGRESS",
    ward: "Ward B",
    location: "Bay A",
    note: "Round",
  });
  assert.equal(write(r, "discharge", { ...fields, summary: " " }), undefined);
  const discharged = version(r.kind, write(r, "discharge", fields).data);
  assert.equal(canRelease(discharged), true);
  assert.equal(write(discharged, "progress", fields), undefined);
  assert.equal(write(discharged, "amend", fields, "2027-01-01T00:00:00Z").occurredAt, stamp);
  assert.equal(write(discharged, "amend", { ...fields, ward: "x".repeat(121) }), undefined);
});
test("surgical transitions pin the plan and schedule, require recovery on completion and omit recovery fields on cancellation", () => {
  const scheduledAt = "2026-04-02T21:12:58.599Z";
  const planned = version("surgery", { status: "PLANNED", procedure: "Plan A", scheduledAt });
  const notes = {
    procedure: "Edited",
    scheduledAt: localMinute(new Date(scheduledAt)),
    notes: "Private",
    performedProcedure: "Recorded procedure",
    recoveryNotes: "Recovery",
    summary: "Public",
  };
  assert.equal(write(planned, "complete", notes), undefined);
  assert.equal(
    write(planned, "reschedule", { ...notes, scheduledAt: "2026-02-31 12:00" }),
    undefined,
  );
  assert.deepEqual(write(planned, "reschedule", notes).data, {
    status: "PLANNED",
    procedure: "Edited",
    scheduledAt,
    notes: "Private",
  });
  const started = version("surgery", write(planned, "start", notes).data);
  assert.deepEqual(started.data, {
    status: "IN_PROGRESS",
    procedure: "Plan A",
    scheduledAt,
    notes: "Private",
  });
  assert.equal(canRelease(started), false);
  assert.equal(write(started, "complete", { ...notes, recoveryNotes: "" }), undefined);
  const completed = write(started, "complete", notes);
  assert.equal(completed.data.performedProcedure, "Recorded procedure");
  assert.equal(completed.data.recoveryNotes, "Recovery");
  assert.equal(canRelease(version("surgery", completed.data)), true);
  const cancelled = write(planned, "cancel", notes);
  assert.deepEqual(cancelled.data, {
    status: "CANCELLED",
    procedure: "Plan A",
    scheduledAt,
    notes: "Private",
    summary: "Public",
  });
  assert.equal(canRelease(version("surgery", cancelled.data)), true);
  assert.equal(buildClinical("surgery", "cancel", "enc", stamp, notes, "", planned), undefined);
});
