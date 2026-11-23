import assert from "node:assert/strict";
import { test } from "node:test";
import {
  stockQuantity,
  displayQuantity,
  movementInput,
  catalogInput,
  canDebit,
  preserveAttempt,
} from "../src/inventory-forms.ts";
import { createInventory, inventoryWrite } from "../src/inventory-client.ts";
import { createPatientTransport, PatientError } from "../src/patient-transport.ts";

test("quantities are exact decimal strings, including the largest accepted balance", () => {
  for (const invalid of [
    "",
    "0",
    "0,000",
    "01.5",
    "-1",
    "1.2345",
    "1,234.50",
    "1e3",
    "1000000000000000",
    "NaN",
  ])
    assert.equal(stockQuantity(invalid), undefined, invalid);
  assert.equal(stockQuantity(" 999999999999999,999 "), "999999999999999.999");
  assert.equal(stockQuantity("0.001"), "0.001");
  assert.equal(displayQuantity("999999999999999.999", "en-US"), "999,999,999,999,999.999");
  assert.equal(displayQuantity("999999999999999.999", "es-ES"), "999.999.999.999.999,999");
  assert.equal(canDebit("999999999999999.998", "999999999999999.999"), false);
  assert.equal(canDebit("0.1", "0.100"), true);
});
const draft = {
  kind: "TRANSFER",
  itemId: "i",
  fromWarehouseId: "a",
  toWarehouseId: "b",
  quantity: "1,125",
  lot: " B2 ",
  reason: " Restock ",
};
test("all movement directions require their authorized locations, reason and lot", () => {
  for (const kind of ["RECEIPT", "RETURN", "ADJUST_IN"])
    assert.deepEqual(movementInput({ ...draft, kind }), {
      ...draft,
      kind,
      fromWarehouseId: null,
      quantity: "1.125",
      lot: "B2",
      reason: "Restock",
    });
  for (const kind of ["ISSUE", "ADJUST_OUT"])
    assert.deepEqual(movementInput({ ...draft, kind }), {
      ...draft,
      kind,
      toWarehouseId: null,
      quantity: "1.125",
      lot: "B2",
      reason: "Restock",
    });
  assert.equal(movementInput({ ...draft, reason: "" }), undefined);
  assert.equal(movementInput({ ...draft, toWarehouseId: "a" }), undefined);
  assert.equal(movementInput({ ...draft, fromWarehouseId: null }), undefined);
  assert.equal(movementInput({ ...draft, lot: "a\nb" }), undefined);
  assert.equal(movementInput({ ...draft, lot: "" }).lot, "");
});
test("catalog validation preserves revisions; uncertain retries keep the same ID and body", () => {
  assert.deepEqual(catalogInput("item", { name: "Needle", sku: "ABC", unit: "ea", revision: 5 }), {
    name: "Needle",
    sku: "ABC",
    unit: "ea",
    revision: 5,
  });
  assert.equal(
    catalogInput("item", { name: "Needle", sku: "", unit: "ea", revision: 0 }),
    undefined,
  );
  assert.deepEqual(catalogInput("warehouse", { name: " Main ", revision: 1 }), {
    name: "Main",
    revision: 1,
  });
  const first = preserveAttempt(undefined, "uuid", movementInput(draft));
  assert.deepEqual(
    preserveAttempt(first, "other", movementInput({ ...draft, quantity: "99" })),
    first,
  );
});
test("seven inventory routes use the verified clinic and exact JSON, including replay after uncertainty", async () => {
  const signal = new AbortController().signal,
    requests = [];
  const scope = { organizationId: "org", clinicId: "clinic", subject: "staff" };
  const session = {
    forOrganization: (sub, org, work) => {
      assert.equal(sub, "staff");
      assert.equal(org, "org");
      return work("token", signal);
    },
  };
  const c = createInventory(
    createPatientTransport(session, "https://vet.test", async (url, init) => {
      assert.equal(init.signal, signal);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      const r = new Request(url, init);
      assert.equal(r.headers.get("Authorization"), "Bearer token");
      requests.push(r);
      return Response.json({});
    }),
  );
  await c.warehouses(scope, 2);
  await c.saveWarehouse(scope, "a", { name: "Main", revision: 2 });
  await c.items(scope, 3, "abc");
  await c.saveItem(scope, "i", { name: "Needles", sku: "ABC", unit: "ea", revision: 0 });
  await c.balances(scope, "a", 2);
  await c.ledger(scope, 4);
  const body = movementInput(draft);
  await c.move(scope, "movement", body);
  await c.move(scope, "movement", body);
  assert.deepEqual(
    requests.map(
      (r) =>
        r.method +
        " " +
        r.url.replace("https://vet.test/organizations/org/clinics/clinic/inventory", ""),
    ),
    [
      "GET /warehouses?page=2",
      "PUT /warehouses/a",
      "GET /items?page=3&query=abc",
      "PUT /items/i",
      "GET /warehouses/a/balances?page=2",
      "GET /movements?page=4",
      "PUT /movements/movement",
      "PUT /movements/movement",
    ],
  );
  assert.deepEqual(await requests[6].json(), body);
  assert.deepEqual(await requests[7].json(), body);
});
test("definitive authorization and stock failures allow reviewing changed data; unknown outcomes preserve retry", async () => {
  assert.deepEqual(await inventoryWrite(async () => ({ id: "m" })), { value: { id: "m" } });
  for (const [status, issue] of [
    [409, "conflict"],
    [403, "denied"],
    [404, "denied"],
    [400, "invalid"],
  ])
    assert.deepEqual(
      await inventoryWrite(async () => {
        throw new PatientError(status);
      }),
      { issue },
    );
  await assert.rejects(
    inventoryWrite(async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
});

test("the clinic ledger returns original stock and warehouse labels in its single scoped read", async () => {
  const scope = { organizationId: "org", clinicId: "c", subject: "s" };
  const session = {
    forOrganization: (_subject, _org, work) => work("token", new AbortController().signal),
  };
  const m = {
    ...movementInput(draft),
    id: "m",
    itemName: "Original needles",
    sku: "N-1",
    unit: "box",
    fromWarehouseName: "Main",
    toWarehouseName: "Surgery",
  };
  const calls = [];
  const c = createInventory(
    createPatientTransport(session, "https://vet.test", async (url) => {
      calls.push(url);
      return Response.json({ page: 1, hasNextPage: false, movements: [m] });
    }),
  );
  assert.deepEqual((await c.ledger(scope, 1)).movements, [m]);
  assert.equal(calls.length, 1);
  assert.ok(String(calls[0]).includes("/inventory/movements"));
});

test("a lost movement response can be retried with the original quantity and UUID without a second debit", async () => {
  const scope = { organizationId: "org", clinicId: "clinic", subject: "staff" };
  const session = {
    forOrganization: (_subject, _org, work) => work("token", new AbortController().signal),
  };
  let balance = 5000n;
  const saved = new Map();
  const c = createInventory(
    createPatientTransport(session, "https://vet.test", async (url, init) => {
      const request = new Request(url, init),
        body = await request.json();
      if (saved.has(request.url)) {
        assert.deepEqual(body, saved.get(request.url));
        return Response.json({ id: "m" });
      }
      saved.set(request.url, body);
      const [whole, fraction = ""] = body.quantity.split(".");
      balance -= BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
      throw new Error("Connection lost after the write");
    }),
  );
  const pending = preserveAttempt(undefined, "m", movementInput(draft));
  await assert.rejects(
    inventoryWrite(() => c.move(scope, pending.id, pending.body)),
    /Connection lost/,
  );
  const retry = preserveAttempt(pending, "new", movementInput({ ...draft, quantity: "2" }));
  assert.deepEqual(await inventoryWrite(() => c.move(scope, retry.id, retry.body)), {
    value: { id: "m" },
  });
  assert.equal(balance, 3875n);
  assert.equal(saved.size, 1);
});
