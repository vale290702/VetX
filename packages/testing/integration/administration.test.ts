import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaDatabase } from "@vetx/database";
import pg from "pg";
import { startTestDatabase } from "./postgres.ts";

test(
  "organization directory administration uses the restricted application connection",
  { timeout: 120_000 },
  async (t) => {
    const { database, runtimeUrl, migrationUrl } = await startTestDatabase(t);
    const operator = new pg.Client({ connectionString: database.getConnectionUri() });
    await operator.connect();

    const application = new PrismaDatabase(runtimeUrl);
    const issuer = "https://keys.test/realms/vetx";
    const administrator = { issuer, subject: "administrator", kind: "staff" as const };
    const staff = { ...administrator, subject: "new-staff" };

    async function organization() {
      const id = randomUUID();
      await operator.query("INSERT INTO organizations (id,name) VALUES ($1,'Directory test')", [
        id,
      ]);
      await operator.query(
        "INSERT INTO organization_memberships (organization_id,user_id,role) SELECT $1,id,'ADMIN' FROM users WHERE identity_issuer=$2 AND identity_subject=$3",
        [id, issuer, administrator.subject],
      );
      return id;
    }

    try {
      await operator.query("INSERT INTO users (identity_issuer,identity_subject) VALUES ($1,$2)", [
        issuer,
        administrator.subject,
      ]);
      await t.test("directory shows scoped subjects and clinic options", async () => {
        const north = await organization();
        assert.deepEqual(await application.readAdministration(administrator, north, 1), {
          revision: 0,
          clinics: [],
          members: [{ subject: administrator.subject, role: "ADMIN", clinicIds: [] }],
          page: 1,
          hasNextPage: false,
        });
      });
      await t.test("denies mismatched principals, staff, and privileged logins", async () => {
        const north = await organization();
        const south = randomUUID();
        const clinic = randomUUID();
        await operator.query("INSERT INTO organizations (id,name) VALUES ($1,'Other')", [south]);
        await application.saveMember(administrator, north, staff.subject, "STAFF", [], 0);
        for (const principal of [
          staff,
          { ...administrator, issuer: issuer + "/other" },
          { ...administrator, kind: "owner" as "staff" },
        ]) {
          await assert.rejects(application.readAdministration(principal, north, 1), {
            code: "forbidden",
          });
          await assert.rejects(application.saveClinic(principal, north, clinic, "Rejected", 0), {
            code: "forbidden",
          });
        }
        await assert.rejects(application.readAdministration(administrator, south, 1), {
          code: "forbidden",
        });
        for (const url of [migrationUrl, database.getConnectionUri()]) {
          const unsafe = new PrismaDatabase(url);
          try {
            await assert.rejects(
              unsafe.saveClinic(administrator, north, clinic, "Rejected", 0),
              /row security/i,
            );
          } finally {
            await unsafe.onApplicationShutdown();
          }
        }
      });
      await t.test("writes, replays, and conflicts preserve tenant data", async () => {
        const north = await organization();
        const south = await organization();
        const clinic = randomUUID();
        const southern = randomUUID();
        await application.saveClinic(administrator, south, southern, "Southern", 0);
        assert.deepEqual(await application.saveClinic(administrator, north, clinic, "Clinic", 0), {
          revision: 1,
        });
        assert.deepEqual(await application.saveClinic(administrator, north, clinic, "Clinic", 0), {
          revision: 1,
        });
        await assert.rejects(application.saveClinic(administrator, north, clinic, "Renamed", 0), {
          code: "conflict",
        });
        assert.deepEqual(await application.saveClinic(administrator, north, clinic, "Renamed", 1), {
          revision: 2,
        });
        await assert.rejects(
          application.saveMember(
            administrator,
            north,
            staff.subject,
            "STAFF",
            [clinic, southern],
            2,
          ),
          { code: "invalid" },
        );
        await assert.rejects(application.saveClinic(administrator, north, southern, "Stolen", 2), {
          code: "invalid",
        });
        assert.deepEqual(
          await application.saveMember(administrator, north, staff.subject, "STAFF", [clinic], 2),
          { revision: 3 },
        );
        assert.deepEqual(
          await application.saveMember(administrator, north, staff.subject, "STAFF", [clinic], 2),
          { revision: 3 },
        );
        assert.deepEqual(await application.listClinics(staff, north), [
          { id: clinic, name: "Renamed" },
        ]);
        assert.deepEqual(await application.removeMember(administrator, north, staff.subject, 3), {
          revision: 4,
        });
        assert.deepEqual(await application.removeMember(administrator, north, staff.subject, 3), {
          revision: 4,
        });
        assert.equal(await application.listClinics(staff, north), null);
        assert.deepEqual(
          (await operator.query("SELECT name FROM clinics WHERE id=$1", [southern])).rows,
          [{ name: "Southern" }],
        );
      });
      await t.test(
        "each applied directory revision creates one append-only audit event",
        async () => {
          const org = await organization();
          const clinic = randomUUID();
          await application.saveClinic(administrator, org, clinic, "Initial name", 0);
          await application.saveClinic(administrator, org, clinic, "New name", 1);
          await application.saveMember(administrator, org, staff.subject, "STAFF", [clinic], 2);
          await application.saveMember(administrator, org, staff.subject, "ADMIN", [], 3);
          await application.removeMember(administrator, org, staff.subject, 4);
          await application.removeMember(administrator, org, staff.subject, 4);
          await assert.rejects(
            application.removeMember(administrator, org, administrator.subject, 5),
            { code: "last_admin" },
          );
          await assert.rejects(application.saveClinic(administrator, org, clinic, "Stale", 0), {
            code: "conflict",
          });
          const result = await operator.query(
            "SELECT revision, actor_issuer, actor_subject, action, target, details, recorded_at FROM directory_events WHERE organization_id=$1 ORDER BY revision",
            [org],
          );
          assert.deepEqual(
            result.rows.map(({ action, target, revision, details }) => ({
              action,
              target,
              revision,
              details,
            })),
            [
              {
                revision: 1,
                action: "CLINIC_CREATED",
                target: clinic,
                details: { name: "Initial name" },
              },
              {
                revision: 2,
                action: "CLINIC_RENAMED",
                target: clinic,
                details: { name: "New name" },
              },
              {
                revision: 3,
                action: "MEMBER_ASSIGNED",
                target: staff.subject,
                details: { role: "STAFF", clinicIds: [clinic] },
              },
              {
                revision: 4,
                action: "MEMBER_UPDATED",
                target: staff.subject,
                details: { role: "ADMIN", clinicIds: [] },
              },
              { revision: 5, action: "MEMBER_REVOKED", target: staff.subject, details: {} },
            ],
          );
          for (const event of result.rows) {
            assert.equal(event.actor_issuer, administrator.issuer);
            assert.equal(event.actor_subject, administrator.subject);
            assert.ok(event.recorded_at instanceof Date);
          }
        },
      );
      await t.test("concurrent administrator revocation preserves one administrator", async () => {
        const north = await organization();
        await assert.rejects(
          application.removeMember(administrator, north, administrator.subject, 0),
          { code: "last_admin" },
        );
        await assert.rejects(
          application.saveMember(administrator, north, administrator.subject, "STAFF", [], 0),
          { code: "last_admin" },
        );
        await application.saveMember(administrator, north, staff.subject, "ADMIN", [], 0);
        const outcomes = await Promise.allSettled([
          application.removeMember(administrator, north, staff.subject, 1),
          application.removeMember(staff, north, administrator.subject, 1),
        ]);
        assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
        assert.deepEqual(
          (
            await operator.query(
              "SELECT action, revision FROM directory_events WHERE organization_id=$1 ORDER BY revision",
              [north],
            )
          ).rows,
          [
            { revision: 1, action: "MEMBER_ASSIGNED" },
            { revision: 2, action: "MEMBER_REVOKED" },
          ],
        );
        const rejected = outcomes.find((o) => o.status === "rejected");
        assert.equal(rejected?.reason.code, "forbidden");
        assert.equal(
          (
            await operator.query(
              "SELECT user_id FROM organization_memberships WHERE organization_id=$1 AND role='ADMIN'",
              [north],
            )
          ).rowCount,
          1,
        );
      });
      await t.test(
        "an administrator from a different issuer cannot satisfy the last-admin requirement",
        async () => {
          const org = await organization();
          await operator.query(
            `WITH old_admin AS (
          INSERT INTO users (identity_issuer,identity_subject) VALUES ($1,$2) RETURNING id
        ) INSERT INTO organization_memberships (organization_id,user_id,role) SELECT $3,id,'ADMIN' FROM old_admin`,
            [issuer + "/retired", administrator.subject, org],
          );
          await assert.rejects(
            application.saveMember(administrator, org, administrator.subject, "STAFF", [], 0),
            { code: "last_admin" },
          );
          await assert.rejects(
            application.removeMember(administrator, org, administrator.subject, 0),
            { code: "last_admin" },
          );
          const remaining = await application.readAdministration(administrator, org, 1);
          assert.equal(remaining.revision, 0);
          assert.deepEqual(remaining.members, [
            { subject: administrator.subject, role: "ADMIN", clinicIds: [] },
          ]);
        },
      );
      await t.test(
        "pagination includes only active-issuer members in the selected organization",
        async () => {
          const org = await organization();
          const elsewhere = await organization();
          await application.saveMember(administrator, elsewhere, "foreign-account", "STAFF", [], 0);
          await operator.query(
            `WITH identities AS (
        INSERT INTO users (identity_issuer, identity_subject)
        SELECT $1, 'member-' || lpad(i::text,2,'0') FROM generate_series(1,25) AS i
        UNION ALL SELECT $3,'unrelated-issuer' RETURNING id
      ) INSERT INTO organization_memberships (organization_id,user_id,role) SELECT $2,id,'STAFF' FROM identities`,
            [issuer, org, issuer + "/other"],
          );
          const first = await application.readAdministration(administrator, org, 1);
          const second = await application.readAdministration(administrator, org, 2);
          assert.deepEqual(
            first.members.map((member) => member.subject),
            [
              administrator.subject,
              ...Array.from({ length: 24 }, (_, i) => "member-" + String(i + 1).padStart(2, "0")),
            ],
          );
          assert.equal(first.hasNextPage, true);
          assert.deepEqual(second.members, [
            { subject: "member-25", role: "STAFF", clinicIds: [] },
          ]);
          assert.equal(second.hasNextPage, false);
          assert.deepEqual(
            (await application.readAdministration(administrator, org, 2147483647)).members,
            [],
          );
          await assert.rejects(application.readAdministration(administrator, org, 0), {
            code: "invalid",
          });
        },
      );
      await t.test(
        "memberships update a whole grant set and leave the same identity's other organizations intact",
        async () => {
          const org = await organization();
          const elsewhere = await organization();
          const clinics = [randomUUID(), randomUUID()];
          await application.saveClinic(administrator, org, clinics[0]!, "Alpha", 0);
          await application.saveClinic(administrator, org, clinics[1]!, "Beta", 1);
          await application.saveMember(administrator, elsewhere, staff.subject, "ADMIN", [], 0);
          await application.saveMember(administrator, org, staff.subject, "STAFF", clinics, 2);
          assert.deepEqual(
            await application.saveMember(
              administrator,
              org,
              staff.subject,
              "STAFF",
              [...clinics].reverse(),
              2,
            ),
            { revision: 3 },
          );
          const grants = async () =>
            (await application.readAdministration(administrator, org, 1)).members.find(
              (m) => m.subject === staff.subject,
            );
          assert.deepEqual(await grants(), {
            subject: staff.subject,
            role: "STAFF",
            clinicIds: [...clinics].sort(),
          });
          await assert.rejects(
            application.saveMember(administrator, org, staff.subject, "STAFF", [randomUUID()], 3),
            { code: "invalid" },
          );
          await assert.rejects(
            application.saveMember(administrator, org, staff.subject, "ADMIN", clinics, 3),
            { code: "invalid" },
          );
          assert.deepEqual((await grants())?.clinicIds, [...clinics].sort());
          await application.saveMember(
            administrator,
            org,
            staff.subject,
            "STAFF",
            [clinics[1]!],
            3,
          );
          assert.deepEqual(await application.listClinics(staff, org), [
            { id: clinics[1], name: "Beta" },
          ]);
          await application.saveMember(administrator, org, staff.subject, "ADMIN", [], 4);
          assert.equal((await application.listClinics(staff, org))?.length, 2);
          await application.removeMember(administrator, org, staff.subject, 5);
          assert.deepEqual(await application.listClinics(staff, elsewhere), []);
          assert.equal(await application.listClinics(staff, org), null);
        },
      );
      await t.test(
        "runtime cannot bypass directory writes and inherited migration privileges fail readiness",
        async () => {
          const runtime = new pg.Client({ connectionString: runtimeUrl });
          await runtime.connect();
          try {
            for (const query of [
              "SELECT * FROM directory_events",
              "UPDATE directory_events SET target='changed'",
              "DELETE FROM directory_events",
              "INSERT INTO directory_events DEFAULT VALUES",
            ]) {
              await assert.rejects(runtime.query(query), { code: "42501" });
            }
            await assert.rejects(runtime.query("DELETE FROM organization_memberships"), {
              code: "42501",
            });
            await assert.rejects(runtime.query("SELECT vetx_directory.lock_revision()"), {
              code: "42501",
            });
            assert.deepEqual(
              (await runtime.query("SELECT public.directory_read(1) AS result")).rows,
              [{ result: { error: "forbidden" } }],
            );
            await operator.query("GRANT vetx_migration TO vetx_runtime");
            try {
              await assert.rejects(application.checkReady(), /row security/i);
            } finally {
              await operator.query("REVOKE vetx_migration FROM vetx_runtime");
            }
          } finally {
            await runtime.end();
          }
          await application.checkReady();
        },
      );
    } finally {
      await application.onApplicationShutdown();
      await operator.end();
    }
  },
);
