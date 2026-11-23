import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRevision, recordFields, clinicalPath } from "../src/clinical/forms.ts";

const encounterId = crypto.randomUUID();
const source = {
  id: crypto.randomUUID(),
  revision: 2,
  encounterId,
  kind: "lab",
  occurredAt: "2026-11-01T06:30:45.123Z",
  data: {
    test: "Specimen exam",
    specimen: "Slide",
    status: "RESULTED",
    result: "Measured finding",
    unit: "units",
  },
};
const form = (o) => {
  const result = new FormData();
  for (const [k, v] of Object.entries(o)) result.set(k, v);
  return result;
};
test("review keeps the reported values, encounter and original instant exactly", () => {
  const result = buildRevision(
    "lab",
    "review",
    form({
      changeReason: "Read and verified",
      test: "Changed",
      result: "Altered",
      occurredAt: "2000-01-01T00:00",
      encounterId: crypto.randomUUID(),
    }),
    "America/New_York",
    source,
  );
  assert.deepEqual(result, {
    kind: "lab",
    encounterId,
    revision: 2,
    changeReason: "Read and verified",
    occurredAt: source.occurredAt,
    data: { ...source.data, status: "REVIEWED" },
  });
});
test("corrected lab results require fresh review, preserve unchanged instants across DST, and omit cleared fields", () => {
  const row = { ...source, data: { ...source.data, status: "REVIEWED" } };
  assert.deepEqual(
    buildRevision(
      "lab",
      "result",
      form({
        test: "Repeat",
        result: "Second observation",
        changeReason: "Revised report",
        occurredAt: "2026-11-01T01:30:45.123",
      }),
      "America/New_York",
      row,
    ),
    {
      kind: "lab",
      encounterId,
      revision: 2,
      changeReason: "Revised report",
      occurredAt: source.occurredAt,
      data: {
        test: "Specimen exam",
        specimen: "Slide",
        result: "Second observation",
        status: "RESULTED",
      },
    },
  );
});
test("order, diagnosis, treatment and vaccination forms expose only their own fields", () => {
  assert.deepEqual(recordFields("lab", "new"), ["test", "specimen"]);
  const input = {
    encounterId,
    occurredAt: "2026-11-15T10:30",
    result: "unsubmitted",
    diagnosis: "Finding",
    status: "REVIEWED",
  };
  for (const [kind, values, data] of [
    ["lab", { test: "Test" }, { test: "Test", status: "ORDERED" }],
    ["diagnosis", { code: "A" }, { diagnosis: "Finding", code: "A" }],
    ["treatment", { treatment: "Recorded care" }, { treatment: "Recorded care" }],
    [
      "vaccination",
      { vaccine: "Product", lotNumber: "A-2", nextDueDate: "2027-01-25" },
      { vaccine: "Product", lotNumber: "A-2", nextDueDate: "2027-01-25" },
    ],
  ]) {
    assert.deepEqual(buildRevision(kind, "new", form({ ...input, ...values }), "UTC"), {
      kind,
      encounterId,
      occurredAt: "2026-11-15T10:30:00Z",
      revision: 0,
      data,
    });
  }
  assert.equal(
    buildRevision(
      "lab",
      "new",
      form({ ...input, occurredAt: "2026-03-08T02:30", test: "Test" }),
      "America/New_York",
    ),
    null,
  );
});
test("history URLs preserve page and time zone while excluding chart text", () => {
  assert.equal(
    clinicalPath("/patient", {
      page: 2,
      encounterPage: 3,
      recordId: source.id,
      historyPage: 2,
      timeZone: "UTC",
    }),
    `/patient/clinical-records?timeZone=UTC&page=2&encounterPage=3&recordId=${source.id}&historyPage=2`,
  );
});

test("the browser can shorten fractional seconds in a repeated local hour without changing the instant", () => {
  const row = { ...source, occurredAt: "2026-11-01T06:30:45.120Z" };
  const updated = buildRevision(
    "lab",
    "result",
    form({
      test: "Panel",
      result: "Corrected",
      occurredAt: "2026-11-01T01:30:45.12",
      changeReason: "Correction",
    }),
    "America/New_York",
    row,
  );
  assert.equal(updated.occurredAt, row.occurredAt);
});
