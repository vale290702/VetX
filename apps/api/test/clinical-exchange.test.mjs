import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { generateExchangeKeys, openVetpkg } from "@vetx/exchange";
import { loadExchangeConfig } from "@vetx/config";
import { ExchangeKeyDirectory } from "../dist/exchange/keyring.js";
import { ExchangeService } from "../dist/exchange/service.js";

const source = { organizationId: randomUUID(), clinicId: randomUUID() },
  destination = { organizationId: randomUUID(), clinicId: randomUUID() };
async function directory() {
  const a = await generateExchangeKeys(source),
    b = await generateExchangeKeys(destination);
  const rows = [
    [source, a],
    [destination, b],
  ].map(([scope, keys]) => ({
    ...scope,
    name: "Clinic",
    signing: [keys.signing.privateKey],
    encryption: [keys.encryption.privateKey],
  }));
  return {
    a,
    b,
    rows,
    keys: ExchangeKeyDirectory.parse({
      version: 1,
      clinics: rows,
      routes: [{ source, destination }],
    }),
  };
}
test("exchange configuration and routes are explicit and independently scoped", async () => {
  assert.equal(loadExchangeConfig({}), undefined);
  const values = {
    VETPKG_KEYRING_FILE: "/run/secrets/keys",
    VETPKG_MAX_PACKAGE_BYTES: "10240",
    VETPKG_MAX_RECORDS: "10",
  };
  assert.equal(loadExchangeConfig(values).maxRecords, 10);
  for (const settings of [
    { VETPKG_KEYRING_FILE: "keys" },
    { VETPKG_MAX_PACKAGE_BYTES: "67108865" },
    { VETPKG_MAX_RECORDS: "-1" },
  ])
    assert.throws(() => loadExchangeConfig({ ...values, ...settings }));
  const { keys, rows } = await directory();
  assert.equal(keys.allows(source, destination), true);
  assert.equal(keys.allows(destination, source), false);
  assert.equal(keys.trustedSources(destination)[0].jwk.d, undefined);
  assert.throws(() =>
    ExchangeKeyDirectory.parse({
      version: 1,
      clinics: rows,
      routes: [{ source, destination: source }],
    }),
  );
  const altered = structuredClone(rows);
  altered[0].signing[0].kid = randomUUID();
  assert.throws(() => ExchangeKeyDirectory.parse({ version: 1, clinics: altered, routes: [] }));
});
test("release is rechecked after sealing, and a private addendum parent receives a stable portable identifier", async () => {
  const { keys, a, b } = await directory(),
    pet = randomUUID(),
    patientId = randomUUID(),
    parent = randomUUID(),
    child = randomUUID();
  const actor = { kind: "owner", issuer: "https://id.example", subject: "owner" };
  const author = { issuer: "https://id.example", subject: "staff" };
  const at = "2026-04-01T12:00:00.000Z";
  const fields = { occurredAt: at, recordedAt: at, author },
    soap = { reason: "Visit", subjective: "Observation", objective: "", assessment: "", plan: "" };
  const snapshot = {
    patient: { id: patientId, name: "Pet", species: "Cat" },
    notes: [{ ...fields, kind: "addendum", id: child, data: { ...soap, addendumTo: parent } }],
    files: [],
  };
  let permitted = false;
  const service = new ExchangeService({
    keys,
    settings: { maxRecords: 32, maxPackageBytes: 100000 },
    database: {
      ownerExportSource: async () => snapshot,
      confirmOwnerExport: async () => {
        if (!permitted) throw new Error("withdrawn");
        return { ok: true };
      },
    },
  });
  const location = { ...source, patientId },
    selection = { encounterIds: [child], documentAssetIds: [], includeOwner: false };
  const issue = () => service.export(actor, pet, location, destination, selection);
  await assert.rejects(issue(), /withdrawn/);
  permitted = true;
  const read = async () => {
    const chunks = [];
    for await (const chunk of (await issue()).getStream()) chunks.push(chunk);
    return openVetpkg(Buffer.concat(chunks), {
      recipient: b.encryption.privateKey,
      trustedSources: [a.signing.publicKey],
    });
  };
  const first = (await read()).records[0];
  assert.equal(first.kind, "addendum");
  assert.notEqual(first.data.addendumTo, parent);
  snapshot.notes.push({ ...fields, kind: "encounter", id: parent, data: soap });
  selection.encounterIds.push(parent);
  const both = (await read()).records;
  assert.deepEqual(both[0], first);
  assert.equal(both[1].id, first.data.addendumTo);
});
test("revoking the receiving employee's access during archive storage suppresses the preview", async () => {
  const { a, b, keys } = await directory();
  const manifest = {
    version: 1,
    packageId: randomUUID(),
    createdAt: new Date().toISOString(),
    source,
    destination,
    patient: { id: randomUUID(), name: "Nube", species: "Cat" },
    records: [],
  };
  const { sealVetpkg } = await import("@vetx/exchange");
  const sealed = Buffer.from(
    await sealVetpkg(manifest, { signer: a.signing.privateKey, recipient: b.encryption.publicKey }),
  );
  let stored = false;
  const service = new ExchangeService({
    keys,
    settings: { maxRecords: 32, maxPackageBytes: 100000 },
    database: {
      listClinics: async () => (stored ? [] : [{ id: destination.clinicId }]),
      stageExchange: async () => ({ candidates: [{ name: "Local patient" }] }),
    },
    storage: {
      put: async () => {
        stored = true;
      },
    },
  });
  await assert.rejects(
    service.preview(
      { kind: "staff", issuer: "https://id.example", subject: "reviewer" },
      destination,
      sealed,
    ),
    (error) => error.getStatus() === 403,
  );
});
test("a released nine MiB document can be exported within the configured ten MiB storage limit", async () => {
  const { a, b, keys } = await directory();
  const { createHash } = await import("node:crypto");
  const bytes = Buffer.alloc(9 * 1024 * 1024, 32);
  bytes.write("%PDF-1.7\n");
  bytes.write("\n%%EOF\n", bytes.length - 7);
  const at = new Date().toISOString(),
    id = randomUUID(),
    objectId = randomUUID(),
    patientId = randomUUID();
  const owner = { issuer: "https://id.example", subject: "owner", kind: "owner" };
  const snapshot = {
    patient: { id: patientId, name: "Pet", species: "Cat" },
    notes: [],
    files: [
      {
        id,
        objectId,
        title: "Report",
        mediaType: "application/pdf",
        byteLength: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        recordedAt: at,
        author: { issuer: owner.issuer, subject: "staff" },
      },
    ],
  };
  const deps = {
    keys,
    documentMaxBytes: 10 * 1024 * 1024,
    settings: { maxRecords: 1024, maxPackageBytes: 48 * 1024 * 1024 },
    database: {
      ownerExportSource: async () => snapshot,
      confirmOwnerExport: async () => ({ ok: true }),
    },
    storage: { read: async () => bytes },
  };
  const make = (service) =>
    service.export(owner, randomUUID(), { ...source, patientId }, destination, {
      encounterIds: [],
      documentAssetIds: [id],
      includeOwner: false,
    });
  const service = new ExchangeService(deps),
    stream = (await make(service)).getStream(),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const imported = await openVetpkg(Buffer.concat(chunks), {
    recipient: b.encryption.privateKey,
    trustedSources: [a.signing.publicKey],
    limits: service.limits,
  });
  assert.equal(imported.records[0].data.byteLength, bytes.length);
  await assert.rejects(
    make(new ExchangeService({ ...deps, documentMaxBytes: 8 * 1024 * 1024 })),
    (error) => error.getStatus() === 413,
  );
});
