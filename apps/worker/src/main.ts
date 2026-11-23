import { isAbsolute } from "node:path";
import { Queue, Worker } from "bullmq";
import pg from "pg";
import { loadFiscalSettings } from "@vetx/fiscal-cr";
import { deliverOne } from "./delivery.js";
import { mountedIssuers } from "./issuer.js";
import { PostgresFiscalJobs } from "./repository.js";
function required(name: string) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error("Missing " + name);
  return v;
}
function positive(name: string) {
  const raw = required(name),
    value = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value) || value > 2147483647)
    throw new Error("Invalid " + name);
  return value;
}
async function start() {
  const environment = required("FISCAL_ENVIRONMENT"),
    root = required("FISCAL_SECRETS_DIR"),
    settings = loadFiscalSettings();
  if (!["sandbox", "production"].includes(environment) || !isAbsolute(root) || !settings)
    throw new Error("Invalid fiscal worker environment");
  const poll = positive("FISCAL_POLL_SECONDS"),
    lease = positive("FISCAL_LEASE_SECONDS"),
    batch = positive("FISCAL_BATCH_SIZE");
  if (lease * 1000 <= settings.timeoutMs * 5 || poll * 1000 > 2147483647)
    throw new Error("Invalid fiscal worker timing");
  const connection = { url: required("FISCAL_REDIS_URL") };
  const pool = new pg.Pool({ connectionString: required("FISCAL_DATABASE_URL"), max: 2 });
  const role = await pool.query<{ valid: boolean }>(
    "SELECT pg_has_role(current_user,'vetx_fiscal_worker','MEMBER') AND NOT pg_has_role(current_user,'vetx_runtime','MEMBER') AND NOT pg_has_role(current_user,'vetx_migration','MEMBER') AND NOT rolcreaterole AND NOT rolsuper AND NOT rolbypassrls AS valid FROM pg_roles WHERE rolname=current_user",
  );
  if (!role.rows[0]?.valid) throw new Error("Fiscal worker requires its dedicated database role");
  const jobs = new PostgresFiscalJobs(pool, environment, lease),
    issuers = mountedIssuers(root, environment, settings);
  const name = "vetx-fiscal-" + environment;
  const queue = new Queue(name, { connection });
  await queue.upsertJobScheduler(
    "poll",
    { every: poll * 1000 },
    { name: "deliver", opts: { removeOnComplete: true, removeOnFail: 50 } },
  );
  const worker = new Worker(
    name,
    async () => {
      for (let index = 0; index < batch; index++)
        if (!(await deliverOne(jobs, issuers, poll))) break;
    },
    { connection, autorun: false },
  );
  const logFailure = () => console.error(JSON.stringify({ event: "fiscal_worker_error" }));
  worker.on("error", logFailure);
  worker.on("failed", logFailure);
  queue.on("error", logFailure);
  pool.on("error", logFailure);
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await worker.close();
    await queue.close();
    await pool.end();
  }
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      void close().catch(() => {
        logFailure();
        process.exitCode = 1;
      });
    });
  await worker.run();
}
start().catch(() => {
  console.error(JSON.stringify({ event: "fiscal_worker_start_failed" }));
  process.exit(1);
});
