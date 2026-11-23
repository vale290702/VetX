import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  PrismaDatabase,
  type ExchangeManifest,
  type ExchangeRecord,
  type StageExchangeInput,
} from "@vetx/database";
import { startTestDatabase } from "./postgres.ts";

const staff = {
  kind: "staff" as const,
  issuer: "https://identity.test/clinic",
  subject: "reviewer",
};
const colleague = { ...staff, subject: "colleague" };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const instant = "2026-08-14T10:11:12-06:00";
const author = { issuer: "https://sender.test/realm", subject: "source-clinician" };

function record(kind: ExchangeRecord["kind"], data: ExchangeRecord["data"]): ExchangeRecord {
  return {
    id: randomUUID(),
    kind,
    data,
    occurredAt: instant,
    recordedAt: "2026-08-15T12:00:00Z",
    author,
  };
}

function input(manifest: ExchangeManifest): StageExchangeInput {
  return {
    manifest,
    archiveSha256: sha(manifest.packageId),
    byteLength: 1024,
    recordDigests: Object.fromEntries(manifest.records.map((r) => [r.id, sha(JSON.stringify(r))])),
  };
}

test("reviewed clinical exchange on PostgreSQL", { timeout: 120_000 }, async (t) => {
  const { database, runtimeUrl, migrationUrl } = await startTestDatabase(t);
  const sql = new pg.Client({ connectionString: database.getConnectionUri() });
  const db = new PrismaDatabase(runtimeUrl);
  await sql.connect();
  try {
    const org = randomUUID(),
      clinic = randomUUID(),
      neighbor = randomUUID(),
      local = randomUUID();
    await sql.query("INSERT INTO organizations (id,name) VALUES ($1,'Destination')", [org]);
    await sql.query(
      "INSERT INTO clinics (id,organization_id,name) VALUES ($1,$3,'Clinic'),($2,$3,'Neighbor')",
      [clinic, neighbor, org],
    );
    const {
      rows: [user],
    } = await sql.query(
      "INSERT INTO users (identity_issuer,identity_subject) VALUES ($1,$2) RETURNING id",
      [staff.issuer, staff.subject],
    );
    await sql.query("INSERT INTO organization_memberships VALUES ($1,$2,'ADMIN')", [org, user.id]);
    await db.saveMember(staff, org, colleague.subject, "STAFF", [clinic], 0);
    const demographics = { name: "Miso", species: "Feline", birthDate: "2020-01-02", revision: 0 };
    const localPatient = await db.savePatient(staff, org, clinic, local, demographics);
    await db.savePatient(staff, org, neighbor, local, demographics);
    await db.savePatient(staff, org, clinic, randomUUID(), {
      ...demographics,
      birthDate: "2021-01-02",
    });

    const source = { organizationId: randomUUID(), clinicId: randomUUID() };
    const note = record("diagnosis", { diagnosis: "Source note" });
    const file = record("document", {
      title: "Report",
      mediaType: "application/pdf",
      byteLength: 3,
      sha256: sha("abc"),
      content: "YWJj",
    });
    const manifest: ExchangeManifest = {
      version: 1,
      packageId: randomUUID(),
      createdAt: instant,
      source,
      destination: { organizationId: org, clinicId: clinic },
      patient: { id: randomUUID(), name: "MISO", species: "Feline", birthDate: "2020-01-02" },
      owner: { name: "Source contact", email: "owner@example.test" },
      records: [note, file],
    };
    const pkg = input(manifest);
    const stage = (candidate: StageExchangeInput) =>
      db.stageExchange(colleague, org, clinic, candidate);
    const list = () => db.listImportedRecords(colleague, org, clinic, local, 1);
    const preview = await stage(pkg);

    await t.test(
      "staging is scoped, actor-bound and immutable; the registry and clinical history stay untouched",
      async () => {
        assert.deepEqual(preview, {
          receiptId: preview.receiptId,
          packageId: manifest.packageId,
          source,
          patient: manifest.patient,
          owner: manifest.owner,
          candidates: [localPatient],
          recordCount: 2,
          mappedPatientId: null,
          committedPatientId: null,
        });
        assert.deepEqual(await stage(pkg), preview);
        assert.deepEqual(await db.getExchangeReceipt(colleague, org, clinic, preview.receiptId), {
          archiveSha256: pkg.archiveSha256,
          byteLength: pkg.byteLength,
          packageId: manifest.packageId,
        });
        await assert.rejects(db.getExchangeReceipt(staff, org, clinic, preview.receiptId), {
          code: "not_found",
        });
        await assert.rejects(db.getExchangeReceipt(colleague, org, neighbor, preview.receiptId), {
          code: "forbidden",
        });
        await assert.rejects(db.getExchangeReceipt(staff, org, neighbor, preview.receiptId), {
          code: "not_found",
        });
        assert.equal((await list()).records.length, 0);
        assert.equal((await db.listPatients(staff, org, clinic, 1, "")).patients.length, 2);
        assert.deepEqual((await db.getPatient(staff, org, clinic, local)).guardians, []);
        assert.equal(
          (await sql.query("SELECT count(*)::int AS n FROM exchange_patients")).rows[0].n,
          0,
        );
        assert.equal(
          (
            await sql.query(
              "SELECT manifest->'records'->1->'data' ? 'content' AS present FROM exchange_packages",
            )
          ).rows[0].present,
          false,
        );
        assert.equal(file.data.content, "YWJj");
        await assert.rejects(
          db.commitExchange(staff, org, clinic, preview.receiptId, { mode: "create" }),
          { code: "not_found" },
        );
        await assert.rejects(
          db.commitExchange(colleague, org, neighbor, preview.receiptId, { mode: "create" }),
          { code: "forbidden" },
        );
        await assert.rejects(db.stageExchange(staff, org, neighbor, pkg), { code: "forbidden" });
        await assert.rejects(stage({ ...pkg, archiveSha256: sha("different ciphertext") }), {
          code: "conflict",
        });
        await assert.rejects(
          stage({ ...pkg, manifest: { ...manifest, owner: { name: "changed" } } }),
          { code: "conflict" },
        );
        await assert.rejects(
          stage({
            ...pkg,
            recordDigests: { ...pkg.recordDigests, [note.id]: sha("substitution") },
          }),
          { code: "conflict" },
        );
        await assert.rejects(stage({ ...pkg, recordDigests: {} }), { code: "invalid" });
        await assert.rejects(
          db.commitExchange(colleague, org, clinic, preview.receiptId, {
            mode: "match",
            patientId: randomUUID(),
          }),
          { code: "not_found" },
        );
        const another = await db.stageExchange(staff, org, clinic, pkg);
        assert.notEqual(another.receiptId, preview.receiptId);
      },
    );

    await t.test(
      "repeated commits preserve the selected patient, original author, timestamps, and the encrypted attachment reference",
      async () => {
        const commit = () =>
          db.commitExchange(colleague, org, clinic, preview.receiptId, {
            mode: "match",
            patientId: local,
          });
        const [a, b] = await Promise.all([commit(), commit()]);
        assert.deepEqual(a, {
          packageId: manifest.packageId,
          patientId: local,
          inserted: 2,
          skipped: 0,
        });
        assert.deepEqual(a, b);
        assert.deepEqual((await db.getPatient(staff, org, clinic, local)).patient, localPatient);
        const seen = await stage(pkg);
        assert.equal(seen.committedPatientId, local);
        assert.equal(seen.mappedPatientId, local);
        const { records } = await list();
        assert.equal(records.length, 2);
        const n = records.find((r) => r.id === note.id)!;
        const f = records.find((r) => r.id === file.id)!;
        assert.ok(n.importedId);
        assert.match(n.importedAt, /Z$/);
        const original = { ...source, patientId: manifest.patient.id };
        assert.deepEqual(n, {
          ...note,
          importedId: n.importedId,
          importedAt: n.importedAt,
          packageId: manifest.packageId,
          source: original,
        });
        assert.equal(f.data.content, undefined);
        assert.equal(f.data.sha256, file.data.sha256);
        assert.deepEqual(
          await db.getImportedAttachment(colleague, org, clinic, local, f.importedId),
          {
            packageId: manifest.packageId,
            source: original,
            recordId: file.id,
            kind: "document",
            archiveSha256: pkg.archiveSha256,
            byteLength: pkg.byteLength,
          },
        );
        await assert.rejects(
          db.getImportedAttachment(staff, org, clinic, randomUUID(), f.importedId),
          { code: "not_found" },
        );
        await assert.rejects(db.getImportedAttachment(staff, org, neighbor, local, f.importedId), {
          code: "not_found",
        });
        await assert.rejects(
          db.getImportedAttachment(colleague, org, neighbor, local, f.importedId),
          { code: "forbidden" },
        );
        await assert.rejects(db.getImportedAttachment(staff, org, clinic, local, n.importedId), {
          code: "not_found",
        });
        assert.equal(
          (await db.listImportedRecords(staff, org, neighbor, local, 1)).records.length,
          0,
        );
        const { rows } = await sql.query(
          "SELECT r.actor_issuer,r.actor_subject,i.inserted_count,i.skipped_count FROM exchange_imports i JOIN exchange_receipts r ON r.id=i.receipt_id",
        );
        assert.deepEqual(rows, [
          {
            actor_issuer: colleague.issuer,
            actor_subject: colleague.subject,
            inserted_count: 2,
            skipped_count: 0,
          },
        ]);
      },
    );

    await t.test(
      "overlapping packages deduplicate by source identity and reject changed records atomically",
      async () => {
        const third = record("treatment", { treatment: "Therapy" });
        const left = input({ ...manifest, packageId: randomUUID(), records: [file, third] });
        const right = input({ ...manifest, packageId: randomUUID(), records: [note, third] });
        const [a, b] = await Promise.all([stage(left), stage(right)]);
        assert.equal(a.mappedPatientId, local);
        await assert.rejects(
          db.commitExchange(colleague, org, clinic, a.receiptId, { mode: "create" }),
          { code: "conflict" },
        );
        const results = await Promise.all(
          [a, b].map(({ receiptId }) =>
            db.commitExchange(colleague, org, clinic, receiptId, {
              mode: "match",
              patientId: local,
            }),
          ),
        );
        assert.equal(
          results.reduce((sum, r) => sum + r.inserted, 0),
          1,
        );
        assert.equal(
          results.reduce((sum, r) => sum + r.skipped, 0),
          3,
        );
        const changed = input({
          ...manifest,
          packageId: randomUUID(),
          records: [
            record("diagnosis", { diagnosis: "New" }),
            { ...file, data: { ...file.data, sha256: sha("123"), content: "MTIz" } },
          ],
        });
        const conflict = await stage(changed);
        await assert.rejects(
          db.commitExchange(colleague, org, clinic, conflict.receiptId, {
            mode: "match",
            patientId: local,
          }),
          { code: "conflict" },
        );
        assert.equal((await list()).records.length, 3);
        assert.equal((await stage(changed)).committedPatientId, null);
        assert.equal(
          (await sql.query("SELECT count(*)::int AS n FROM exchange_imports")).rows[0].n,
          3,
        );
      },
    );

    await t.test(
      "create is explicit, serialized, and retryable; identical external IDs in distinct source clinics stay independent",
      async () => {
        const fromElsewhere = input({ ...manifest, source: { ...source, clinicId: randomUUID() } });
        const a = await stage(fromElsewhere);
        assert.equal(a.mappedPatientId, null);
        const create = () =>
          db.commitExchange(colleague, org, clinic, a.receiptId, { mode: "create" });
        const [x, y] = await Promise.all([create(), create()]);
        assert.equal(x.inserted, 2);
        assert.notEqual(x.patientId, local);
        assert.deepEqual(x, y);
        assert.equal((await db.getPatient(staff, org, clinic, x.patientId)).patient.name, "MISO");
        assert.deepEqual((await db.getPatient(staff, org, clinic, x.patientId)).guardians, []);
        await assert.rejects(
          db.commitExchange(colleague, org, clinic, a.receiptId, {
            mode: "match",
            patientId: local,
          }),
          { code: "conflict" },
        );
        const additional = Array.from({ length: 28 }, () =>
          record("vaccination", { vaccine: "External" }),
        );
        const later = await stage(
          input({ ...fromElsewhere.manifest, packageId: randomUUID(), records: additional }),
        );
        await db.commitExchange(colleague, org, clinic, later.receiptId, {
          mode: "match",
          patientId: x.patientId,
        });
        const first = await db.listImportedRecords(colleague, org, clinic, x.patientId, 1);
        const second = await db.listImportedRecords(colleague, org, clinic, x.patientId, 2);
        assert.equal(first.hasNextPage, true);
        assert.equal(first.records.length, 25);
        assert.equal(second.hasNextPage, false);
        assert.equal(second.records.length, 5);
        assert.equal(
          new Set([...first.records, ...second.records].map((r) => r.importedId)).size,
          30,
        );
        await assert.rejects(db.listImportedRecords(colleague, org, clinic, x.patientId, 0), {
          code: "invalid",
        });
      },
    );

    await t.test("imports a full 1,024-record package", async () => {
      const bulk = input({
        ...manifest,
        packageId: randomUUID(),
        records: Array.from({ length: 1024 }, () =>
          record("encounter", {
            reason: "Exam",
            subjective: randomBytes(5200).toString("base64"),
            objective: randomBytes(5200).toString("base64"),
            assessment: randomBytes(5200).toString("base64"),
            plan: "",
          }),
        ),
      });
      const reviewed = await stage(bulk);
      const result = await db.commitExchange(colleague, org, clinic, reviewed.receiptId, {
        mode: "match",
        patientId: local,
      });
      assert.equal(result.inserted, 1024);
    });

    await t.test(
      "runtime has no raw clinical access, imported history is append-only and loss of RLS/grants fails closed",
      async () => {
        const runtime = new pg.Client({ connectionString: runtimeUrl }),
          migration = new pg.Client({ connectionString: migrationUrl });
        await Promise.all([runtime.connect(), migration.connect()]);
        try {
          for (const table of [
            "exchange_packages",
            "exchange_receipts",
            "exchange_patients",
            "exchange_imports",
            "exchange_records",
          ]) {
            for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
              const result = await runtime.query(
                "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
                [table, privilege],
              );
              assert.equal(result.rows[0].allowed, false);
            }
          }
          await migration.query("BEGIN");
          await migration.query(
            "SELECT set_config('vetx.identity_issuer',$1,true),set_config('vetx.identity_subject',$2,true),set_config('vetx.organization_id',$3,true),set_config('vetx.clinic_id',$4,true),set_config('vetx.client_kind','staff',true)",
            [staff.issuer, staff.subject, org, clinic],
          );
          assert.ok((await migration.query("SELECT id FROM exchange_records")).rowCount);
          assert.equal(
            (await migration.query("UPDATE exchange_records SET digest=repeat('0',64)")).rowCount,
            0,
          );
          assert.equal((await migration.query("DELETE FROM exchange_records")).rowCount, 0);
          await migration.query("ROLLBACK");
          await sql.query("ALTER TABLE exchange_receipts NO FORCE ROW LEVEL SECURITY");
          try {
            await assert.rejects(list(), /row security/i);
          } finally {
            await sql.query("ALTER TABLE exchange_receipts FORCE ROW LEVEL SECURITY");
          }
          await db.checkReady();
          await db.removeMember(staff, org, colleague.subject, 1);
          await assert.rejects(list(), { code: "forbidden" });
          await assert.rejects(
            db.commitExchange(colleague, org, clinic, preview.receiptId, {
              mode: "match",
              patientId: local,
            }),
            { code: "forbidden" },
          );
        } finally {
          await Promise.all([runtime.end(), migration.end()]);
        }
      },
    );
  } finally {
    await Promise.all([sql.end(), db.onApplicationShutdown()]);
  }
});
