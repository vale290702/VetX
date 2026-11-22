import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplication } from "./application.js";
import { createOpenApiDocument } from "./openapi.js";

async function generateOpenApi(): Promise<void> {
  const app = await createApplication(
    {
      async checkReady() {
        throw new Error("Readiness is unavailable during OpenAPI generation");
      },
    },
    false,
  );
  try {
    const destination = resolve(__dirname, "../../../packages/contracts/openapi.json");
    await writeFile(destination, JSON.stringify(createOpenApiDocument(app), null, 2) + "\n");
  } finally {
    await app.close();
  }
}

void generateOpenApi().catch(() => {
  process.stderr.write("Unable to generate the OpenAPI contract\n");
  process.exitCode = 1;
});
