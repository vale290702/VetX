import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../locales/native-inventory.en.json" with { type: "json" };
import es from "../locales/native-inventory.es.json" with { type: "json" };
import enTrade from "../locales/native-trade.en.json" with { type: "json" };
import esTrade from "../locales/native-trade.es.json" with { type: "json" };
function compare(a, b, path) {
  if (typeof a === "string") {
    assert.ok(a.trim() && b.trim());
    assert.deepEqual((a.match(/{\w+}/g) ?? []).sort(), (b.match(/{\w+}/g) ?? []).sort(), path);
    return;
  }
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
  for (const k of Object.keys(a)) compare(a[k], b[k], path + "." + k);
}
test("native inventory actions, notices, quantities and movement kinds have bilingual labels", () =>
  compare(en, es, "inventory"));

test("purchasing, pharmacy grants and owner prescription labels match in both languages", () =>
  compare(enTrade, esTrade, "trade"));
