import assert from "node:assert/strict";
import { test } from "node:test";

import en from "../locales/native-auth.en.json" with { type: "json" };
import es from "../locales/native-auth.es.json" with { type: "json" };

test("native access control and error messages are available in both languages", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  assert.deepEqual(Object.keys(en.errors).sort(), Object.keys(es.errors).sort());
  for (const { errors, ...labels } of [en, es]) {
    for (const message of [...Object.values(labels), ...Object.values(errors)]) {
      assert.ok(message.trim());
    }
  }
});
