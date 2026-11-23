import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaDatabase, type ReferralRequestInput } from "@vetx/database";
import pg from "pg";
import { startTestDatabase } from "./postgres.ts";

const sourceStaff = {
  kind: "staff" as const,
  issuer: "https://source.test",
  subject: "source-doctor",
};
const destinationStaff = {
  ...sourceStaff,
  issuer: "https://destination.test",
  subject: "specialist",
};
const owner = {
  kind: "owner" as const,
  issuer: sourceStaff.issuer,
  subject: "family",
  verifiedEmail: "family@example.test",
};
const anotherOwner = { ...owner, subject: "other-family", verifiedEmail: "other@example.test" };

test("consented clinic referrals on PostgreSQL", { timeout: 120_000 }, async (t) => {
  const { database, runtimeUrl, migrationUrl } = await startTestDatabase(t);
  const sql = new pg.Client({ connectionString: database.getConnectionUri() });
  const db = new PrismaDatabase(runtimeUrl);
  await sql.connect();
  try {
    const srcOrg = randomUUID(),
      dstOrg = randomUUID(),
      source = randomUUID(),
      dest = randomUUID(),
      neighbor = randomUUID(),
      patient = randomUUID();
    await sql.query(
      "INSERT INTO organizations(id,name) VALUES ($1,'Source practice'),($2,'Specialty group')",
      [srcOrg, dstOrg],
    );
    await sql.query(
      "INSERT INTO clinics(id,organization_id,name) VALUES ($1,$4,'Primary'),($2,$5,'Specialty'),($3,$5,'Other specialty')",
      [source, dest, neighbor, srcOrg, dstOrg],
    );
    for (const [staff, org] of [
      [sourceStaff, srcOrg],
      [destinationStaff, dstOrg],
    ] as const) {
      const {
        rows: [account],
      } = await sql.query(
        "INSERT INTO users(identity_issuer,identity_subject) VALUES ($1,$2) RETURNING id",
        [staff.issuer, staff.subject],
      );
      await sql.query("INSERT INTO organization_memberships VALUES ($1,$2,'ADMIN')", [
        org,
        account.id,
      ]);
    }
    const employee = { ...destinationStaff, subject: "technician" };
    await db.saveMember(destinationStaff, dstOrg, employee.subject, "STAFF", [dest], 0);
    await db.savePatient(sourceStaff, srcOrg, source, patient, {
      name: "Pepper",
      species: "Dog",
      birthDate: null,
      revision: 0,
    });
    async function link(person: typeof owner, existingPetId?: string) {
      const guardian = randomUUID();
      await db.addGuardian(sourceStaff, srcOrg, source, patient, guardian, {
        name: "Private contact",
        email: person.verifiedEmail,
      });
      const digest = createHash("sha256").update(randomUUID()).digest("hex");
      await db.issuePetLink(sourceStaff, srcOrg, source, patient, guardian, {
        digest,
        requestId: randomUUID(),
        lifetimeSeconds: 600,
      });
      const identity = person;
      const { petId } = await db.redeemPetLink(identity, {
        digest,
        requestId: randomUUID(),
        attemptLimit: 5,
        windowSeconds: 60,
        ...(existingPetId ? { existingPetId } : {}),
      });
      return { identity, guardian, petId };
    }
    const first = await link(owner),
      second = await link(anotherOwner);
    const request: ReferralRequestInput = {
      guardianId: first.guardian,
      destination: { organizationId: dstOrg, clinicId: dest },
      reason: "Specialist assessment",
      summary: "Relevant referral summary",
    };
    const save = (id = randomUUID(), details = request) =>
      db.requestReferral(sourceStaff, srcOrg, source, patient, id, details);
    const inbox = () =>
      db.listStaffReferrals(destinationStaff, dstOrg, dest, { direction: "incoming", page: 1 });
    const outgoing = () =>
      db.listStaffReferrals(sourceStaff, srcOrg, source, {
        direction: "outgoing",
        page: 1,
        patientId: patient,
      });
    const owners = () => db.listOwnerReferrals(first.identity, first.petId, 1);
    const approve = (ref: string, revision = 1) =>
      db.decideReferral(first.identity, first.petId, ref, { action: "approve", revision });
    const respond = (ref: string, summary = "Response from specialty clinic", revision = 2) =>
      db.respondReferral(destinationStaff, dstOrg, dest, ref, { revision, summary });
    const requestId = randomUUID();
    const referral = await save(requestId);

    await t.test(
      "source and only the chosen guardian see a pending request; tenant and compound clinic identities are verified",
      async () => {
        assert.deepEqual(referral, {
          id: referral.id,
          status: "REQUESTED",
          revision: 1,
          source: {
            organizationId: srcOrg,
            clinicId: source,
            organizationName: "Source practice",
            clinicName: "Primary",
          },
          destination: {
            organizationId: dstOrg,
            clinicId: dest,
            organizationName: "Specialty group",
            clinicName: "Specialty",
          },
          patient: { id: patient, name: "Pepper", species: "Dog" },
          reason: request.reason,
          summary: request.summary,
          requestedAt: referral.requestedAt,
          requestedBy: { issuer: sourceStaff.issuer, subject: sourceStaff.subject },
          response: null,
        });
        assert.match(referral.requestedAt, /Z$/);
        assert.deepEqual(await save(requestId), referral);
        assert.deepEqual((await outgoing()).referrals, [referral]);
        assert.deepEqual((await owners()).referrals, [referral]);
        assert.deepEqual((await inbox()).referrals, []);
        assert.deepEqual(
          (await db.listOwnerReferrals(second.identity, second.petId, 1)).referrals,
          [],
        );
        await assert.rejects(db.listOwnerReferrals(second.identity, first.petId, 1), {
          code: "not_found",
        });
        await assert.rejects(
          db.decideReferral(second.identity, second.petId, referral.id, {
            action: "approve",
            revision: 1,
          }),
          { code: "not_found" },
        );
        await assert.rejects(
          db.decideReferral(first.identity, randomUUID(), referral.id, {
            action: "approve",
            revision: 1,
          }),
          { code: "not_found" },
        );
        await assert.rejects(respond(referral.id), { code: "not_found" });
        await assert.rejects(save(requestId, { ...request, reason: "Changed" }), {
          code: "conflict",
        });
        await assert.rejects(
          save(randomUUID(), {
            ...request,
            destination: { organizationId: srcOrg, clinicId: dest },
          }),
          { code: "not_found" },
        );
        await assert.rejects(
          save(randomUUID(), {
            ...request,
            destination: { organizationId: srcOrg, clinicId: source },
          }),
          { code: "invalid" },
        );
        await assert.rejects(save(randomUUID(), { ...request, guardianId: randomUUID() }), {
          code: "not_found",
        });
        await assert.rejects(
          db.requestReferral(destinationStaff, srcOrg, source, patient, requestId, request),
          { code: "forbidden" },
        );
        await assert.rejects(
          db.listStaffReferrals(employee, dstOrg, neighbor, { direction: "incoming", page: 1 }),
          { code: "forbidden" },
        );
        await assert.rejects(save(randomUUID(), { ...request, reason: "   " }), {
          code: "invalid",
        });
        const coworker = { ...sourceStaff, subject: "second-doctor" };
        await db.saveMember(sourceStaff, srcOrg, coworker.subject, "STAFF", [source], 0);
        await assert.rejects(
          db.requestReferral(coworker, srcOrg, source, patient, requestId, request),
          { code: "conflict" },
        );
      },
    );

    await t.test(
      "consent exposes exactly the scoped referral and an immutable, attributed response",
      async () => {
        const approved = await approve(referral.id);
        assert.equal(approved.status, "APPROVED");
        assert.equal(approved.revision, 2);
        assert.deepEqual(await approve(referral.id), approved);
        await assert.rejects(
          db.decideReferral(first.identity, first.petId, referral.id, {
            action: "decline",
            revision: 1,
          }),
          { code: "conflict" },
        );
        assert.deepEqual((await inbox()).referrals, [approved]);
        assert.deepEqual(
          (await db.listStaffReferrals(employee, dstOrg, dest, { direction: "incoming", page: 1 }))
            .referrals,
          [approved],
        );
        await db.removeMember(destinationStaff, dstOrg, employee.subject, 1);
        await assert.rejects(
          db.respondReferral(employee, dstOrg, dest, referral.id, {
            revision: 2,
            summary: "Denied",
          }),
          { code: "forbidden" },
        );
        await db.saveMember(destinationStaff, dstOrg, employee.subject, "STAFF", [dest], 2);
        assert.deepEqual(
          (
            await db.listStaffReferrals(destinationStaff, dstOrg, neighbor, {
              direction: "incoming",
              page: 1,
            })
          ).referrals,
          [],
        );
        await assert.rejects(
          db.respondReferral(destinationStaff, dstOrg, neighbor, referral.id, {
            revision: 2,
            summary: "Other clinic",
          }),
          { code: "not_found" },
        );
        await assert.rejects(
          db.respondReferral(sourceStaff, srcOrg, source, referral.id, {
            revision: 2,
            summary: "Own response",
          }),
          { code: "not_found" },
        );
        await assert.rejects(respond(referral.id, "\n"), { code: "invalid" });
        const [left, right] = await Promise.all([respond(referral.id), respond(referral.id)]);
        assert.deepEqual(left, right);
        assert.equal(left.status, "RESPONDED");
        assert.equal(left.revision, 3);
        assert.ok(left.response);
        assert.deepEqual(left.response, {
          summary: "Response from specialty clinic",
          recordedAt: left.response.recordedAt,
          author: { issuer: destinationStaff.issuer, subject: destinationStaff.subject },
        });
        assert.match(left.response.recordedAt, /Z$/);
        await assert.rejects(respond(referral.id, "Changed response"), { code: "conflict" });
        await assert.rejects(
          db.respondReferral(employee, dstOrg, dest, referral.id, {
            revision: 2,
            summary: "Response from specialty clinic",
          }),
          { code: "conflict" },
        );
        assert.deepEqual((await owners()).referrals, [left]);
        assert.deepEqual((await outgoing()).referrals, [left]);
        assert.deepEqual((await inbox()).referrals, [left]);
        const withdrawn = await db.decideReferral(first.identity, first.petId, referral.id, {
          action: "withdraw",
          revision: 3,
        });
        assert.equal(withdrawn.status, "WITHDRAWN");
        assert.deepEqual(withdrawn.response, left.response);
        assert.deepEqual((await inbox()).referrals, []);
        assert.deepEqual((await owners()).referrals, [withdrawn]);
        await assert.rejects(respond(referral.id), { code: "not_found" });
        await assert.rejects(approve(referral.id, 4), { code: "conflict" });
        assert.deepEqual(
          (
            await sql.query(
              "SELECT action,revision,actor_subject FROM referral_events WHERE referral_id=$1 ORDER BY revision",
              [referral.id],
            )
          ).rows,
          [
            { action: "REQUESTED", revision: 1, actor_subject: sourceStaff.subject },
            { action: "APPROVED", revision: 2, actor_subject: first.identity.subject },
            { action: "RESPONDED", revision: 3, actor_subject: destinationStaff.subject },
            { action: "WITHDRAWN", revision: 4, actor_subject: first.identity.subject },
          ],
        );
      },
    );

    await t.test(
      "concurrent decisions serialize; a decline cannot be disclosed or overwritten",
      async () => {
        const declined = await save();
        const decide = (action: "approve" | "decline", ref = declined.id) =>
          db.decideReferral(first.identity, first.petId, ref, { action, revision: 1 });
        const d = await decide("decline");
        assert.equal(d.status, "DECLINED");
        assert.deepEqual(await decide("decline"), d);
        await assert.rejects(decide("approve"), { code: "conflict" });
        await assert.rejects(respond(declined.id), { code: "not_found" });
        const race = await save();
        const outcomes = await Promise.allSettled([
          decide("approve", race.id),
          decide("decline", race.id),
        ]);
        assert.equal(outcomes.filter((v) => v.status === "fulfilled").length, 1);
        assert.equal(outcomes.find((v) => v.status === "rejected")?.reason.code, "conflict");
        assert.equal(
          (
            await sql.query("SELECT count(*)::int AS n FROM referral_events WHERE referral_id=$1", [
              race.id,
            ])
          ).rows[0].n,
          2,
        );
      },
    );

    await t.test(
      "separate clinics in one organization respect consent and paginate only the selected guardian's referrals",
      async () => {
        const sister = randomUUID();
        await sql.query(
          "INSERT INTO clinics(id,organization_id,name) VALUES ($1,$2,'Sister clinic')",
          [sister, srcOrg],
        );
        const details = {
          ...request,
          guardianId: second.guardian,
          destination: { organizationId: srcOrg, clinicId: sister },
        };
        const initial = await save(randomUUID(), details);
        const incoming = () =>
          db.listStaffReferrals(sourceStaff, srcOrg, sister, { direction: "incoming", page: 1 });
        assert.deepEqual((await incoming()).referrals, []);
        const consented = await db.decideReferral(second.identity, second.petId, initial.id, {
          action: "approve",
          revision: 1,
        });
        assert.deepEqual((await incoming()).referrals, [consented]);
        for (let i = 0; i < 25; i++) await save(randomUUID(), details);
        const firstPage = await db.listOwnerReferrals(second.identity, second.petId, 1);
        const lastPage = await db.listOwnerReferrals(second.identity, second.petId, 2);
        assert.equal(firstPage.page, 1);
        assert.equal(firstPage.referrals.length, 25);
        assert.equal(firstPage.hasNextPage, true);
        assert.deepEqual(lastPage, { page: 2, hasNextPage: false, referrals: [consented] });
        assert.ok(
          firstPage.referrals.every(
            (r) => r.destination.clinicId === sister && r.status === "REQUESTED",
          ),
        );
        assert.deepEqual((await incoming()).referrals, [consented]);
      },
    );

    await t.test(
      "guardian removal and responses serialize, revoking destination access and preserving source history",
      async () => {
        const linked = await save();
        await approve(linked.id);
        const [unlink, reply] = await Promise.allSettled([
          db.removeGuardian(sourceStaff, srcOrg, source, patient, first.guardian),
          respond(linked.id),
        ]);
        assert.equal(unlink.status, "fulfilled");
        if (reply.status === "rejected") assert.equal(reply.reason.code, "not_found");
        assert.deepEqual((await inbox()).referrals, []);
        const historic = (await outgoing()).referrals.find((r) => r.id === linked.id)!;
        assert.equal(historic.status, "WITHDRAWN");
        assert.equal(Boolean(historic.response), reply.status === "fulfilled");
        await assert.rejects(respond(linked.id), { code: "not_found" });
        await assert.rejects(owners(), { code: "not_found" });
        await assert.rejects(approve(linked.id, 2), { code: "not_found" });
        assert.equal(
          (
            await sql.query(
              "SELECT action FROM referral_events WHERE referral_id=$1 ORDER BY revision DESC LIMIT 1",
              [linked.id],
            )
          ).rows[0].action,
          "GUARDIAN_UNLINKED",
        );
      },
    );

    await t.test(
      "authenticated HTTP requests enforce real database consent and current directory routes",
      async () => {
        const { createApplication } = await import(
          new URL("../../../apps/api/dist/application.js", import.meta.url).href
        );
        const principals = new Map<
          string,
          typeof sourceStaff | typeof destinationStaff | typeof second.identity
        >([
          ["source.jwt.test", sourceStaff],
          ["dest.jwt.test", destinationStaff],
          ["owner.jwt.test", second.identity],
        ] as const);
        let enabled = true;
        const destination = { organizationId: dstOrg, clinicId: dest };
        const app = await createApplication(db, false, {
          referrals: db,
          tokenVerifier: { verify: async (token: string) => principals.get(token) },
          referralDirectory: {
            destinations: () => [{ ...destination, name: "Specialty" }],
            allows: (
              src: { organizationId: string; clinicId: string },
              target: { organizationId: string; clinicId: string },
            ) =>
              enabled &&
              src.organizationId === srcOrg &&
              src.clinicId === source &&
              target.organizationId === dstOrg &&
              target.clinicId === dest,
          },
        });
        try {
          await app.listen(0, "127.0.0.1");
          const url = await app.getUrl();
          const call = (token: string, path: string, body?: unknown) =>
            fetch(url + path, {
              method: body === undefined ? "GET" : "PUT",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
              body: body === undefined ? undefined : JSON.stringify(body),
            });
          const staff = "/organizations/" + srcOrg + "/clinics/" + source;
          const target = "/organizations/" + dstOrg + "/clinics/" + dest + "/referrals";
          const ownerUrl = "/owner/pets/" + second.petId + "/referrals";
          const options = await call("source.jwt.test", staff + "/referrals/destinations");
          assert.equal(options.status, 200);
          assert.deepEqual(await options.json(), {
            destinations: [{ ...destination, name: "Specialty" }],
          });
          assert.equal(
            (await call("dest.jwt.test", staff + "/referrals/destinations")).status,
            403,
          );
          const pending = await call(
            "source.jwt.test",
            staff + "/patients/" + patient + "/referrals/" + randomUUID(),
            { ...request, guardianId: second.guardian },
          );
          assert.equal(pending.status, 200);
          const { id } = await pending.json();
          assert.ok(id);
          const recipient = async () => {
            const page = await call("dest.jwt.test", target + "?direction=incoming");
            assert.equal(page.status, 200);
            return (await page.json()).referrals as { id: string }[];
          };
          assert.ok(!(await recipient()).some((r) => r.id === id));
          assert.equal(
            (
              await call("dest.jwt.test", target + "/" + id + "/response", {
                summary: "Not shared",
                revision: 1,
              })
            ).status,
            404,
          );
          const decide = (action: string, revision: number) =>
            call("owner.jwt.test", ownerUrl + "/" + id + "/decision", { action, revision });
          assert.equal((await decide("approve", 1)).status, 200);
          assert.ok((await recipient()).some((r) => r.id === id));
          enabled = false;
          assert.ok(!(await recipient()).some((r) => r.id === id));
          assert.equal(
            (
              await call("dest.jwt.test", target + "/" + id + "/response", {
                summary: "No route",
                revision: 2,
              })
            ).status,
            404,
          );
          enabled = true;
          const answered = await call("dest.jwt.test", target + "/" + id + "/response", {
            summary: "Consultation result",
            revision: 2,
          });
          assert.equal(answered.status, 200);
          assert.equal((await answered.json()).response.author.subject, destinationStaff.subject);
          assert.equal((await decide("withdraw", 2)).status, 409);
          assert.equal((await decide("withdraw", 3)).status, 200);
          assert.ok(!(await recipient()).some((r) => r.id === id));
          const history = await call(
            "source.jwt.test",
            staff + "/referrals?direction=outgoing&patientId=" + patient,
          );
          assert.equal(history.status, 200);
          assert.equal(
            (await history.json()).referrals.find((r: { id: string }) => r.id === id).status,
            "WITHDRAWN",
          );
        } finally {
          await app.close();
        }
      },
    );

    await t.test(
      "no direct runtime DML or unscoped clinical reads; the function owner and readiness enforce protections",
      async () => {
        const runtime = new pg.Client({ connectionString: runtimeUrl }),
          migration = new pg.Client({ connectionString: migrationUrl });
        await Promise.all([runtime.connect(), migration.connect()]);
        try {
          for (const relation of [
            "referral_states",
            "referral_requests",
            "referral_responses",
            "referral_events",
          ]) {
            for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
              assert.equal(
                (
                  await runtime.query("SELECT has_table_privilege(current_user,$1,$2) AS allowed", [
                    relation,
                    privilege,
                  ])
                ).rows[0].allowed,
                false,
              );
            }
          }
          await assert.rejects(
            runtime.query("SELECT * FROM vetx_referral.clinic_label($1,$2)", [dstOrg, dest]),
            { code: "42501" },
          );
          await migration.query("BEGIN");
          await migration.query(
            "SELECT set_config('vetx.identity_issuer',$1,true),set_config('vetx.identity_subject',$2,true),set_config('vetx.organization_id',$3,true),set_config('vetx.clinic_id',$4,true),set_config('vetx.client_kind','staff',true)",
            [sourceStaff.issuer, sourceStaff.subject, srcOrg, source],
          );
          assert.equal(
            (await migration.query("SELECT FROM referral_responses WHERE id=$1", [referral.id]))
              .rowCount,
            1,
          );
          assert.equal(
            (
              await migration.query("UPDATE referral_requests SET summary='Changed' WHERE id=$1", [
                referral.id,
              ])
            ).rowCount,
            0,
          );
          assert.equal(
            (await migration.query("DELETE FROM referral_responses WHERE id=$1", [referral.id]))
              .rowCount,
            0,
          );
          await migration.query("ROLLBACK");
          await sql.query("ALTER TABLE referral_responses NO FORCE ROW LEVEL SECURITY");
          try {
            await assert.rejects(outgoing(), /row security/i);
          } finally {
            await sql.query("ALTER TABLE referral_responses FORCE ROW LEVEL SECURITY");
          }
          await db.checkReady();
        } finally {
          await Promise.all([runtime.end(), migration.end()]);
        }
      },
    );
  } finally {
    await Promise.all([db.onApplicationShutdown(), sql.end()]);
  }
});
