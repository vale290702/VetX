import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDirectoryChange, readDirectoryPage } from "../src/directory/forms.ts";

const clinicId = "21c72bf5-ffff-47ac-8888-dcf34129ba73";

function form(entries) {
  const result = new FormData();
  for (const [key, value] of entries) result.append(key, value);
  return result;
}

test("clinic writes keep the form's stable ID and exact directory revision", () => {
  const fields = form([
    ["action", "clinic"],
    ["clinicId", clinicId],
    ["revision", "0"],
    ["name", "  San José  "],
  ]);
  assert.deepEqual(parseDirectoryChange(fields), {
    action: "clinic",
    clinicId,
    revision: 0,
    name: "San José",
  });
  fields.set("revision", "1e2");
  assert.equal(parseDirectoryChange(fields), null);
  fields.set("revision", "3");
  fields.set("clinicId", "../another");
  assert.equal(parseDirectoryChange(fields), null);
});

test("member writes select a known role and protect the subject and grants", () => {
  const fields = form([
    ["action", "member"],
    ["subject", "staff-account"],
    ["role", "STAFF"],
    ["clinicIds", clinicId],
    ["revision", "2"],
  ]);
  assert.deepEqual(parseDirectoryChange(fields), {
    action: "member",
    revision: 2,
    subject: "staff-account",
    role: "STAFF",
    clinicIds: [clinicId],
  });
  fields.set("role", "ADMIN");
  assert.deepEqual(parseDirectoryChange(fields)?.clinicIds, []);
  fields.set("role", "NEW");
  assert.equal(parseDirectoryChange(fields), null);
  fields.set("action", "revoke");
  assert.deepEqual(parseDirectoryChange(fields), {
    action: "revoke",
    revision: 2,
    subject: "staff-account",
  });
  fields.set("subject", "  ");
  assert.equal(parseDirectoryChange(fields), null);
});

test("the employee list accepts positive page numbers only", () => {
  assert.equal(readDirectoryPage("2"), 2);
  for (const value of ["0", "5e3", "Infinity", "", undefined, ["2", "3"], "2147483648"]) {
    assert.equal(readDirectoryPage(value), 1);
  }
});
