import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { FiscalXmlValidationError } from "@vetx/fiscal-cr";
import { createApplication } from "../dist/application.js";
test("fiscal status, issuance and retries require staff and accept only explicit fiscal classifications", async () => {
  const calls = [],
    org = randomUUID(),
    clinic = randomUUID(),
    sale = randomUUID();
  const record = {
    id: randomUUID(),
    saleId: sale,
    environment: "sandbox",
    key: "0".repeat(50),
    state: "pending",
    issue: null,
    createdAt: new Date().toISOString(),
    hasSignedXml: false,
    hasReceipt: false,
  };
  let validatorAvailable = true;
  const app = await createApplication({ async checkReady() {} }, false, {
    tokenVerifier: {
      verify: async (token) => ({
        kind: token.startsWith("owner") ? "owner" : "staff",
        issuer: "https://id.test",
        subject: "cashier",
      }),
    },
    fiscal: {
      fiscalArtifact: async (...args) => {
        calls.push(args);
        return { key: record.key, xml: Buffer.from("<fixture/>") };
      },
      fiscalStatus: async (...args) => {
        calls.push(args);
        return { enabled: true, invoice: null };
      },
      issueFiscalInvoice: async (...args) => {
        if (!validatorAvailable) throw new FiscalXmlValidationError("unavailable");
        calls.push(args);
        return record;
      },
      retryFiscalInvoice: async (...args) => {
        calls.push(args);
        return record;
      },
    },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const path =
      (await app.getUrl()) +
      `/organizations/${org}/clinics/${clinic}/billing/sales/${sale}/fiscal/`;
    const draft = {
      recipient: { name: "Ana Mora", identity: { type: "01", number: "100000001" } },
      terms: { code: "02", days: 15 },
      exchangeRate: "1",
      lines: [{ unitCode: "Sp", category: "service", vatTariffCode: "08" }],
    };
    const send = (env, method = "GET", body, role = "staff") =>
      fetch(path + env, {
        method,
        headers: { Authorization: "Bearer " + role + ".a.b", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    assert.equal((await send("sandbox", "GET", undefined, "owner")).status, 403);
    assert.equal((await send("whatever")).status, 400);
    const status = await send("sandbox");
    assert.equal(status.status, 200);
    assert.equal(status.headers.get("cache-control"), "no-store");
    assert.deepEqual(await status.json(), { enabled: true, invoice: null });
    for (const body of [
      { ...draft, issuer: {} },
      { ...draft, recipient: null },
      { ...draft, terms: { code: "01", days: 1 } },
      { ...draft, terms: { code: "02" } },
      { ...draft, exchangeRate: "1e2" },
      { ...draft, lines: [{ ...draft.lines[0], subtotal: "10" }] },
      { ...draft, lines: [{ ...draft.lines[0], unitCode: "not-a-unit" }] },
      { ...draft, lines: [{ ...draft.lines[0], vatTariffCode: "10" }] },
    ])
      assert.equal((await send("sandbox", "PUT", body)).status, 400);
    assert.equal((await send("sandbox", "PUT", draft)).status, 200);
    assert.equal((await send("sandbox/retry", "PUT", { key: "replacement" })).status, 400);
    assert.equal((await send("sandbox/retry", "PUT", {})).status, 200);
    assert.equal((await send("sandbox/artifacts/receipt", "GET", undefined, "owner")).status, 403);
    assert.equal((await send("sandbox/artifacts/keys")).status, 400);
    const file = await send("sandbox/artifacts/invoice");
    assert.equal(file.status, 200);
    assert.match(
      file.headers.get("content-disposition"),
      /attachment; filename="0{50}-invoice.xml"/,
    );
    assert.equal(await file.text(), "<fixture/>");
    assert.equal(file.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 4);
    validatorAvailable = false;
    const unavailable = await send("sandbox", "PUT", draft);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, "SERVICE_UNAVAILABLE");
    assert.deepEqual(calls[1].slice(1, 5), [org, clinic, sale, "sandbox"]);
  } finally {
    await app.close();
  }
});
