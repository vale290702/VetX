import assert from "node:assert/strict";
import { test } from "node:test";
import {
  money,
  lineFitsStock,
  formatDecimal,
  quoteCart,
  saleBody,
  priceBody,
  paymentBody,
  shiftBody,
  myShift,
  refreshLines,
} from "../src/billing-forms.ts";
import { createBilling } from "../src/billing-client.ts";
import { createPatientTransport } from "../src/patient-transport.ts";
import { preserveAttempt } from "../src/inventory-forms.ts";
const price = {
  id: "x",
  name: "Entry",
  stockItemId: null,
  unit: "visit",
  currency: "CRC",
  unitPrice: "1.23456",
  taxRate: "13.00000",
  cabys: "0123456789012",
  revision: 1,
};
const product = { ...price, id: "y", unit: "box", stockItemId: "stock" },
  account = { subject: "cashier", issuer: "realm" },
  open = { id: "s", closedAt: null, currency: "CRC", cashier: account };
const balance = {
    warehouseId: "w",
    warehouseName: "Store",
    itemId: "stock",
    lot: "L",
    quantity: "3.000",
    unit: "box",
  },
  serviceLine = { key: "a", price, quantity: "1,125" },
  productLine = { key: "b", price: product, quantity: "2", balance };
test("localized five-place amounts preserve integer precision and per-line half-up rounding", () => {
  assert.equal(money("9999999999999,99999"), "9999999999999.99999");
  for (const s of ["1,234.42", "-1", ".01", "1.123456", "10000000000000", "2e2"])
    assert.equal(money(s), undefined);
  assert.equal(formatDecimal("-9999999999999.99999", "es-ES"), "-9.999.999.999.999,99999");
  assert.deepEqual(quoteCart([serviceLine]), {
    subtotal: "1.38888",
    tax: "0.18055",
    total: "1.56943",
  });
  const half = {
    ...serviceLine,
    price: { ...price, unitPrice: "0.00001", taxRate: "50" },
    quantity: "0.500",
  };
  assert.deepEqual(quoteCart([half, half]), {
    subtotal: "0.00002",
    tax: "0.00002",
    total: "0.00004",
  });
});
test("cart uses reviewed revisions and real lot balances, aggregated across prices for the same item", () => {
  assert.deepEqual(saleBody("p", [serviceLine, productLine]), {
    currency: "CRC",
    patientId: "p",
    lines: [
      { priceId: "x", priceRevision: 1, quantity: "1.125", warehouseId: null, lot: "" },
      { priceId: "y", priceRevision: 1, quantity: "2", warehouseId: "w", lot: "L" },
    ],
  });
  for (const rows of [
    [{ ...productLine, balance: undefined }],
    [{ ...productLine, balance: { ...balance, unit: "each" } }],
    [productLine, { ...productLine, price: { ...product, id: "y2" } }],
    [serviceLine, { ...serviceLine, price: { ...price, currency: "USD" } }],
    [{ ...serviceLine, quantity: "10000000000000" }],
    [
      {
        ...serviceLine,
        quantity: "9999999999999",
        price: { ...price, unitPrice: "9999999999999" },
      },
    ],
  ])
    assert.equal(saleBody(null, rows), undefined);
});
test("refreshing cart terms drops invalid quantities, lots and unavailable prices", () => {
  const updated = refreshLines([productLine], new Map([["y", { ...product, revision: 2 }]]), [
    balance,
  ])[0];
  assert.equal(updated.price.revision, 2);
  assert.equal(updated.quantity, "2");
  const changed = refreshLines(
    [productLine],
    new Map([["y", { ...product, unit: "each", stockItemId: "q" }]]),
    [balance],
  )[0];
  assert.equal(changed.quantity, "");
  assert.equal(changed.balance, undefined);
  const missing = refreshLines([productLine], new Map(), [])[0];
  assert.equal(missing.unavailable, true);
  assert.equal(saleBody(null, [missing]), undefined);
});
test("price writes preserve CABYS, explicit base units, five-place rates and amounts", () => {
  assert.deepEqual(priceBody({ ...price, unitPrice: "1,20000" }), {
    name: "Entry",
    unit: "visit",
    stockItemId: null,
    currency: "CRC",
    unitPrice: "1.20000",
    taxRate: "13.00000",
    cabys: "0123456789012",
    revision: 1,
  });
  assert.equal(priceBody({ ...price, cabys: "12" }), undefined);
  assert.equal(priceBody({ ...price, taxRate: "100.00001" }), undefined);
});
test("cash needs the current issuer and cashier's open matching-currency drawer; external references are required", () => {
  assert.ok(myShift(open, account));
  assert.equal(myShift({ ...open, cashier: { ...account, issuer: "other" } }, account), false);
  const sale = { balance: "4.00000", currency: "CRC" };
  assert.deepEqual(paymentBody(sale, account, "CASH", "2,50", "", open), {
    method: "CASH",
    amount: "2.50",
    reference: "",
    shiftId: "s",
  });
  for (const s of [
    undefined,
    { ...open, closedAt: "now" },
    { ...open, currency: "USD" },
    { ...open, cashier: { ...account, subject: "other" } },
  ])
    assert.equal(paymentBody(sale, account, "CASH", "1", "", s), undefined);
  assert.equal(paymentBody(sale, account, "CARD", "1", "  "), undefined);
  assert.equal(paymentBody(sale, account, "TRANSFER", "5", "r"), undefined);
  assert.deepEqual(paymentBody(sale, account, "CARD", "1", " R7 ", open), {
    method: "CARD",
    amount: "1",
    reference: "R7",
    shiftId: null,
  });
  assert.deepEqual(shiftBody(" Front ", "crc", "0,00000"), {
    label: "Front",
    currency: "CRC",
    openingFloat: "0.00000",
  });
});
test("ten billing operations use the verified clinic; retry preserves the sale identifier and reviewed lines", async () => {
  const scope = { subject: "cashier", organizationId: "org", clinicId: "clinic" },
    requests = [],
    signal = new AbortController().signal;
  const session = {
    forOrganization: (sub, org, work) => {
      assert.equal(sub, scope.subject);
      assert.equal(org, scope.organizationId);
      return work("grant", signal);
    },
  };
  const c = createBilling(
    createPatientTransport(session, "https://vet.test", async (url, init) => {
      assert.equal(init.signal, signal);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      const r = new Request(url, init);
      requests.push(r);
      assert.equal(r.headers.get("Authorization"), "Bearer grant");
      return Response.json({});
    }),
  );
  await c.prices(scope, 2, "ABC");
  await c.price(scope, "p", priceBody(price));
  await c.sales(scope, 3);
  const first = preserveAttempt(undefined, "sale-uuid", saleBody(null, [serviceLine]));
  await c.checkout(scope, first.id, first.body);
  const replay = preserveAttempt(first, "other", saleBody(null, [productLine]));
  await c.checkout(scope, replay.id, replay.body);
  await c.sale(scope, "sale-uuid");
  await c.payments(scope, "sale-uuid", 2);
  await c.pay(
    scope,
    "sale-uuid",
    "pay-uuid",
    paymentBody({ currency: "CRC", balance: "3" }, account, "CASH", "2", "", open),
  );
  await c.shifts(scope, 2);
  await c.open(scope, "drawer", shiftBody("Front", "CRC", "0"));
  await c.close(scope, "drawer", { counted: "2.00000" });
  assert.deepEqual(
    requests.map(
      (r) =>
        r.method +
        " " +
        r.url.replace("https://vet.test/organizations/org/clinics/clinic/billing", ""),
    ),
    [
      "GET /prices?page=2&query=ABC",
      "PUT /prices/p",
      "GET /sales?page=3",
      "PUT /sales/sale-uuid",
      "PUT /sales/sale-uuid",
      "GET /sales/sale-uuid",
      "GET /sales/sale-uuid/payments?page=2",
      "PUT /sales/sale-uuid/payments/pay-uuid",
      "GET /shifts?page=2",
      "PUT /shifts/drawer",
      "PUT /shifts/drawer/close",
    ],
  );
  assert.deepEqual(await requests[3].json(), await requests[4].json());
  assert.deepEqual(await requests[7].json(), {
    method: "CASH",
    amount: "2",
    reference: "",
    shiftId: "s",
  });
});

test("a dropped cash payment response retries the same drawer, amount, and reference without another charge", async () => {
  const scope = { subject: "cashier", clinicId: "clinic", organizationId: "org" };
  const recorded = new Map(),
    signal = new AbortController().signal;
  const client = createBilling(
    createPatientTransport(
      { forOrganization: (subject, org, work) => work("verified", signal) },
      "https://vet.test",
      async (url, init) => {
        const r = new Request(url, init),
          body = await r.json(),
          key = r.url;
        if (!recorded.has(key)) {
          recorded.set(key, body);
          throw new TypeError("response lost");
        }
        assert.deepEqual(body, recorded.get(key));
        return Response.json({ id: "payment", ...body });
      },
    ),
  );
  const sale = { currency: "CRC", balance: "20.00000" };
  const first = preserveAttempt(
    undefined,
    "payment",
    paymentBody(sale, account, "CASH", "2,55", "", open),
  );
  await assert.rejects(() => client.pay(scope, "sale", first.id, first.body));
  const replay = preserveAttempt(
    first,
    "second",
    paymentBody(sale, account, "CARD", "15", "external-ref"),
  );
  const result = await client.pay(scope, "sale", replay.id, replay.body);
  assert.equal(result.amount, "2.55");
  assert.equal(result.shiftId, "s");
  assert.equal(recorded.size, 1);
});

test("cart preserves the smallest reviewed balance for a lot until refreshed", () => {
  const old = { ...productLine, quantity: "1", balance: { ...balance, quantity: "1.000" } };
  const newer = { ...productLine, quantity: "1", balance: { ...balance, quantity: "5.000" } };
  assert.equal(lineFitsStock(newer, [old]), false);
  assert.equal(saleBody(null, [old, newer]), undefined);
  assert.equal(saleBody(null, [newer, old]), undefined);
  assert.ok(lineFitsStock(newer, [{ ...old, balance: { ...old.balance, lot: "OTHER" } }]));
  assert.equal(
    quoteCart([serviceLine, { ...serviceLine, price: { ...price, currency: "USD" } }]),
    undefined,
  );
});
