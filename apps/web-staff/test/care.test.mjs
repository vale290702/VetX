import assert from "node:assert/strict";
import { test } from "node:test";
import { agendaDay, localInstant, localInput, operatorZone } from "../src/care/time.ts";
import { parseCareChange, sharingOptions } from "../src/care/forms.ts";

const id = "17982c8c-00ce-4177-ae55-fed702298158";
function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test("calendar days follow the operator zone across daylight saving changes", () => {
  const zone = "America/New_York";
  assert.deepEqual(agendaDay("2026-03-08", zone), {
    day: "2026-03-08",
    from: "2026-03-08T05:00:00Z",
    to: "2026-03-09T04:00:00Z",
    previous: "2026-03-07",
    next: "2026-03-09",
  });
  assert.equal(localInstant("2026-03-08T02:30", zone), null);
  assert.equal(localInstant("2026-11-01T01:30", zone), null);
  assert.equal(localInput("2026-03-08T08:30:00Z", zone), "2026-03-08T04:30");
  assert.equal(operatorZone("../bad"), "America/Costa_Rica");
});

test("encounter forms require a SOAP section and preserve the parent encounter", () => {
  const fields = form({
    action: "encounter",
    patientId: id,
    encounterId: id,
    occurredAt: "2026-01-15T09:00",
    timeZone: "America/Costa_Rica",
    reason: " Checkup ",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    addendumTo: id,
  });
  assert.equal(parseCareChange(fields), null);
  fields.set("plan", " Continue care. ");
  const note = parseCareChange(fields);
  assert.equal(note.body.plan, "Continue care.");
  assert.equal(note.body.occurredAt, "2026-01-15T15:00:00Z");
  assert.equal(note.body.addendumTo, id);
});

test("empty guardian selection revokes access and invalid recipients fail closed", () => {
  const fields = form({ action: "sharing", patientId: id, encounterId: id, revision: "3" });
  assert.deepEqual(parseCareChange(fields).body, { guardianIds: [], revision: 3 });
  fields.set("guardianIds", "../bad");
  assert.equal(parseCareChange(fields), null);
});

test("scheduling validates dates and preserves viewed appointment revisions", () => {
  const fields = form({
    action: "book",
    appointmentId: id,
    patientId: id,
    revision: "0",
    startAt: "2026-01-15T10:00",
    endAt: "2026-01-15T09:30",
    timeZone: "America/Costa_Rica",
    reason: " Follow-up ",
  });
  assert.equal(parseCareChange(fields), null);
  fields.set("endAt", "2026-01-15T10:30");
  assert.deepEqual(parseCareChange(fields).body, {
    patientId: id,
    startAt: "2026-01-15T16:00:00Z",
    endAt: "2026-01-15T16:30:00Z",
    status: "BOOKED",
    reason: "Follow-up",
    revision: 0,
  });
});

test("unchanged appointment inputs keep the stored instant across both DST folds and with subseconds", () => {
  for (const startAt of ["2026-11-01T05:30:28.123Z", "2026-11-01T06:30:28.123Z"]) {
    const original = {
      id,
      patientId: id,
      revision: 2,
      startAt,
      endAt: "2026-11-01T07:45:00.000Z",
      reason: "Old reason",
    };
    const fields = form({
      action: "book",
      appointmentId: id,
      patientId: id,
      revision: "2",
      timeZone: "America/New_York",
      startAt: "2026-11-01T01:30:28.123",
      endAt: "2026-11-01T02:45",
      reason: "Updated reason",
    });
    assert.equal(parseCareChange(fields, original)?.body.startAt, startAt);
    assert.equal(parseCareChange(fields, original)?.body.endAt, original.endAt);
    assert.equal(parseCareChange(fields), null);
    assert.equal(
      parseCareChange(fields, { ...original, patientId: "12345678-1234-1234-1234-123456789012" }),
      null,
    );
    assert.equal(parseCareChange(fields, { ...original, revision: 3 }), null);
    fields.set("action", "cancel");
    fields.set("startAt", "2030-01-01T08:00");
    assert.equal(parseCareChange(fields, original)?.body.startAt, startAt);
    assert.equal(parseCareChange(fields, original)?.body.reason, "Old reason");
  }
});

test("sharing edits only offer a complete view of linked recipients", () => {
  const options = [
    { id: "ana", linked: true },
    { id: "bob", linked: false },
  ];
  assert.deepEqual(sharingOptions(options, ["ana"]), [options[0]]);
  assert.equal(sharingOptions(options, ["ana", "new-guardian"]), null);
  assert.equal(sharingOptions(options, ["bob"]), null);
  assert.equal(sharingOptions([], ["ana"]), null);
  assert.deepEqual(sharingOptions([], []), []);
});

test("the appointment used for a retry is the signed snapshot originally shown in that clinic and session", async () => {
  const { signAppointment, verifyAppointment } =
    await import("../src/care/appointment-snapshot.ts");
  const scope = { organizationId: id, clinicId: id },
    key = "a server-only credential",
    csrf = "session";
  const row = {
    id,
    patientId: id,
    revision: 3,
    startAt: "2026-07-20T14:00:00.000Z",
    endAt: "2026-07-20T14:30:00.000Z",
    reason: "Follow up",
  };
  const snapshot = signAppointment(row, scope, csrf, key);
  assert.deepEqual(verifyAppointment(snapshot, scope, csrf, key), row);
  assert.equal(
    verifyAppointment(snapshot, { ...scope, clinicId: "another" }, csrf, key),
    undefined,
  );
  assert.equal(verifyAppointment(snapshot, scope, "second session", key), undefined);
  assert.equal(verifyAppointment("x" + snapshot, scope, csrf, key), undefined);
});
