import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createIdentity, setting } from "./identity.js";

export async function createDirectoryFixture(organizationId: string = randomUUID()) {
  const url = new URL(setting("DATABASE_URL"));
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Directory fixtures require a local test database");
  }
  url.username = "vetx_bootstrap";
  url.password = setting("POSTGRES_PASSWORD");
  const db = new pg.Client({ connectionString: url.href });
  const users: Awaited<ReturnType<typeof createIdentity>>[] = [];
  const organizationName = `VetX ${organizationId}`;
  const issuer = setting("OIDC_ISSUER_URL");
  await db.connect();
  async function cleanup() {
    try {
      const documents = await db.query(
        "SELECT clinic_id,patient_id,id,sha256 FROM medical_documents WHERE organization_id=$1",
        [organizationId],
      );
      const archives = await db.query(
        "SELECT clinic_id,archive_sha256 FROM exchange_packages WHERE organization_id=$1",
        [organizationId],
      );
      if (documents.rowCount || archives.rowCount) {
        execFileSync(
          process.execPath,
          [
            fileURLToPath(
              new URL(
                "../../../../apps/api/integration/clear-document-fixtures.mjs",
                import.meta.url,
              ),
            ),
          ],
          {
            input: JSON.stringify({
              org: organizationId,
              rows: documents.rows,
              archives: archives.rows,
            }),
            timeout: 15000,
          },
        );
      }
      await db.query("BEGIN");
      const routeFilter = "source_org=$1 OR destination_org=$1";
      for (const [table, id] of [
        ["referral_events", "referral_id"],
        ["referral_responses", "id"],
        ["referral_requests", "id"],
      ]) {
        await db.query(
          `DELETE FROM ${table} WHERE ${id} IN (SELECT id FROM referral_states WHERE ${routeFilter})`,
          [organizationId],
        );
      }
      await db.query(`DELETE FROM referral_states WHERE ${routeFilter}`, [organizationId]);
      for (const table of [
        "document_events",
        "medical_documents",
        "exchange_export_events",
        "exchange_records",
        "exchange_imports",
        "exchange_patients",
        "exchange_receipts",
        "exchange_packages",
        "care_events",
        "encounter_recipients",
        "encounter_sharing",
        "appointments",
        "clinical_encounters",
        "registry_events",
        "guardians",
        "owner_contacts",
        "patients",
      ]) {
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
    try {
      await db.query("ROLLBACK");
    } finally {
      await Promise.all([db.end(), ...users.map((user) => user.remove())]);
    }
    throw error;
  }
}
