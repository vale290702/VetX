import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const webSettings = [
  "OIDC_WEB_CLIENT_ID",
  "OIDC_WEB_CLIENT_SECRET",
  "WEB_PUBLIC_ORIGIN",
  "WEB_REDIS_URL",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

export type WebAuthConfig = {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  webOrigin: URL;
  redisUrl: string;
  apiOrigin: string;
};

function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value?.trim() || value.trim() !== value) throw new Error(`Invalid ${name}`);
  return value;
}

function checkedUrl(env: Environment, name: string): URL {
  const value = required(env, name);
  try {
    if (/[\\\s?#]/.test(value)) throw new Error();
    return new URL(value);
  } catch {
    throw new Error(`Invalid ${name}`);
  }
}

function browserUrl(env: Environment, name: string): URL {
  const url = checkedUrl(env, name);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password
  ) {
    throw new Error(`Invalid ${name}`);
  }
  return url;
}

export function parseWebAuthConfig(env: Environment): WebAuthConfig | null {
  if (webSettings.every((key) => env[key] === undefined)) return null;
  const issuer = browserUrl(env, "OIDC_ISSUER_URL");
  if (issuer.pathname.endsWith("/")) issuer.pathname = issuer.pathname.slice(0, -1);
  const webOrigin = browserUrl(env, "WEB_PUBLIC_ORIGIN");
  if (webOrigin.pathname !== "/") throw new Error("Invalid WEB_PUBLIC_ORIGIN");
  const redis = checkedUrl(env, "WEB_REDIS_URL");
  if (
    !["redis:", "rediss:"].includes(redis.protocol) ||
    !redis.hostname ||
    !/^(\/\d*)?$/.test(redis.pathname)
  ) {
    throw new Error("Invalid WEB_REDIS_URL");
  }
  const api = checkedUrl(env, "API_INTERNAL_URL");
  if (
    !["http:", "https:"].includes(api.protocol) ||
    api.username ||
    api.password ||
    api.pathname !== "/"
  ) {
    throw new Error("Invalid API_INTERNAL_URL");
  }
  return {
    issuer,
    clientId: required(env, "OIDC_WEB_CLIENT_ID"),
    clientSecret: required(env, "OIDC_WEB_CLIENT_SECRET"),
    webOrigin,
    redisUrl: redis.href,
    apiOrigin: api.origin,
  };
}

export function loadWebAuthConfig(): WebAuthConfig | null {
  let local: Environment = {};
  try {
    local = parseEnv(readFileSync(resolve(process.cwd(), "../../.env"), "utf8"));
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
      throw new Error("Unable to read the workspace environment file");
    }
  }
  return parseWebAuthConfig({ ...local, ...process.env });
}
