import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PrismaDatabase } from "@vetx/database";
import { startTestDatabase } from "./postgres.ts";

test(
  "documents become visible only after storage confirmation and a current guardian release",
  { timeout: 120000 },
  async (t) => {
    const { database, runtimeUrl } = await startTestDatabase(t);
    const sql = new pg.Client({ connectionString: database.getConnectionUri() });
    await sql.connect();
    const db = new PrismaDatabase(runtimeUrl);
    try {
      const org = randomUUID(),
        clinic = randomUUID(),
        patient = randomUUID(),
        guardian = randomUUID(),
        id = randomUUID();
      const staff = {
        issuer: "https://identity.example",
        subject: "operator",
        kind: "staff" as const,
      };
      const owner = {
        ...staff,
        kind: "owner" as const,
        subject: "guardian",
        verifiedEmail: "guardian@example.test",
      };
      const input = {
        title: "Report",
        mediaType: "application/pdf" as const,
        byteLength: 8,
        sha256: randomBytes(32).toString("hex"),
      };
      await sql.query("INSERT INTO organizations(id,name) VALUES($1,'Test')", [org]);
      await sql.query("INSERT INTO clinics(organization_id,id,name) VALUES($1,$2,'Clinic')", [
        org,
        clinic,
      ]);
      const user = await sql.query(
        "INSERT INTO users(identity_issuer,identity_subject) VALUES($1,$2) RETURNING id",
        [staff.issuer, staff.subject],
      );
      await sql.query(
        "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'ADMIN')",
        [org, user.rows[0].id],
      );
      await db.savePatient(staff, org, clinic, patient, {
        name: "Pet",
        species: "Dog",
        birthDate: null,
        revision: 0,
      });
      await db.addGuardian(staff, org, clinic, patient, guardian, {
        name: "Guardian",
        email: owner.verifiedEmail,
      });
      const digest = randomBytes(32).toString("hex");
      await db.issuePetLink(staff, org, clinic, patient, guardian, {
        digest,
        requestId: randomUUID(),
        lifetimeSeconds: 60,
      });
      const { petId } = await db.redeemPetLink(owner, {
        digest,
        requestId: randomUUID(),
        attemptLimit: 4,
        windowSeconds: 60,
      });
      const reserve = () => db.reserveDocument(staff, org, clinic, patient, id, input);
      const pending = await reserve();
      assert.deepEqual(await reserve(), pending);
      assert.equal(pending.ready, false);
      assert.deepEqual((await db.listDocuments(staff, org, clinic, patient, 1)).documents, []);
      await assert.rejects(
        db.reserveDocument(staff, org, clinic, patient, id, { ...input, sha256: "0".repeat(64) }),
        { code: "conflict" },
      );
      await assert.rejects(db.reserveDocument(staff, randomUUID(), clinic, patient, id, input), {
        code: "forbidden",
      });
      const finish = () => db.finishDocument(staff, org, clinic, patient, id, input.sha256);
      const ready = await finish();
      assert.deepEqual(await finish(), ready);
      assert.equal(ready.ready, true);
      assert.deepEqual(await db.getDocument(staff, org, clinic, patient, id), ready);
      assert.deepEqual((await db.listDocuments(staff, org, clinic, patient, 1)).documents, [ready]);
      assert.deepEqual((await db.listOwnerDocuments(owner, petId, 1)).documents, []);
      await assert.rejects(db.getOwnerDocument(owner, petId, pending.assetId), {
        code: "not_found",
      });
      const share = { guardianIds: [guardian], revision: 0 };
      assert.equal((await db.shareDocument(staff, org, clinic, patient, id, share)).revision, 1);
      assert.equal((await db.shareDocument(staff, org, clinic, patient, id, share)).revision, 1);
      const released = await db.getOwnerDocument(owner, petId, ready.assetId);
      assert.equal(released.title, "Report");
      assert.equal("sharing" in released, false);
      assert.deepEqual((await db.listOwnerDocuments(owner, petId, 1)).documents, [released]);
      await assert.rejects(
        db.getOwnerDocument({ ...owner, subject: "different owner" }, petId, ready.assetId),
        { code: "not_found" },
      );
      await db.shareDocument(staff, org, clinic, patient, id, { guardianIds: [], revision: 1 });
      await assert.rejects(db.getOwnerDocument(owner, petId, pending.assetId), {
        code: "not_found",
      });
      await db.shareDocument(staff, org, clinic, patient, id, {
        guardianIds: [guardian],
        revision: 2,
      });
      const scan = randomUUID();
      const raw = { ...input, mediaType: "application/dicom" as const };
      const preflight = (candidate = raw) =>
        db.preflightDocument(staff, org, clinic, patient, scan, candidate);
      const rejectedRaw = { ...raw, sha256: "0".repeat(64) };
      assert.equal(await preflight(rejectedRaw), null);
      assert.equal(
        (await sql.query("SELECT id FROM medical_documents WHERE id=$1", [scan])).rowCount,
        0,
      );
      await assert.rejects(db.preflightDocument(staff, org, randomUUID(), patient, scan, raw), {
        code: "forbidden",
      });
      await assert.rejects(db.preflightDocument(staff, org, clinic, randomUUID(), scan, raw), {
        code: "not_found",
      });
      await assert.rejects(preflight({ ...raw, title: "bad\u001btitle" }), { code: "invalid" });
      const original = await db.reserveDocument(staff, org, clinic, patient, scan, raw);
      assert.deepEqual(await preflight(), original);
      await assert.rejects(preflight(rejectedRaw), { code: "conflict" });
      await assert.rejects(preflight({ ...raw, title: "Different title" }), { code: "conflict" });
      const otherStaff = { ...staff, subject: "peer" };
      const otherUser = await sql.query(
        "INSERT INTO users(identity_issuer,identity_subject) VALUES($1,$2) RETURNING id",
        [otherStaff.issuer, otherStaff.subject],
      );
      await sql.query(
        "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'ADMIN')",
        [org, otherUser.rows[0].id],
      );
      await assert.rejects(db.preflightDocument(otherStaff, org, clinic, patient, scan, raw), {
        code: "conflict",
      });
      const metadata = {
        studyInstanceUid: "2.25.1",
        seriesInstanceUid: "2.25.2",
        sopInstanceUid: "2.25.3",
        modality: "DX",
        frames: 2,
        preview: { byteLength: 123, sha256: "1".repeat(64) },
      };
      const finalize = (m: typeof metadata) =>
        db.finishDicomDocument(staff, org, clinic, patient, scan, raw.sha256, m);
      await assert.rejects(db.finishDocument(staff, org, clinic, patient, scan, raw.sha256), {
        code: "conflict",
      });
      await assert.rejects(finalize({ ...metadata, frames: 0 }), { code: "invalid" });
      await assert.rejects(finalize({ ...metadata, seriesInstanceUid: "invalid" }), {
        code: "invalid",
      });
      assert.deepEqual((await finalize(metadata)).imaging, metadata);
      const readyScan = await finalize(metadata);
      assert.deepEqual(readyScan.imaging, metadata);
      assert.deepEqual(await preflight(), readyScan);
      await assert.rejects(finalize({ ...metadata, modality: "MR" }), { code: "conflict" });
      await assert.rejects(db.getOwnerDocument(owner, petId, original.assetId), {
        code: "not_found",
      });
      await db.shareDocument(staff, org, clinic, patient, scan, {
        guardianIds: [guardian],
        revision: 0,
      });
      assert.deepEqual(
        (await db.getOwnerDocument(owner, petId, original.assetId)).imaging,
        metadata,
      );
      const selection = {
        encounterIds: [],
        documentAssetIds: [original.assetId],
        includeOwner: false,
      };
      const source = { organizationId: org, clinicId: clinic, patientId: patient };
      const snapshot = await db.ownerExportSource(owner, petId, source, selection);
      assert.deepEqual(snapshot.files[0]?.imaging, {
        studyInstanceUid: metadata.studyInstanceUid,
        seriesInstanceUid: metadata.seriesInstanceUid,
        sopInstanceUid: metadata.sopInstanceUid,
      });
      await db.removeGuardian(staff, org, clinic, patient, guardian);
      await assert.rejects(db.ownerExportSource(owner, petId, source, selection), {
        code: "not_found",
      });
      await assert.rejects(db.getOwnerDocument(owner, petId, original.assetId), {
        code: "not_found",
      });
      await assert.rejects(db.getOwnerDocument(owner, petId, pending.assetId), {
        code: "not_found",
      });
      assert.equal(
        (await sql.query("SELECT count(*)::int AS count FROM document_events")).rows[0].count,
        6,
      );
    } finally {
      await db.onApplicationShutdown();
      await sql.end();
    }
  },
);
