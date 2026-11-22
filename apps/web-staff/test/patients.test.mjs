import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePatientChange, registryPath } from "../src/patients/forms.ts";

const id = "17982c8c-00ce-4177-ae55-fed702298158";
function form(fields) {
  const result = new FormData();
  for (const [key, value] of Object.entries(fields)) result.set(key, value);
  return result;
}

test("patient forms preserve the viewed revision, stable ID, and nullable calendar date", () => {
  const fields = form({
    action: "patient",
    patientId: id,
    revision: "0",
    name: "  Nina ",
    species: " Gato ",
    birthDate: "",
  });
  assert.deepEqual(parsePatientChange(fields), {
    action: "patient",
    patientId: id,
    body: { revision: 0, name: "Nina", species: "Gato", birthDate: null },
  });
  fields.set("birthDate", "2024-02-29");
  assert.equal(parsePatientChange(fields).body.birthDate, "2024-02-29");
  for (const wrong of ["2023-02-29", "2040-01-01", "2024-01-01T12:00:00Z", "0000-01-01"]) {
    fields.set("birthDate", wrong);
    assert.equal(parsePatientChange(fields), null);
  }
  fields.set("birthDate", "");
  for (const wrong of ["-1", "1e2", "2147483648"]) {
    fields.set("revision", wrong);
    assert.equal(parsePatientChange(fields), null);
  }
});

test("an invitation requires the form’s exact patient, guardian and retry IDs", () => {
  const fields = form({ action: "invite", patientId: id, guardianId: id, requestId: id });
  assert.deepEqual(parsePatientChange(fields), {
    action: "invite",
    patientId: id,
    guardianId: id,
    requestId: id,
  });
  for (const key of ["patientId", "guardianId", "requestId"]) {
    fields.set(key, "../other");
    assert.equal(parsePatientChange(fields), null);
    fields.set(key, id);
  }
});

test("registry pagination preserves accents and special characters in the search", () => {
  const path = registryPath(
    { organizationId: id, clinicId: id },
    { page: 2, search: "José & Luna" },
  );
  const url = new URL(path, "https://example.test");
  assert.equal(url.pathname, `/organizations/${id}/clinics/${id}/patients`);
  assert.equal(url.searchParams.get("search"), "José & Luna");
  assert.equal(url.searchParams.get("page"), "2");
});
