import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseMovement,
  parseCatalog,
  inventoryPath,
  stockQuantity,
} from "../src/inventory/forms.ts";
const first = crypto.randomUUID(),
  second = crypto.randomUUID(),
  item = crypto.randomUUID();
const base = {
  kind: "RECEIPT",
  fromWarehouseId: null,
  toWarehouseId: first,
  itemId: item,
  quantity: "0.125",
  lot: "Batch 1",
  reason: "Delivery",
};
test("inventory retains decimal precision and validates the warehouse direction for every movement", () => {
  for (const [kind, fromWarehouseId, toWarehouseId] of [
    ["RECEIPT", null, first],
    ["RETURN", null, first],
    ["ADJUST_IN", null, first],
    ["TRANSFER", first, second],
    ["ISSUE", first, null],
    ["ADJUST_OUT", first, null],
  ]) {
    const movement = { ...base, kind, fromWarehouseId, toWarehouseId };
    assert.deepEqual(parseMovement(movement), movement);
  }
  for (const patch of [
    { quantity: "0.000" },
    { quantity: "1.1234" },
    { quantity: "1e3" },
    { quantity: "1000000000000000" },
    { quantity: 1 },
    { kind: "TRANSFER", fromWarehouseId: first },
    { fromWarehouseId: second },
    { kind: "ISSUE" },
    { reason: "" },
    { lot: "bad\nlot" },
    { toWarehouseId: "" },
  ])
    assert.equal(parseMovement({ ...base, ...patch }), null);
  assert.equal(
    parseMovement({ ...base, quantity: "999999999999999.999", lot: "" }).quantity,
    "999999999999999.999",
  );
});
test("catalog fields are trimmed, revisions are explicit, and item/warehouse inputs remain distinct", () => {
  assert.deepEqual(parseCatalog("warehouses", { name: " Pharmacy ", revision: 0 }), {
    name: "Pharmacy",
    revision: 0,
  });
  assert.deepEqual(
    parseCatalog("items", { name: " Gauze ", sku: "GZ", unit: "roll", revision: 2 }),
    { name: "Gauze", sku: "GZ", unit: "roll", revision: 2 },
  );
  for (const patch of [
    { unit: " " },
    { sku: "" },
    { name: "n".repeat(121) },
    { revision: -2 },
    { revision: 0.5 },
  ])
    assert.equal(
      parseCatalog("items", { name: "Gauze", sku: "GZ", unit: "roll", revision: 1, ...patch }),
      null,
    );
});
test("inventory pagination preserves the search term, clinic and selected warehouse", () => {
  const scope = { organizationId: first, clinicId: second },
    basePath = `/organizations/${first}/clinics/${second}/inventory`;
  assert.equal(
    inventoryPath(scope, { view: "items", query: "C & D", page: 2 }),
    basePath + "?q=C+%26+D&page=2",
  );
  assert.equal(
    inventoryPath(scope, { view: "warehouses", warehouse: item, page: 3 }),
    basePath + `?view=warehouses&warehouse=${item}&page=3`,
  );
});
test("English and Spanish inventory messages have matching keys and format arguments", () => {
  const data = (l) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../packages/i18n/locales/web-inventory.${l}.json`, import.meta.url),
      ),
    );
  const en = data("en"),
    es = data("es");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const key of Object.keys(en))
    assert.deepEqual(en[key].match(/\{\w+\}/g), es[key].match(/\{\w+\}/g));
});

test("inventory quantities use the locale decimal separator without losing a thousandth at maximum scale", () => {
  assert.equal(stockQuantity("999999999999999.999", "en"), "999,999,999,999,999.999");
  assert.equal(stockQuantity("999999999999999.999", "es"), "999.999.999.999.999,999");
  assert.equal(stockQuantity("0.125", "es"), "0,125");
});
