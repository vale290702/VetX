import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHttpOrigin } from "../dist/public.js";
import {
  loadApiConfig,
  loadMigrationConfig,
  loadOidcConfig,
  loadPetLinkConfig,
} from "../dist/server.js";

const runtimeUrl = "postgresql://service:private-value@localhost:5432/vetx";
const migrationUrl = "postgresql://owner:another-private-value@localhost:5432/vetx";

test("loads runtime settings with a loopback default and no migration credentials", () => {
  assert.deepEqual(
    loadApiConfig({
      API_PORT: "4000",
      DATABASE_URL: runtimeUrl,
      DIRECT_DATABASE_URL: migrationUrl,
    }),
    {
      host: "127.0.0.1",
      port: 4000,
      databaseUrl: runtimeUrl,
    },
  );
});

test("allows an explicit bind address for native development", () => {
  assert.equal(
    loadApiConfig({
      API_PORT: "4000",
      API_HOST: "0.0.0.0",
      DATABASE_URL: runtimeUrl,
    }).host,
    "0.0.0.0",
  );
});

test("rejects invalid HTTP ports and bind addresses without reflecting the input", () => {
  const invalids = [undefined, "0", "-1", "65536", "80.5", "5000secret"];
  for (const API_PORT of invalids) {
    assert.throws(() => loadApiConfig({ API_PORT, DATABASE_URL: runtimeUrl }), {
      message: "API_PORT must be an integer from 1 to 65535",
    });
  }

  assert.throws(
    () =>
      loadApiConfig({
        API_PORT: "4000",
        API_HOST: "https://somewhere.test",
        DATABASE_URL: runtimeUrl,
      }),
    { message: "API_HOST must be a hostname or an IP address" },
  );
});

test("validates PostgreSQL URLs without reflecting supplied values", () => {
  const invalids = [
    undefined,
    "https://private-value@localhost/vetx",
    "postgresql://localhost/vetx",
    "postgresql://user:private-value@localhost",
  ];
  for (const DATABASE_URL of invalids) {
    assert.throws(() => loadApiConfig({ API_PORT: "4000", DATABASE_URL }), {
      message: "DATABASE_URL must be a PostgreSQL URL with a user, host and database",
    });
  }
});

test("validates only the direct migration connection for the migration CLI", () => {
  assert.deepEqual(loadMigrationConfig({ DIRECT_DATABASE_URL: migrationUrl }), {
    directDatabaseUrl: migrationUrl,
  });
  assert.throws(() => loadMigrationConfig({ DATABASE_URL: runtimeUrl }), {
    message: "DIRECT_DATABASE_URL must be a PostgreSQL URL with a user, host and database",
  });
});

test("accepts only plain HTTP origins for client configuration", () => {
  assert.equal(parseHttpOrigin("http://127.0.0.1:4000/"), "http://127.0.0.1:4000");
  assert.equal(parseHttpOrigin("https://VETX.example"), "https://vetx.example");
  for (const input of [
    undefined,
    "file:///path",
    "https://password@vetx.example",
    "https://vetx.example/a",
    "https://vetx.example/?",
    "https://vetx.example/#",
  ]) {
    assert.equal(parseHttpOrigin(input), undefined);
  }
});

test("OIDC configuration is optional but all configured clients must be distinct", () => {
  assert.equal(loadOidcConfig({}), undefined);
  const valid = {
    OIDC_ISSUER_URL: "http://127.0.0.1:58080/realms/vetx",
    OIDC_API_CLIENT_ID: "api",
    OIDC_API_CLIENT_SECRET: "api-secret",
    OIDC_WEB_CLIENT_ID: "web",
    OIDC_STAFF_CLIENT_ID: "staff",
    OIDC_OWNER_CLIENT_ID: "owner",
  };
  assert.deepEqual(loadOidcConfig(valid), {
    issuer: "http://127.0.0.1:58080/realms/vetx",
    apiClientId: "api",
    apiClientSecret: "api-secret",
    webClientId: "web",
    staffClientId: "staff",
    ownerClientId: "owner",
  });
  assert.throws(() => loadOidcConfig({ ...valid, OIDC_OWNER_CLIENT_ID: "staff" }), {
    message: "OIDC client IDs must be distinct",
  });
  assert.throws(() => loadOidcConfig({ OIDC_ISSUER_URL: valid.OIDC_ISSUER_URL }), {
    message: "OIDC_API_CLIENT_ID must be configured",
  });
});

test("OIDC issuer requires a credential-free realm URL and HTTPS away from loopback", () => {
  for (const OIDC_ISSUER_URL of [
    "http://id.example/realms/vetx",
    "https://sensitive@id.example/realms/vetx",
    "https://id.example",
    "https://id.example/realms/vetx?q=sensitive",
  ]) {
    assert.throws(() => loadOidcConfig({ OIDC_ISSUER_URL }), {
      message: "OIDC_ISSUER_URL must be a Keycloak realm URL using HTTPS or loopback HTTP",
    });
  }
});

test("link issuance requires deployment-specific key material and positive duration and attempt settings", () => {
  assert.equal(loadPetLinkConfig({}), undefined);
  const env = {
    PET_LINK_HMAC_KEY_HEX: "a9".repeat(32),
    PET_LINK_LIFETIME_SECONDS: "3600",
    PET_LINK_ATTEMPT_LIMIT: "6",
    PET_LINK_WINDOW_SECONDS: "900",
  };
  assert.equal(loadPetLinkConfig(env).attemptLimit, 6);
  for (const change of [
    { PET_LINK_HMAC_KEY_HEX: "sensitive-invalid" },
    { PET_LINK_WINDOW_SECONDS: "0" },
    { PET_LINK_ATTEMPT_LIMIT: "NaN" },
    { PET_LINK_LIFETIME_SECONDS: "999999999999" },
  ]) {
    assert.throws(
      () => loadPetLinkConfig({ ...env, ...change }),
      (error) =>
        !error.message.includes("sensitive-invalid") && error.message.startsWith("PET_LINK_"),
    );
  }
});

test("document storage configuration requires a private endpoint connection and bounds in-memory upload size", async () => {
  const { loadDocumentConfig } = await import("../dist/server.js");
  assert.equal(loadDocumentConfig({}), undefined);
  const settings = {
    S3_ENDPOINT: "https://storage.example.test",
    S3_BUCKET: "medical-records",
    S3_REGION: "us-east-1",
    DOCUMENT_MAX_BYTES: "10485760",
  };
  assert.equal(loadDocumentConfig(settings).maxBytes, 10485760);
  for (const overrides of [
    { S3_ENDPOINT: "http://storage.example.test" },
    { S3_ENDPOINT: "https://user:pass@storage.example.test" },
    { S3_SECRET_KEY: "only-half" },
    { S3_BUCKET: "../bucket" },
    { DOCUMENT_MAX_BYTES: "33554433" },
  ]) {
    assert.throws(() => loadDocumentConfig({ ...settings, ...overrides }));
  }
});
