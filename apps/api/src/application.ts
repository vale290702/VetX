import "reflect-metadata";
import { type DynamicModule, type LoggerService, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import { type AccessDependencies, AccessModule } from "./access.js";
import { DocumentModule, type DocumentDependencies } from "./documents/module.js";
import { IdentityModule } from "./identity-context.js";
import { CareModule, type CareStore } from "./care/module.js";
import { RegistryModule, type RegistryStore } from "./registry/module.js";
import type { PetLinkConfig } from "@vetx/config";
import { HealthModule, type ReadinessCheck } from "./health.js";
import { configureHttp } from "./http.js";
import { createOpenApiDocument } from "./openapi.js";

type Dependencies = AccessDependencies & {
  documents?: DocumentDependencies;
  care?: CareStore;
  registry?: RegistryStore;
  petLinks?: PetLinkConfig;
};

@Module({})
class AppModule {
  static register(readiness: ReadinessCheck, access: Dependencies): DynamicModule {
    return {
      module: AppModule,
      imports: [
        IdentityModule.register(access.tokenVerifier),
        HealthModule.register(readiness),
        AccessModule.register(access),
        RegistryModule.register(access.registry, access.petLinks),
        DocumentModule.register(access.documents),
        CareModule.register(access.care),
      ],
    };
  }
}

export async function createApplication(
  readiness: ReadinessCheck,
  logger: LoggerService | false,
  access: Dependencies = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(readiness, access),
    {
      logger,
      abortOnError: false,
    },
  );
  configureHttp(app);
  SwaggerModule.setup("openapi", app, () => createOpenApiDocument(app), {
    ui: false,
    raw: ["json"],
    jsonDocumentUrl: "/openapi.json",
  });
  return app;
}
