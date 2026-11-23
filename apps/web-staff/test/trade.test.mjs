import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parseTrade, remaining, allowedSubject } from "../src/trade/forms.ts";
const id = crypto.randomUUID(),
  other = crypto.randomUUID(),
  warehouse = crypto.randomUUID();
const line = { itemId: id, expectedUnit: "pack", quantity: "0.125" };
test("purchases bind reviewed units and reject duplicate or unbounded order lines", () => {
  assert.deepEqual(parseTrade("order", { supplierId: other, lines: [line] }), {
    action: "order",
    body: { supplierId: other, lines: [line] },
  });
  for (const lines of [
    [],
    [line, line],
    [{ ...line, expectedUnit: "" }],
    [{ ...line, quantity: "1e4" }],
    Array(101).fill(line),
  ])
    assert.equal(parseTrade("order", { supplierId: other, lines }), null);
});
test("receipt lines can split one item by lot and bind to the original order", () => {
  const lines = ["A", "B"].map((lot) => ({
    itemId: id,
    warehouseId: warehouse,
    quantity: "1",
    lot,
  }));
  assert.deepEqual(parseTrade("receipt", { orderId: other, lines }), {
    action: "receipt",
    orderId: other,
    body: { lines },
  });
  assert.equal(parseTrade("receipt", { orderId: "x", lines }), null);
});
test("prescription writes bind a patient, the reviewed unit, grant revision and individual linked guardians", () => {
  const rx = {
    patientId: id,
    itemId: other,
    expectedUnit: "pack",
    medication: "Existing medication",
    instructions: "First line\nSecond line",
    quantity: "1.125",
  };
  assert.equal(parseTrade("prescribe", rx).body.expectedUnit, "pack");
  assert.equal(parseTrade("prescribe", { ...rx, instructions: "\u0000" }), null);
  assert.equal(
    parseTrade("share", { patientId: id, rxId: other, revision: 1, guardianIds: [id, id] }),
    null,
  );
  assert.deepEqual(
    parseTrade("share", { patientId: id, rxId: other, revision: 1, guardianIds: [] }).body
      .guardianIds,
    [],
  );
  assert.equal(
    parseTrade("grant", { subject: "..", revision: 0, canPrescribe: true, canDispense: false }),
    null,
  );
  assert.equal(allowedSubject("external.user-2"), true);
  assert.equal(allowedSubject("issuer/user"), true);
  assert.equal(remaining("999999999999999.999", "0.001"), "999999999999999.998");
});

test("purchasing and pharmacy labels and format arguments are available in both languages", () => {
  const read = (locale) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../packages/i18n/locales/web-trade.${locale}.json`, import.meta.url),
        "utf8",
      ),
    );
  const en = read("en"),
    es = read("es");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const [key, value] of Object.entries(en)) {
    assert.ok(es[key].trim());
    assert.deepEqual(es[key].match(/\{\w+\}/g), value.match(/\{\w+\}/g));
  }
});
