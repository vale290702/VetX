import assert from "node:assert/strict";
import { test } from "node:test";
import { createDirectory, DirectoryError } from "../src/directory.ts";

const scope = { subject: "vet", organizationId: "org" };
const snapshot = { clinics: [], members: [], page: 1, hasNextPage: false, revision: 3 };

function fixture(responses) {
  const calls = [];
  const signal = new AbortController().signal;
  const client = createDirectory(
    {
      async forOrganization(subject, organizationId, request) {
        assert.equal(subject, scope.subject);
        assert.equal(organizationId, scope.organizationId);
        return request("secret", signal);
      },
    },
    "https://api.test",
    async (url, options) => {
      assert.equal(options.signal, signal);
      assert.equal(options.headers.get("Authorization"), "Bearer secret");
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "omit");
      calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
      const [status, payload] = responses.shift();
      return Response.json(payload, { status });
    },
  );
  return { client, calls };
}

test("an administrator reads the requested directory page", async () => {
  const { client, calls } = fixture([[200, { ...snapshot, page: 2 }]]);
  assert.deepEqual(await client.load(scope, 2), {
    kind: "admin",
    directory: { ...snapshot, page: 2 },
  });
  assert.equal(calls[0].url, "https://api.test/organizations/org/administration?page=2");
});

test("a regular member falls back to granted clinics only on administration denial", async () => {
  const clinics = [{ id: "clinic", name: "Central" }];
  const { client, calls } = fixture([
    [403, {}],
    [200, { clinics }],
  ]);
  assert.deepEqual(await client.load(scope, 1), { kind: "staff", clinics });
  assert.equal(calls[1].url, "https://api.test/organizations/org/clinics");
  const outage = fixture([[503, {}]]);
  await assert.rejects(outage.client.load(scope, 1), DirectoryError);
  assert.equal(outage.calls.length, 1);
});

test("every write carries the original revision and reports conflicts without replay", async () => {
  const { client, calls } = fixture([
    [200, { revision: 4 }],
    [200, { revision: 5 }],
    [409, { error: { code: "LAST_ORGANIZATION_ADMIN" } }],
  ]);
  await client.saveClinic(scope, "clinic-id", "Central", 3);
  await client.saveMember(
    scope,
    { subject: "new-vet", role: "STAFF", clinicIds: ["clinic-id"] },
    4,
  );
  await assert.rejects(
    client.revokeMember(scope, "new-vet", 5),
    (error) => error.status === 409 && error.code === "LAST_ORGANIZATION_ADMIN",
  );
  assert.deepEqual(
    calls.map(({ method, body }) => [method, body]),
    [
      ["PUT", { name: "Central", revision: 3 }],
      ["PUT", { subject: "new-vet", role: "STAFF", clinicIds: ["clinic-id"], revision: 4 }],
      ["POST", { subject: "new-vet", revision: 5 }],
    ],
  );
});
