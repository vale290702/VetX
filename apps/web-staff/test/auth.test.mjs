import assert from "node:assert/strict";
import { test } from "node:test";

import { beginLogin, finishLogin, readSessionAccess, signOutSession } from "../src/auth/flows.ts";
import {
  authorizationKey,
  createSecret,
  isSameOriginPost,
  secretsMatch,
  trustedCallback,
} from "../src/auth/security.ts";
import { parseWebAuthConfig } from "../src/auth/config.ts";

const origin = new URL("https://staff.example.com");
const fixedBrowserId = createSecret();
const fixedState = createSecret();

const session = {
  subject: "staff-user",
  username: "vet",
  csrf: createSecret(),
  accessToken: "current-access-token",
  refreshToken: "current-refresh-token",
  idToken: "current-id-token",
  accessExpiresAt: 0,
};

function fixtureStore() {
  const attempts = new Map();
  const sessions = new Map([[fixedBrowserId, session]]);
  const locks = new Map();
  return {
    async saveAuthorization(browserId, attempt) {
      attempts.set(authorizationKey(browserId, attempt.state), attempt);
    },
    async takeAuthorization(browserId, state) {
      const key = authorizationKey(browserId, state);
      const attempt = attempts.get(key);
      attempts.delete(key);
      return attempt ?? null;
    },
    async readSession(id) {
      return sessions.get(id) ?? null;
    },
    async replaceSession(id, prior, next) {
      if (sessions.get(id) !== prior) return false;
      sessions.set(id, next);
      return true;
    },
    async refreshLock(id, owner) {
      if (locks.has(id)) return false;
      locks.set(id, owner);
      return true;
    },
    async releaseRefreshLock(id, owner) {
      if (locks.get(id) === owner) locks.delete(id);
    },
    async removeSessionIfCurrent(id, prior) {
      if (sessions.get(id) === prior) sessions.delete(id);
    },
    async removeSession(id) {
      const old = sessions.get(id);
      sessions.delete(id);
      return old ?? null;
    },
  };
}

test("cross-origin, missing origin, and non-POST requests fail closed", () => {
  assert.equal(
    isSameOriginPost(
      new Request(origin, { method: "POST", headers: { Origin: origin.origin } }),
      origin,
    ),
    true,
  );
  assert.equal(
    isSameOriginPost(
      new Request(origin, { method: "POST", headers: { Origin: "https://other.example.org" } }),
      origin,
    ),
    false,
  );
  assert.equal(isSameOriginPost(new Request(origin, { method: "POST" }), origin), false);
  assert.equal(
    isSameOriginPost(new Request(origin, { headers: { Origin: origin.origin } }), origin),
    false,
  );
  assert.equal(secretsMatch(fixedState, fixedState), true);
  assert.equal(secretsMatch(fixedState, fixedBrowserId), false);
  assert.equal(secretsMatch(fixedState, null), false);
});

test("callback always uses the configured origin and exact path", () => {
  const url = trustedCallback(origin, new URL("https://attacker.invalid/other?code=a-code"));
  assert.equal(url.href, "https://staff.example.com/auth/callback?code=a-code");
});

test("auth start is random and callback must have the correct browser and unconsumed state", async () => {
  const store = fixtureStore();
  let exchangeCount = 0;
  const oidc = {
    async authorizationUrl(attempt) {
      assert.notEqual(attempt.state, attempt.nonce);
      assert.notEqual(attempt.state, attempt.verifier);
      return new URL(`https://issuer.example.com/authorize?state=${attempt.state}`);
    },
    async exchange(url, attempt) {
      exchangeCount += 1;
      assert.equal(url.origin, origin.origin);
      assert.equal(url.searchParams.get("state"), attempt.state);
      return session;
    },
  };
  const { browserId, authorizationUrl } = await beginLogin("en", oidc, store);
  const state = authorizationUrl.searchParams.get("state");
  const callback = new URL(`/auth/callback?code=test&state=${state}`, origin);
  const wrongCallback = new URL(`/auth/callback?code=test&state=${fixedState}`, origin);
  const repeatedCallback = new URL(
    `/auth/callback?code=test&state=${state}&state=${state}`,
    origin,
  );
  assert.equal(await finishLogin(origin, callback, fixedBrowserId, oidc, store), null);
  assert.equal(await finishLogin(origin, wrongCallback, browserId, oidc, store), null);
  assert.equal(await finishLogin(origin, repeatedCallback, browserId, oidc, store), null);
  assert.equal(exchangeCount, 0);
  const results = await Promise.all([
    finishLogin(origin, callback, browserId, oidc, store),
    finishLogin(origin, callback, browserId, oidc, store),
  ]);
  assert.equal(results.filter((result) => result?.session === session).length, 1);
  assert.equal(results.find(Boolean)?.locale, "en");
  assert.equal(exchangeCount, 1);
});

test("parallel requests refresh a rotating token once", async () => {
  const store = fixtureStore();
  let renewCount = 0;
  const updated = {
    ...session,
    accessToken: "new-access-token",
    accessExpiresAt: Date.now() + 60_000,
  };
  const oidc = {
    async refresh() {
      renewCount += 1;
      return updated;
    },
    async isActive(accessToken, subject) {
      return accessToken === updated.accessToken && subject === session.subject;
    },
  };
  assert.deepEqual(
    await Promise.all([
      readSessionAccess(fixedBrowserId, oidc, store),
      readSessionAccess(fixedBrowserId, oidc, store),
    ]),
    [
      { kind: "active", session: updated },
      { kind: "active", session: updated },
    ],
  );
  assert.equal(renewCount, 1);
});

test("logout during refresh prevents stale credentials from restoring a deleted session", async () => {
  const store = fixtureStore();
  const oidc = {
    async refresh() {
      await store.removeSession(fixedBrowserId);
      return { ...session, accessExpiresAt: Date.now() + 60_000 };
    },
    async isActive() {
      assert.fail("a deleted session must not be used");
    },
  };
  assert.deepEqual(await readSessionAccess(fixedBrowserId, oidc, store), { kind: "anonymous" });
  assert.equal(await store.readSession(fixedBrowserId), null);
});

test("provider revocation clears the current browser session, temporary outages preserve it", async () => {
  const store = fixtureStore();
  const renewed = { ...session, accessExpiresAt: Date.now() + 60_000 };
  const oidc = {
    async refresh() {
      return renewed;
    },
    async isActive() {
      throw new Error("temporarily unavailable");
    },
  };
  assert.deepEqual(await readSessionAccess(fixedBrowserId, oidc, store), {
    kind: "locked",
    csrf: session.csrf,
  });
  assert.equal(await store.readSession(fixedBrowserId), renewed);
  assert.deepEqual(
    await readSessionAccess(fixedBrowserId, { ...oidc, isActive: async () => false }, store),
    { kind: "anonymous" },
  );
  assert.equal(await store.readSession(fixedBrowserId), null);
});

test("refresh outages lock recognized sessions, without trusting cookies alone", async () => {
  const store = fixtureStore();
  const oidc = {
    async refresh() {
      throw new Error("temporarily unavailable");
    },
    async isActive() {
      assert.fail("unverified session must stay locked");
    },
  };
  assert.deepEqual(await readSessionAccess(fixedBrowserId, oidc, store), {
    kind: "locked",
    csrf: session.csrf,
  });
  assert.deepEqual(await readSessionAccess(createSecret(), oidc, store), { kind: "anonymous" });
  await assert.rejects(
    readSessionAccess(fixedBrowserId, oidc, {
      ...store,
      async readSession() {
        throw new Error("Redis unavailable");
      },
    }),
    /Redis unavailable/,
  );
});

test("sign-out requires local CSRF before deleting a session or calling Keycloak", async () => {
  const store = fixtureStore();
  const oidc = {
    async revoke() {
      assert.fail("invalid CSRF cannot start revocation");
    },
    async logoutUrl() {
      assert.fail("invalid CSRF cannot start provider sign-out");
    },
  };
  assert.deepEqual(await signOutSession(fixedBrowserId, fixedState, oidc, store), {
    kind: "rejected",
  });
  assert.equal(await store.readSession(fixedBrowserId), session);
});

test("local sign-out completes before Keycloak and reports a provider failure", async () => {
  for (const failingStep of ["revoke", "logoutUrl"]) {
    const store = fixtureStore();
    const oidc = {
      async revoke(removed) {
        assert.equal(removed, session);
        assert.equal(await store.readSession(fixedBrowserId), null);
        if (failingStep === "revoke") throw new Error("provider unavailable");
      },
      async logoutUrl() {
        assert.equal(failingStep, "logoutUrl");
        throw new Error("provider unavailable");
      },
    };
    assert.deepEqual(await signOutSession(fixedBrowserId, session.csrf, oidc, store), {
      kind: "local",
    });
    assert.equal(await store.readSession(fixedBrowserId), null);
  }
});

test("healthy provider sign-out returns its end-session destination", async () => {
  const store = fixtureStore();
  const url = new URL("https://issuer.example.com/logout");
  const oidc = {
    async revoke() {
      assert.equal(await store.readSession(fixedBrowserId), null);
    },
    async logoutUrl(removed) {
      assert.equal(removed, session);
      return url;
    },
  };
  assert.deepEqual(await signOutSession(fixedBrowserId, session.csrf, oidc, store), {
    kind: "provider",
    destination: url,
  });
});

test("production URLs require TLS and loopback URLs permit local HTTP", () => {
  const env = {
    OIDC_ISSUER_URL: "http://localhost:8080/realms/vetx",
    OIDC_WEB_CLIENT_ID: "vetx-staff-web",
    OIDC_WEB_CLIENT_SECRET: "local-demo-secret",
    WEB_PUBLIC_ORIGIN: "http://localhost:3000",
    WEB_REDIS_URL: "redis://localhost:6379",
    API_INTERNAL_URL: "http://localhost:4000",
  };
  assert.equal(parseWebAuthConfig(env)?.webOrigin.origin, "http://localhost:3000");
  assert.equal(parseWebAuthConfig({ API_INTERNAL_URL: env.API_INTERNAL_URL }), null);
  assert.throws(
    () => parseWebAuthConfig({ ...env, WEB_PUBLIC_ORIGIN: "http://staff.example.com" }),
    /WEB_PUBLIC_ORIGIN/,
  );
  assert.throws(
    () => parseWebAuthConfig({ ...env, OIDC_ISSUER_URL: "http://id.example.org/realms/vetx" }),
    /OIDC_ISSUER_URL/,
  );
  assert.throws(
    () => parseWebAuthConfig({ ...env, WEB_PUBLIC_ORIGIN: "https://staff.example.com/login" }),
    /WEB_PUBLIC_ORIGIN/,
  );
});
