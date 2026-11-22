import assert from "node:assert/strict";
import { test } from "node:test";

import en from "../locales/en.json" with { type: "json" };
import es from "../locales/es.json" with { type: "json" };

function keysByPath(catalog, prefix = "") {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value) return keysByPath(value, path);
    assert.equal(typeof value, "string", path);
    assert.ok(value.trim().length > 0, path);
    return [path];
  });
}

test("both catalogs supply the same nonempty translation keys", () => {
  assert.deepEqual(keysByPath(en).sort(), keysByPath(es).sort());
});

test("both catalogs supply staff and pet titles, language controls and readiness states", () => {
  for (const catalog of [en, es]) {
    assert.ok(catalog.entry.staff.title);
    assert.ok(catalog.entry.pets.title);
    assert.ok(catalog.language.label);
    assert.ok(catalog.language.es);
    assert.ok(catalog.language.en);
    assert.ok(catalog.service.checking);
    assert.ok(catalog.service.available);
    assert.ok(catalog.service.unavailable);
    assert.ok(catalog.service.unconfigured);
  }
});
