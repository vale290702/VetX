import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { type AppointmentInput, PrismaDatabase } from "@vetx/database";
import pg from "pg";
import { startTestDatabase } from "./postgres.ts";

const forbidden = { code: "forbidden" };
const missing = { code: "not_found" };
const conflict = { code: "conflict" };
const invalid = { code: "invalid" };
const staff = { kind: "staff" as const, issuer: "https://clinical.example", subject: "clinician" };
const employee = { ...staff, subject: "assistant" };
const owner = {
  issuer: staff.issuer,
  subject: "family",
  kind: "owner" as const,
  verifiedEmail: "sam@example.org",
};
const note = {
  occurredAt: "2026-06-12T10:00:00-06:00",
  reason: "Exam",
  subjective: "S",
  objective: "O",
  assessment: "A",
  plan: "P",
};

test("clinic care on PostgreSQL", { timeout: 120_000 }, async (t) => {
  const { database, runtimeUrl, migrationUrl } = await startTestDatabase(t);
  const sql = new pg.Client({ connectionString: database.getConnectionUri() });
  const db = new PrismaDatabase(runtimeUrl);
  await sql.connect();
  try {
    const org = randomUUID(),
      clinic = randomUUID(),
      other = randomUUID(),
      patient = randomUUID(),
      second = randomUUID(),
      id = randomUUID();
    await sql.query("INSERT INTO organizations(id,name) VALUES ($1,'North')", [org]);
    await sql.query(
      "INSERT INTO clinics(id,organization_id,name) VALUES ($1,$3,'Hospital'), ($2,$3,'Office')",
      [clinic, other, org],
    );
    const {
      rows: [user],
    } = await sql.query(
      "INSERT INTO users(identity_issuer,identity_subject) VALUES ($1,$2) RETURNING id",
      [staff.issuer, staff.subject],
    );
    await sql.query("INSERT INTO organization_memberships VALUES ($1,$2,'ADMIN')", [org, user.id]);
    await db.saveMember(staff, org, employee.subject, "STAFF", [clinic], 0);
    const data = { name: "Pepper", species: "Dog", birthDate: null, revision: 0 };
    await db.savePatient(staff, org, clinic, patient, data);
    await db.savePatient(staff, org, other, patient, data);
    await db.savePatient(staff, org, clinic, second, { ...data, name: "Mina" });

    await t.test(
      "attributed clinical entries are append-only and retries are author-bound",
      async () => {
        const saved = await db.saveEncounter(employee, org, clinic, patient, id, note);
        assert.equal(saved.occurredAt, "2026-06-12T16:00:00.000Z");
        assert.match(saved.recordedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        assert.equal(saved.authorSubject, employee.subject);
        assert.equal(saved.authorIssuer, employee.issuer);
        assert.deepEqual(saved.sharing, { guardianIds: [], revision: 0 });
        assert.deepEqual(
          await db.saveEncounter(employee, org, clinic, patient, id, {
            ...note,
            occurredAt: saved.occurredAt,
          }),
          saved,
        );
        await assert.rejects(db.saveEncounter(staff, org, clinic, patient, id, note), conflict);
        await assert.rejects(
          db.saveEncounter(employee, org, clinic, patient, id, { ...note, plan: "Different" }),
          conflict,
        );
        await assert.rejects(
          db.saveEncounter(staff, org, clinic, second, randomUUID(), { ...note, addendumTo: id }),
          missing,
        );
        await assert.rejects(
          db.saveEncounter(staff, org, clinic, patient, randomUUID(), {
            ...note,
            subjective: " ",
            objective: "",
            assessment: "",
            plan: "\n",
          }),
          invalid,
        );
        await assert.rejects(
          db.saveEncounter(staff, org, clinic, patient, randomUUID(), {
            ...note,
            occurredAt: "2026-06-12T10:00:00",
          }),
          invalid,
        );
        await assert.rejects(
          db.saveEncounter(staff, org, clinic, patient, randomUUID(), {
            ...note,
            occurredAt: "2026-02-31T12:00:00Z",
          }),
          invalid,
        );
        assert.deepEqual(await db.listEncounters(employee, org, clinic, patient, 1), {
          page: 1,
          hasNextPage: false,
          encounters: [saved],
        });
        assert.deepEqual((await db.listEncounters(staff, org, other, patient, 1)).encounters, []);
        await assert.rejects(db.listEncounters(employee, org, other, patient, 1), forbidden);
        await assert.rejects(db.listEncounters(employee, org, clinic, randomUUID(), 1), missing);
        const audit = await sql.query(
          "SELECT action,actor_subject FROM care_events WHERE resource_id=$1",
          [id],
        );
        assert.deepEqual(audit.rows, [
          { action: "ENCOUNTER_RECORDED", actor_subject: employee.subject },
        ]);
      },
    );

    async function link(selectedClinic: string, actor: typeof owner, existingPetId?: string) {
      const guardian = randomUUID(),
        digest = createHash("sha256").update(randomUUID()).digest("hex");
      await db.addGuardian(staff, org, selectedClinic, patient, guardian, {
        name: "Guardian",
        email: actor.verifiedEmail,
      });
      await db.issuePetLink(staff, org, selectedClinic, patient, guardian, {
        requestId: randomUUID(),
        digest,
        lifetimeSeconds: 600,
      });
      const { petId } = await db.redeemPetLink(actor, {
        digest,
        requestId: randomUUID(),
        attemptLimit: 10,
        windowSeconds: 60,
        ...(existingPetId ? { existingPetId } : {}),
      });
      return { guardian, petId };
    }
    await t.test(
      "releases follow the particular guardian and source record, including redacted addenda and immediate revocation",
      async () => {
        const own = await link(clinic, owner);
        const sibling = { ...owner, subject: "sibling", verifiedEmail: "pat@example.org" };
        const otherOwner = await link(clinic, sibling);
        const remote = await link(other, owner, own.petId);
        await db.saveEncounter(staff, org, other, patient, id, { ...note, reason: "Office visit" });
        const addendum = randomUUID();
        await db.saveEncounter(staff, org, clinic, patient, addendum, {
          ...note,
          reason: "Correction",
          addendumTo: id,
        });
        const release = { guardianIds: [own.guardian], revision: 0 };
        const share = await db.shareEncounter(staff, org, clinic, patient, addendum, release);
        assert.deepEqual(share, { ...release, revision: 1 });
        assert.deepEqual(
          await db.shareEncounter(staff, org, clinic, patient, addendum, release),
          share,
        );
        await assert.rejects(
          db.shareEncounter(staff, org, clinic, patient, addendum, {
            guardianIds: [],
            revision: 0,
          }),
          conflict,
        );
        await assert.rejects(
          db.shareEncounter(staff, org, clinic, patient, id, {
            guardianIds: [remote.guardian],
            revision: 0,
          }),
          missing,
        );
        const pending = randomUUID();
        await db.addGuardian(staff, org, clinic, patient, pending, {
          name: "Pending",
          email: "pending@example.org",
        });
        await assert.rejects(
          db.shareEncounter(staff, org, clinic, patient, id, {
            guardianIds: [pending],
            revision: 0,
          }),
          missing,
        );
        await db.shareEncounter(staff, org, other, patient, id, {
          guardianIds: [remote.guardian],
          revision: 0,
        });
        const changedEmail = { ...owner, verifiedEmail: "moved@example.org" };
        const visible = await db.listOwnerEncounters(changedEmail, own.petId, 1);
        assert.equal(visible.encounters.length, 2);
        const correction = visible.encounters.find((e) => e.id === addendum);
        assert.equal(correction?.addendumTo, null);
        assert.equal(correction?.clinicId, clinic);
        assert.equal(correction?.clinicName, "Hospital");
        assert.equal(correction?.organizationName, "North");
        assert.equal(correction?.patientId, patient);
        assert.ok(
          correction &&
            !("authorSubject" in correction) &&
            !("authorIssuer" in correction) &&
            !("sharing" in correction),
        );
        assert.deepEqual(
          (await db.listOwnerEncounters(sibling, otherOwner.petId, 1)).encounters,
          [],
        );
        await assert.rejects(db.listOwnerEncounters(owner, otherOwner.petId, 1), missing);
        await assert.rejects(
          db.listOwnerEncounters({ ...owner, issuer: staff.issuer + "/elsewhere" }, own.petId, 1),
          missing,
        );
        await db.shareEncounter(staff, org, clinic, patient, id, {
          guardianIds: [own.guardian, otherOwner.guardian],
          revision: 0,
        });
        const all = (await db.listOwnerEncounters(owner, own.petId, 1)).encounters;
        assert.equal(all.length, 3);
        assert.equal(all.find((e) => e.id === addendum)?.addendumTo, id);
        await db.shareEncounter(staff, org, clinic, patient, id, {
          guardianIds: [otherOwner.guardian],
          revision: 1,
        });
        assert.equal(
          (await db.listOwnerEncounters(owner, own.petId, 1)).encounters.find(
            (e) => e.id === addendum,
          )?.addendumTo,
          null,
        );
        await db.removeGuardian(staff, org, clinic, patient, own.guardian);
        assert.deepEqual(
          (await db.listOwnerEncounters(owner, own.petId, 1)).encounters.map((e) => e.clinicId),
          [other],
        );
        assert.deepEqual(
          (await db.listOwnerEncounters(sibling, otherOwner.petId, 1)).encounters.map(
            (e) => e.clinicId,
          ),
          [clinic],
        );
        assert.equal(
          (
            await sql.query(
              "SELECT count(*)::int AS count FROM care_events WHERE action='ENCOUNTER_SHARING_CHANGED'",
            )
          ).rows[0].count,
          4,
        );
      },
    );

    await t.test(
      "appointment writes serialize overlaps, allow adjacent visits, preserve terminal states and audit only changes",
      async () => {
        const aid = randomUUID(),
          bid = randomUUID(),
          startAt = "2026-06-12T16:00:00.000Z",
          endAt = "2026-06-12T17:00:00.000Z";
        const input: AppointmentInput = {
          patientId: patient,
          startAt,
          endAt,
          reason: "Exam",
          status: "BOOKED",
          revision: 0,
        };
        const writes = await Promise.allSettled([
          db.saveAppointment(employee, org, clinic, aid, input),
          db.saveAppointment(employee, org, clinic, bid, input),
        ]);
        const applied = writes.filter((w) => w.status === "fulfilled");
        assert.equal(applied.length, 1);
        assert.equal(writes.find((w) => w.status === "rejected")?.reason.code, "overlap");
        const saved = applied[0]!.value;
        assert.deepEqual(saved, { ...input, revision: 1, id: saved.id, patientName: "Pepper" });
        assert.deepEqual(await db.saveAppointment(employee, org, clinic, saved.id, input), saved);
        await assert.rejects(db.saveAppointment(staff, org, clinic, saved.id, input), conflict);
        await assert.rejects(
          db.saveAppointment(employee, org, clinic, saved.id, {
            ...input,
            patientId: second,
            revision: 1,
          }),
          conflict,
        );
        const adjacent = await db.saveAppointment(employee, org, clinic, randomUUID(), {
          ...input,
          startAt: endAt,
          endAt: "2026-06-12T18:00:00Z",
        });
        await db.saveAppointment(staff, org, other, saved.id, input);
        await db.saveAppointment(employee, org, clinic, randomUUID(), {
          ...input,
          patientId: second,
        });
        const filter = { from: "2026-06-12T16:30:00Z", to: endAt, page: 1, patientId: patient };
        assert.deepEqual(await db.listAppointments(employee, org, clinic, filter), {
          page: 1,
          hasNextPage: false,
          appointments: [saved],
        });
        await assert.rejects(db.listAppointments(employee, org, other, filter), forbidden);
        await assert.rejects(
          db.saveAppointment(employee, org, clinic, randomUUID(), { ...input, endAt: startAt }),
          invalid,
        );
        await assert.rejects(
          db.saveAppointment(employee, org, clinic, randomUUID(), {
            ...input,
            status: "CANCELLED",
          }),
          invalid,
        );
        const cancelled = { ...input, revision: 1, status: "CANCELLED" as const };
        const finalized = await db.saveAppointment(employee, org, clinic, saved.id, cancelled);
        assert.deepEqual(
          await db.saveAppointment(employee, org, clinic, saved.id, cancelled),
          finalized,
        );
        await assert.rejects(
          db.saveAppointment(employee, org, clinic, saved.id, { ...input, revision: 2 }),
          conflict,
        );
        const replacement = await db.saveAppointment(employee, org, clinic, randomUUID(), input);
        await db.saveAppointment(employee, org, clinic, replacement.id, {
          ...input,
          status: "COMPLETED",
          revision: 1,
        });
        await assert.rejects(db.saveAppointment(employee, org, clinic, randomUUID(), input), {
          code: "overlap",
        });
        await assert.rejects(
          db.saveAppointment(employee, org, clinic, adjacent.id, {
            ...adjacent,
            startAt,
            revision: 1,
          }),
          { code: "overlap" },
        );
        const audit = await sql.query(
          "SELECT action,details->>'status' AS status FROM care_events WHERE clinic_id=$1 AND resource_id=$2 ORDER BY id",
          [clinic, saved.id],
        );
        assert.deepEqual(audit.rows, [
          { action: "APPOINTMENT_CREATED", status: "BOOKED" },
          { action: "APPOINTMENT_UPDATED", status: "CANCELLED" },
        ]);
      },
    );

    await t.test(
      "runtime cannot read raw clinical tables; the function owner cannot amend entries; readiness enforces forced RLS",
      async () => {
        const runtime = new pg.Client({ connectionString: runtimeUrl }),
          migration = new pg.Client({ connectionString: migrationUrl });
        await Promise.all([runtime.connect(), migration.connect()]);
        try {
          for (const table of [
            "clinical_encounters",
            "encounter_sharing",
            "encounter_recipients",
            "appointments",
            "care_events",
          ]) {
            await assert.rejects(runtime.query("SELECT * FROM " + table), { code: "42501" });
            await assert.rejects(runtime.query("DELETE FROM " + table), { code: "42501" });
          }
          await assert.rejects(runtime.query("SELECT vetx_care.utc(now())"), { code: "42501" });
          await migration.query("BEGIN");
          await migration.query(
            "SELECT set_config('vetx.identity_issuer',$1,true),set_config('vetx.identity_subject',$2,true),set_config('vetx.organization_id',$3,true),set_config('vetx.clinic_id',$4,true),set_config('vetx.client_kind','staff',true)",
            [staff.issuer, staff.subject, org, clinic],
          );
          assert.equal(
            (await migration.query("SELECT id FROM clinical_encounters WHERE id=$1", [id]))
              .rowCount,
            1,
          );
          assert.equal(
            (
              await migration.query("UPDATE clinical_encounters SET reason='altered' WHERE id=$1", [
                id,
              ])
            ).rowCount,
            0,
          );
          assert.equal(
            (await migration.query("DELETE FROM clinical_encounters WHERE id=$1", [id])).rowCount,
            0,
          );
          await migration.query("ROLLBACK");
          await sql.query("ALTER TABLE encounter_recipients NO FORCE ROW LEVEL SECURITY");
          try {
            await assert.rejects(
              db.listEncounters(staff, org, clinic, patient, 1),
              /row security/i,
            );
          } finally {
            await sql.query("ALTER TABLE encounter_recipients FORCE ROW LEVEL SECURITY");
          }
          await db.checkReady();
        } finally {
          await Promise.all([runtime.end(), migration.end()]);
        }
      },
    );
  } finally {
    await Promise.all([sql.end(), db.onApplicationShutdown()]);
  }
});
