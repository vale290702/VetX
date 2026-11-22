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
