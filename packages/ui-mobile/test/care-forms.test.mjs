import assert from "node:assert/strict";
import { test } from "node:test";
import { encounterBody, sharingChange, appointmentBody } from "../src/care-forms.ts";

test("a new encounter and its addendum require clinical content and carry only their own author-independent data", () => {
  const fields = { subjective: "", objective: "  ", assessment: "", plan: "" };
  const at = "2026-01-02T14:00:00.000Z";
  assert.equal(encounterBody(at, "reason", fields), undefined);
  assert.equal(encounterBody(undefined, "reason", { ...fields, plan: "A" }), undefined);
  assert.deepEqual(encounterBody(at, " reason ", { ...fields, plan: " recheck " }, "original"), {
    occurredAt: at,
    reason: "reason",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "recheck",
    addendumTo: "original",
  });
});
test("only explicitly selected currently linked guardians can receive a note and clearing all ends access", () => {
  const original = { revision: 4, guardianIds: ["a"] };
  const guardians = [
    { id: "a", linked: true },
    { id: "b", linked: true },
    { id: "unlinked", linked: false },
  ];
  assert.equal(sharingChange(original, guardians, ["a", "unlinked"]), undefined);
  assert.deepEqual(sharingChange(original, guardians, ["b", "unknown", "unlinked"]), {
    revision: 4,
    guardianIds: ["b"],
  });
  assert.deepEqual(sharingChange(original, guardians, []), { revision: 4, guardianIds: [] });
});
test("sharing keeps existing recipients missing from a stale linked guardian list", () => {
  const original = { revision: 6, guardianIds: ["a", "newlyLinked", "absent"] };
  const cached = [
    { id: "a", linked: true },
    { id: "b", linked: true },
    { id: "newlyLinked", linked: false },
  ];
  assert.equal(sharingChange(original, cached, original.guardianIds), undefined);
  const result = sharingChange(original, cached, ["b"]);
  assert.equal(result.revision, 6);
  assert.deepEqual(result.guardianIds.sort(), ["absent", "b", "newlyLinked"]);
});
test("terminal appointment changes retain times, patient and last-read revision; rescheduling checks the new interval", () => {
  const visit = {
    id: "v",
    patientId: "p",
    patientName: "Luna",
    reason: "Exam",
    startAt: "2026-01-02T14:00:00.000Z",
    endAt: "2026-01-02T14:45:00.000Z",
    status: "BOOKED",
    revision: 4,
  };
  const { id, patientName, ...fields } = visit;
  for (const status of ["CANCELLED", "COMPLETED"])
    assert.deepEqual(appointmentBody({ kind: "finish", visit, status }, undefined, undefined, ""), {
      ...fields,
      status,
    });
  const editor = { kind: "book", id, patient: { id: "p", name: patientName }, original: visit };
  assert.equal(appointmentBody(editor, visit.endAt, visit.startAt, "Exam"), undefined);
  assert.deepEqual(appointmentBody(editor, visit.startAt, visit.endAt, " Follow up "), {
    ...fields,
    reason: "Follow up",
  });
});
