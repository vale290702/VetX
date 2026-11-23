import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { CompactEncrypt, CompactSign, compactDecrypt, importJWK } from "jose";
import * as exchange from "../dist/index.js";

const clinic = () => ({ organizationId: randomUUID(), clinicId: randomUUID() });
const source = clinic();
const destination = clinic();
const now = "2026-11-22T13:01:02.123Z";
const record = (kind, data) => ({
  id: randomUUID(),
  kind,
  occurredAt: now,
  recordedAt: now,
  author: { issuer: "https://id.example", subject: "clinician-42" },
  data,
});
const soap = {
  reason: "Checkup",
  subjective: "",
  objective: "Observation documented",
  assessment: "",
  plan: "",
};
const encounter = record("encounter", soap);
const attachment = {
  title: "Report",
  mediaType: "application/pdf",
  byteLength: 3,
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  content: "YWJj",
};
const manifest = {
  version: 1,
  packageId: randomUUID(),
  createdAt: now,
  source,
  destination,
  patient: { id: randomUUID(), name: "Lúa", species: "Feline", birthDate: null },
  records: [
    encounter,
    record("addendum", { ...soap, addendumTo: encounter.id }),
    record("diagnosis", { diagnosis: "External record" }),
    record("treatment", { treatment: "Recorded" }),
    record("prescription", {
      medication: "External medication",
      instructions: "Source directions",
    }),
    record("vaccination", { vaccine: "External vaccine", nextDueDate: "2027-01-01" }),
    record("labResult", { test: "Sample", result: "Reported" }),
    record("document", attachment),
    record("radiograph", { ...attachment, mediaType: "image/jpeg" }),
    record("dicom", {
      ...attachment,
      mediaType: "application/dicom",
      studyInstanceUid: "2.25.123",
    }),
    record("referral", { referredTo: destination, reason: "Consultation" }),
    record("counterReferral", {
      referralId: randomUUID(),
      referringClinic: destination,
      summary: "Response",
    }),
  ],
};
let keySetup;
function keys() {
  return (keySetup ??= Promise.all([
    exchange.generateExchangeKeys(source),
    exchange.generateExchangeKeys(destination),
  ]));
}
async function options() {
  const [s, d] = await keys();
  return {
    seal: { signer: s.signing.privateKey, recipient: d.encryption.publicKey },
    open: { trustedSources: [s.signing.publicKey], recipient: d.encryption.privateKey },
  };
}
const substitute = (token, i, value) => {
  const segments = token.split(".");
  segments[i] = value(segments[i]);
  return segments.join(".");
};

test("a portable file preserves every clinical record, provenance and explicit owner selection", async () => {
  const { seal, open } = await options();
  const bytes = await exchange.sealVetpkg(manifest, seal);
  assert.deepEqual(await exchange.openVetpkg(bytes, open), manifest);
  assert.ok(!Buffer.from(bytes).includes(Buffer.from(manifest.patient.id)));
  assert.notDeepEqual(await exchange.sealVetpkg(manifest, seal), bytes);
  const authorized = { ...manifest, owner: { name: "Guardian", email: "guardian@example.org" } };
  assert.deepEqual(
    await exchange.openVetpkg(await exchange.sealVetpkg(authorized, seal), open),
    authorized,
  );
});

test("verifies both clinic identifiers, signature trust and exact recipient key", async () => {
  const { seal, open } = await options();
  const bytes = await exchange.sealVetpkg(manifest, seal);
  const [s, d] = await keys();
  const changes = [
    { trustedSources: [] },
    { trustedSources: [{ ...s.signing.publicKey, organizationId: destination.organizationId }] },
    { trustedSources: [{ ...s.signing.publicKey, clinicId: destination.clinicId }] },
    { trustedSources: [s.signing.publicKey, { ...s.signing.publicKey, ...destination }] },
    { recipient: { ...d.encryption.privateKey, organizationId: source.organizationId } },
    { recipient: { ...d.encryption.privateKey, clinicId: source.clinicId } },
    { recipient: s.encryption.privateKey },
    { trustedSources: [{ ...s.signing.publicKey, jwk: d.signing.publicKey.jwk }] },
    { trustedSources: [s.signing.privateKey] },
  ];
  for (const change of changes)
    await assert.rejects(exchange.openVetpkg(bytes, { ...open, ...change }));
  await assert.rejects(exchange.sealVetpkg({ ...manifest, source: destination }, seal));
  await assert.rejects(
    exchange.sealVetpkg(manifest, { ...seal, recipient: d.encryption.privateKey }),
  );
});

test("validates the signed schema, record-specific data, attachment length and SHA-256", () => {
  assert.deepEqual(exchange.validateVetpkgManifest(manifest), manifest);
  const invalid = [
    { ...manifest, version: 2 },
    { ...manifest, records: [encounter, encounter] },
    { ...manifest, records: [record("prescription", { medication: "Missing directions" })] },
    { ...manifest, records: [record("diagnosis", { treatment: "Wrong kind" })] },
    { ...manifest, records: [record("unknown", {})] },
    { ...manifest, records: [record("dicom", attachment)] },
    { ...manifest, records: [record("document", { ...attachment, byteLength: 4 })] },
    { ...manifest, records: [record("document", { ...attachment, sha256: "f".repeat(64) })] },
    {
      ...manifest,
      records: [record("document", { ...attachment, content: "YQ==", byteLength: 1 })],
    },
    {
      ...manifest,
      records: [
        record("document", {
          ...attachment,
          content: "YR",
          byteLength: 1,
          sha256: createHash("sha256").update("a").digest("hex"),
        }),
      ],
    },
    { ...manifest, records: [record("radiograph", { ...attachment, mediaType: "text/html" })] },
    { ...manifest, patient: { ...manifest.patient, birthDate: "2026-02-30" } },
    { ...manifest, patient: { ...manifest.patient, ownerSubject: "private" } },
  ];
  for (const candidate of invalid) assert.throws(() => exchange.validateVetpkgManifest(candidate));
});

test("encounters and addenda require at least one nonblank SOAP section", () => {
  const blank = { ...soap, subjective: " ", objective: "\t", assessment: "\n", plan: "" };
  for (const kind of ["encounter", "addendum"]) {
    const data = kind === "addendum" ? { ...blank, addendumTo: encounter.id } : blank;
    const validate = (data) =>
      exchange.validateVetpkgManifest({ ...manifest, records: [record(kind, data)] });
    assert.throws(() => validate(data));
    for (const section of ["subjective", "objective", "assessment", "plan"]) {
      assert.doesNotThrow(() => validate({ ...data, [section]: "Content" }));
    }
  }
});

test("addenda may reference omitted notes or form valid chains in any order", () => {
  const first = record("addendum", { ...soap, addendumTo: encounter.id });
  const second = record("addendum", { ...soap, addendumTo: first.id });
  const sibling = record("addendum", { ...soap, addendumTo: first.id });
  for (const records of [
    [second, sibling, first, encounter],
    [encounter, first, second],
    [second, first],
    [first],
  ]) {
    assert.deepEqual(exchange.validateVetpkgManifest({ ...manifest, records }).records, records);
  }
});

test("addenda can only reference encounters or addenda present in the same package", () => {
  const other = record("diagnosis", { diagnosis: "Prior record" });
  const addendum = record("addendum", { ...soap, addendumTo: other.id });
  for (const records of [
    [other, addendum],
    [addendum, other],
  ]) {
    assert.throws(() => exchange.validateVetpkgManifest({ ...manifest, records }));
  }
});

test("addendum cycles are rejected, including cycles entered through another addendum", () => {
  const a = record("addendum", { ...soap, addendumTo: encounter.id });
  const b = record("addendum", { ...soap, addendumTo: a.id });
  const c = record("addendum", { ...soap, addendumTo: b.id });
  const incoming = record("addendum", { ...soap, addendumTo: c.id });
  for (const [parent, records] of [
    [a, [a]],
    [b, [a, b]],
    [c, [incoming, c, b, a]],
  ]) {
    a.data.addendumTo = parent.id;
    assert.throws(() => exchange.validateVetpkgManifest({ ...manifest, records }));
  }
});

test("bounds encrypted size, signed manifest size, records, single and cumulative file bytes", async () => {
  const { seal, open } = await options();
  const bytes = await exchange.sealVetpkg(manifest, seal);
  for (const limits of [
    { maxPackageBytes: bytes.length - 1 },
    { maxManifestBytes: 100 },
    { maxRecords: 2 },
    { maxAttachmentBytes: 2 },
    { maxTotalAttachmentBytes: 6 },
    { maxRecords: -1 },
  ]) {
    await assert.rejects(exchange.openVetpkg(bytes, { ...open, limits }));
    await assert.rejects(exchange.sealVetpkg(manifest, { ...seal, limits }));
  }
});

test("rejects modified ciphertext and authenticated packages with unapproved headers or signatures", async () => {
  const { seal, open } = await options();
  const [s, d] = await keys();
  const bytes = await exchange.sealVetpkg(manifest, seal);
  const text = Buffer.from(bytes).toString();
  const header = (t) => JSON.parse(Buffer.from(t.split(".")[0], "base64url"));
  const jweHeader = header(text);
  assert.equal(jweHeader.alg, "ECDH-ES+A256KW");
  assert.equal(jweHeader.enc, "A256GCM");
  assert.equal(jweHeader.epk.crv, "X25519");
  const key = await importJWK(d.encryption.privateKey.jwk, jweHeader.alg);
  const inner = Buffer.from((await compactDecrypt(text, key)).plaintext).toString();
  const jwsHeader = header(inner);
  assert.equal(jwsHeader.alg, "Ed25519");
  const recipient = await importJWK(d.encryption.publicKey.jwk, jweHeader.alg);
  const signer = await importJWK(s.signing.privateKey.jwk, "Ed25519");
  const { epk, ...outer } = jweHeader;
  assert.ok(epk);
  const wrap = async (t, h = outer) =>
    Buffer.from(await new CompactEncrypt(Buffer.from(t)).setProtectedHeader(h).encrypt(recipient));
  const sign = async (v, h = jwsHeader, sk = signer) =>
    new CompactSign(Buffer.from(v)).setProtectedHeader(h).sign(sk);
  // A producer can sign ordinary UTF-8 JSON with its own whitespace and property order.
  const external = {
    ...manifest,
    records: [record("treatment", { treatment: 'A "{quoted}" note, [reviewed]\nSecond line.' })],
  };
  assert.deepEqual(
    await exchange.openVetpkg(await wrap(await sign(JSON.stringify(external, null, 2))), open),
    external,
  );
  await assert.rejects(exchange.openVetpkg(await wrap(inner, { ...outer, zip: "DEF" }), open));
  const edited = substitute(text, 3, (v) => (v.startsWith("A") ? "B" : "A") + v.slice(1));
  await assert.rejects(exchange.openVetpkg(Buffer.from(edited), open));
  await assert.rejects(
    exchange.openVetpkg(
      await wrap(inner, { ...outer, jku: "https://example.invalid/untrusted" }),
      open,
    ),
  );
  for (const h of [
    { ...jwsHeader, jwk: s.signing.publicKey.jwk },
    { ...jwsHeader, alg: "EdDSA" },
    { ...jwsHeader, typ: "JWT" },
  ]) {
    await assert.rejects(
      exchange.openVetpkg(await wrap(await sign(JSON.stringify(manifest), h)), open),
    );
  }
  await assert.rejects(
    exchange.openVetpkg(
      await wrap(
        await sign(
          JSON.stringify(manifest),
          jwsHeader,
          await importJWK(d.signing.privateKey.jwk, "Ed25519"),
        ),
      ),
      open,
    ),
  );
  for (const payload of [
    JSON.stringify({ ...manifest, version: 2 }),
    JSON.stringify({ ...manifest, source: destination }),
    JSON.stringify({ ...manifest, destination: source }),
    JSON.stringify({ ...manifest, records: [encounter, encounter] }),
    JSON.stringify({
      ...manifest,
      records: [record("document", { ...attachment, content: "YWJk" })],
    }),
    JSON.stringify(manifest).replace('"version":1', '"version":2,"version":1'),
  ]) {
    await assert.rejects(exchange.openVetpkg(await wrap(await sign(payload)), open));
  }
});

test("reads a bounded, untrusted recipient key hint for key rotation", async () => {
  const { seal, open } = await options();
  const bytes = await exchange.sealVetpkg(manifest, seal);
  const second = await exchange.generateExchangeKeys(destination);
  const rotated = await exchange.sealVetpkg(manifest, {
    ...seal,
    recipient: second.encryption.publicKey,
  });
  assert.equal(exchange.vetpkgRecipientKid(bytes), open.recipient.kid);
  assert.equal(exchange.vetpkgRecipientKid(rotated), second.encryption.privateKey.kid);
  assert.throws(() => exchange.vetpkgRecipientKid(bytes, { maxPackageBytes: bytes.length - 1 }));
  assert.throws(() => exchange.vetpkgRecipientKid(Buffer.from("invalid")));
  const token = Buffer.from(bytes).toString();
  const substituteHeader = (changes) =>
    Buffer.from(
      substitute(token, 0, (s) =>
        Buffer.from(
          JSON.stringify({ ...JSON.parse(Buffer.from(s, "base64url")), ...changes }),
        ).toString("base64url"),
      ),
    );
  assert.throws(() => exchange.vetpkgRecipientKid(substituteHeader({ zip: "DEF" })));
  const misleading = substituteHeader({ kid: second.encryption.publicKey.kid });
  assert.equal(exchange.vetpkgRecipientKid(misleading), second.encryption.privateKey.kid);
  await assert.rejects(
    exchange.openVetpkg(misleading, { ...open, recipient: second.encryption.privateKey }),
  );
});

test("versioned records require complete lab provenance and keep legacy clinical records readable", () => {
  const lab = record("labResult", {
    test: "Named test",
    result: "Entered result",
    specimen: "Reported sample",
  });
  const provenance = {
    recordId: randomUUID(),
    revision: 3,
    resultAuthor: { issuer: "https://id.example", subject: "result-author" },
    resultRecordedAt: now,
  };
  const read = (r) => exchange.validateVetpkgManifest({ ...manifest, records: [r] }).records[0];
  assert.deepEqual(read({ ...lab, clinicalRevision: provenance }).clinicalRevision, provenance);
  assert.equal(read(lab).clinicalRevision, undefined);
  for (const bad of [
    { ...provenance, revision: 0 },
    { ...provenance, resultAuthor: undefined },
    { ...provenance, resultRecordedAt: undefined },
  ])
    assert.throws(() => read({ ...lab, clinicalRevision: bad }));
  assert.throws(() =>
    read({
      ...record("diagnosis", { diagnosis: "Entered diagnosis" }),
      clinicalRevision: provenance,
    }),
  );
});
