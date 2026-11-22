import assert from "node:assert/strict";
import { test } from "node:test";
import es from "../locales/native-directory.es.json" with { type: "json" };
import en from "../locales/native-directory.en.json" with { type: "json" };

test("staff directory messages have the same labels and ICU arguments in both languages", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const key of Object.keys(es)) {
    assert.ok(en[key].trim() && es[key].trim());
    assert.deepEqual(
      (en[key].match(/{\w+}/g) ?? []).sort(),
      (es[key].match(/{\w+}/g) ?? []).sort(),
      key,
    );
  }
});
