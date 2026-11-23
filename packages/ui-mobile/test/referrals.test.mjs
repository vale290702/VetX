import assert from "node:assert/strict";
import { test } from "node:test";
import { createReferrals, updateReferral } from "../src/referral-client.ts";
import { createPatientTransport, PatientError } from "../src/patient-transport.ts";
import {
  decisionInput,
  responseInput,
  requestInput,
  recipientMatches,
  referralMatches,
} from "../src/referral-forms.ts";

const destination = { organizationId: "org2", clinicId: "dest", name: "Clínica Norte" };
const linked = { id: "g1", linked: true },
  unlinked = { id: "g2", linked: false };
const src = { organizationId: "org", clinicId: "src", subject: "staff" };
const requested = {
  id: "r1",
  reason: "Dental pain",
  source: { clinicName: "Centro", organizationName: "VetX" },
  destination: { clinicName: "Clínica Norte", organizationName: "Socios" },
  patient: { name: "Gata", species: "Cat" },
  status: "REQUESTED",
  revision: 3,
};
test("request requires a current permitted clinic and linked guardian, with optional summary", () => {
  const choices = [destination],
    guardians = [linked, unlinked];
  assert.deepEqual(requestInput(choices, guardians, destination, "g1", " Dental pain ", " "), {
    destination: { organizationId: "org2", clinicId: "dest" },
    guardianId: "g1",
    reason: "Dental pain",
    summary: "",
  });
  assert.equal(requestInput([], guardians, destination, "g1", "Check", ""), undefined);
  assert.equal(
    requestInput(
      choices,
      guardians,
      { ...destination, organizationId: "wrong" },
      "g1",
      "Check",
      "",
    ),
    undefined,
  );
  assert.equal(requestInput(choices, guardians, destination, "g2", "Check", ""), undefined);
  assert.equal(requestInput(choices, guardians, destination, "g1", "  ", ""), undefined);
  assert.equal(requestInput(choices, guardians, destination, "g1", "Hello\nthere", ""), undefined);
  assert.equal(
    requestInput(choices, guardians, destination, "g1", "Check", "x".repeat(8001)),
    undefined,
  );
});
test("owner choices and counter-referrals bind to the current status and revision", () => {
  assert.deepEqual(decisionInput(requested, "approve"), { action: "approve", revision: 3 });
  assert.deepEqual(decisionInput(requested, "decline"), { action: "decline", revision: 3 });
  assert.equal(decisionInput(requested, "withdraw"), undefined);
  for (const status of ["APPROVED", "RESPONDED"]) {
    assert.deepEqual(decisionInput({ ...requested, status }, "withdraw"), {
      action: "withdraw",
      revision: 3,
    });
    assert.equal(decisionInput({ ...requested, status }, "approve"), undefined);
  }
  for (const status of ["WITHDRAWN", "DECLINED"])
    for (const a of ["approve", "withdraw", "decline"])
      assert.equal(decisionInput({ ...requested, status }, a), undefined);
  assert.equal(responseInput(requested, "Notes"), undefined);
  assert.equal(responseInput({ ...requested, status: "RESPONDED" }, "Notes"), undefined);
  assert.equal(responseInput({ ...requested, status: "APPROVED" }, "  "), undefined);
  assert.deepEqual(responseInput({ ...requested, status: "APPROVED" }, " Notes "), {
    revision: 3,
    summary: "Notes",
  });
});
test("clinic and current-page search fold accents and match patient, reason and clinic names", () => {
  assert.ok(recipientMatches(destination, "clinica"));
  for (const q of ["gata", "dental", "socios", "CENTRO", "clinica norte"])
    assert.ok(referralMatches(requested, q));
  assert.equal(referralMatches(requested, "Puppy"), false);
});
test("six referral endpoints enforce account scope and send stable request IDs and revisioned JSON", async () => {
  const requests = [],
    signal = new AbortController().signal;
  const session = {
    forAccount: (subject, work) => {
      assert.equal(subject, "owner");
      return work("owner-token", signal);
    },
    forOrganization: (subject, org, work) => {
      assert.equal(subject, "staff");
      assert.equal(org, "org");
      return work("staff-token", signal);
    },
  };
  const trans = createPatientTransport(session, "https://vet.test", async (url, init) => {
    assert.equal(init.signal, signal);
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    requests.push(new Request(url, init));
    return Response.json(requested);
  });
  const client = createReferrals(trans),
    body = requestInput([destination], [linked], destination, "g1", "Dental pain", "");
  await client.destinations(src);
  await client.request(src, "p", "request-id", body);
  await client.request(src, "p", "request-id", body);
  await client.staffList(src, "outgoing", 2, "p");
  await client.staffList(src, "incoming", 1);
  await client.respond(src, "r1", { summary: "Results", revision: 3 });
  await client.ownerList("owner", "pet", 3);
  await client.decide("owner", "pet", "r1", { action: "approve", revision: 3 });
  const prefix = "/organizations/org/clinics/src";
  assert.deepEqual(
    requests.map((r) => [r.method, new URL(r.url).pathname, r.headers.get("Authorization")]),
    [
      ["GET", prefix + "/referrals/destinations", "Bearer staff-token"],
      ["PUT", prefix + "/patients/p/referrals/request-id", "Bearer staff-token"],
      ["PUT", prefix + "/patients/p/referrals/request-id", "Bearer staff-token"],
      ["GET", prefix + "/referrals", "Bearer staff-token"],
      ["GET", prefix + "/referrals", "Bearer staff-token"],
      ["PUT", prefix + "/referrals/r1/response", "Bearer staff-token"],
      ["GET", "/owner/pets/pet/referrals", "Bearer owner-token"],
      ["PUT", "/owner/pets/pet/referrals/r1/decision", "Bearer owner-token"],
    ],
  );
  assert.deepEqual(Object.fromEntries(new URL(requests[3].url).searchParams), {
    direction: "outgoing",
    page: "2",
    patientId: "p",
  });
  assert.equal(new URL(requests[4].url).searchParams.has("patientId"), false);
  assert.equal(new URL(requests[6].url).searchParams.get("page"), "3");
  assert.deepEqual(await requests[1].json(), body);
  assert.deepEqual(await requests[2].json(), body);
  assert.deepEqual(await requests[5].json(), { summary: "Results", revision: 3 });
  assert.deepEqual(await requests[7].json(), { action: "approve", revision: 3 });
});

test("changed or inaccessible referrals trigger a fresh read while offline failures remain retryable", async () => {
  for (const status of [403, 404, 409])
    assert.equal(
      await updateReferral(async () => {
        throw new PatientError(status);
      }),
      "changed",
    );
  assert.equal(await updateReferral(async () => ({})), "saved");
  await assert.rejects(
    updateReferral(async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  const session = {
    forOrganization: (_subject, _org, work) => work("token", new AbortController().signal),
  };
  const transport = createPatientTransport(session, "https://vet.test", async () =>
    Response.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503 }),
  );
  await assert.rejects(
    createReferrals(transport).destinations(src),
    (e) => e.code === "REFERRALS_UNAVAILABLE",
  );
});
