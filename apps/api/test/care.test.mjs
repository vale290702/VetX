import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApplication } from "../dist/application.js";
const org = randomUUID(),
  clinic = randomUUID(),
  patient = randomUUID(),
  id = randomUUID();
const base = `/organizations/${org}/clinics/${clinic}`;
const visits = `${base}/patients/${patient}/encounters`,
  schedule = `${base}/appointments`;
const note = {
  occurredAt: "2026-02-23T14:00:00-06:00",
  reason: "Follow up",
  subjective: "",
  objective: "",
  assessment: "Follow up requested",
  plan: "",
};
const slot = {
  patientId: patient,
  startAt: note.occurredAt,
  endAt: "2026-02-23T21:00:00Z",
  reason: "Follow up",
  status: "BOOKED",
  revision: 0,
};
async function run(kind, care, fn) {
  const actor = { kind, issuer: "https://identity.example", subject: "subject" };
  const app = await createApplication({ async checkReady() {} }, false, {
    care,
    tokenVerifier: { verify: async () => actor },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    await fn(
      (path, body) =>
        fetch(url + path, {
          method: body === undefined ? "GET" : "PUT",
          headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      actor,
    );
  } finally {
    await app.close();
  }
}
test("clinical and appointment routes enforce their audience and validate before accessing storage", async () => {
  await run("owner", {}, async (send) => {
    assert.equal((await send(visits)).status, 403);
    assert.equal(
      (await send(schedule + "?from=2026-01-01T00:00Z&to=2026-01-02T00:00Z")).status,
      403,
    );
  });
  await run("staff", {}, async (send) => {
    assert.equal((await send("/owner/pets/" + id + "/encounters")).status, 403);
    for (const invalid of [
      { ...note, assessment: "  " },
      { ...note, occurredAt: "2026-02-30T09:00:00Z" },
      { ...note, occurredAt: "2026-02-22T13:00:00" },
      { ...note, subjective: null },
      { ...note, objective: "invalid\u0000text" },
      { ...note, authorSubject: "forged" },
    ])
      assert.equal((await send(visits + "/" + id, invalid)).status, 400);
    assert.equal(
      (await send(visits + "/" + id + "/sharing", { guardianIds: [patient, patient], revision: 0 }))
        .status,
      400,
    );
    assert.equal((await send(schedule + "/" + id, { ...slot, endAt: slot.startAt })).status, 400);
    assert.equal((await send(schedule + "?from=yesterday&to=tomorrow")).status, 400);
    assert.equal((await send(visits + "?page=0")).status, 400);
  });
});
test("clinical inputs preserve multiline text and normalize equivalent timestamps before storage", async () => {
  await run(
    "staff",
    {
      saveEncounter: async (actor, o, c, p, i, data) => {
        assert.deepEqual([o, c, p, i], [org, clinic, patient, id]);
        assert.equal(actor.kind, "staff");
        assert.equal(data.objective, "line one\nline two");
        assert.equal(data.occurredAt, "2026-02-23T20:00:00.000Z");
        assert.equal(data.reason, "Follow up");
        return { id };
      },
    },
    async (send) => {
      const r = await send(visits + "/" + id, {
        ...note,
        reason: " Follow up ",
        objective: "line one\nline two",
      });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.deepEqual(await r.json(), { id });
    },
  );
});
test("owner timeline carries only the authenticated owner and selected pet to storage", async () => {
  await run(
    "owner",
    {
      listOwnerEncounters: async (actor, pet, page) => {
        assert.equal(actor.kind, "owner");
        assert.equal(pet, patient);
        assert.equal(page, 2);
        return { encounters: [], page, hasNextPage: false };
      },
    },
    async (send) => {
      const r = await send("/owner/pets/" + patient + "/encounters?page=2");
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { encounters: [], page: 2, hasNextPage: false });
    },
  );
});
