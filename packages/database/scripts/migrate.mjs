import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ConfigurationError, loadMigrationConfig } from "@vetx/config";

try {
  const { directDatabaseUrl } = loadMigrationConfig();
  const env = { ...process.env, DIRECT_DATABASE_URL: directDatabaseUrl };
  delete env.DATABASE_URL;

  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.resolve("prisma/build/index.js")), "migrate", "deploy"],
    {
      env,
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(
    error instanceof ConfigurationError ? error.message : "Database migration could not start",
  );
  process.exitCode = 1;
}
