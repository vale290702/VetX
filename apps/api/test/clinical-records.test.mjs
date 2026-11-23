import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApplication } from "../dist/application.js";
test("staff clinical routes validate typed data before storage and bind revision authors to the token", async () => {
  const org = randomUUID(),
    clinic = randomUUID(),
    patient = randomUUID(),
    id = randomUUID(),
    req = randomUUID(),
    encounterId = randomUUID();
  const base =
      "/organizations/" + org + "/clinics/" + clinic + "/patients/" + patient + "/clinical-records",
    path = base + "/" + id + "/revisions/" + req;
  let received;
  const staff = { kind: "staff", issuer: "https://example.test", subject: "staff" };
  const app = await createApplication({ async checkReady() {} }, false, {
    tokenVerifier: {
      verify: async (token) => (token === "owner.test.token" ? { ...staff, kind: "owner" } : staff),
    },
    clinicalRecords: {
      async saveClinicalRevision(...args) {
        received = args;
        return { id };
      },
    },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const call = (urlPath, body, token = "staff.test.token") =>
      fetch(url + urlPath, {
        method: body === undefined ? "GET" : "PUT",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const good = {
      encounterId,
      kind: "diagnosis",
      occurredAt: "2026-11-22T15:00:00.000Z",
      revision: 0,
      data: { diagnosis: "Documented observation" },
    };
    for (const bad of [
      { ...good, data: { ...good.data, test: "extra" } },
      { ...good, author: staff },
      { ...good, kind: "vaccination", data: { vaccine: "Recorded", nextDueDate: "2026-02-31" } },
      { ...good, kind: "lab", data: { test: "T", status: "ORDERED", unit: "u" } },
      { ...good, kind: "lab", data: { test: "T", status: "REVIEWED", result: "Entry" } },
      { ...good, revision: 1 },
      { ...good, changeReason: "Unexpected" },
    ]) {
      assert.equal((await call(path, bad)).status, 400);
    }
    assert.equal(received, undefined);
    assert.equal((await call(path, good, "owner.test.token")).status, 403);
    assert.equal((await call("/owner/pets/" + patient + "/clinical-records")).status, 403);
    const result = await call(path, good);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(received.slice(0, 6), [staff, org, clinic, patient, id, req]);
    assert.deepEqual(JSON.parse(JSON.stringify(received[6])), good);
    for (const [kind, data] of [
      ["hospitalization", { status: "ADMITTED", ward: "Ward A", note: "Admission" }],
      [
        "surgery",
        { status: "PLANNED", procedure: "Scheduled procedure", scheduledAt: good.occurredAt },
      ],
    ]) {
      assert.equal((await call(path, { ...good, kind, data })).status, 200);
      assert.equal(
        (await call(path, { ...good, kind, data: { ...data, summary: "Unreleased text" } })).status,
        400,
      );
    }
    assert.equal(
      (
        await call(path, {
          ...good,
          kind: "hospitalization",
          data: { status: "DISCHARGED", ward: "Ward", note: "Recorded" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(path, {
          ...good,
          kind: "surgery",
          revision: 1,
          changeReason: "Completed",
          data: {
            status: "COMPLETED",
            procedure: "Procedure",
            scheduledAt: good.occurredAt,
            summary: "Complete",
          },
        })
      ).status,
      400,
    );
  } finally {
    await app.close();
  }
});
