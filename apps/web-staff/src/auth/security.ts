import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const callbackPath = "/auth/callback";
export const loginLifetimeSeconds = 10 * 60;
export const sessionLifetimeSeconds = 8 * 60 * 60;
export const providerTimeoutSeconds = 5;

export function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function isSecret(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{43}$/.test(value);
}

export function secretsMatch(expected: string, received: string | null): boolean {
  return (
    isSecret(expected) &&
    isSecret(received) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}

function digest(...values: string[]): string {
  return createHash("sha256").update(values.join(":")).digest("hex");
}

export function authorizationKey(browserId: string, state: string): string {
  return `vetx:web:auth:${digest(browserId, state)}`;
}

export function sessionKey(sessionId: string): string {
  return `vetx:web:session:${digest(sessionId)}`;
}

export function trustedCallback(origin: URL, requestUrl?: URL): URL {
  const url = new URL(callbackPath, origin);
  if (requestUrl) url.search = requestUrl.search;
  return url;
}

export function isSameOriginPost(request: Request, origin: URL): boolean {
  return request.method === "POST" && request.headers.get("origin") === origin.origin;
}
