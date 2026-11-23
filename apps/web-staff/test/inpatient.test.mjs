import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleRecordFields } from "../src/exchange/forms.ts";
import { buildRevision } from "../src/clinical/forms.ts";
import { workflowActions, terminalStatus } from "../src/clinical/workflows.ts";
const encounterId = crypto.randomUUID(),
  at = "2026-11-01T06:30:45.120Z";
const form = (values) => {
  const f = new FormData();
  for (const [key, value] of Object.entries(values)) f.set(key, value);
  return f;
};
const version = (kind, data) => ({ kind, encounterId, occurredAt: at, revision: 3, data });
const write = (current, action, values = {}) =>
  buildRevision(
    current.kind,
    action,
    form({ changeReason: "Chart update", occurredAt: "2026-11-01T02:00", ...values }),
    "America/New_York",
    current,
  );
test("hospitalization notes stay internal until discharge and a correction keeps its original event time", () => {
  const admit = buildRevision(
    "hospitalization",
    "new",
    form({
      encounterId,
      occurredAt: "2026-11-01T09:00",
      ward: "Ward A",
      location: "101",
      note: "Admission note",
      status: "DISCHARGED",
      summary: "Dropped",
    }),
    "UTC",
  );
  assert.deepEqual(admit.data, {
    ward: "Ward A",
    location: "101",
    note: "Admission note",
    status: "ADMITTED",
  });
  const active = version("hospitalization", admit.data);
  assert.deepEqual(workflowActions(active.kind, active.data.status), ["progress", "discharge"]);
  assert.equal(terminalStatus(active.data.status), false);
  assert.equal(
    write(active, "progress", { ward: "B", note: "Progress", occurredAt: "2026-10-01T10:00" }),
    null,
  );
  const current = write(active, "progress", {
    ward: "Ward B",
    location: "102",
    note: "Progress",
    summary: "Ignored",
  });
  assert.deepEqual(current.data, {
    status: "PROGRESS",
    ward: "Ward B",
    location: "102",
    note: "Progress",
  });
  assert.equal(write(active, "discharge", { ward: "B", note: "Staff note" }), null);
  const closed = write(active, "discharge", {
    ward: "B",
    note: "Staff note",
    summary: "Guardian summary",
  });
  assert.deepEqual(closed.data, {
    status: "DISCHARGED",
    ward: "B",
    note: "Staff note",
    summary: "Guardian summary",
  });
  const terminal = version("hospitalization", closed.data);
  assert.deepEqual(workflowActions(terminal.kind, terminal.data.status), ["amend"]);
  assert.equal(write(terminal, "progress", { ward: "B", note: "Forged" }), null);
  assert.equal(
    write(terminal, "amend", {
      ward: "B",
      note: "Corrected",
      summary: "Revised",
      occurredAt: "1900-01-01T00:00",
    }).occurredAt,
    at,
  );
});
test("planned surgery supports rescheduling; start, complete and cancellation preserve the stored plan and exact schedule", () => {
  const planned = version("surgery", {
    status: "PLANNED",
    procedure: "Scheduled procedure",
    scheduledAt: at,
    notes: "Staff plan",
  });
  assert.deepEqual(workflowActions(planned.kind, planned.data.status), [
    "reschedule",
    "startSurgery",
    "cancelSurgery",
  ]);
  assert.equal(
    write(planned, "reschedule", {
      procedure: "Amended plan",
      scheduledAt: "2026-11-01T01:30:45.12",
    }).data.scheduledAt,
    at,
  );
  const started = write(planned, "startSurgery", {
    procedure: "Spoof",
    scheduledAt: "1900-01-01T00:00",
    notes: "Started",
    summary: "Ignored",
  });
  assert.deepEqual(started.data, {
    procedure: "Scheduled procedure",
    scheduledAt: at,
    status: "IN_PROGRESS",
    notes: "Started",
  });
  const active = version("surgery", started.data);
  assert.equal(
    write(active, "reschedule", { procedure: "Spoof", scheduledAt: "2028-05-01T12:00" }),
    null,
  );
  assert.equal(
    write(active, "completeSurgery", {
      performedProcedure: "Completed plan",
      summary: "Guardian summary",
    }),
    null,
  );
  const finished = write(active, "completeSurgery", {
    performedProcedure: "Completed plan",
    recoveryNotes: "Staff recovery",
    summary: "Guardian summary",
  });
  assert.deepEqual(finished.data, {
    procedure: "Scheduled procedure",
    scheduledAt: at,
    status: "COMPLETED",
    performedProcedure: "Completed plan",
    recoveryNotes: "Staff recovery",
    summary: "Guardian summary",
  });
  const cancelled = write(planned, "cancelSurgery", {
    performedProcedure: "Excluded",
    recoveryNotes: "Excluded",
    notes: "Private",
    summary: "Cancelled",
  });
  assert.deepEqual(cancelled.data, {
    procedure: "Scheduled procedure",
    scheduledAt: at,
    status: "CANCELLED",
    notes: "Private",
    summary: "Cancelled",
  });
  assert.deepEqual(workflowActions("surgery", "COMPLETED"), ["amend"]);
  assert.equal(
    write(version("surgery", cancelled.data), "amend", {
      notes: "Private",
      summary: "Adjusted",
      occurredAt: "1900-01-01T00:00",
    }).occurredAt,
    at,
  );
});

test("imported hospital and surgery entries show only the permitted terminal status and guardian summary", () => {
  for (const [kind, status] of [
    ["hospitalization", "DISCHARGED"],
    ["surgery", "CANCELLED"],
    ["surgery", "COMPLETED"],
  ]) {
    const raw = {
      status,
      ward: "Private",
      procedure: "Private",
      notes: "Private",
      recoveryNotes: "Private",
      summary: "Released summary",
    };
    assert.deepEqual(visibleRecordFields(raw, kind), [
      ["status", status],
      ["summary", "Released summary"],
    ]);
    assert.deepEqual(visibleRecordFields({ ...raw, status: "PLANNED" }, kind), []);
  }
});
