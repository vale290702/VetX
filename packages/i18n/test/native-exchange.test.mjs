import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../locales/native-exchange.en.json" with { type: "json" };
import es from "../locales/native-exchange.es.json" with { type: "json" };

function compare(en, es, path) {
  if (typeof en === "object") {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort(), path);
    for (const key of Object.keys(en)) compare(en[key], es[key], path + "." + key);
    return;
  }
  assert.ok(en.trim() && es.trim(), path);
  assert.deepEqual((en.match(/{\w+}/g) ?? []).sort(), (es.match(/{\w+}/g) ?? []).sort(), path);
}
test("native exchange messages, clinical fields and placeholders match in both languages", () =>
  compare(en, es, "exchange"));
