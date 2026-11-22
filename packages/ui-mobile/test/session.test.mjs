import assert from "node:assert/strict";
import { test } from "node:test";

import { AccessTokenRejectedError, MobileSession, SessionRejectedError } from "../src/session.ts";
import {
  authorizationCode,
  readProviderDocument,
  readTokenResponse,
  requireAccountResponse,
} from "../src/auth-protocol.ts";

const account = { subject: "vetx-user", organizations: [{ id: "clinic", name: "Clínica" }] };
const tokens = { accessToken: "access-one", refreshToken: "refresh-one", expiresIn: 300 };
const rotated = { accessToken: "access-two", refreshToken: "refresh-two", expiresIn: 300 };

function fixture(overrides = {}) {
  const calls = [];
  let stored;
  let now = 0;
  const dependencies = {
    now: () => now,
    authorize: async (locale) => {
      calls.push(["authorize", locale]);
      return tokens;
    },
    refresh: async (token) => {
      calls.push(["refresh", token]);
      return rotated;
    },
    verify: async (token) => {
      calls.push(["verify", token]);
      return account;
    },
    revoke: async (token) => calls.push(["revoke", token]),
    storage: {
      read: async () => stored,
      write: async (token) => {
        calls.push(["store", token]);
        stored = token;
      },
      clear: async () => {
        calls.push(["erase"]);
        stored = undefined;
      },
    },
    ...overrides,
  };
  return {
    calls,
    dependencies,
    session: new MobileSession(dependencies),
    advanceTime: (time) => {
      now += time;
    },
    setStored: (token) => {
      stored = token;
    },
    getStored: () => stored,
  };
}

test("requires /me before presenting the account and persists only the refresh token", async () => {
  const { calls, session, getStored } = fixture();
  await session.restore();
  await session.signIn("es");
  assert.deepEqual(calls, [
    ["authorize", "es"],
    ["store", "refresh-one"],
    ["verify", "access-one"],
  ]);
  assert.deepEqual(session.getSnapshot().account, account);
  assert.equal(getStored(), "refresh-one");
});

test("dismissal returns to the sign-in screen and does not contact /me", async () => {
  const { calls, session, getStored } = fixture({ authorize: async () => null });
  await session.restore();
  await session.signIn("en");
  assert.deepEqual(session.getSnapshot(), { status: "signedOut" });
  assert.deepEqual(calls, []);
  assert.equal(getStored(), undefined);
});

test("restores a session through refresh and renews shortly before access expiry", async () => {
  const { calls, session, setStored, getStored, advanceTime } = fixture();
  setStored("refresh-from-previous-launch");
  await session.restore();
  assert.equal(getStored(), "refresh-two");
  assert.deepEqual(calls, [
    ["refresh", "refresh-from-previous-launch"],
    ["store", "refresh-two"],
    ["verify", "access-two"],
  ]);
  advanceTime(280_000);
  await session.revalidate();
  assert.deepEqual(calls.at(-2), ["refresh", "refresh-two"]);
  assert.equal(session.getSnapshot().status, "signedIn");
});

test("revoked account verification clears the credential and hides the account", async () => {
  let revoked = false;
  const { session, getStored } = fixture({
    verify: async () => {
      if (revoked) throw new AccessTokenRejectedError();
      return account;
    },
  });
  await session.restore();
  await session.signIn("en");
  revoked = true;
  await session.revalidate();
  assert.deepEqual(session.getSnapshot(), { status: "signedOut", issue: "rejected" });
  assert.equal(getStored(), undefined);
});

test("an unavailable /me locks the account and keeps the refresh token for retry", async () => {
  let offline = true;
  const { session, getStored, calls } = fixture({
    verify: async () => {
      if (offline) throw new TypeError("network unavailable");
      return account;
    },
  });
  await session.restore();
  await session.signIn("en");
  assert.deepEqual(session.getSnapshot(), { status: "verificationFailed" });
  assert.equal(getStored(), "refresh-one");
  assert.equal(session.getSnapshot().account, undefined);

  offline = false;
  await session.revalidate();
  assert.deepEqual(session.getSnapshot().account, account);
  assert.equal(calls.filter(([name]) => name === "refresh").length, 0);
});

test("a restore timeout keeps the saved refresh token and can retry on foreground", async () => {
  let offline = true;
  const refreshed = [];
  const { session, setStored, getStored } = fixture({
    refresh: async (token) => {
      refreshed.push(token);
      if (offline) throw new DOMException("deadline", "AbortError");
      return rotated;
    },
  });
  setStored("saved-token");
  await session.restore();
  assert.deepEqual(session.getSnapshot(), { status: "verificationFailed" });
  assert.equal(getStored(), "saved-token");

  offline = false;
  await session.revalidate();
  assert.deepEqual(refreshed, ["saved-token", "saved-token"]);
  assert.equal(getStored(), "refresh-two");
  assert.equal(session.getSnapshot().status, "signedIn");
});

test("an explicit refresh rejection clears saved credentials", async () => {
  const { session, setStored, getStored } = fixture({
    refresh: async () => {
      throw new SessionRejectedError();
    },
  });
  setStored("previously-valid");
  await session.restore();
  assert.deepEqual(session.getSnapshot(), { status: "signedOut", issue: "rejected" });
  assert.equal(getStored(), undefined);
});

test("a rotated credential is already saved when profile verification fails", async () => {
  let offline = false;
  const { session, getStored, calls, advanceTime } = fixture({
    verify: async () => {
      if (offline) throw new TypeError("network unavailable");
      return account;
    },
  });
  await session.restore();
  await session.signIn("es");
  offline = true;
  advanceTime(280_000);
  await session.revalidate();
  assert.equal(getStored(), "refresh-two");
  assert.deepEqual(session.getSnapshot(), { status: "verificationFailed" });

  await session.signOut();
  assert.equal(getStored(), undefined);
  assert.deepEqual(calls.at(-1), ["revoke", "refresh-two"]);
});

test("a failed rotated-token write stays locked and retries the write before verifying the account", async () => {
  let stored = "saved-token";
  let unavailable = true;
  const verification = [];
  const { session, calls } = fixture({
    storage: {
      read: async () => stored,
      write: async (token) => {
        if (unavailable) throw new Error("device locked");
        stored = token;
      },
      clear: async () => {
        stored = undefined;
      },
    },
    verify: async (token) => {
      verification.push(token);
      return account;
    },
  });
  await session.restore();
  assert.deepEqual(session.getSnapshot(), { status: "verificationFailed" });
  assert.deepEqual(verification, []);
  assert.equal(stored, "saved-token");

  unavailable = false;
  await session.revalidate();
  assert.equal(stored, "refresh-two");
  assert.deepEqual(verification, ["access-two"]);
  assert.deepEqual(
    calls.filter(([name]) => name === "refresh"),
    [["refresh", "saved-token"]],
  );
  assert.equal(session.getSnapshot().status, "signedIn");
});

test("logout while retrying a failed restore never restores the late account", async () => {
  let unavailable = true;
  const read = Promise.withResolvers();
  let stored = "saved-token";
  const { session, calls } = fixture({
    storage: {
      read: async () => {
        if (unavailable) throw new Error("device locked");
        return read.promise;
      },
      write: async (token) => {
        stored = token;
      },
      clear: async () => {
        stored = undefined;
      },
    },
  });
  await session.restore();
  assert.deepEqual(session.getSnapshot(), { status: "verificationFailed" });
  unavailable = false;
  const retry = session.revalidate();
  const logout = session.signOut();
  read.resolve("saved-token");
  await Promise.all([retry, logout]);
  assert.deepEqual(session.getSnapshot(), { status: "signedOut" });
  assert.equal(stored, undefined);
  assert.deepEqual(calls, [["revoke", "saved-token"]]);
});

test("concurrent revalidation shares one refresh and logout revokes credentials from the in-flight refresh", async () => {
  const pending = Promise.withResolvers();
  let refreshCalls = 0;
  const { session, calls, advanceTime, getStored } = fixture({
    refresh: () => {
      refreshCalls += 1;
      return pending.promise;
    },
  });
  await session.restore();
  await session.signIn("es");
  advanceTime(280_000);
  const updating = session.revalidate();
  const concurrent = session.revalidate();
  const logout = session.signOut();
  assert.equal(session.getSnapshot().status, "signingOut");
  pending.resolve(rotated);
  await Promise.all([updating, concurrent, logout]);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(session.getSnapshot(), { status: "signedOut" });
  assert.equal(getStored(), undefined);
  assert.deepEqual(
    calls.filter(([name]) => name === "revoke"),
    [["revoke", "refresh-two"]],
  );
});

test("logout serializes erasure behind a started token write", async () => {
  const writeStarted = Promise.withResolvers();
  const releaseWrite = Promise.withResolvers();
  let stored = "refresh-from-previous-launch";
  const { session, calls } = fixture({
    storage: {
      read: async () => stored,
      write: async (token) => {
        writeStarted.resolve();
        await releaseWrite.promise;
        stored = token;
      },
      clear: async () => {
        stored = undefined;
      },
    },
  });
  const restore = session.restore();
  await writeStarted.promise;
  const logout = session.signOut();
  releaseWrite.resolve();
  await Promise.all([restore, logout]);
  assert.equal(stored, undefined);
  assert.deepEqual(calls.at(-1), ["revoke", "refresh-two"]);
  assert.equal(session.getSnapshot().status, "signedOut");
});

test("local sign-out completes even if remote revocation fails", async () => {
  const { session, getStored } = fixture({
    revoke: async () => {
      throw new Error("offline");
    },
  });
  await session.restore();
  await session.signIn("en");
  await session.signOut();
  assert.deepEqual(session.getSnapshot(), { status: "signedOut", issue: "revocationFailed" });
  assert.equal(getStored(), undefined);
});

test("a failed SecureStore delete leaves only the option to retry local sign-out", async () => {
  let attempts = 0;
  const { session } = fixture({
    storage: {
      read: async () => undefined,
      write: async () => {},
      clear: async () => {
        if (++attempts === 1) throw new Error("device storage unavailable");
      },
    },
  });
  await session.restore();
  await session.signIn("en");
  await session.signOut();
  assert.deepEqual(session.getSnapshot(), { status: "logoutFailed" });
  await session.signIn("en");
  assert.equal(session.getSnapshot().status, "logoutFailed");
  await session.signOut();
  assert.equal(session.getSnapshot().status, "signedOut");
});

const callback = "vetx-staff://auth/callback";
const issuer = "https://identity.example/realms/vetx";

test("checks the native callback target, unique state and issuer before returning an authorization code", () => {
  assert.equal(
    authorizationCode(callback + "?state=expected&code=secret", callback, "expected", issuer),
    "secret",
  );
  for (const url of [
    callback + "?state=wrong&code=secret",
    callback + "?state=expected&state=wrong&code=secret",
    callback + "?state=expected&code=first&code=second",
    callback + "?state=expected",
    callback + "?state=expected&code=secret#extra",
    callback + "?state=expected&code=secret&iss=https%3A%2F%2Fwrong.example",
    callback + "/wrong?state=expected&code=secret",
    "vetx-pets://auth/callback?state=expected&code=secret",
  ]) {
    assert.throws(() => authorizationCode(url, callback, "expected", issuer), SessionRejectedError);
  }
});

test("verification that crosses access expiry refreshes before exposing the account", async () => {
  const check = Promise.withResolvers();
  let verifying = false;
  const { session, calls, advanceTime } = fixture({
    verify: async () => {
      if (verifying) {
        verifying = false;
        return check.promise;
      }
      return account;
    },
    authorize: async () => ({ ...tokens, expiresIn: 5 }),
  });
  await session.restore();
  await session.signIn("en");
  verifying = true;
  advanceTime(3_900);
  const update = session.revalidate();
  advanceTime(1_500);
  check.resolve(account);
  await update;
  assert.ok(calls.some(([operation]) => operation === "refresh"));
  assert.equal(session.getSnapshot().status, "signedIn");
});

test("provider metadata must match the configured realm and keep credentials in that realm", () => {
  const payload = {
    issuer,
    authorization_endpoint: issuer + "/protocol/openid-connect/auth",
    token_endpoint: issuer + "/protocol/openid-connect/token",
    revocation_endpoint: issuer + "/protocol/openid-connect/revoke",
  };
  assert.equal(readProviderDocument(payload, issuer).tokenEndpoint, payload.token_endpoint);

  for (const endpoint of [
    "https://host.example/token",
    issuer + "-other/token",
    issuer + "/%2e%2e/other/token",
    issuer + "/protocol/openid-connect/token?next=https://other.example",
  ]) {
    assert.throws(() => readProviderDocument({ ...payload, token_endpoint: endpoint }, issuer), {
      message: "Invalid identity provider discovery document",
    });
  }
  assert.throws(() => readProviderDocument({ ...payload, issuer: issuer + "-other" }, issuer), {
    message: "Invalid identity provider discovery document",
  });
});

test("token refresh uses the new credential when present and preserves the older one when unrotated", () => {
  const response = {
    access_token: "access-two",
    refresh_token: "refresh-two",
    expires_in: 300,
    token_type: "Bearer",
  };
  assert.deepEqual(readTokenResponse(200, response, "refresh-one"), rotated);
  assert.equal(
    readTokenResponse(200, { ...response, refresh_token: undefined }, "refresh-one").refreshToken,
    "refresh-one",
  );
  assert.throws(() => readTokenResponse(200, { ...response, refresh_token: undefined }), {
    message: "Invalid identity provider token response",
  });
  assert.throws(() => readTokenResponse(200, { ...response, expires_in: 0 }), {
    message: "Invalid identity provider token response",
  });
});

test("invalid_grant is a rejection, while service errors leave the grant unverified", () => {
  const invalid = { error: "invalid_grant" };
  assert.throws(() => readTokenResponse(400, invalid), SessionRejectedError);
  for (const [status, body] of [
    [503, invalid],
    [502, null],
    [429, { error: "temporarily_unavailable" }],
  ]) {
    assert.throws(
      () => readTokenResponse(status, body),
      (error) => !(error instanceof SessionRejectedError),
    );
  }
});

test("profile failure distinguishes explicit rejection from account service outages", () => {
  assert.doesNotThrow(() => requireAccountResponse(200));
  assert.throws(() => requireAccountResponse(401), AccessTokenRejectedError);
  assert.throws(() => requireAccountResponse(403), SessionRejectedError);
  assert.throws(
    () => requireAccountResponse(503),
    (error) => !(error instanceof SessionRejectedError),
  );
});

test("a profile request that receives 401 after known local expiry can refresh", async () => {
  const check = Promise.withResolvers();
  let latency = false;
  const { session, calls, getStored, advanceTime } = fixture({
    verify: async () => {
      if (latency) {
        latency = false;
        return check.promise;
      }
      return account;
    },
    authorize: async () => ({ ...tokens, expiresIn: 5 }),
  });
  await session.restore();
  await session.signIn("es");
  latency = true;
  advanceTime(3_900);
  const update = session.revalidate();
  advanceTime(1_500);
  check.reject(new AccessTokenRejectedError());
  await update;
  assert.ok(calls.some(([operation]) => operation === "refresh"));
  assert.equal(getStored(), "refresh-two");
  assert.equal(session.getSnapshot().status, "signedIn");
});

test("an access token that expires during initial verification stays locked for refresh", async () => {
  const started = Promise.withResolvers();
  const delayed = Promise.withResolvers();
  const { session, getStored, advanceTime } = fixture({
    verify: async (token) => {
      if (token === "access-one") {
        started.resolve();
        return delayed.promise;
      }
      return account;
    },
    authorize: async () => ({ ...tokens, expiresIn: 5 }),
  });
  await session.restore();
  const signIn = session.signIn("es");
  await started.promise;
  advanceTime(5_001);
  delayed.resolve(account);
  await signIn;
  assert.equal(getStored(), "refresh-one");
  assert.deepEqual(session.getSnapshot(), { status: "verificationFailed" });

  await session.revalidate();
  assert.equal(getStored(), "refresh-two");
  assert.equal(session.getSnapshot().status, "signedIn");
});

test("organization requests require the verified subject and a current membership", async () => {
  const { session, advanceTime } = fixture();
  const run = (subject, org) => session.forOrganization(subject, org, async (token) => token);
  await session.restore();
  await assert.rejects(run(account.subject, "clinic"));
  await session.signIn("en");
  assert.equal(await run(account.subject, "clinic"), tokens.accessToken);
  await assert.rejects(run("other-user", "clinic"));
  await assert.rejects(run(account.subject, "other-clinic"));
  advanceTime(60_001);
  await assert.rejects(run(account.subject, "clinic"));
});

test("sign-out cancels an organization request and discards even a late success", async () => {
  const { session } = fixture();
  await session.restore();
  await session.signIn("es");
  const release = Promise.withResolvers();
  let signal;
  const pending = session.forOrganization(
    account.subject,
    "clinic",
    async (_token, currentSignal) => {
      signal = currentSignal;
      return release.promise;
    },
  );
  await session.signOut();
  assert.equal(signal.aborted, true);
  release.resolve("private directory");
  await assert.rejects(pending);
});

test("a fresh profile invalidates a pending directory read and withdraws removed memberships", async () => {
  let verified = account;
  const { session } = fixture({ verify: async () => verified });
  await session.restore();
  await session.signIn("en");
  const release = Promise.withResolvers();
  let signal;
  const pending = session.forOrganization(account.subject, "clinic", async (_token, current) => {
    signal = current;
    return release.promise;
  });
  verified = { ...account, organizations: [] };
  await session.revalidate();
  assert.equal(signal.aborted, true);
  release.resolve("previous directory");
  await assert.rejects(pending);
  await assert.rejects(session.forOrganization(account.subject, "clinic", async () => "removed"));
});

test("owner requests use the current verified account even with no staff memberships", async () => {
  const owner = { subject: "owner", organizations: [] };
  const { session, advanceTime } = fixture({ verify: async () => owner });
  await session.restore();
  await session.signIn("es");
  assert.equal(typeof session.forAccount, "function");
  assert.equal(await session.forAccount(owner.subject, async (token) => token), tokens.accessToken);
  await assert.rejects(session.forAccount("previous-owner", async () => "wrong owner"));
  await assert.rejects(session.forOrganization(owner.subject, "clinic", async () => "wrong scope"));
  advanceTime(60_001);
  await assert.rejects(session.forAccount(owner.subject, async () => "stale"));
});

test("sign-out aborts owner reads and discards results produced after cancellation", async () => {
  const { session } = fixture();
  await session.restore();
  await session.signIn("es");
  const pending = Promise.withResolvers();
  let signal;
  assert.equal(typeof session.forAccount, "function");
  const request = session.forAccount(account.subject, (_token, current) => {
    signal = current;
    return pending.promise;
  });
  await session.signOut();
  assert.equal(signal.aborted, true);
  pending.resolve("previous owner's pets");
  await assert.rejects(request);
});
