import "reflect-metadata";
import type { LoggerService } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import { HealthModule, type ReadinessCheck } from "./health.js";
import { configureHttp } from "./http.js";
import { createOpenApiDocument } from "./openapi.js";

export async function createApplication(
  readiness: ReadinessCheck,
  logger: LoggerService | false,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(HealthModule.register(readiness), {
    logger,
    abortOnError: false,
  });
  configureHttp(app);
  SwaggerModule.setup("openapi", app, () => createOpenApiDocument(app), {
    ui: false,
    raw: ["json"],
    jsonDocumentUrl: "/openapi.json",
  });
  return app;
}
