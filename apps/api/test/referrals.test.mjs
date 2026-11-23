import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ReferralError } from "@vetx/database";
import { createApplication } from "../dist/application.js";

const org = randomUUID(),
  clinic = randomUUID(),
  patient = randomUUID(),
  id = randomUUID(),
  pet = randomUUID();
const source = { organizationId: org, clinicId: clinic },
  destination = { organizationId: randomUUID(), clinicId: randomUUID() };
const base = `/organizations/${org}/clinics/${clinic}`,
  create = `${base}/patients/${patient}/referrals/${id}`;
const ownerPath = `/owner/pets/${pet}/referrals`,
  inbox = base + "/referrals?direction=incoming";
const request = {
  guardianId: randomUUID(),
  destination,
  reason: "Referral",
  summary: "History\nfindings",
};
const directory = {
  destinations: () => [{ ...destination, name: "Specialist", private: "must never leave server" }],
  allows: (from, to) => from.clinicId === clinic && to.clinicId === destination.clinicId,
};

async function withApi(kind, referrals, referralDirectory, run) {
  const actor = { kind, issuer: "https://id.example", subject: "account" };
  const app = await createApplication({ async checkReady() {} }, false, {
    referrals,
    referralDirectory,
    tokenVerifier: { verify: async () => actor },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const send = (path, body, auth = true) =>
      fetch(url + path, {
        method: body === undefined ? "GET" : "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: "Bearer a.b.c" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    await run(send, actor);
  } finally {
    await app.close();
  }
}

test("referral routes authenticate both audiences and strictly validate scoped inputs", async () => {
  await withApi("staff", {}, directory, async (send) => {
    assert.equal((await send(base + "/referrals/destinations", undefined, false)).status, 401);
    assert.equal((await send(ownerPath)).status, 403);
    for (const bad of [
      { ...request, destination: null },
      { ...request, destination: { ...destination, secret: "unknown" } },
      { ...request, actor: "forged" },
      { ...request, guardianId: "invalid" },
      { ...request, reason: "\n" },
      { ...request, summary: "bad\u0000data" },
      { ...request, summary: "x".repeat(8001) },
    ]) {
      assert.equal((await send(create, bad)).status, 400);
    }
    assert.equal((await send(base + "/referrals?direction=elsewhere")).status, 400);
    assert.equal((await send(inbox + "&page=-2")).status, 400);
    assert.equal(
      (await send(base + "/referrals/" + id + "/response", { revision: 2, summary: "   " })).status,
      400,
    );
  });
  await withApi("owner", {}, directory, async (send) => {
    assert.equal((await send(inbox)).status, 403);
    assert.equal((await send(create, request)).status, 403);
    for (const bad of [
      { action: "approve", revision: 0 },
      { action: "accept", revision: 1 },
      { action: "decline", revision: 1, petId: randomUUID() },
    ]) {
      assert.equal((await send(ownerPath + "/" + id + "/decision", bad)).status, 400);
    }
  });
});

test("destination options verify the current clinic and expose public labels; route changes block disclosure", async () => {
  let authorized = true;
  const store = {
    referralClinicContext: async (actor, o, c, incoming) => {
      assert.deepEqual([actor.kind, o, c, incoming], ["staff", org, clinic, false]);
      if (!authorized) throw new ReferralError("forbidden");
      return { sources: [] };
    },
    requestReferral: async (actor, o, c, p, i, details) => {
      assert.deepEqual([actor.kind, o, c, p, i], ["staff", org, clinic, patient, id]);
      assert.equal(details.reason, "Referral");
      assert.equal(details.summary, request.summary);
      return { id };
    },
  };
  await withApi("staff", store, directory, async (send) => {
    const options = await send(base + "/referrals/destinations");
    assert.equal(options.status, 200);
    assert.equal(options.headers.get("cache-control"), "no-store");
    assert.deepEqual(await options.json(), {
      destinations: [{ ...destination, name: "Specialist" }],
    });
    assert.deepEqual(await (await send(create, { ...request, reason: " Referral " })).json(), {
      id,
    });
    assert.equal((await send(create, { ...request, destination: source })).status, 403);
    authorized = false;
    assert.equal((await send(base + "/referrals/destinations")).status, 403);
  });
});

test("absent route configuration fails closed while owners can still withdraw consent", async () => {
  await withApi(
    "staff",
    { referralClinicContext: async () => ({ sources: [] }) },
    undefined,
    async (send) => {
      for (const [path, body] of [[base + "/referrals/destinations"], [inbox], [create, request]]) {
        assert.equal((await send(path, body)).status, 503);
      }
    },
  );
  const store = {
    referralRoute: async () => ({ source, destination }),
    decideReferral: async (actor, p, r, input) => {
      assert.deepEqual([actor.kind, p, r, input.action], ["owner", pet, id, "withdraw"]);
      return { revision: 3, status: "WITHDRAWN" };
    },
  };
  await withApi("owner", store, undefined, async (send) => {
    assert.equal(
      (await send(ownerPath + "/" + id + "/decision", { action: "approve", revision: 1 })).status,
      503,
    );
    assert.deepEqual(
      await (
        await send(ownerPath + "/" + id + "/decision", { action: "withdraw", revision: 2 })
      ).json(),
      { revision: 3, status: "WITHDRAWN" },
    );
  });
});

test("database failures return the shared redacted error envelope", async () => {
  for (const [code, status] of [
    ["invalid", 400],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
  ]) {
    await withApi(
      "owner",
      {
        decideReferral: async () => {
          throw new ReferralError(code);
        },
      },
      directory,
      async (send) => {
        const result = await send(ownerPath + "/" + id + "/decision", {
          action: "decline",
          revision: 1,
        });
        assert.equal(result.status, status);
        assert.equal(result.headers.get("cache-control"), "no-store");
        const { error } = await result.json();
        assert.equal(error.requestId, result.headers.get("x-request-id"));
        assert.ok(!error.message.includes(request.summary));
      },
    );
  }
});
