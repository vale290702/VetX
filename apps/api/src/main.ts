import { ConsoleLogger } from "@nestjs/common";
import { S3Client } from "@aws-sdk/client-s3";
import { S3DocumentStorage } from "./documents/storage.js";
import { KeycloakTokenVerifier } from "@vetx/auth";
import {
  ConfigurationError,
  loadApiConfig,
  loadDocumentConfig,
  loadOidcConfig,
  loadPetLinkConfig,
} from "@vetx/config";
import { PrismaDatabase } from "@vetx/database";
import { createApplication } from "./application.js";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const logger = new ConsoleLogger({ json: true });
  const oidc = loadOidcConfig();
  const database = new PrismaDatabase(config.databaseUrl);
  const files = loadDocumentConfig();
  const storage =
    files &&
    new S3DocumentStorage(
      new S3Client({
        endpoint: files.endpoint,
        region: files.region,
        credentials: files.credentials,
        forcePathStyle: true,
      }),
      files.bucket,
    );
  const app = await createApplication(database, logger, {
    database,
    directory: database,
    registry: database,
    documents: { database, ...(files && storage ? { config: files, storage } : {}) },
    care: database,
    inventory: database,
    petLinks: loadPetLinkConfig(),
    tokenVerifier: oidc && new KeycloakTokenVerifier(oidc),
  });
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
