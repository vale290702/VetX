import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClinical, canRelease, clinicalSharing } from "../src/clinical-record-forms.ts";
import { createClinicalRecords } from "../src/clinical-record-client.ts";
import { createPatientTransport } from "../src/patient-transport.ts";
import { exportBody, toggleExportRecord } from "../src/exchange-forms.ts";
const stamp = "2026-04-01T17:20:21.123Z",
  encounterId = "enc",
  record = {
    id: "lab",
    revisionId: "v",
    encounterId,
    revision: 2,
    kind: "lab",
    occurredAt: stamp,
    data: {
      test: "CBC",
      specimen: "blood",
      status: "RESULTED",
      result: "5",
      unit: "g/L",
      referenceRange: "4–7",
    },
    sharing: { revision: 4, guardianIds: ["g", "old"] },
  };
test("lab orders, results, corrections and review remain distinct attributable revisions", () => {
  const create = buildClinical(
    "lab",
    "new",
    encounterId,
    stamp,
    { test: " CBC ", specimen: "blood", result: "unreviewed" },
    "",
  );
  assert.deepEqual(create, {
    kind: "lab",
    encounterId,
    occurredAt: stamp,
    revision: 0,
    data: { test: "CBC", specimen: "blood", status: "ORDERED" },
  });
  const order = { ...record, revision: 1, data: create.data };
  const resulted = buildClinical(
    "lab",
    "result",
    "ignored",
    stamp,
    { test: "ignored", result: "5", unit: "g/L", referenceRange: "4–7" },
    "measured",
    order,
  );
  assert.deepEqual(resulted, {
    kind: "lab",
    encounterId,
    occurredAt: stamp,
    revision: 1,
    changeReason: "measured",
    data: record.data,
  });
  const review = buildClinical(
    "lab",
    "review",
    "ignored",
    "2030-01-01T00:00:00Z",
    { result: "changed" },
    "verified",
    record,
  );
  assert.deepEqual(review, {
    kind: "lab",
    encounterId,
    occurredAt: stamp,
    revision: 2,
    changeReason: "verified",
    data: { ...record.data, status: "REVIEWED" },
  });
  assert.equal(buildClinical("lab", "review", "enc", stamp, {}, "verified", order), undefined);
  assert.equal(
    buildClinical("lab", "correct", "enc", stamp, { test: "different" }, "reason", record),
    undefined,
  );
  assert.equal(
    buildClinical("lab", "result", "enc", stamp, { result: "9" }, "", record),
    undefined,
  );
  assert.equal(canRelease(record), false);
  assert.equal(canRelease({ ...record, data: review.data }), true);
});
test("diagnoses, treatments, dates and revision-specific sharing stay within server limits", () => {
  assert.deepEqual(
    buildClinical("diagnosis", "new", encounterId, stamp, { diagnosis: " D ", code: " 01 " }, "")
      .data,
    { diagnosis: "D", code: "01" },
  );
  assert.deepEqual(
    buildClinical(
      "treatment",
      "new",
      encounterId,
      stamp,
      { treatment: " A\nB ", notes: "note" },
      "",
    ).data,
    { treatment: "A\nB", notes: "note" },
  );
  assert.equal(
    buildClinical(
      "vaccination",
      "new",
      encounterId,
      stamp,
      { vaccine: "V", nextDueDate: "2026-02-31" },
      "",
    ),
    undefined,
  );
  assert.equal(
    buildClinical("diagnosis", "new", encounterId, stamp, { diagnosis: "x".repeat(8001) }, ""),
    undefined,
  );
  const reviewed = { ...record, data: { ...record.data, status: "REVIEWED" } };
  assert.deepEqual(clinicalSharing(reviewed, [{ linked: true, id: "g" }], []), {
    guardianIds: ["old"],
    revision: 4,
    recordRevision: 2,
  });
  assert.equal(clinicalSharing(record, [{ linked: true, id: "g" }], []), undefined);
  assert.equal(clinicalSharing(reviewed, [{ linked: true, id: "g" }], ["g"]), undefined);
});
test("the encrypted export selects only requested immutable clinical version IDs", () => {
  const dest = { organizationId: "o2", clinicId: "c2" },
    source = { organizationId: "o", clinicId: "c", patientId: "p", destinations: [dest] };
  const selected = toggleExportRecord([{ id: "v1", kind: "encounter" }], {
    id: "v1",
    kind: "clinical",
  });
  assert.deepEqual(exportBody(source, dest, selected, false), {
    source: { organizationId: "o", clinicId: "c", patientId: "p" },
    destination: dest,
    encounterIds: ["v1"],
    documentAssetIds: [],
    clinicalRevisionIds: ["v1"],
    includeOwner: false,
  });
});
test("clinical chart, paged history, exact writes, sharing and owner reads bind to the verified identity", async () => {
  const calls = [],
    signal = new AbortController().signal,
    scope = { subject: "staff", organizationId: "org", clinicId: "c" };
  const s = {
    forOrganization: (sub, org, fn) => {
      assert.equal(sub, "staff");
      assert.equal(org, "org");
      return fn("staff-grant", signal);
    },
    forAccount: (sub, fn) => {
      assert.equal(sub, "guardian");
      return fn("owner-grant", signal);
    },
  };
  const c = createClinicalRecords(
    createPatientTransport(s, "https://vet.test", async (url, init) => {
      const r = new Request(url, init);
      assert.equal(init.signal, signal);
      assert.equal(init.redirect, "error");
      assert.equal(
        r.headers.get("Authorization"),
        url.includes("/owner/") ? "Bearer owner-grant" : "Bearer staff-grant",
      );
      calls.push(r);
      return Response.json({});
    }),
  );
  const b = buildClinical("diagnosis", "new", "e", stamp, { diagnosis: "D" }, "");
  await c.list(scope, "p", 2);
  await c.history(scope, "p", "r", 2);
  await c.save(scope, "p", "r", "request", b);
  await c.save(scope, "p", "r", "request", b);
  await c.share(scope, "p", "r", { guardianIds: ["g"], revision: 1, recordRevision: 3 });
  await c.released("guardian", "pet", 3);
  assert.deepEqual(
    calls.map(
      (r) =>
        r.method +
        " " +
        r.url
          .replace("https://vet.test", "")
          .replace("/organizations/org/clinics/c/patients/p", ""),
    ),
    [
      "GET /clinical-records?page=2",
      "GET /clinical-records/r/revisions?page=2",
      "PUT /clinical-records/r/revisions/request",
      "PUT /clinical-records/r/revisions/request",
      "PUT /clinical-records/r/sharing",
      "GET /owner/pets/pet/clinical-records?page=3",
    ],
  );
  assert.deepEqual(await calls[2].json(), await calls[3].json());
  assert.deepEqual(await calls[4].json(), { guardianIds: ["g"], revision: 1, recordRevision: 3 });
});
