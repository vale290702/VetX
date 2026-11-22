import assert from "node:assert/strict";
import { test } from "node:test";
import esDirectory from "../locales/native-directory.es.json" with { type: "json" };
import enDirectory from "../locales/native-directory.en.json" with { type: "json" };

import enDocuments from "../locales/native-documents.en.json" with { type: "json" };
import esDocuments from "../locales/native-documents.es.json" with { type: "json" };
import esPatients from "../locales/native-patients.es.json" with { type: "json" };
import enPatients from "../locales/native-patients.en.json" with { type: "json" };

for (const [catalog, en, es] of [
  ["documents", enDocuments, esDocuments],
  ["directory", enDirectory, esDirectory],
  ["patients", enPatients, esPatients],
]) {
  test(`native ${catalog} messages have the same labels and ICU arguments in both languages`, () => {
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
}
