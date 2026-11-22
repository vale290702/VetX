import { ConsoleLogger } from "@nestjs/common";
import { ConfigurationError, loadApiConfig } from "@vetx/config";
import { PrismaDatabase } from "@vetx/database";
import { createApplication } from "./application.js";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const logger = new ConsoleLogger({ json: true });
  const app = await createApplication(new PrismaDatabase(config.databaseUrl), logger);
  try {
    app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
    await app.listen(config.port, config.host);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof ConfigurationError ? error.message : "Unable to start the API";
  process.stderr.write(
    JSON.stringify({ level: "error", event: "api.start.failed", message }) + "\n",
  );
  process.exitCode = 1;
});
