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

export interface PetLinkConfig {
  keyHex: string;
  lifetimeSeconds: number;
  attemptLimit: number;
  windowSeconds: number;
}

export function loadPetLinkConfig(env = environment()): PetLinkConfig | undefined {
  if (
    [
      "PET_LINK_HMAC_KEY_HEX",
      "PET_LINK_LIFETIME_SECONDS",
      "PET_LINK_ATTEMPT_LIMIT",
      "PET_LINK_WINDOW_SECONDS",
    ].every((key) => env[key] === undefined)
  )
    return undefined;
  const keyHex = env.PET_LINK_HMAC_KEY_HEX;
  if (!keyHex || !/^[a-f0-9]{64}$/i.test(keyHex))
    throw new ConfigurationError("PET_LINK_HMAC_KEY_HEX requires 32 bytes encoded as hexadecimal");
  const positive = (name: string) => {
    const raw = env[name] ?? "";
    const number = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(number) || number > 2_147_483_647)
      throw new ConfigurationError(`${name} must be a positive 32-bit integer`);
    return number;
  };
  return {
    keyHex,
    lifetimeSeconds: positive("PET_LINK_LIFETIME_SECONDS"),
    attemptLimit: positive("PET_LINK_ATTEMPT_LIMIT"),
    windowSeconds: positive("PET_LINK_WINDOW_SECONDS"),
  };
}

export interface DocumentConfig {
  endpoint: string;
  region: string;
  bucket: string;
  maxBytes: number;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export function loadDocumentConfig(env = environment()): DocumentConfig | undefined {
  if (
    ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "DOCUMENT_MAX_BYTES"].every(
      (name) => env[name] === undefined,
    )
  )
    return undefined;
  const raw = env.S3_ENDPOINT ?? "";
  const url = URL.parse(raw);
  if (
    !url ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    /[?#\\\s]/.test(raw)
  )
    throw new ConfigurationError("S3_ENDPOINT must be an HTTPS origin or a loopback HTTP origin");
  const region = env.S3_REGION ?? "",
    bucket = env.S3_BUCKET ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(region))
    throw new ConfigurationError("S3_REGION must be supplied");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..") || isIP(bucket))
    throw new ConfigurationError("S3_BUCKET must be a valid bucket name");
  const limit = env.DOCUMENT_MAX_BYTES ?? "";
  const maxBytes = Number(limit);
  if (!/^[1-9]\d*$/.test(limit) || !Number.isSafeInteger(maxBytes) || maxBytes > 32 * 1024 * 1024)
    throw new ConfigurationError("DOCUMENT_MAX_BYTES must be between one byte and 32 MiB");
  const accessKeyId = env.S3_ACCESS_KEY,
    secretAccessKey = env.S3_SECRET_KEY;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey))
    throw new ConfigurationError(
      "Supply both static S3 credential settings or use the AWS credentials provider",
    );
  return {
    endpoint: url.origin,
    region,
    bucket,
    maxBytes,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  };
}

export interface ExchangeConfig {
  keyDirectoryPath: string;
  maxPackageBytes: number;
  maxRecords: number;
}
export function loadExchangeConfig(env = environment()): ExchangeConfig | undefined {
  const path = env.VETPKG_KEYRING_FILE;
  if (!path) return undefined;
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0"))
    throw new ConfigurationError("VETPKG_KEYRING_FILE must be an absolute secret file path");
  const positive = (key: string, ceiling: number) => {
    const raw = env[key] ?? "",
      value = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value) || value > ceiling)
      throw new ConfigurationError(`${key} must be a positive integer within the process limit`);
    return value;
  };
  return {
    keyDirectoryPath: path,
    maxPackageBytes: positive("VETPKG_MAX_PACKAGE_BYTES", 64 * 1024 * 1024),
    maxRecords: positive("VETPKG_MAX_RECORDS", 10000),
  };
}

export interface OrthancConfig {
  endpoint: string;
  username: string;
  password: string;
  timeoutMs: number;
  metadataBytes: number;
  previewBytes: number;
}
export function loadOrthancConfig(env = environment()): OrthancConfig | undefined {
  const names = [
    "ORTHANC_API_URL",
    "ORTHANC_API_USERNAME",
    "ORTHANC_API_PASSWORD",
    "ORTHANC_TIMEOUT_MS",
    "ORTHANC_METADATA_BYTES",
    "ORTHANC_PREVIEW_BYTES",
  ] as const;
  if (names.every((name) => !env[name])) return undefined;
  const read = (name: (typeof names)[number]) => {
    const v = env[name];
    if (!v || v !== v.trim()) throw new ConfigurationError("Invalid " + name);
    return v;
  };
  const number = (name: (typeof names)[number], maximum: number) => {
    const s = read(name),
      n = Number(s);
    if (!/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(n) || n > maximum)
      throw new ConfigurationError("Invalid " + name);
    return n;
  };
  const url = URL.parse(read("ORTHANC_API_URL"));
  if (
    !url ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ConfigurationError("Invalid ORTHANC_API_URL");
  return {
    endpoint: url.href.replace(/\/$/, ""),
    username: read("ORTHANC_API_USERNAME"),
    password: read("ORTHANC_API_PASSWORD"),
    timeoutMs: number("ORTHANC_TIMEOUT_MS", 120000),
    metadataBytes: number("ORTHANC_METADATA_BYTES", 8 * 1024 * 1024),
    previewBytes: number("ORTHANC_PREVIEW_BYTES", 32 * 1024 * 1024),
  };
}
