import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export interface ApiConfig {
  host: string;
  port: number;
  databaseUrl: string;
}

export class ConfigurationError extends Error {}

function environment(): NodeJS.ProcessEnv {
  try {
    const local = parseEnv(readFileSync(resolve(__dirname, "../../..", ".env"), "utf8"));
    return { ...local, ...process.env };
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
      throw new ConfigurationError("Unable to read the workspace environment file");
    }
  }
  return process.env;
}

function postgresUrl(env: NodeJS.ProcessEnv, key: "DATABASE_URL" | "DIRECT_DATABASE_URL"): string {
  const value = env[key];
  const message = `${key} must be a PostgreSQL URL with a user, host and database`;
  if (!value || value !== value.trim()) {
    throw new ConfigurationError(message);
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      url.hostname &&
      url.username &&
      /^\/[^/]+$/.test(url.pathname) &&
      !value.includes("#") &&
      url.port !== "0"
    ) {
      // The driver decodes connection fields independently.
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
      decodeURIComponent(url.pathname);
      return value;
    }
  } catch {
    throw new ConfigurationError(message);
  }
  throw new ConfigurationError(message);
}

export function loadApiConfig(env = environment()): ApiConfig {
  const portValue = env.API_PORT ?? "";
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || port < 1 || port > 65535) {
    throw new ConfigurationError("API_PORT must be an integer from 1 to 65535");
  }

  const host = env.API_HOST ?? "127.0.0.1";
  const dnsName = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.?$/i;
  if (!isIP(host) && (host.length > 253 || !dnsName.test(host))) {
    throw new ConfigurationError("API_HOST must be a hostname or an IP address");
  }

  return { host, port, databaseUrl: postgresUrl(env, "DATABASE_URL") };
}

export function loadMigrationConfig(env = environment()): { directDatabaseUrl: string } {
  return { directDatabaseUrl: postgresUrl(env, "DIRECT_DATABASE_URL") };
}

export interface OidcConfig {
  issuer: string;
  apiClientId: string;
  apiClientSecret: string;
  webClientId: string;
  staffClientId: string;
  ownerClientId: string;
}

const oidcKeys = [
  "OIDC_ISSUER_URL",
  "OIDC_API_CLIENT_ID",
  "OIDC_API_CLIENT_SECRET",
  "OIDC_WEB_CLIENT_ID",
  "OIDC_STAFF_CLIENT_ID",
  "OIDC_OWNER_CLIENT_ID",
] as const;

type OidcKey = (typeof oidcKeys)[number];

function oidcValue(env: NodeJS.ProcessEnv, key: OidcKey): string {
  const value = env[key];
  if (!value || value !== value.trim()) {
    throw new ConfigurationError(`${key} must be configured`);
  }
  return value;
}

function keycloakIssuer(value: string): string {
  const url = URL.parse(value);
  const loopback = url && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    !url ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    !/^https?:\/\//.test(value) ||
    /[?#@\\\s]/.test(value) ||
    !/\/realms\/[^/]+$/.test(url.pathname)
  ) {
    throw new ConfigurationError(
      "OIDC_ISSUER_URL must be a Keycloak realm URL using HTTPS or loopback HTTP",
    );
  }
  return value;
}

export function loadOidcConfig(env = environment()): OidcConfig | undefined {
  if (oidcKeys.every((key) => env[key] === undefined)) {
    return undefined;
  }

  const issuer = keycloakIssuer(oidcValue(env, "OIDC_ISSUER_URL"));
  const apiClientId = oidcValue(env, "OIDC_API_CLIENT_ID");
  const apiClientSecret = oidcValue(env, "OIDC_API_CLIENT_SECRET");
  const webClientId = oidcValue(env, "OIDC_WEB_CLIENT_ID");
  const staffClientId = oidcValue(env, "OIDC_STAFF_CLIENT_ID");
  const ownerClientId = oidcValue(env, "OIDC_OWNER_CLIENT_ID");
  if (new Set([apiClientId, webClientId, staffClientId, ownerClientId]).size !== 4) {
    throw new ConfigurationError("OIDC client IDs must be distinct");
  }
  return { issuer, apiClientId, apiClientSecret, webClientId, staffClientId, ownerClientId };
}
