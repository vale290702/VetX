import { randomUUID } from "node:crypto";
import pg from "pg";
import { createIdentity, setting } from "./identity.js";

export async function createDirectoryFixture() {
  const url = new URL(setting("DATABASE_URL"));
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Directory fixtures require a local test database");
  }
  url.username = "vetx_bootstrap";
  url.password = setting("POSTGRES_PASSWORD");
  const db = new pg.Client({ connectionString: url.href });
  const users: Awaited<ReturnType<typeof createIdentity>>[] = [];
  const organizationId = randomUUID();
  const organizationName = `VetX ${organizationId}`;
  const issuer = setting("OIDC_ISSUER_URL");
  await db.connect();
  async function cleanup() {
    try {
      await db.query("BEGIN");
      for (const table of ["registry_events", "guardians", "owner_contacts", "patients"]) {
        await db.query(`DELETE FROM ${table} WHERE organization_id=$1`, [organizationId]);
      }
      await db.query("DELETE FROM pet_link_attempts WHERE issuer=$1 AND subject=ANY($2::text[])", [
        issuer,
        users.map((user) => user.id),
      ]);
      await db.query("DELETE FROM directory_events WHERE organization_id=$1", [organizationId]);
      await db.query("DELETE FROM clinics WHERE organization_id=$1", [organizationId]);
      await db.query("DELETE FROM organizations WHERE id=$1", [organizationId]);
      await db.query(
        "DELETE FROM users WHERE identity_issuer=$1 AND identity_subject=ANY($2::text[])",
        [issuer, users.map((identity) => identity.id)],
      );
      await db.query("COMMIT");
    } finally {
      await Promise.all([db.end(), ...users.map((user) => user.remove())]);
    }
  }
  try {
    const admin = await createIdentity();
    users.push(admin);
    const staff = await createIdentity();
    users.push(staff);
    await db.query("BEGIN");
    await db.query("INSERT INTO organizations(id,name) VALUES ($1,$2)", [
      organizationId,
      organizationName,
    ]);
    await db.query(
      `WITH new_user AS (
      INSERT INTO users(identity_issuer,identity_subject) VALUES ($1,$2) RETURNING id
    ) INSERT INTO organization_memberships(organization_id,user_id,role) SELECT $3,id,'ADMIN' FROM new_user`,
      [issuer, admin.id, organizationId],
    );
    await db.query("COMMIT");
    return { admin, staff, organizationId, organizationName, cleanup };
  } catch (error) {
    await db.query("ROLLBACK");
    await cleanup();
    throw error;
  }
}
