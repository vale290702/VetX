import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const bootstrap = fileURLToPath(
  new URL("../../../infrastructure/postgres/10-roles.sh", import.meta.url),
);
const password = () => randomBytes(24).toString("hex");

test(
  "the migration is deployable with separate runtime privileges",
  { timeout: 120_000 },
  async (t) => {
    const migrationPassword = password();
    const runtimePassword = password();

    const database = await new PostgreSqlContainer("postgres:17.10-alpine")
      .withDatabase("vetx")
      .withUsername("vetx_bootstrap")
      .withPassword(password())
      .withEnvironment({
        POSTGRES_MIGRATION_PASSWORD: migrationPassword,
        POSTGRES_RUNTIME_PASSWORD: runtimePassword,
      })
      .withCopyFilesToContainer([
        { source: bootstrap, target: "/docker-entrypoint-initdb.d/10-roles.sh", mode: 0o755 },
      ])
      .start();
    t.after(async () => {
      await database.stop();
    });

    const connection = (username: string, secret: string) => {
      const uri = new URL(database.getConnectionUri());
      uri.username = username;
      uri.password = secret;
      return uri.href;
    };

    const runtimeUrl = connection("vetx_runtime", runtimePassword);
    const result = spawnSync("pnpm", ["db:migrate"], {
      cwd: repo,
      env: {
        ...process.env,
        DATABASE_URL: runtimeUrl,
        DIRECT_DATABASE_URL: connection("vetx_migration", migrationPassword),
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);

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
    } finally {
      await runtime.end();
    }
  },
);
