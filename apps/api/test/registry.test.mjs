import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApplication } from "../dist/application.js";

const org = randomUUID(),
  clinic = randomUUID(),
  patient = randomUUID(),
  guardian = randomUUID();
const base = `/organizations/${org}/clinics/${clinic}/patients`;
const passport = { issuer: "https://login.example/realms/clinic", subject: "user", kind: "staff" };
const petLinks = {
  keyHex: "8a".repeat(32),
  lifetimeSeconds: 1800,
  attemptLimit: 6,
  windowSeconds: 600,
};
async function withRegistry(principal, registry, run) {
  const app = await createApplication({ async checkReady() {} }, false, {
    tokenVerifier: { verify: async () => principal },
    registry,
    petLinks,
  });
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const send = (path, method = "GET", body) =>
      fetch(url + path, {
        method,
        headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    await run(send);
  } finally {
    await app.close();
  }
}

test("clinical requests deny the wrong application type, and owner redemption requires verified email", async () => {
  const code = "0123456789ABCDEF".repeat(2);
  await withRegistry(passport, {}, async (send) =>
    assert.equal((await send("/owner/pets")).status, 403),
  );
  await withRegistry({ ...passport, kind: "owner" }, {}, async (send) => {
    assert.equal((await send(base)).status, 403);
    const reply = await send("/owner/pet-links/redeem", "POST", { code, requestId: randomUUID() });
    assert.equal(reply.status, 403);
    assert.equal((await reply.json()).error.code, "EMAIL_VERIFICATION_REQUIRED");
  });
});

test("issuance is reproducible for a retry and passes only code digests to storage", async () => {
  const digests = [];
  const data = {
    issuePetLink: async (actor, orgId, clinicId, patientId, guardianId, options) => {
      assert.deepEqual(
        [actor, orgId, clinicId, patientId, guardianId],
        [passport, org, clinic, patient, guardian],
      );
      assert.equal(options.lifetimeSeconds, 1800);
      digests.push(options.digest);
      return { expiresAt: "2027-01-01T00:00:00.000Z" };
    },
  };
  await withRegistry(passport, data, async (send) => {
    const route = `${base}/${patient}/guardians/${guardian}/invitations`;
    const id = randomUUID();
    async function issue(requestId) {
      const res = await send(route, "POST", { requestId });
      assert.equal(res.status, 201);
      assert.equal(res.headers.get("cache-control"), "no-store");
      return (await res.json()).code;
    }
    const code = await issue(id);
    assert.match(code, /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
    assert.equal(await issue(id), code);
    assert.notEqual(await issue(randomUUID()), code);
    assert.equal(digests[0], digests[1]);
    assert.notEqual(digests[0], digests[2]);
    assert.match(digests[0], /^[a-f0-9]{64}$/);
  });
  const owner = { ...passport, kind: "owner", verifiedEmail: "a@example.test" };
  await withRegistry(
    owner,
    {
      redeemPetLink: async (actor, options) => {
        assert.equal(actor.verifiedEmail, owner.verifiedEmail);
        assert.match(options.digest, /^[a-f0-9]{64}$/);
        assert.equal(options.attemptLimit, 6);
        assert.equal(options.windowSeconds, 600);
        return { petId: patient };
      },
    },
    async (send) => {
      const res = await send("/owner/pet-links/redeem", "POST", {
        code: "0123-abcd ".repeat(4).trim(),
        requestId: randomUUID(),
      });
      assert.equal(res.status, 200);
    },
  );
});

test("invalid clinical dates and untrusted recipient fields are rejected before storage", async () => {
  await withRegistry(passport, {}, async (send) => {
    assert.equal(
      (await send(`${base}/${patient}`, "PUT", { name: "Pet", species: "Dog", revision: 1 }))
        .status,
      400,
    );
    for (const birthDate of ["2026-02-30", "2099-01-01", "yesterday"])
      assert.equal(
        (
          await send(`${base}/${patient}`, "PUT", {
            name: "Pet",
            species: "Dog",
            birthDate,
            revision: 0,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await send(`${base}/${patient}/guardians/${guardian}`, "PUT", {
          name: "Recipient",
          email: "local",
          verifiedEmail: true,
        })
      ).status,
      400,
    );
  });
});
