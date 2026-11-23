import assert from "node:assert/strict";
import { test } from "node:test";
import { createExchange } from "../src/exchange-client.ts";
import { createPatientTransport } from "../src/patient-transport.ts";
import { exportBody, toggleExportRecord, importChoice } from "../src/exchange-forms.ts";

const scope = { subject: "staff", organizationId: "org", clinicId: "dest" };
const source = {
  organizationId: "org",
  clinicId: "from",
  patientId: "patient",
  clinicName: "From",
  organizationName: "Org",
  destinations: [{ organizationId: "other", clinicId: "dest", name: "Destino" }],
};
const dest = source.destinations[0],
  bytes = Uint8Array.of(0, 187, 255, 25);
function fixture(reply) {
  const calls = [],
    signal = new AbortController().signal;
  const session = {
    forAccount(subject, work) {
      assert.equal(subject, "owner");
      return work("owner-token", signal);
    },
    forOrganization(subject, org, work) {
      assert.equal(subject, "staff");
      assert.equal(org, "org");
      return work("staff-token", signal);
    },
  };
  const fetcher = async (url, init) => {
    assert.equal(init.signal, signal);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    const req = new Request(url, init);
    calls.push(req);
    return reply(req);
  };
  const transport = createPatientTransport(session, "https://vet.test", fetcher);
  return { client: createExchange(transport, session, "https://vet.test", fetcher), calls };
}
test("export selections span pages, separate IDs by record kind, and require opt-in for the owner's contact", () => {
  const note = { id: "same", kind: "encounter" },
    file = { id: "same", kind: "document" },
    next = { id: "another", kind: "document" };
  let selected = toggleExportRecord([], note);
  selected = toggleExportRecord(selected, file);
  selected = toggleExportRecord(selected, next);
  selected = toggleExportRecord(selected, file);
  const body = exportBody(source, dest, selected, false);
  assert.deepEqual(body, {
    source: { organizationId: "org", clinicId: "from", patientId: "patient" },
    destination: { organizationId: "other", clinicId: "dest" },
    encounterIds: ["same"],
    documentAssetIds: ["another"],
    includeOwner: false,
  });
  assert.equal(exportBody(source, dest, selected, true).includeOwner, true);
  assert.equal(
    exportBody(source, { organizationId: "wrong", clinicId: "dest" }, selected, false),
    undefined,
  );
  assert.equal(exportBody(source, dest, [], false), undefined);
});
test("imports require an explicit choice and honor an existing patient mapping", () => {
  const state = { mappedPatientId: null, committedPatientId: null };
  assert.equal(importChoice(state, undefined), undefined);
  assert.deepEqual(importChoice(state, { mode: "create" }), { mode: "create" });
  assert.equal(importChoice(state, { mode: "match" }), undefined);
  assert.deepEqual(
    importChoice({ ...state, mappedPatientId: "local" }, { mode: "match", patientId: "local" }),
    { mode: "match", patientId: "local" },
  );
  assert.equal(importChoice({ ...state, mappedPatientId: "local" }, { mode: "create" }), undefined);
  assert.equal(
    importChoice({ ...state, mappedPatientId: "local" }, { mode: "match", patientId: "other" }),
    undefined,
  );
});
test("owner export reads the selected source and delivers the recipient-bound package through the account session", async () => {
  const { client, calls } = fixture((r) =>
    r.method === "POST"
      ? new Response(bytes, {
          headers: { "content-type": "application/octet-stream", "content-length": "4" },
        })
      : Response.json({}),
  );
  await client.options("owner", "pet");
  await client.choices("owner", "pet", source, 2);
  const body = exportBody(
    source,
    dest,
    [
      { kind: "encounter", id: "e" },
      { kind: "clinical", id: "released-version" },
    ],
    false,
  );
  assert.deepEqual(body.clinicalRevisionIds, ["released-version"]);
  assert.deepEqual(await client.exportPackage("owner", "pet", body), bytes);
  assert.deepEqual(
    calls.map((r) => [
      r.method,
      r.url.replace("https://vet.test", ""),
      r.headers.get("Authorization"),
    ]),
    [
      ["GET", "/owner/pets/pet/exchange-options", "Bearer owner-token"],
      [
        "GET",
        "/owner/pets/pet/exchange-options/org/from/patient/records?page=2",
        "Bearer owner-token",
      ],
      ["POST", "/owner/pets/pet/exports", "Bearer owner-token"],
    ],
  );
  assert.deepEqual(await calls[2].json(), body);
});
test("staff preview sends only file bytes, commits the reviewed choice and retrieves scoped history", async () => {
  const state = {
    receiptId: "receipt",
    packageId: "pkg",
    patient: { id: "p", name: "Luna", species: "Cat" },
    source: { organizationId: "other", clinicId: "from" },
    recordCount: 1,
    candidates: [],
    counts: [],
    mappedPatientId: null,
    committedPatientId: null,
  };
  const { client, calls } = fixture((r) =>
    r.url.endsWith("/content")
      ? new Response(bytes, { headers: { "content-type": "application/octet-stream" } })
      : Response.json(state),
  );
  assert.deepEqual(await client.preview(scope, bytes, "BOUNDARY"), state);
  const parts = await calls[0].formData();
  assert.deepEqual(Array.from(parts.keys()), ["file"]);
  assert.deepEqual(new Uint8Array(await parts.get("file").arrayBuffer()), bytes);
  await client.commit(scope, "receipt", { mode: "match", patientId: "local" });
  await client.history(scope, "local", 3);
  assert.deepEqual(await client.content(scope, "local", "item", 4), bytes);
  assert.deepEqual(
    calls.map((r) => [
      r.method,
      r.url.replace("https://vet.test/organizations/org/clinics/dest", ""),
    ]),
    [
      ["POST", "/exchange/imports/preview"],
      ["PUT", "/exchange/imports/receipt/commit"],
      ["GET", "/patients/local/imported-records?page=3"],
      ["GET", "/patients/local/imported-records/item/content"],
    ],
  );
  assert.ok(calls.every((r) => r.headers.get("Authorization") === "Bearer staff-token"));
  assert.deepEqual(await calls[1].json(), { mode: "match", patientId: "local" });
});
test("unavailable exchange is recoverable and an invalid attachment response is rejected", async () => {
  const { client } = fixture(() =>
    Response.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503 }),
  );
  await assert.rejects(client.options("owner", "pet"), (e) => e.code === "EXCHANGE_UNAVAILABLE");
  await assert.rejects(
    client.preview(scope, bytes, "BOUNDARY"),
    (e) => e.code === "EXCHANGE_UNAVAILABLE",
  );
  const other = fixture(
    () => new Response("error page", { headers: { "content-type": "text/html" } }),
  ).client;
  await assert.rejects(other.content(scope, "local", "item", 4));
});
