import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaDatabase } from "@vetx/database";
import pg from "pg";
import { startTestDatabase } from "./postgres.ts";

const digest = () => createHash("sha256").update(randomUUID()).digest("hex");
const issuer = "https://identity.example/realm";
const admin = { issuer, subject: "administrator", kind: "staff" as const };
const employee = { ...admin, subject: "employee" };
const owner = {
  issuer,
  subject: "owner",
  kind: "owner" as const,
  verifiedEmail: "Owner@Example.org",
};
const restricted = { code: "forbidden" };
const missing = { code: "not_found" };
const conflict = { code: "conflict" };

test(
  "the patient registry scopes official records, contacts and recipient-bound links",
  { timeout: 120_000 },
  async (t) => {
    const { database, runtimeUrl } = await startTestDatabase(t);
    const sql = new pg.Client({ connectionString: database.getConnectionUri() });
    await sql.connect();
    const db = new PrismaDatabase(runtimeUrl);
    try {
      const north = randomUUID(),
        south = randomUUID(),
        a = randomUUID(),
        b = randomUUID(),
        c = randomUUID();
      await sql.query("INSERT INTO organizations(id,name) VALUES($1,'North'),($2,'South')", [
        north,
        south,
      ]);
      await sql.query(
        "INSERT INTO clinics(id,organization_id,name) VALUES($1,$4,'Alpha'),($2,$4,'Beta'),($3,$5,'Gamma')",
        [a, b, c, north, south],
      );
      const {
        rows: [user],
      } = await sql.query(
        "INSERT INTO users(identity_issuer,identity_subject) VALUES($1,$2) RETURNING id",
        [issuer, admin.subject],
      );
      await sql.query(
        "INSERT INTO organization_memberships VALUES($1,$3,'ADMIN'),($2,$3,'ADMIN')",
        [north, south, user.id],
      );
      await db.saveMember(admin, north, employee.subject, "STAFF", [a], 0);
      const patientId = randomUUID(),
        secondId = randomUUID(),
        remoteId = patientId;
      const form = { name: "Pepper", species: "Dog", birthDate: "2020-01-02", revision: 0 };
      const patient = await db.savePatient(employee, north, a, patientId, form);
      assert.deepEqual(patient, { id: patientId, ...form, revision: 1 });
      assert.deepEqual(await db.savePatient(employee, north, a, patientId, form), patient);
      await db.savePatient(admin, south, c, remoteId, form);
      await db.savePatient(admin, north, a, secondId, { ...form, name: "Fern" });
      await assert.rejects(db.listPatients(employee, north, b, 1, ""), restricted);
      await assert.rejects(db.getPatient(employee, south, c, remoteId), restricted);
      await assert.rejects(db.getPatient(employee, north, a, randomUUID()), missing);
      assert.deepEqual((await db.listPatients(employee, north, a, 1, "pep")).patients, [patient]);
      assert.deepEqual((await db.listPatients(employee, north, a, 1, "%")).patients, []);
      await assert.rejects(
        db.savePatient(employee, north, a, patientId, { ...form, name: "New" }),
        conflict,
      );
      const guardianId = randomUUID(),
        another = randomUUID(),
        remoteGuardian = randomUUID();
      const contact = { name: "Sam", email: "owner@example.org" };
      assert.deepEqual(await db.addGuardian(employee, north, a, patientId, guardianId, contact), {
        id: guardianId,
        ...contact,
        linked: false,
      });
      await db.addGuardian(employee, north, a, secondId, randomUUID(), contact);
      await assert.rejects(
        db.addGuardian(employee, north, a, secondId, randomUUID(), { ...contact, name: "Other" }),
        conflict,
      );
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int AS n FROM owner_contacts WHERE organization_id=$1 AND clinic_id=$2",
            [north, a],
          )
        ).rows[0].n,
        1,
      );
      await db.addGuardian(admin, south, c, remoteId, remoteGuardian, contact);
      await db.addGuardian(employee, north, a, patientId, another, {
        name: "Pat",
        email: "other@example.org",
      });
      const issue = { requestId: randomUUID(), digest: digest(), lifetimeSeconds: 600 };
      assert.deepEqual(
        await db.issuePetLink(employee, north, a, patientId, guardianId, issue),
        await db.issuePetLink(employee, north, a, patientId, guardianId, issue),
      );
      const active = { ...issue, requestId: randomUUID(), digest: digest() };
      await db.issuePetLink(employee, north, a, patientId, guardianId, active);
      await assert.rejects(
        db.issuePetLink(employee, north, a, patientId, guardianId, issue),
        conflict,
      );
      const claim = {
        digest: active.digest,
        requestId: randomUUID(),
        attemptLimit: 8,
        windowSeconds: 900,
      };
      await assert.rejects(db.redeemPetLink(owner, { ...claim, digest: issue.digest }), missing);
      await assert.rejects(
        db.redeemPetLink({ ...owner, verifiedEmail: undefined }, claim),
        restricted,
      );
      await assert.rejects(
        db.redeemPetLink({ ...owner, issuer: issuer + "/different" }, claim),
        missing,
      );
      await assert.rejects(
        db.redeemPetLink({ ...owner, verifiedEmail: "wrong@example.org" }, claim),
        missing,
      );
      const [first, retry] = await Promise.all([
        db.redeemPetLink(owner, claim),
        db.redeemPetLink(owner, claim),
      ]);
      assert.deepEqual(first, retry);
      await assert.rejects(db.redeemPetLink({ ...owner, subject: "someone-else" }, claim), missing);
      await assert.rejects(db.redeemPetLink(owner, { ...claim, requestId: randomUUID() }), missing);
      assert.deepEqual(
        (await db.getPatient(employee, north, a, patientId)).guardians.find(
          (g) => g.id === guardianId,
        ),
        { id: guardianId, ...contact, linked: true },
      );
      const fromSouth = { ...active, requestId: randomUUID(), digest: digest() };
      await db.issuePetLink(admin, south, c, remoteId, remoteGuardian, fromSouth);
      const southClaim = {
        ...claim,
        digest: fromSouth.digest,
        requestId: randomUUID(),
        existingPetId: first.petId,
      };
      await assert.rejects(
        db.redeemPetLink({ ...owner, subject: "someone-else" }, southClaim),
        missing,
      );
      assert.deepEqual(await db.redeemPetLink(owner, southClaim), first);
      const [pet] = (await db.listOwnerPets({ ...owner, verifiedEmail: "changed@example.org" }))
        .pets;
      assert.equal(pet?.id, first.petId);
      assert.deepEqual(pet?.clinics.map((c) => c.clinicName).sort(), ["Alpha", "Gamma"]);
      assert.deepEqual((await db.listOwnerPets({ ...owner, subject: "someone-else" })).pets, []);
      await db.removeGuardian(employee, north, a, patientId, guardianId);
      await db.removeGuardian(employee, north, a, patientId, guardianId);
      assert.deepEqual((await db.listOwnerPets(owner)).pets[0]?.clinics, [
        { recordId: remoteId, clinicId: c, clinicName: "Gamma", organizationName: "South" },
      ]);
      await assert.rejects(db.redeemPetLink(owner, claim), missing);
      const guesses = { ...claim, digest: digest(), attemptLimit: 2 };
      const guesser = { ...owner, subject: "guesser" };
      await assert.rejects(db.redeemPetLink(guesser, guesses), missing);
      await assert.rejects(db.redeemPetLink(guesser, guesses), missing);
      await assert.rejects(db.redeemPetLink(guesser, guesses), { code: "rate_limited" });
      const audits = await sql.query(
        "SELECT action FROM registry_events WHERE organization_id=$1 AND clinic_id=$2 AND patient_id=$3 ORDER BY id",
        [north, a, patientId],
      );
      assert.deepEqual(
        audits.rows.map((r) => r.action),
        [
          "PATIENT_CREATED",
          "GUARDIAN_ADDED",
          "GUARDIAN_ADDED",
          "LINK_ISSUED",
          "LINK_ISSUED",
          "LINK_REDEEMED",
          "GUARDIAN_REMOVED",
        ],
      );
      // One clinic guardian may revoke access while another guardian remains independently authorized.
      const secondGuardianClaim = { ...claim, digest: digest(), requestId: randomUUID() };
      await db.issuePetLink(employee, north, a, patientId, another, {
        ...issue,
        requestId: randomUUID(),
        digest: secondGuardianClaim.digest,
      });
      const pat = { ...owner, subject: "pat", verifiedEmail: "other@example.org" };
      const sam = { ...pat, subject: "other-identity-sharing-address" };
      const sameAddressRace = await Promise.allSettled([
        db.redeemPetLink(pat, secondGuardianClaim),
        db.redeemPetLink(sam, secondGuardianClaim),
      ]);
      assert.equal(sameAddressRace.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(
        sameAddressRace.find((result) => result.status === "rejected")?.reason.code,
        "not_found",
      );
      const patPets = await db.listOwnerPets(pat),
        samPets = await db.listOwnerPets(sam);
      assert.equal(patPets.pets.length + samPets.pets.length, 1);
      assert.deepEqual([...patPets.pets, ...samPets.pets][0]!.clinics, [
        { recordId: patientId, clinicId: a, clinicName: "Alpha", organizationName: "North" },
      ]);
      await db.removeGuardian(admin, south, c, remoteId, remoteGuardian);
      assert.deepEqual((await db.listOwnerPets(owner)).pets, []);

      const pendingGuardian = randomUUID(),
        expiredIssue = { ...issue, digest: digest(), requestId: randomUUID() };
      await db.addGuardian(employee, north, a, secondId, pendingGuardian, {
        name: "Penelope",
        email: "penelope@example.org",
      });
      await sql.query("UPDATE organizations SET pet_link_lifetime_seconds=17 WHERE id=$1", [north]);
      const { expiresAt } = await db.issuePetLink(
        employee,
        north,
        a,
        secondId,
        pendingGuardian,
        expiredIssue,
      );
      const now = (await sql.query("SELECT clock_timestamp() AS now")).rows[0].now as Date;
      assert.ok(Math.abs(Date.parse(expiresAt) - now.getTime() - 17_000) < 3_000);
      await sql.query(
        "UPDATE guardians SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [pendingGuardian],
      );
      const penelope = { ...owner, subject: "penelope", verifiedEmail: "penelope@example.org" };
      await assert.rejects(
        db.redeemPetLink(penelope, { ...claim, digest: expiredIssue.digest }),
        missing,
      );
      await assert.rejects(
        db.issuePetLink(employee, north, a, secondId, pendingGuardian, expiredIssue),
        conflict,
      );
      const withdrawnIssue = { ...expiredIssue, requestId: randomUUID(), digest: digest() };
      await db.issuePetLink(employee, north, a, secondId, pendingGuardian, withdrawnIssue);
      await db.removeGuardian(employee, north, a, secondId, pendingGuardian);
      await assert.rejects(
        db.redeemPetLink(penelope, { ...claim, digest: withdrawnIssue.digest }),
        missing,
      );
      assert.deepEqual(await db.listOwnerPets(penelope), { pets: [] });
      const edited = await db.savePatient(employee, north, a, patientId, {
        ...form,
        name: "Pepperoni",
        revision: 1,
      });
      assert.equal(edited.revision, 2);
      await assert.rejects(
        db.savePatient(employee, north, a, patientId, {
          ...form,
          birthDate: "2025-02-31",
          revision: 2,
        }),
        { code: "invalid" },
      );
      await assert.rejects(db.listOwnerPets(admin as unknown as typeof owner), restricted);

      const runtime = new pg.Client({ connectionString: runtimeUrl });
      await runtime.connect();
      try {
        for (const table of [
          "patients",
          "owner_contacts",
          "guardians",
          "registry_events",
          "pet_link_attempts",
        ]) {
          await assert.rejects(runtime.query("SELECT * FROM " + table), { code: "42501" });
          await assert.rejects(runtime.query("DELETE FROM " + table), { code: "42501" });
        }
        await assert.rejects(runtime.query("SELECT vetx_registry.clinic_access(true)"), {
          code: "42501",
        });
        await sql.query("ALTER TABLE guardians NO FORCE ROW LEVEL SECURITY");
        try {
          await assert.rejects(db.listOwnerPets(owner), /row security/i);
        } finally {
          await sql.query("ALTER TABLE guardians FORCE ROW LEVEL SECURITY");
        }
        await db.checkReady();
      } finally {
        await runtime.end();
      }
    } finally {
      await Promise.all([sql.end(), db.onApplicationShutdown()]);
    }
  },
);
