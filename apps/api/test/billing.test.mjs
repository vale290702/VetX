import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApplication } from "../dist/application.js";
test("only a staff identity can checkout and invoice totals cannot be supplied by the client", async () => {
  const org = randomUUID(),
    clinic = randomUUID(),
    id = randomUUID(),
    priceId = randomUUID(),
    calls = [];
  const app = await createApplication({ async checkReady() {} }, false, {
    tokenVerifier: {
      verify: async (token) => ({
        kind: token.includes("owner") ? "owner" : "staff",
        issuer: "https://id.example",
        subject: "employee",
      }),
    },
    billing: {
      createSale: async (...values) => {
        calls.push(values);
        return { id };
      },
    },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const url =
      (await app.getUrl()) +
      "/organizations/" +
      org +
      "/clinics/" +
      clinic +
      "/billing/sales/" +
      id;
    const body = {
      currency: "CRC",
      patientId: null,
      lines: [{ priceId, priceRevision: 1, quantity: "1.500", warehouseId: null, lot: "" }],
    };
    const send = (role, data) =>
      fetch(url, {
        method: "PUT",
        headers: { Authorization: "Bearer " + role + ".a.b", "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    assert.equal((await send("owner", body)).status, 403);
    for (const data of [
      { ...body, total: "1.00" },
      { ...body, lines: [] },
      { ...body, lines: [{ ...body.lines[0], priceRevision: 0 }] },
      { ...body, lines: [{ ...body.lines[0], unitPrice: "0" }] },
    ])
      assert.equal((await send("staff", data)).status, 400);
    const ok = await send("staff", body);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(1, 4), [org, clinic, id]);
  } finally {
    await app.close();
  }
});
