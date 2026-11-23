import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../locales/native-billing.en.json" with { type: "json" };
import es from "../locales/native-billing.es.json" with { type: "json" };
function compare(a, b, path) {
  if (typeof a === "string") {
    assert.ok(a.trim() && b.trim());
    assert.deepEqual((a.match(/{\w+}/g) ?? []).sort(), (b.match(/{\w+}/g) ?? []).sort(), path);
    return;
  }
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
  for (const k of Object.keys(a)) compare(a[k], b[k], path + "." + k);
}
test("native billing forms, invoices, drawers and payment methods have bilingual labels", () =>
  compare(en, es, "billing"));
