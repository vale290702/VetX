import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  IdentityProviderUnavailableError,
  InvalidAccessTokenError,
  KeycloakTokenVerifier,
} from "../dist/index.js";

const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = {
  ...(await exportJWK(publicKey)),
  alg: "RS256",
  kid: "phase-two-test-key",
  use: "sig",
};
const revoked = new Set();
let requestCount = 0;
let upstream = "active";
const server = createServer(async (request, response) => {
  if (request.url?.endsWith("/certs")) {
    return response
      .setHeader("Content-Type", "application/json")
      .end(JSON.stringify({ keys: [publicJwk] }));
  }
  requestCount++;
  const expectedCredentials = Buffer.from("api-client:example%3Aclient+secret").toString("base64");
  if (
    request.method !== "POST" ||
    request.headers.authorization !== "Basic " + expectedCredentials
  ) {
    response.statusCode = 401;
    return response.end();
  }
  if (upstream === "outage") {
    response.statusCode = 502;
    return response.end();
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const token = new URLSearchParams(Buffer.concat(chunks).toString()).get("token");
  const claims = decodeJwt(token);
  response.setHeader("Content-Type", "application/json");
  return response.end(
    JSON.stringify(
      revoked.has(claims.sid)
        ? { active: false }
        : {
            ...claims,
            active: true,
            client_id: claims.azp,
            sub: upstream === "mismatch" ? "unexpected" : claims.sub,
          },
    ),
  );
});

let issuer;
let verifier;
before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  issuer = `http://127.0.0.1:${server.address().port}/realms/vetx`;
  verifier = new KeycloakTokenVerifier({
    issuer,
    apiClientId: "api-client",
    apiClientSecret: "example:client secret",
    webClientId: "web-client",
    staffClientId: "staff-client",
    ownerClientId: "owner-client",
  });
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function issueToken(claims = {}, signingKey = privateKey) {
  return new SignJWT({
    aud: ["api-client", "account"],
    typ: "Bearer",
    azp: "staff-client",
    sid: "session-a",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "phase-two-test-key" })
    .setIssuer(claims.iss ?? issuer)
    .setSubject("person-one")
    .setExpirationTime(claims.exp ?? "5m")
    .sign(signingKey);
}

test("validates both staff app clients and distinguishes owner identity", async () => {
  for (const azp of ["staff-client", "web-client", "owner-client"]) {
    assert.deepEqual(await verifier.verify(await issueToken({ azp })), {
      issuer,
      subject: "person-one",
      kind: azp === "owner-client" ? "owner" : "staff",
    });
  }
});

test("rejects mismatched issuer, audience, client, token type, session and expiry before live verification", async () => {
  const previousCount = requestCount;
  for (const mismatch of [
    { iss: "https://unexpected.example/realms/vetx" },
    { aud: "account" },
    { aud: ["api-client", 42] },
    { azp: "unknown-client" },
    { typ: "ID" },
    { cnf: { jkt: "sender-constrained" } },
    { sid: "" },
    { exp: 1 },
  ]) {
    await assert.rejects(verifier.verify(await issueToken(mismatch)), InvalidAccessTokenError);
  }
  const { privateKey: untrusted } = await generateKeyPair("RS256");
  await assert.rejects(verifier.verify(await issueToken({}, untrusted)), InvalidAccessTokenError);
  assert.equal(requestCount, previousCount);
});

test("checks live session state on every request and preserves the other session", async () => {
  const first = await issueToken({ sid: "session-a" });
  const second = await issueToken({ sid: "session-b" });
  assert.equal((await verifier.verify(first)).subject, "person-one");
  assert.equal((await verifier.verify(second)).subject, "person-one");
  revoked.add("session-a");
  await assert.rejects(verifier.verify(first), InvalidAccessTokenError);
  assert.equal((await verifier.verify(second)).subject, "person-one");
});

test("rejects conflicting introspection metadata and upstream outages with safe errors", async () => {
  const token = await issueToken({ sid: "session-c" });
  try {
    upstream = "mismatch";
    await assert.rejects(verifier.verify(token), InvalidAccessTokenError);
    upstream = "outage";
    await assert.rejects(verifier.verify(token), IdentityProviderUnavailableError);
  } finally {
    upstream = "active";
  }
});

test("only verified owner addresses are supplied to recipient-bound operations", async () => {
  const claims = {
    sid: "verified-recipient",
    azp: "owner-client",
    email: "Keeper@Example.test",
    email_verified: true,
  };
  const verified = await verifier.verify(await issueToken(claims));
  assert.equal(verified.verifiedEmail, "keeper@example.test");
  for (const change of [
    { email_verified: false },
    { email_verified: "true" },
    { azp: "staff-client" },
    { email: "missing-domain" },
  ]) {
    const principal = await verifier.verify(await issueToken({ ...claims, ...change }));
    assert.equal(principal.verifiedEmail, undefined);
  }
});
