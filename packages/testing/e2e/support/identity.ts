import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

export function setting(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing test setting ${key}`);
  return value;
}

function localRealm() {
  const issuer = new URL(setting("OIDC_ISSUER_URL"));
  if (!["localhost", "127.0.0.1"].includes(issuer.hostname) || issuer.pathname !== "/realms/vetx") {
    throw new Error("Identity fixtures require the local VetX development realm");
  }
  return issuer;
}

async function admin(path: string, init: RequestInit = {}) {
  const issuer = localRealm();
  const token = await fetch(new URL("/realms/master/protocol/openid-connect/token", issuer), {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: setting("KEYCLOAK_ADMIN"),
      password: setting("KEYCLOAK_ADMIN_PASSWORD"),
    }),
  });
  if (!token.ok) throw new Error(`Test admin authentication failed (${token.status})`);
  const { access_token: accessToken } = (await token.json()) as { access_token: string };
  const url = new URL(`/admin/realms/vetx/${path}`, issuer);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Test identity administration failed (${res.status})`);
  return res;
}

export async function createIdentity(requiredActions: string[] = []) {
  const username = `vetx-test-${randomUUID()}`;
  const password = randomBytes(32).toString("base64url");
  const response = await admin("users", {
    method: "POST",
    body: JSON.stringify({
      username,
      requiredActions,
      enabled: true,
      firstName: "VetX",
      lastName: "Test",
      emailVerified: true,
      email: `${username}@example.test`,
      credentials: [{ type: "password", value: password, temporary: false }],
    }),
  });
  const id = response.headers.get("location")?.split("/").pop();
  if (!id) throw new Error("Keycloak did not return the test identity ID");
  return {
    id,
    username,
    password,
    email: `${username}@example.test`,
    remove: () => admin(`users/${id}`, { method: "DELETE" }),
    async sessions() {
      const result = await admin(`users/${id}/sessions`);
      return (await result.json()) as Array<{ id: string }>;
    },
  };
}
export async function revokeSession(id: string) {
  await admin(`sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function enterCredentials(
  page: Page,
  user: Awaited<ReturnType<typeof createIdentity>>,
) {
  await page.locator('input[name="username"]').fill(user.username);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator("#kc-login").click();
}

/** Exercise the actual public client and realm with a system-browser redirect. */
export async function mobileSession(
  page: Page,
  user: Awaited<ReturnType<typeof createIdentity>>,
  role: "STAFF" | "OWNER",
) {
  const issuer = localRealm();
  const clientId = setting(`OIDC_${role}_CLIENT_ID`);
  const callback = role === "STAFF" ? "vetx-staff://auth/callback" : "vetx-pets://auth/callback";
  const verifier = randomBytes(48).toString("base64url");
  const state = randomUUID();
  const auth = new URL(issuer.href + "/protocol/openid-connect/auth");
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    state,
    scope: role === "OWNER" ? "openid email" : "openid",
    prompt: "login",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  await page.goto(auth.href);
  const redirect = page.waitForResponse(
    (res) => res.headers()["location"]?.startsWith(callback + "?") === true,
  );
  await enterCredentials(page, user);
  const response = await redirect;
  const location = new URL((await response.headerValue("location"))!);
  const code = location.searchParams.get("code");
  if (!code || location.searchParams.get("state") !== state)
    throw new Error("Invalid mobile callback");
  const exchange = await fetch(issuer.href + "/protocol/openid-connect/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
    }),
  });
  if (!exchange.ok) throw new Error(`Public client exchange failed (${exchange.status})`);
  const result = (await exchange.json()) as { access_token: string; refresh_token: string };
  return {
    accessToken: result.access_token,
    async revoke() {
      const response = await fetch(issuer.href + "/protocol/openid-connect/revoke", {
        method: "POST",
        body: new URLSearchParams({
          client_id: clientId,
          token: result.refresh_token,
          token_type_hint: "refresh_token",
        }),
      });
      if (!response.ok) throw new Error(`Mobile session revocation failed (${response.status})`);
    },
  };
}

/** Generate a test authenticator code for the local realm's default RFC 6238 policy. */
export function authenticatorCode(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}
