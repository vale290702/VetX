import assert from "node:assert/strict";
import { test } from "node:test";
import { createPatients, patientFailure } from "../src/patients.ts";

const scope = { subject: "employee", organizationId: "a", clinicId: "north" };
const clinic = "/organizations/a/clinics/north";
const note = {
  occurredAt: "2026-10-01T12:00:00.000Z",
  reason: "Checkup",
  subjective: "Eating well",
  objective: "",
  assessment: "",
  plan: "",
  addendumTo: null,
};
const appointment = {
  patientId: "pet",
  startAt: note.occurredAt,
  endAt: "2026-10-01T12:30:00.000Z",
  reason: "Checkup",
  status: "BOOKED",
  revision: 0,
};

function fixture(status = 200, code) {
  const calls = [];
  const signal = new AbortController().signal;
  const { care } = createPatients(
    {
      forOrganization(subject, org, work) {
        assert.equal(subject, scope.subject);
        assert.equal(org, scope.organizationId);
        return work("staff", signal);
      },
      forAccount(subject, work) {
        assert.equal(subject, "owner");
        return work("owner", signal);
      },
    },
    "https://api.test",
    async (url, init) => {
      assert.equal(init.signal, signal);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      calls.push([
        init.headers.get("Authorization"),
        init.method,
        url.replace("https://api.test", ""),
        init.body && JSON.parse(init.body),
      ]);
      return Response.json(code ? { error: { code } } : {}, { status });
    },
  );
  return { care, calls };
}

test("staff notes, selected releases and addenda stay on the same patient and stable encounter IDs", async () => {
  const { care, calls } = fixture();
  const base = clinic + "/patients/pet/encounters";
  await care.encounters(scope, "pet", 2);
  await care.append(scope, "pet", "one", note);
  await care.append(scope, "pet", "two", { ...note, addendumTo: "one" });
  await care.share(scope, "pet", "one", { guardianIds: ["guardian"], revision: 0 });
  await care.share(scope, "pet", "one", { guardianIds: [], revision: 1 });
  assert.deepEqual(calls, [
    ["Bearer staff", "GET", base + "?page=2", undefined],
    ["Bearer staff", "PUT", base + "/one", note],
    ["Bearer staff", "PUT", base + "/two", { ...note, addendumTo: "one" }],
    ["Bearer staff", "PUT", base + "/one/sharing", { guardianIds: ["guardian"], revision: 0 }],
    ["Bearer staff", "PUT", base + "/one/sharing", { guardianIds: [], revision: 1 }],
  ]);
});

test("owner reads page through the signed-in owner's selected pet", async () => {
  const { care, calls } = fixture();
  await care.released("owner", "one", 2);
  assert.deepEqual(calls, [
    ["Bearer owner", "GET", "/owner/pets/one/encounters?page=2", undefined],
  ]);
});

test("clinic calendar scoping, revisions and overlap failures survive native transport", async () => {
  const { care, calls } = fixture();
  const range = { from: appointment.startAt, to: appointment.endAt };
  await care.appointments(scope, range, 2, "pet");
  await care.book(scope, "visit", appointment);
  await care.book(scope, "visit", { ...appointment, status: "CANCELLED", revision: 1 });
  const [token, method, path] = calls[0];
  const url = new URL(path, "https://api.test");
  assert.deepEqual(
    [token, method, url.pathname],
    ["Bearer staff", "GET", clinic + "/appointments"],
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), { ...range, page: "2", patientId: "pet" });
  assert.deepEqual(calls.slice(1), [
    ["Bearer staff", "PUT", clinic + "/appointments/visit", appointment],
    [
      "Bearer staff",
      "PUT",
      clinic + "/appointments/visit",
      { ...appointment, status: "CANCELLED", revision: 1 },
    ],
  ]);
  await assert.rejects(
    fixture(409, "APPOINTMENT_OVERLAP").care.book(scope, "visit", appointment),
    (err) => patientFailure(err, "write") === "overlap",
  );
});
