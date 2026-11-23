import assert from "node:assert/strict";
import { test } from "node:test";
import { lineAmounts, formatAmount, decimal, billingTarget } from "../src/billing/model.ts";
test("sale calculations round each line and tax to five decimals with integer arithmetic", () => {
  assert.deepEqual(lineAmounts("1234567890123.12345", "0.001", "13"), {
    net: 123456789012312n,
    tax: 16049382571601n,
    total: 139506171583913n,
  });
  assert.equal(formatAmount("9999999999999.12345", "en"), "9,999,999,999,999.12345");
  assert.equal(decimal("1,235", 3), "1.235");
  assert.equal(decimal("1e2", 5), null);
  assert.equal(decimal("-0.15", 5), null);
});
test("billing BFF accepts only known scoped operations and bounded query fields", () => {
  const id = "a1234567-1111-2222-3333-123456789abc";
  assert.equal(
    billingTarget("GET", ["balances", id], new URLSearchParams("page=2&secret=value")),
    `inventory/warehouses/${id}/balances?page=2`,
  );
  assert.equal(
    billingTarget("POST", ["sales", id, "payments", id], new URLSearchParams()),
    `billing/sales/${id}/payments/${id}`,
  );
  for (const path of [
    ["..", "billing"],
    ["sales", id, "payments"],
    ["sales", id, "junk", id],
    ["patients", id],
  ])
    assert.equal(billingTarget("POST", path, new URLSearchParams()), null);
});
