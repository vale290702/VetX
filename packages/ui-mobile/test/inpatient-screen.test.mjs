import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { createElement as h } from "react";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import en from "../../i18n/locales/native-clinical.en.json" with { type: "json" };
import es from "../../i18n/locales/native-clinical.es.json" with { type: "json" };
import exchangeEs from "../../i18n/locales/native-exchange.es.json" with { type: "json" };
import { screen } from "./support/native-screen.mjs";
// Attachment handoff requires a native OS. Summary-only records never open that handoff.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./exchange-files" && context.parentURL?.endsWith("/imported-history.tsx"))
      return {
        url: "data:text/javascript,export const useExchangeHandoff=()=>({});",
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { ImportedHistory } = await import("../src/imported-history.tsx");
const { ClinicalRecords, ReleasedClinical } = await import("../src/clinical-records.tsx");
async function translated(Component, language = "en") {
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    resources: {
      [language]: {
        translation: { nativeClinical: language === "en" ? en : es, nativeExchange: exchangeEs },
      },
    },
    interpolation: { prefix: "{", suffix: "}" },
  });
  return (props) => h(I18nextProvider, { i18n }, h(Component, props));
}
const account = { subject: "vet", issuer: "realm", organizations: [] },
  scope = { subject: "vet", organizationId: "org", clinicId: "clinic" };
const stamp = "2026-01-10T13:30:20.555Z",
  page = (records) => ({ records, page: 1, hasNextPage: false });
function setup(t, Component, row, lose) {
  let current = row;
  const writes = [],
    shares = [];
  const client = {
    care: {
      encounters: async () => ({
        encounters: [{ id: "enc", reason: "Visit", occurredAt: stamp }],
        page: 1,
        hasNextPage: false,
      }),
    },
    detail: async () => ({
      guardians: [{ id: "g", name: "Morgan", email: "g@example.test", linked: true }],
    }),
    clinical: {
      list: async () => page(current ? [current] : []),
      history: async () => page([current]),
      share: async (_s, _p, _id, b) => {
        shares.push(b);
        return { revision: 1, guardianIds: b.guardianIds };
      },
      save: async (s, p, id, requestId, b) => {
        writes.push({ s, p, id, requestId, b });
        if (lose && b.data.status === lose) {
          lose = false;
          throw Error("connection");
        }
        current = {
          ...b,
          id,
          revision: b.revision + 1,
          revisionId: requestId,
          recordedAt: stamp,
          author: account,
          sharing: { revision: 0, guardianIds: [] },
        };
        return current;
      },
    },
  };
  const ui = screen(t, Component),
    props = { scope, account, client, styles: {}, patientId: "patient", back() {}, openNotes() {} };
  return { ui, props, writes, shares };
}
test("staff admit, record a fresh ward note, sign and retry a discharge, then release the exact version", async (t) => {
  const { ui, props, writes, shares } = setup(
    t,
    await translated(ClinicalRecords),
    null,
    "DISCHARGED",
  );
  await ui.render(props);
  await ui.press(en.new);
  await ui.press(en.hospitalization);
  await ui.press(en.selectEncounter);
  await ui.press("Visit · " + new Date(stamp).toLocaleString("en"));
  await ui.fill(en.ward, "A");
  await ui.fill(en.note, "Staff admission");
  await ui.press(en.admit);
  assert.ok(!ui.button(en.sharing));
  await ui.press(en.progress);
  await ui.fill(en.changeReason, "Daily round");
  assert.ok(ui.button(en.progress).disabled);
  await ui.fill(en.note, "Fresh note");
  await ui.press(en.progress);
  await ui.press(en.discharge);
  await ui.fill(en.note, "Private discharge note");
  await ui.fill(en.changeReason, "Discharge review");
  assert.ok(ui.button(en.discharge).disabled);
  await ui.fill(en.summary, "Discharge summary for Morgan");
  await ui.press(en.discharge);
  await ui.render({ ...props, account: { ...account }, scope: { ...scope } });
  await ui.press(en.retry);
  assert.deepEqual(writes.at(-2), writes.at(-1));
  assert.deepEqual(
    writes.map((x) => x.b.data.status),
    ["ADMITTED", "PROGRESS", "DISCHARGED", "DISCHARGED"],
  );
  await ui.press(en.sharing);
  await ui.press("Morgan · g@example.test");
  await ui.press(en.saveAccess);
  assert.deepEqual(shares, [{ recordRevision: 3, revision: 0, guardianIds: ["g"] }]);
});
test("staff can schedule, start and complete surgery, keeping the actual procedure separate from the plan", async (t) => {
  const { ui, props, writes } = setup(t, await translated(ClinicalRecords));
  await ui.render(props);
  await ui.press(en.new);
  await ui.press(en.surgery);
  await ui.press(en.selectEncounter);
  await ui.press("Visit · " + new Date(stamp).toLocaleString("en"));
  await ui.fill(en.procedure, "Plan");
  await ui.fill(en.scheduledAt, "2026-07-03 09:00");
  await ui.press(en.planSurgery);
  assert.ok(ui.button(en.cancel));
  assert.ok(!ui.button(en.complete));
  assert.ok(!ui.button(en.sharing));
  await ui.press(en.reschedule);
  await ui.fill(en.scheduledAt, "2026-07-04 11:25");
  await ui.fill(en.changeReason, "New schedule");
  await ui.press(en.reschedule);
  await ui.press(en.start);
  await ui.fill(en.changeReason, "Started");
  await ui.press(en.start);
  await ui.press(en.complete);
  await ui.fill(en.performedProcedure, "Actual procedure");
  await ui.fill(en.recoveryNotes, "Staff recovery note");
  await ui.fill(en.changeReason, "Signed");
  assert.ok(ui.button(en.complete).disabled);
  await ui.fill(en.summary, "Guardian summary");
  await ui.press(en.complete);
  assert.equal(writes[3].b.data.scheduledAt, writes[1].b.data.scheduledAt);
  assert.equal(writes[3].b.data.procedure, "Plan");
  assert.equal(writes[3].b.data.performedProcedure, "Actual procedure");
  assert.ok(ui.button(en.sharing));
  assert.ok(ui.button(en.amend));
  assert.ok(!ui.button(en.cancel));
});
test("cancellation signs only a guardian summary and private notes; amending it retains the event and plan", async (t) => {
  const row = {
    id: "s",
    kind: "surgery",
    encounterId: "enc",
    revision: 2,
    revisionId: "v2",
    occurredAt: stamp,
    recordedAt: stamp,
    author: account,
    sharing: { revision: 0, guardianIds: [] },
    data: {
      status: "IN_PROGRESS",
      procedure: "Planned procedure",
      scheduledAt: stamp,
      notes: "Initial notes",
    },
  };
  const { ui, props, writes } = setup(t, await translated(ClinicalRecords), row);
  await ui.render(props);
  await ui.press(en.cancel);
  await ui.fill(en.changeReason, "Recorded by surgeon");
  assert.ok(ui.button(en.cancel).disabled);
  await ui.fill(en.surgeryNotes, "Private update");
  await ui.fill(en.summary, "Cancelled");
  await ui.press(en.cancel);
  assert.deepEqual(writes[0].b.data, {
    status: "CANCELLED",
    procedure: "Planned procedure",
    scheduledAt: stamp,
    notes: "Private update",
    summary: "Cancelled",
  });
  await ui.press(en.amend);
  await ui.fill(en.summary, "Corrected summary");
  await ui.fill(en.changeReason, "Clarified wording");
  await ui.press(en.amend);
  assert.deepEqual(writes[1].b.data, { ...writes[0].b.data, summary: "Corrected summary" });
  assert.equal(writes[1].b.occurredAt, writes[0].b.occurredAt);
  assert.equal(writes[1].b.revision, 3);
});
test("guardian chart shows Spanish terminal summaries and never renders staff-only fields", async (t) => {
  const ui = screen(t, await translated(ReleasedClinical, "es")),
    calls = [];
  const rows = [
    ["hospitalization", "DISCHARGED"],
    ["surgery", "CANCELLED"],
    ["surgery", "COMPLETED"],
    ["surgery", "PLANNED"],
  ].map(([kind, status], i) => ({
    kind,
    data: {
      status,
      summary: "Public " + status,
      notes: "private notes",
      note: "staff note",
      ward: "private ward",
      procedure: "private plan",
      recoveryNotes: "private recovery",
    },
    revisionId: "v" + i,
    revision: 2,
    occurredAt: stamp,
    clinicName: "Clinic",
    organizationName: "Org",
  }));
  await ui.render({
    account: { ...account, subject: "guardian" },
    pet: { id: "pet", name: "Oz" },
    client: {
      clinical: {
        released: async (...args) => {
          calls.push(args);
          return page(rows);
        },
      },
    },
    styles: {},
    back() {},
  });
  assert.deepEqual(calls, [["guardian", "pet", 1]]);
  const output = document.body.textContent;
  for (const word of [
    es.DISCHARGED,
    es.CANCELLED,
    es.COMPLETED,
    "Public DISCHARGED",
    "Public CANCELLED",
    "Public COMPLETED",
  ])
    assert.ok(output.includes(word), word);
  for (const word of ["private", "staff note", "Public PLANNED"])
    assert.ok(!output.includes(word), word);
});

test("imported surgery renders its authorized summary, original revision and localized final state, excluding stray staff data", async (t) => {
  const ui = screen(t, await translated(ImportedHistory, "es")),
    calls = [];
  const imported = {
    importedId: "imported",
    id: "record",
    kind: "surgery",
    patientId: "p",
    source: {
      organizationId: "original-org",
      clinicId: "original-clinic",
      patientId: "original-patient",
    },
    author: account,
    packageId: "pkg",
    occurredAt: stamp,
    recordedAt: stamp,
    importedAt: stamp,
    clinicalRevision: { recordId: "source-record", revision: 3 },
    data: {
      status: "COMPLETED",
      summary: "Resumen compartido",
      procedure: "private surgery",
      notes: "private notes",
      recoveryNotes: "private recovery",
      subjective: "private chart",
    },
  };
  await ui.render({
    account,
    scope,
    patientId: "p",
    styles: {},
    back() {},
    client: {
      exchange: {
        history: async (...args) => {
          calls.push(args);
          return page([imported]);
        },
      },
    },
  });
  assert.deepEqual(calls, [[scope, "p", 1]]);
  await ui.press(exchangeEs.details);
  const content = document.body.textContent;
  for (const expected of [
    exchangeEs.kinds.surgery,
    es.COMPLETED,
    "Resumen compartido",
    es.sourceVersion,
    "source-record",
  ])
    assert.ok(content.includes(expected), expected);
  assert.ok(!content.includes("private"));
});
