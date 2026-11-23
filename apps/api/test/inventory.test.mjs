import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApplication } from "../dist/application.js";
const org = randomUUID(),
  clinic = randomUUID(),
  id = randomUUID(),
  item = randomUUID(),
  warehouse = randomUUID();
const fields = {
  quantity: "1.250",
  kind: "RECEIPT",
  fromWarehouseId: null,
  toWarehouseId: warehouse,
  itemId: item,
  unit: "ea",
  lot: "A",
  reason: "Delivery",
};
test("stock endpoints bind clinic scope and accept exact decimal strings only", async () => {
  const calls = [];
  const app = await createApplication({ async checkReady() {} }, false, {
    tokenVerifier: {
      verify: async (token) => ({
        kind: token.includes("owner") ? "owner" : "staff",
        issuer: "https://id.example",
        subject: "user",
      }),
    },
    inventory: {
      recordStockMovement: async (...args) => {
        calls.push(args);
        return { ...args[4], id: args[3] };
      },
    },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const path =
      (await app.getUrl()) +
      "/organizations/" +
      org +
      "/clinics/" +
      clinic +
      "/inventory/movements/" +
      id;
    const send = (role, data) =>
      fetch(path, {
        method: "PUT",
        headers: { authorization: "Bearer " + role + ".a.b", "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    assert.equal((await send("owner", fields)).status, 403);
    for (const quantity of [1.25, "0", "0.000", "1.9999", "-1", "1e3"]) {
      assert.equal((await send("staff", { ...fields, quantity })).status, 400);
    }
    assert.equal((await send("staff", { ...fields, fromWarehouseId: undefined })).status, 400);
    assert.equal((await send("staff", { ...fields, clinicId: randomUUID() })).status, 400);
    const saved = await send("staff", fields);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(1, 4), [org, clinic, id]);
    assert.equal(calls[0][4].quantity, "1.250");
  } finally {
    await app.close();
  }
});
