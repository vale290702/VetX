import { readFile } from "node:fs/promises";
import pg from "pg";
interface Provisioning {
  organizationId: string;
  clinicId: string;
  environment: "sandbox" | "production";
  profile: {
    branch: string;
    terminal: string;
    providerId: string;
    issuerActivity: string;
    issuer: {
      name: string;
      identity: { type: string; number: string };
      email: string;
      address: { province: string; canton: string; district: string; details: string };
    };
  };
  startingNumber: number;
  enabled: boolean;
}
async function main() {
  const path = process.argv[2],
    url = process.env.FISCAL_DATABASE_URL;
  if (!url || !path || process.argv.length !== 3) throw new Error();
  const data: Provisioning = JSON.parse(await readFile(path, "utf8"));
  const prof = data.profile,
    issuer = prof.issuer;
  if (
    !["production", "sandbox"].includes(data.environment) ||
    typeof data.enabled !== "boolean" ||
    !Number.isSafeInteger(data.startingNumber) ||
    data.startingNumber < 1 ||
    !issuer.name?.trim() ||
    !/^[^@\s]+@[^@\s]+$/.test(issuer.email) ||
    !/^\d{2}$/.test(issuer.identity.type) ||
    !/^\d{1,12}$/.test(issuer.identity.number) ||
    !/^\d{6}$/.test(prof.issuerActivity) ||
    !/^[0-9]{1,20}$/.test(prof.providerId) ||
    !/^\d$/.test(issuer.address.province) ||
    !/^\d{2}$/.test(issuer.address.canton) ||
    !/^\d{2}$/.test(issuer.address.district) ||
    !issuer.address.details?.trim()
  )
    throw new Error();
  // Only public issuer fields enter PostgreSQL, even if the input contains extra keys.
  const { name, email, identity, address } = issuer;
  const sanitized = {
    branch: prof.branch,
    terminal: prof.terminal,
    providerId: prof.providerId,
    issuerActivity: prof.issuerActivity,
    issuer: {
      name,
      email,
      identity: { type: identity.type, number: identity.number },
      address: {
        province: address.province,
        canton: address.canton,
        district: address.district,
        details: address.details,
      },
    },
  };
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("SELECT public.fiscal_provision($1,$2,$3,$4,$5,$6)", [
      data.organizationId,
      data.clinicId,
      data.environment,
      sanitized,
      data.startingNumber,
      data.enabled,
    ]);
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error("Fiscal profile provisioning failed");
  process.exitCode = 1;
});
