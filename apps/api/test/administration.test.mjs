import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DirectoryError } from "@vetx/database";
import { createApplication } from "../dist/application.js";

const organization = randomUUID();
const clinic = randomUUID();
const base = `/organizations/${organization}/administration`;
const subject = "recipient-staff";
const directory = { revision: 2, clinics: [], members: [], page: 1, hasNextPage: false };

async function withDirectory(kind, run, storeOverrides = {}) {
  const calls = [];
  const record =
    (operation, result) =>
    async (...args) => {
      calls.push({ operation, args });
      return result;
    };
  const actor = { issuer: "https://id.example/realms/test", subject: "operator", kind };
  const app = await createApplication({ async checkReady() {} }, false, {
    tokenVerifier: {
      async verify() {
        return actor;
      },
    },
    directory: {
      readAdministration: record("read", directory),
      saveClinic: record("clinic", { revision: 3 }),
      saveMember: record("member", { revision: 3 }),
      removeMember: record("remove", { revision: 3 }),
      ...storeOverrides,
    },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    const send = (path, method = "GET", body) =>
      fetch(origin + base + path, {
        method,
        headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    await run({ actor, calls, send });
  } finally {
    await app.close();
  }
}

test("directory operations bind the actor from the token and forward the expected revision", async () => {
  await withDirectory("staff", async ({ actor, calls, send }) => {
    const page = await send("?page=2");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.deepEqual(await page.json(), directory);
    assert.equal(
      (await send(`/clinics/${clinic}`, "PUT", { name: "Clinic", revision: 2 })).status,
      200,
    );
    assert.equal(
      (await send("/members", "PUT", { subject, role: "STAFF", clinicIds: [clinic], revision: 2 }))
        .status,
      200,
    );
    assert.equal((await send("/members/revoke", "POST", { subject, revision: 2 })).status, 200);
    assert.deepEqual(calls, [
      { operation: "read", args: [actor, organization, 2] },
      { operation: "clinic", args: [actor, organization, clinic, "Clinic", 2] },
      { operation: "member", args: [actor, organization, subject, "STAFF", [clinic], 2] },
      { operation: "remove", args: [actor, organization, subject, 2] },
    ]);
  });
});

test("owner tokens cannot read or mutate any staff directory", async () => {
  await withDirectory("owner", async ({ calls, send }) => {
    assert.equal((await send("")).status, 403);
    assert.equal(
      (await send(`/clinics/${clinic}`, "PUT", { name: "Clinic", revision: 0 })).status,
      403,
    );
    assert.deepEqual(calls, []);
  });
});

test("invalid names, IDs, pagination and membership grants are rejected before storage", async () => {
  await withDirectory("staff", async ({ calls, send }) => {
    for (const page of ["0", "1.5", "2147483648"])
      assert.equal((await send(`?page=${page}`)).status, 400);
    for (const name of [" ", "x".repeat(121), "invalid\nname"]) {
      assert.equal((await send(`/clinics/${clinic}`, "PUT", { name, revision: 0 })).status, 400);
    }
    const good = { subject, role: "STAFF", clinicIds: [clinic], revision: 2 };
    for (const invalid of [
      { revision: -1 },
      { revision: "2" },
      { role: "ADMIN" },
      { role: "partner" },
      { clinicIds: [clinic, clinic] },
      { clinicIds: ["abc"] },
      { actor: subject },
      { subject: "" },
    ]) {
      assert.equal((await send("/members", "PUT", { ...good, ...invalid })).status, 400);
    }
    assert.deepEqual(calls, []);
  });
});

test("directory policy failures produce stable public error codes", async () => {
  const cases = [
    ["forbidden", 403, "FORBIDDEN"],
    ["invalid", 400, "BAD_REQUEST"],
    ["conflict", 409, "CONFLICT"],
    ["last_admin", 409, "LAST_ORGANIZATION_ADMIN"],
  ];
  for (const [domainCode, status, httpCode] of cases) {
    await withDirectory(
      "staff",
      async ({ send }) => {
        const response = await send("/members/revoke", "POST", { subject, revision: 0 });
        assert.equal(response.status, status);
        const payload = await response.json();
        assert.equal(payload.error.code, httpCode);
        assert.equal(payload.error.requestId, response.headers.get("x-request-id"));
      },
      {
        async removeMember() {
          throw new DirectoryError(domainCode);
        },
      },
    );
  }
});
