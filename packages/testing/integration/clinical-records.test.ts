import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { buffer } from "node:stream/consumers";
import { generateExchangeKeys } from "@vetx/exchange";

import { PrismaDatabase, type ClinicalWrite } from "@vetx/database";
import { startTestDatabase } from "./postgres.ts";
const admin = { kind: "staff" as const, issuer: "https://clinical.test", subject: "admin" },
  nurse = { ...admin, subject: "nurse" };
const owner = {
  kind: "owner" as const,
  issuer: admin.issuer,
  subject: "family",
  verifiedEmail: "family@example.test",
};
test(
  "scoped typed clinical history, reviewed labs and version-specific release",
  { timeout: 120_000 },
  async (t) => {
    const { database, runtimeUrl, migrationUrl } = await startTestDatabase(t);
    const sql = new pg.Client({ connectionString: database.getConnectionUri() }),
      db = new PrismaDatabase(runtimeUrl);
    await sql.connect();
    try {
      const org = randomUUID(),
        clinic = randomUUID(),
        other = randomUUID(),
        patient = randomUUID(),
        second = randomUUID(),
        encounter = randomUUID(),
        id = randomUUID();
      await sql.query("INSERT INTO organizations(id,name) VALUES($1,'Org')", [org]);
      await sql.query(
        "INSERT INTO clinics(id,organization_id,name) VALUES($1,$3,'Clinic'),($2,$3,'Other')",
        [clinic, other, org],
      );
      const {
        rows: [user],
      } = await sql.query(
        "INSERT INTO users(identity_issuer,identity_subject) VALUES($1,$2) RETURNING id",
        [admin.issuer, admin.subject],
      );
      await sql.query("INSERT INTO organization_memberships VALUES($1,$2,'ADMIN')", [org, user.id]);
      await db.saveMember(admin, org, nurse.subject, "STAFF", [clinic], 0);
      for (const pid of [patient, second])
        await db.savePatient(admin, org, clinic, pid, {
          name: "Patient",
          species: "Dog",
          birthDate: null,
          revision: 0,
        });
      const at = "2026-11-22T15:00:00.000Z";
      await db.saveEncounter(nurse, org, clinic, patient, encounter, {
        occurredAt: at,
        reason: "Visit",
        subjective: "Observed",
        objective: "",
        assessment: "",
        plan: "",
      });
      const guardian = randomUUID(),
        digest = createHash("sha256").update(randomUUID()).digest("hex");
      await db.addGuardian(admin, org, clinic, patient, guardian, {
        name: "Guardian",
        email: owner.verifiedEmail,
      });
      await db.issuePetLink(admin, org, clinic, patient, guardian, {
        requestId: randomUUID(),
        digest,
        lifetimeSeconds: 600,
      });
      const { petId } = await db.redeemPetLink(owner, {
        digest,
        requestId: randomUUID(),
        attemptLimit: 5,
        windowSeconds: 60,
      });
      const save = (record: string, body: ClinicalWrite, request = randomUUID(), actor = nurse) =>
        db.saveClinicalRevision(actor, org, clinic, patient, record, request, body);
      const share = (
        record: string,
        recordRevision: number,
        revision: number,
        guardianIds: string[],
      ) =>
        db.shareClinicalRecord(nurse, org, clinic, patient, record, {
          revision,
          recordRevision,
          guardianIds,
        });
      const scope = { organizationId: org, clinicId: clinic, patientId: patient },
        selection = (version: string) => ({
          encounterIds: [],
          documentAssetIds: [],
          includeOwner: false,
          clinicalRevisionIds: [version],
        });
      const draft = {
        kind: "diagnosis" as const,
        occurredAt: at,
        encounterId: encounter,
        revision: 0,
        data: { diagnosis: "Entered finding", code: "CL-1" },
      };
      await t.test(
        "retry identity, concurrent corrections, correction history and selective export",
        async () => {
          const key = randomUUID(),
            [a, b] = await Promise.all([save(id, draft, key), save(id, draft, key)]);
          assert.deepEqual(a, b);
          await assert.rejects(save(id, draft, key, admin), { code: "conflict" });
          await assert.rejects(
            db.saveClinicalRevision(nurse, org, clinic, second, randomUUID(), randomUUID(), draft),
            { code: "not_found" },
          );
          await assert.rejects(db.listClinicalRecords(nurse, org, other, patient, 1), {
            code: "forbidden",
          });
          assert.equal((await db.listOwnerClinicalRecords(owner, petId, 1)).records.length, 0);
          await share(id, 1, 0, [guardian]);
          assert.equal(
            (await db.listOwnerClinicalRecords(owner, petId, 1)).records[0]?.revisionId,
            a.revisionId,
          );
          assert.equal(
            (await db.ownerExportChoices(owner, petId, scope, 1)).records[0]?.kind,
            "clinical",
          );
          const snap = await db.ownerExportSource(owner, petId, scope, selection(a.revisionId));
          assert.equal(snap.clinical?.[0]?.id, a.revisionId);
          await db.confirmOwnerExport(
            owner,
            petId,
            scope,
            selection(a.revisionId),
            { organizationId: org, clinicId: other },
            randomUUID(),
          );
          const changed = {
            ...draft,
            revision: 1,
            changeReason: "Amended finding",
            data: { diagnosis: "Corrected wording" },
          };
          const race = await Promise.allSettled([save(id, changed), save(id, changed)]);
          assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
          const history = await db.clinicalHistory(nurse, org, clinic, patient, id, 1);
          assert.deepEqual(
            history.records.map((r) => r.revision),
            [2, 1],
          );
          assert.equal((await db.listOwnerClinicalRecords(owner, petId, 1)).records.length, 0);
          await assert.rejects(db.ownerExportSource(owner, petId, scope, selection(a.revisionId)), {
            code: "not_found",
          });
          await assert.rejects(
            db.confirmOwnerExport(
              owner,
              petId,
              scope,
              selection(a.revisionId),
              { organizationId: org, clinicId: other },
              randomUUID(),
            ),
            { code: "not_found" },
          );
          await assert.rejects(share(id, 1, 0, [guardian]), { code: "conflict" });
          await share(id, 2, 0, [guardian]);
          await share(id, 2, 1, []);
          assert.equal((await db.listOwnerClinicalRecords(owner, petId, 1)).records.length, 0);
        },
      );
      await t.test("typed data and lab order, result, review, correction and release", async () => {
        for (const body of [
          { kind: "treatment", data: { treatment: "Recorded care", notes: "Observation" } },
          {
            kind: "vaccination",
            data: { vaccine: "Named product", lotNumber: "LOT", nextDueDate: "2027-01-01" },
          },
        ] as const) {
          const saved = await save(randomUUID(), { ...draft, ...body });
          assert.deepEqual(saved.data, body.data);
        }
        await assert.rejects(
          save(randomUUID(), {
            ...draft,
            kind: "vaccination",
            data: { vaccine: "Named", nextDueDate: "2026-02-31" },
          }),
          { code: "invalid" },
        );
        const lab = randomUUID(),
          order = {
            ...draft,
            kind: "lab" as const,
            data: { test: "Panel", specimen: "Recorded sample", status: "ORDERED" as const },
          };
        const result = {
          ...order,
          revision: 1,
          changeReason: "Result received",
          data: {
            ...order.data,
            status: "RESULTED" as const,
            result: "Entered value",
            unit: "units",
          },
        };
        await assert.rejects(save(lab, { ...result, revision: 0 }), { code: "invalid" });
        await save(lab, order);
        await assert.rejects(share(lab, 1, 0, [guardian]), { code: "conflict" });
        const finding = await save(lab, result);
        const review = {
          ...result,
          revision: 2,
          changeReason: "Reviewed",
          data: { ...result.data, status: "REVIEWED" as const },
        };
        await assert.rejects(
          save(lab, { ...review, data: { ...review.data, result: "Changed" } }),
          { code: "conflict" },
        );
        const reviewed = await save(lab, review, randomUUID(), admin);
        await share(lab, 3, 0, [guardian]);
        const record = (
          await db.ownerExportSource(owner, petId, scope, selection(reviewed.revisionId))
        ).clinical![0]!;
        assert.equal(record.kind, "labResult");
        assert.equal(record.author.subject, admin.subject);
        assert.equal(record.clinicalRevision.resultAuthor?.subject, nurse.subject);
        assert.equal(record.clinicalRevision.resultRecordedAt, finding.recordedAt);
        const source = { organizationId: org, clinicId: clinic },
          target = { organizationId: org, clinicId: other };
        const clinics = await Promise.all(
          [source, target].map(async (location) => {
            const keys = await generateExchangeKeys(location);
            return {
              ...location,
              name: "Clinic",
              signing: [keys.signing.privateKey],
              encryption: [keys.encryption.privateKey],
            };
          }),
        );
        const archives = new Map<string, Buffer>();
        // Integration runs against the compiled Nest entry points.
        const api = "../../../apps/api/dist/exchange/";
        const { ExchangeService } = await import(api + "service.js");
        const { ExchangeKeyDirectory } = await import(api + "keyring.js");
        const service = new ExchangeService({
          database: db,
          keys: ExchangeKeyDirectory.parse({
            version: 1,
            clinics,
            routes: [{ source, destination: target }],
          }),
          settings: { keyDirectoryPath: "/fixture", maxRecords: 10, maxPackageBytes: 200000 },
          storage: {
            async put(key: string, bytes: Buffer) {
              archives.set(key, bytes);
            },
            async read(key: string) {
              const bytes = archives.get(key);
              if (!bytes) throw new Error("Missing archive");
              return bytes;
            },
          },
        });
        let local = "";
        for (let i = 0; i < 2; i++) {
          const pkg = await service.export(
            owner,
            petId,
            scope,
            target,
            selection(reviewed.revisionId),
          );
          const receipt = await service.preview(admin, target, await buffer(pkg.getStream()));
          const committed = await service.commit(
            admin,
            target,
            receipt.receiptId,
            local ? { mode: "match", patientId: local } : { mode: "create" },
          );
          local = committed.patientId;
          assert.equal(committed.inserted, i === 0 ? 1 : 0);
          assert.equal(committed.skipped, i);
        }
        const imported = (await db.listImportedRecords(admin, org, other, local, 1)).records;
        assert.equal(imported.length, 1);
        assert.equal(imported[0]!.id, reviewed.revisionId);
        assert.deepEqual(imported[0]!.clinicalRevision, record.clinicalRevision);
        assert.deepEqual(imported[0]!.author, record.author);
        assert.deepEqual(imported[0]!.data, record.data);
        await save(lab, {
          ...result,
          revision: 3,
          changeReason: "Corrected laboratory report",
          data: { ...result.data, result: "Corrected value" },
        });
        assert.equal((await db.listOwnerClinicalRecords(owner, petId, 1)).records.length, 0);
      });
      await t.test(
        "withdrawn guardian links and revoked staff grants cut off reads and the restricted roles cannot alter history",
        async () => {
          const saved = await save(randomUUID(), draft);
          await share(saved.id, 1, 0, [guardian]);
          await db.removeGuardian(admin, org, clinic, patient, guardian);
          await assert.rejects(db.listOwnerClinicalRecords(owner, petId, 1), { code: "not_found" });
          await assert.rejects(
            db.ownerExportSource(owner, petId, scope, selection(saved.revisionId)),
            { code: "not_found" },
          );
          await db.saveMember(admin, org, nurse.subject, "STAFF", [other], 1);
          await assert.rejects(db.clinicalHistory(nurse, org, clinic, patient, saved.id, 1), {
            code: "forbidden",
          });
          const runtime = new pg.Client({ connectionString: runtimeUrl }),
            writer = new pg.Client({ connectionString: migrationUrl });
          await Promise.all([runtime.connect(), writer.connect()]);
          try {
            for (const table of ["clinical_record_heads", "clinical_record_revisions"]) {
              for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
                const { rows } = await runtime.query(
                  "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
                  [table, privilege],
                );
                assert.equal(rows[0].allowed, false);
              }
            }
            await writer.query("BEGIN");
            await writer.query(
              "SELECT set_config('vetx.identity_issuer',$1,true),set_config('vetx.identity_subject',$2,true),set_config('vetx.organization_id',$3,true),set_config('vetx.clinic_id',$4,true),set_config('vetx.client_kind','staff',true)",
              [admin.issuer, admin.subject, org, clinic],
            );
            assert.ok(
              (await writer.query("SELECT revision FROM clinical_record_revisions")).rowCount,
            );
            assert.equal(
              (await writer.query("UPDATE clinical_record_revisions SET data='{}'::jsonb"))
                .rowCount,
              0,
            );
            assert.equal((await writer.query("DELETE FROM clinical_record_revisions")).rowCount, 0);
            await writer.query("ROLLBACK");
            await sql.query("ALTER TABLE clinical_record_heads NO FORCE ROW LEVEL SECURITY");
            try {
              await assert.rejects(db.checkReady(), /row security/i);
            } finally {
              await sql.query("ALTER TABLE clinical_record_heads FORCE ROW LEVEL SECURITY");
            }
          } finally {
            await Promise.all([runtime.end(), writer.end()]);
          }
        },
      );
      await db.checkReady();
    } finally {
      await db.onApplicationShutdown();
      await sql.end();
    }
  },
);
