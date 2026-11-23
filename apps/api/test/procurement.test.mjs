import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { RegistryError } from "@vetx/database";
import { createApplication } from "../dist/application.js";
const org = randomUUID(),
  clinic = randomUUID(),
  patient = randomUUID(),
  rx = randomUUID(),
  order = randomUUID(),
  supply = randomUUID(),
  warehouse = randomUUID(),
  item = randomUUID();
const base = `/organizations/${org}/clinics/${clinic}`,
  purchase = base + "/purchasing/orders/" + order;
const prescription = base + "/patients/" + patient + "/prescriptions/" + rx,
  pet = randomUUID(),
  ownerPath = "/owner/pets/" + pet + "/prescriptions";
async function run(kind, procurement, fn) {
  const actor = { kind, issuer: "https://realm.test", subject: "viewer" };
  const app = await createApplication({ async checkReady() {} }, false, {
    procurement,
    tokenVerifier: { verify: async () => actor },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    await fn(
      (path, data, auth = true) =>
        fetch(url + path, {
          method: data === undefined ? "GET" : "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: "Bearer a.b.c" } : {}),
          },
          body: data === undefined ? undefined : JSON.stringify(data),
        }),
      actor,
    );
  } finally {
    await app.close();
  }
}
test("staff and owner procurement routes enforce their audience and validate nested lists before storage", async () => {
  const valid = { itemId: item, quantity: "1.125", expectedUnit: "units" },
    body = { supplierId: supply, lines: [valid] };
  await run("staff", {}, async (send) => {
    assert.equal((await send(purchase, body, false)).status, 401);
    assert.equal((await send(ownerPath)).status, 403);
    for (const bad of [
      { ...body, lines: [] },
      ...[undefined, null, "", "a".repeat(41), "u\nnits"].map((expectedUnit) => ({
        ...body,
        lines: [{ ...valid, expectedUnit }],
      })),
      { ...body, lines: null },
      { ...body, lines: [valid, valid] },
      { ...body, lines: [{ ...valid, author: "spoof" }] },
      { ...body, lines: [{ ...valid, quantity: 12 }] },
      { ...body, lines: [{ ...valid, quantity: "0" }] },
      { ...body, lines: [{ ...valid, quantity: "1.0001" }] },
      { ...body, lines: Array.from({ length: 101 }, () => ({ ...valid, itemId: randomUUID() })) },
    ]) {
      assert.equal((await send(purchase, bad)).status, 400);
    }
    assert.equal(
      (await send(purchase + "/receipts/" + randomUUID(), { lines: [{ ...valid, lot: "L" }] }))
        .status,
      400,
    );
    assert.equal(
      (
        await send(base + "/pharmacy/capabilities/member", {
          revision: 0,
          canPrescribe: "true",
          canDispense: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (await send(prescription, { ...valid, medication: "entered", instructions: "   " })).status,
      400,
    );
    for (const expectedUnit of [undefined, "", "a".repeat(41)]) {
      assert.equal(
        (
          await send(prescription, {
            ...valid,
            expectedUnit,
            medication: "entered",
            instructions: "Entered directions",
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await send(purchase + "/receipts/" + randomUUID(), {
          lines: [{ ...valid, warehouseId: warehouse, lot: "L" }],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await send(prescription + "/dispensings/" + randomUUID(), {
          warehouseId: warehouse,
          lot: "L",
          quantity: "1",
          expectedUnit: "units",
        })
      ).status,
      400,
    );
    assert.equal(
      (await send(prescription + "/sharing", { revision: 0, guardianIds: [patient, patient] }))
        .status,
      400,
    );
  });
  await run("owner", {}, async (send) => {
    assert.equal((await send(base + "/pharmacy/me")).status, 403);
    assert.equal((await send(base + "/purchasing/suppliers")).status, 403);
    assert.equal((await send(ownerPath + "?page=0")).status, 400);
  });
});
test("capabilities, authored orders, partial receipts, staged dispensing and owner projection use authenticated identity", async () => {
  let n = 0;
  const lines = [{ itemId: item, warehouseId: warehouse, lot: "L", quantity: "1.000" }];
  const payload = {
    supplierId: supply,
    lines: [{ itemId: item, quantity: "3", expectedUnit: "units" }],
  };
  const store = {
    createPurchaseOrder: async (actor, o, c, id, input) => {
      assert.deepEqual(
        [actor.kind, o, c, id, structuredClone(input)],
        ["staff", org, clinic, order, payload],
      );
      n++;
      return { id };
    },
    receivePurchaseOrder: async (actor, o, c, parent, id, input) => {
      assert.deepEqual(
        [actor.kind, o, c, parent, structuredClone(input)],
        ["staff", org, clinic, order, { lines }],
      );
      n++;
      return { id };
    },
    getPharmacyCapability: async (actor) => ({ subject: actor.subject, canDispense: false }),
    savePharmacyCapability: async () => {
      throw new RegistryError("forbidden");
    },
    dispensePrescription: async () => {
      throw new RegistryError("conflict");
    },
  };
  await run("staff", store, async (send) => {
    const created = await send(purchase, payload);
    assert.deepEqual(await created.json(), { id: order });
    assert.equal(created.headers.get("cache-control"), "no-store");
    const receipt = randomUUID();
    assert.deepEqual(await (await send(purchase + "/receipts/" + receipt, { lines })).json(), {
      id: receipt,
    });
    assert.equal(n, 2);
    assert.deepEqual(await (await send(base + "/pharmacy/me")).json(), {
      subject: "viewer",
      canDispense: false,
    });
    assert.equal(
      (
        await send(base + "/pharmacy/capabilities/member", {
          revision: 0,
          canPrescribe: true,
          canDispense: false,
        })
      ).status,
      403,
    );
    const result = await send(prescription + "/dispensings/" + randomUUID(), {
      warehouseId: warehouse,
      quantity: "1",
      lot: "L",
    });
    assert.equal(result.status, 409);
    assert.equal((await result.json()).error.code, "CONFLICT");
  });
  await run(
    "owner",
    {
      listOwnerPrescriptions: async (actor, id, page) => {
        assert.deepEqual([actor.kind, id, page], ["owner", pet, 2]);
        return { page, hasNextPage: false, prescriptions: [] };
      },
    },
    async (send) => {
      assert.deepEqual(await (await send(ownerPath + "?page=2")).json(), {
        page: 2,
        hasNextPage: false,
        prescriptions: [],
      });
    },
  );
});
