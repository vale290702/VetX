import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import clinical from "../../i18n/locales/native-clinical.en.json" with { type: "json" };
import care from "../../i18n/locales/native-care.en.json" with { type: "json" };
import directory from "../../i18n/locales/native-directory.en.json" with { type: "json" };
import { screen } from "./support/native-screen.mjs";
const { ClinicalRecords, ReleasedClinical } = await import("../src/clinical-records.tsx");
const i18n = createInstance();
await i18n.init({
  lng: "en",
  resources: { en: { translation: { nativeClinical: clinical, nativeCare: care, directory } } },
  interpolation: { prefix: "{", suffix: "}" },
});
function local(component) {
  return (props) => h(I18nextProvider, { i18n }, h(component, props));
}
const account = { issuer: "realm", subject: "veterinarian", organizations: [] },
  scope = { organizationId: "org", clinicId: "clinic", subject: account.subject },
  stamp = "2026-03-19T12:30:00Z";
const note = { id: "enc", reason: "Consult", occurredAt: stamp },
  guardian = { id: "guardian", name: "Morgan", email: "g@example.test", linked: true };
const page = (records) => ({ records, page: 1, hasNextPage: false });
test("a staff member orders, results, reviews and releases a lab; a lost review reuses the original request after revalidation", async (t) => {
  const writes = [],
    shares = [],
    versions = [];
  let drop = true;
  const client = {
    care: {
      encounters: async (_scope, _patient, n) => ({
        encounters: n === 2 ? [note] : [],
        page: n,
        hasNextPage: n === 1,
      }),
    },
    detail: async () => ({ guardians: [guardian] }),
    clinical: {
      list: async () => page(versions.slice(-1)),
      history: async () => page([...versions].reverse()),
      save: async (_scope, patient, recordId, requestId, body) => {
        assert.equal(patient, "p");
        writes.push({ recordId, requestId, body });
        if (body.data.status === "REVIEWED" && drop) {
          drop = false;
          throw Error("response lost");
        }
        const saved = {
          ...body,
          revision: body.revision + 1,
          revisionId: "version-" + (body.revision + 1),
          id: recordId,
          recordedAt: stamp,
          author: account,
          sharing: { revision: 0, guardianIds: [] },
        };
        versions.push(saved);
        return saved;
      },
      share: async (_scope, patient, id, body) => {
        assert.equal(patient, "p");
        assert.equal(id, versions.at(-1).id);
        shares.push(body);
        const sharing = { revision: 1, guardianIds: body.guardianIds };
        versions.at(-1).sharing = sharing;
        return sharing;
      },
    },
  };
  const props = { scope, account, client, patientId: "p", styles: {}, back() {}, openNotes() {} };
  const ui = screen(t, local(ClinicalRecords));
  await ui.render(props);
  await ui.press("Add a clinical record");
  await ui.press("Select an encounter");
  await ui.press(directory.next);
  await ui.press("Consult · " + new Date(stamp).toLocaleString("en"));
  await ui.press("Laboratory test");
  await ui.fill("Test name", "CBC");
  await ui.fill("Specimen", "Blood");
  await ui.press("Save record");
  assert.equal(writes[0].body.encounterId, "enc");
  assert.equal(writes[0].body.data.status, "ORDERED");
  assert.equal(ui.button("Guardian access"), undefined);
  assert.equal(ui.button("Review this result"), undefined);
  await ui.press("Enter result");
  await ui.fill("Result", "5");
  await ui.fill("Unit", "g/L");
  await ui.fill("Reason for this version", "Result received");
  await ui.press("Save new version");
  assert.equal(writes[1].body.data.status, "RESULTED");
  assert.equal(ui.button("Guardian access"), undefined);
  await ui.press("Review this result");
  await ui.fill("Reason for this version", "Reviewed against original report");
  await ui.press("Confirm review");
  assert.ok(ui.button("Retry submission"));
  await ui.render({ ...props, account: { ...account }, scope: { ...scope } });
  await ui.press("Retry submission");
  assert.deepEqual(writes[2], writes[3]);
  assert.equal(writes[3].body.occurredAt, writes[1].body.occurredAt);
  assert.equal(writes[3].body.data.status, "REVIEWED");
  await ui.press("Guardian access");
  await ui.press("Morgan · g@example.test");
  await ui.press("Save guardian access");
  assert.deepEqual(shares, [{ guardianIds: ["guardian"], revision: 0, recordRevision: 3 }]);
  await ui.press("View version history");
  assert.equal(ui.button("Correct result"), undefined);
  assert.ok(globalThis.document.body.textContent.includes("Reviewed against original report"));
});
test("guardian pages contain only owner-endpoint data and provenance with no staff actions or identifiers", async (t) => {
  const calls = [],
    data = {
      kind: "vaccination",
      data: { vaccine: "Released vaccine", lotNumber: "LOT-A", nextDueDate: "2027-01-01" },
      id: "root-id",
      revisionId: "version-id",
      revision: 2,
      patientId: "p",
      organizationName: "Example practice",
      clinicName: "South clinic",
      occurredAt: stamp,
      recordedAt: stamp,
    };
  const client = {
    clinical: {
      released: async (subject, petId, n) => {
        calls.push([subject, petId, n]);
        return { records: n === 1 ? [data] : [], page: n, hasNextPage: n === 1 };
      },
    },
  };
  const ui = screen(t, local(ReleasedClinical));
  await ui.render({
    account: { ...account, subject: "owner" },
    client,
    pet: { id: "pet", name: "Oz" },
    styles: {},
    back() {},
  });
  const content = globalThis.document.body.textContent;
  assert.ok(
    content.includes("Released vaccine") && content.includes("South clinic · Example practice"),
  );
  assert.ok(!content.includes("version-id"));
  assert.equal(ui.button("Guardian access"), undefined);
  assert.equal(ui.button("Correct this record"), undefined);
  await ui.press(directory.next);
  assert.ok(
    globalThis.document.body.textContent.includes(
      "No clinical records have been shared on this page.",
    ),
  );
  assert.deepEqual(calls, [
    ["owner", "pet", 1],
    ["owner", "pet", 2],
  ]);
});

test("a clinic refresh hides an unresolved correction and a confirmed denial discards it", async (t) => {
  const { PatientError } = await import("../src/patient-transport.ts");
  const record = {
    id: "condition",
    revisionId: "v",
    revision: 1,
    kind: "diagnosis",
    encounterId: "enc",
    data: { diagnosis: "Original" },
    author: account,
    occurredAt: stamp,
    recordedAt: stamp,
    sharing: { revision: 0, guardianIds: [] },
  };
  const clinical = {
    list: async () => page([record]),
    save: async () => {
      throw Error("unknown outcome");
    },
  };
  const initial = {
      scope,
      account,
      client: { clinical },
      patientId: "p",
      styles: {},
      back() {},
      openNotes() {},
    },
    ui = screen(t, local(ClinicalRecords));
  await ui.render(initial);
  await ui.press("Correct this record");
  await ui.fill("Diagnosis", "Updated");
  await ui.fill("Reason for this version", "Correction");
  await ui.press("Save new version");
  assert.ok(ui.button("Retry submission"));
  const verification = Promise.withResolvers();
  clinical.list = () => verification.promise;
  await ui.render({ ...initial, scope: { ...scope }, account: { ...account } });
  assert.ok(!ui.button("Retry submission"));
  const { act } = await import("react");
  await act(async () => verification.reject(new PatientError(403)));
  clinical.list = async () => page([record]);
  await ui.render({ ...initial, scope: { ...scope } });
  assert.ok(!ui.button("Retry submission"));
  assert.ok(ui.button("Correct this record"));
});

function sharingFixture() {
  const current = {
    id: "record",
    revisionId: "version-7",
    revision: 7,
    kind: "diagnosis",
    encounterId: "enc",
    data: { diagnosis: "Exam" },
    author: account,
    occurredAt: stamp,
    recordedAt: stamp,
    sharing: { guardianIds: [], revision: 2 },
  };
  const requests = [];
  const client = {
    clinical: {
      list: async () => page([current]),
      history: async () => page([current]),
      share: async ({ organizationId, clinicId, subject }, patientId, recordId, body) => {
        requests.push({ organizationId, clinicId, subject, patientId, recordId, body });
        if (requests.length === 1) throw Error("response lost");
        return { revision: 3, guardianIds: body.guardianIds };
      },
    },
    detail: async () => ({ guardians: [guardian] }),
  };
  return {
    current,
    requests,
    client,
    props: { scope, account, client, patientId: "p", styles: {}, back() {}, openNotes() {} },
  };
}
async function selectGuardian(ui, fixture) {
  await ui.render(fixture.props);
  await ui.press(clinical.sharing);
  await ui.press("Morgan · g@example.test");
}
test("an uncertain guardian release survives a roster 503 and replays the same scoped versions and recipients", async (t) => {
  const { PatientError } = await import("../src/patient-transport.ts");
  const fixture = sharingFixture(),
    ui = screen(t, local(ClinicalRecords));
  await selectGuardian(ui, fixture);
  await ui.press(clinical.saveAccess);
  assert.ok(ui.button(clinical.retry));
  fixture.client.detail = async () => {
    throw new PatientError(503);
  };
  await ui.render({ ...fixture.props, scope: { ...scope }, account: { ...account } });
  assert.ok(!ui.button(clinical.retry));
  assert.ok(!ui.button("✓ Morgan · g@example.test"));
  const hiddenRetry = [...globalThis.document.querySelectorAll("button")].find(
    (b) => b.textContent === clinical.retry,
  );
  assert.equal(
    hiddenRetry?.disabled,
    true,
    "the mounted retry is inoperable during the failed read",
  );
  assert.equal(fixture.requests.length, 1);
  fixture.client.detail = async () => ({ guardians: [{ ...guardian }] });
  await ui.press(directory.retry);
  assert.ok(ui.button(clinical.retry), "unknown release should still be retryable");
  await ui.press(clinical.retry);
  const expected = {
    organizationId: scope.organizationId,
    clinicId: scope.clinicId,
    subject: account.subject,
    patientId: "p",
    recordId: "record",
    body: { revision: 2, recordRevision: 7, guardianIds: ["guardian"] },
  };
  assert.deepEqual(fixture.requests, [expected, expected]);
});
test("a manual roster refresh retains an unsaved choice on the same revision, then resets it for a corrected record", async (t) => {
  const { PatientError } = await import("../src/patient-transport.ts");
  const fixture = sharingFixture(),
    ui = screen(t, local(ClinicalRecords));
  await selectGuardian(ui, fixture);
  fixture.client.detail = async () => {
    throw new PatientError(503);
  };
  await ui.press(care.refreshGuardians);
  assert.ok(!ui.button(clinical.saveAccess));
  fixture.client.detail = async () => ({ guardians: [guardian] });
  await ui.press(directory.retry);
  assert.equal(ui.button(clinical.saveAccess).disabled, false, "same revision keeps the selection");
  await ui.press(clinical.saveAccess);
  assert.ok(ui.button(clinical.retry));
  fixture.current.revision = 8;
  fixture.current.revisionId = "version-8";
  fixture.current.sharing = { revision: 3, guardianIds: [] };
  await ui.render({ ...fixture.props, scope: { ...scope }, account: { ...account } });
  assert.ok(!ui.button(clinical.retry));
  assert.equal(ui.button(clinical.saveAccess).disabled, true);
  assert.equal(fixture.requests.length, 1);
});
test("denied access clears a pending guardian release before a later grant", async (t) => {
  const { PatientError } = await import("../src/patient-transport.ts");
  const fixture = sharingFixture(),
    ui = screen(t, local(ClinicalRecords));
  await selectGuardian(ui, fixture);
  await ui.press(clinical.saveAccess);
  fixture.client.detail = async () => {
    throw new PatientError(403);
  };
  await ui.render({ ...fixture.props, scope: { ...scope }, account: { ...account } });
  assert.ok(!ui.button(clinical.retry));
  fixture.client.detail = async () => ({ guardians: [guardian] });
  await ui.press(directory.retry);
  assert.ok(!ui.button(clinical.retry));
  assert.equal(ui.button(clinical.saveAccess).disabled, true);
  assert.equal(fixture.requests.length, 1);
});

test("a changed sharing revision or patient scope clears the old recipient submission", async (t) => {
  const fixture = sharingFixture(),
    ui = screen(t, local(ClinicalRecords));
  await selectGuardian(ui, fixture);
  await ui.press(clinical.saveAccess);
  fixture.current.sharing = { revision: 3, guardianIds: ["guardian"] };
  await ui.render({ ...fixture.props, scope: { ...scope }, account: { ...account } });
  assert.ok(!ui.button(clinical.retry));
  assert.equal(ui.button(clinical.saveAccess).disabled, true);
  await ui.press("✓ Morgan · g@example.test");
  await ui.render({ ...fixture.props, patientId: "another-patient" });
  assert.ok(!ui.button(clinical.saveAccess));
  assert.ok(ui.button(clinical.sharing));
  assert.equal(fixture.requests.length, 1);
});
