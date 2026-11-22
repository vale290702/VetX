import assert from "node:assert/strict";
import { test } from "node:test";
import { createPatients, patientFailure, validBirthDate } from "../src/patients.ts";

const scope = { subject: "employee", organizationId: "org", clinicId: "clinic" };
const input = { name: "Luna", species: "Cat", birthDate: null, revision: 0 };

function fixture(replies) {
  const calls = [];
  const signal = new AbortController().signal;
  const client = createPatients(
    {
      forAccount(subject, work) {
        assert.equal(subject, "owner");
        return work("owner-token", signal);
      },
      forOrganization(subject, org, work) {
        assert.equal(subject, scope.subject);
        assert.equal(org, scope.organizationId);
        return work("employee-token", signal);
      },
    },
    "https://api.test",
    async (url, init) => {
      assert.equal(init.signal, signal);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      calls.push([
        init.method,
        url.replace("https://api.test", ""),
        init.body && JSON.parse(init.body),
        init.headers.get("Authorization"),
      ]);
      const [status, data] = replies.shift();
      return status === 204 ? new Response(null, { status }) : Response.json(data, { status });
    },
  );
  return { client, calls };
}

test("staff search, patient writes, guardian access and invitation retries stay scoped to the clinic", async () => {
  const { client, calls } = fixture([
    [200, { patients: [], page: 1, hasNextPage: false }],
    [200, input],
    [200, {}],
    [200, {}],
    [201, { code: "secret", expiresAt: "expiry" }],
    [204],
  ]);
  const base = "/organizations/org/clinics/clinic/patients";
  await client.list(scope, 1, "Luna");
  await client.save(scope, "record", input);
  await client.detail(scope, "record");
  const guardian = { name: "A", email: "a@example.org" };
  await client.saveGuardian(scope, "record", "guardian", guardian);
  await client.issue(scope, "record", "guardian", "same-request");
  await client.removeGuardian(scope, "record", "guardian");
  assert.deepEqual(
    calls.map((c) => c.slice(0, 3)),
    [
      ["GET", base + "?page=1&search=Luna", undefined],
      ["PUT", base + "/record", input],
      ["GET", base + "/record", undefined],
      ["PUT", base + "/record/guardians/guardian", guardian],
      ["POST", base + "/record/guardians/guardian/invitations", { requestId: "same-request" }],
      ["DELETE", base + "/record/guardians/guardian", undefined],
    ],
  );
  assert.ok(calls.every((c) => c[3] === "Bearer employee-token"));
});

test("owner listing and redemption never accept the identity as request data or put a code in the URL", async () => {
  const { client, calls } = fixture([
    [200, { pets: [] }],
    [200, { petId: "mine" }],
    [403, { error: { code: "EMAIL_VERIFICATION_REQUIRED" } }],
    [404, { error: { code: "NOT_FOUND" } }],
  ]);
  await client.pets("owner");
  const input = { code: "SECRET", requestId: "same-request", existingPetId: "mine" };
  await client.redeem("owner", input);
  assert.deepEqual(calls, [
    ["GET", "/owner/pets", undefined, "Bearer owner-token"],
    ["POST", "/owner/pet-links/redeem", input, "Bearer owner-token"],
  ]);
  await assert.rejects(
    client.redeem("owner", input),
    (e) => patientFailure(e, "redeem") === "verifyEmail",
  );
  await assert.rejects(
    client.redeem("owner", input),
    (e) => patientFailure(e, "redeem") === "unavailableCode",
  );
});

test("optional birth date accepts real ISO calendar dates through today", () => {
  assert.ok(validBirthDate("", "2024-03-01"));
  assert.ok(validBirthDate("2024-02-29", "2024-03-01"));
  assert.ok(validBirthDate("2024-03-01", "2024-03-01"));
  for (const value of ["0000-01-01", "2023-02-29", "2024-03-02", "2024-2-1", "hello"])
    assert.equal(validBirthDate(value, "2024-03-01"), false);
});

test("redemption rate limiting tells owners to wait before retrying", async () => {
  const { client } = fixture([[429, { error: { code: "TOO_MANY_REQUESTS" } }]]);
  await assert.rejects(
    client.redeem("owner", { code: "abcd".repeat(8), requestId: "request" }),
    (error) => patientFailure(error, "redeem") === "tooManyAttempts",
  );
});
