import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { startTestDatabase } from "./postgres.ts";
import { PrismaDatabase } from "@vetx/database";
import pg from "pg";

test(
  "the migration is deployable with separate runtime privileges",
  { timeout: 120_000 },
  async (t) => {
    const { database, runtimeUrl } = await startTestDatabase(t);

    const issuer = "https://identity.test/realms/phase-two";
    const north = randomUUID();
    const south = randomUUID();
    const grantedClinic = randomUUID();
    const otherClinic = randomUUID();
    const southClinic = randomUUID();
    const staff = randomUUID();
    const admin = randomUUID();
    const bootstrapClient = new pg.Client({ connectionString: database.getConnectionUri() });
    await bootstrapClient.connect();
    try {
      const protections = await bootstrapClient.query<{ relname: string }>(
        `SELECT relname
         FROM pg_class
         WHERE relnamespace = 'public'::regnamespace AND relrowsecurity AND relforcerowsecurity
         ORDER BY relname`,
      );
      assert.deepEqual(
        protections.rows.map((row) => row.relname),
        [
          "appointments",
          "care_events",
          "clinic_grants",
          "clinical_encounters",
          "clinics",
          "directory_events",
          "document_events",
          "encounter_recipients",
          "encounter_sharing",
          "exchange_export_events",
          "exchange_imports",
          "exchange_packages",
          "exchange_patients",
          "exchange_receipts",
          "exchange_records",
          "guardians",
          "inventory_items",
          "inventory_warehouses",
          "medical_documents",
          "organization_memberships",
          "organizations",
          "owner_contacts",
          "patients",
          "pet_link_attempts",
          "referral_events",
          "referral_requests",
          "referral_responses",
          "referral_states",
          "registry_events",
          "stock_balances",
          "stock_movements",
          "users",
        ],
      );

      await bootstrapClient.query(
        "INSERT INTO public.organizations (id, name) VALUES ($1, 'North'), ($2, 'South')",
        [north, south],
      );
      await bootstrapClient.query(
        `INSERT INTO public.clinics (id, organization_id, name)
         VALUES ($1, $4, 'Granted clinic'), ($2, $4, 'Other clinic'), ($3, $5, 'South clinic')`,
        [grantedClinic, otherClinic, southClinic, north, south],
      );
      await bootstrapClient.query(
        `INSERT INTO public.users (id, identity_issuer, identity_subject)
         VALUES ($1, $3, 'staff-subject'), ($2, $3, 'admin-subject')`,
        [staff, admin, issuer],
      );
      await bootstrapClient.query(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role)
         VALUES ($1, $3, 'STAFF'), ($1, $4, 'ADMIN'), ($2, $4, 'ADMIN')`,
        [north, south, staff, admin],
      );
      await bootstrapClient.query(
        "INSERT INTO public.clinic_grants (organization_id, clinic_id, user_id) VALUES ($1, $2, $3)",
        [north, grantedClinic, staff],
      );
      await assert.rejects(
        bootstrapClient.query(
          "INSERT INTO public.clinic_grants (organization_id, clinic_id, user_id) VALUES ($1, $2, $3)",
          [north, southClinic, staff],
        ),
        { code: "23503" },
      );
      await assert.rejects(
        bootstrapClient.query(
          "INSERT INTO public.clinic_grants (organization_id, clinic_id, user_id) VALUES ($1, $2, $3)",
          [south, southClinic, staff],
        ),
        { code: "23503" },
      );
    } finally {
      await bootstrapClient.end();
    }

    const staffContext: Context = {
      issuer,
      subject: "staff-subject",
      kind: "staff",
      organizationId: north,
    };
    const principal = { ...staffContext, kind: "staff" as const };
    const application = new PrismaDatabase(runtimeUrl);
    const privileged = new PrismaDatabase(database.getConnectionUri());
    try {
      await application.checkReady();
      assert.deepEqual(await application.listOrganizations(principal), [
        { id: north, name: "North" },
      ]);
      await assert.rejects(privileged.checkReady(), /row security/i);
      await assert.rejects(privileged.listOrganizations(principal), /row security/i);
      await assert.rejects(privileged.listClinics(principal, south), /row security/i);

      const operator = new pg.Client({ connectionString: database.getConnectionUri() });
      await operator.connect();
      try {
        await operator.query("ALTER TABLE public.organizations DISABLE ROW LEVEL SECURITY");
        await assert.rejects(application.checkReady(), /row security/i);
        await assert.rejects(application.listOrganizations(principal), /row security/i);
        await operator.query("ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY");
        await application.checkReady();
      } finally {
        await operator.end();
      }
    } finally {
      await Promise.all([application.onApplicationShutdown(), privileged.onApplicationShutdown()]);
    }
    const allData = async (client: pg.Client | pg.PoolClient, context: Context) => {
      await setContext(client, context);
      const organizations = await client.query(
        "SELECT name FROM public.organizations ORDER BY name",
      );
      const clinics = await client.query<{ name: string }>(
        "SELECT name FROM public.clinics ORDER BY name",
      );
      const users = await client.query(
        "SELECT identity_subject FROM public.users ORDER BY identity_subject",
      );
      return {
        organizations: organizations.rows.map((row) => row.name),
        clinics: clinics.rows.map((row) => row.name),
        users: users.rows.map((row) => row.identity_subject),
      };
    };

    const runtime = new pg.Client({ connectionString: runtimeUrl });
    await runtime.connect();
    try {
      assert.equal((await runtime.query("SELECT id FROM public.organizations")).rowCount, 0);
      assert.equal((await runtime.query("SELECT id FROM public.clinics")).rowCount, 0);
      assert.equal((await runtime.query("SELECT id FROM public.users")).rowCount, 0);
      await assert.rejects(runtime.query("CREATE TABLE public.should_fail(id integer)"), {
        code: "42501",
      });
      await assert.rejects(runtime.query("DELETE FROM public.organizations"), { code: "42501" });

      await runtime.query("BEGIN");
      assert.deepEqual(await allData(runtime, staffContext), {
        organizations: ["North"],
        clinics: ["Granted clinic"],
        users: ["staff-subject"],
      });
      await runtime.query("COMMIT");
      assert.equal((await runtime.query("SELECT id FROM public.clinics")).rowCount, 0);

      await runtime.query("BEGIN");
      assert.deepEqual(await allData(runtime, { ...staffContext, organizationId: south }), {
        organizations: [],
        clinics: [],
        users: ["staff-subject"],
      });
      await runtime.query("ROLLBACK");
      assert.equal((await runtime.query("SELECT id FROM public.users")).rowCount, 0);

      await runtime.query("BEGIN");
      assert.deepEqual(await allData(runtime, { ...staffContext, kind: "owner" }), {
        organizations: [],
        clinics: [],
        users: [],
      });
      await runtime.query("ROLLBACK");
    } finally {
      await runtime.end();
    }

    const pool = new pg.Pool({ connectionString: runtimeUrl, max: 2 });
    const readInTransaction = async (context: Context) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        return await allData(client, context);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    };
    try {
      const [staffNorth, adminNorth, adminSouth, adminAll, wrongIssuer] = await Promise.all([
        readInTransaction(staffContext),
        readInTransaction({ ...staffContext, subject: "admin-subject" }),
        readInTransaction({ ...staffContext, subject: "admin-subject", organizationId: south }),
        readInTransaction({ ...staffContext, subject: "admin-subject", organizationId: "" }),
        readInTransaction({ ...staffContext, issuer: issuer + "-other" }),
      ]);
      assert.deepEqual(staffNorth.clinics, ["Granted clinic"]);
      assert.deepEqual(adminNorth.clinics, ["Granted clinic", "Other clinic"]);
      assert.deepEqual(adminSouth.clinics, ["South clinic"]);
      assert.deepEqual(adminAll.organizations, ["North", "South"]);
      assert.deepEqual(adminAll.clinics, []);
      assert.deepEqual(wrongIssuer, { organizations: [], clinics: [], users: [] });
      assert.equal(
        (await pool.query("SELECT user_id FROM public.organization_memberships")).rowCount,
        0,
      );
    } finally {
      await pool.end();
    }
  },
);

interface Context {
  issuer: string;
  subject: string;
  kind: "staff" | "owner";
  organizationId: string;
}

async function setContext(client: pg.Client | pg.PoolClient, context: Context) {
  await client.query(
    `SELECT
      set_config('vetx.identity_issuer', $1, true),
      set_config('vetx.identity_subject', $2, true),
      set_config('vetx.client_kind', $3, true),
      set_config('vetx.organization_id', $4, true)`,
    [context.issuer, context.subject, context.kind, context.organizationId],
  );
}
