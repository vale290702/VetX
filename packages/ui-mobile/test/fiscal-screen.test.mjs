import assert from "node:assert/strict";
import { test } from "node:test";
import { screen } from "./support/native-screen.mjs";
const { ClinicBilling } = await import("../src/billing.tsx");
const line = {
  name: "Visit",
  unit: "Unid",
  unitPrice: "4.00000",
  quantity: "2",
  taxRate: "13.00000",
  cabys: "0123456789012",
  subtotal: "8",
  tax: "1.04",
  total: "9.04",
};
const sale = {
  id: "sale",
  number: "13",
  currency: "CRC",
  balance: "9.04",
  paid: "0",
  total: "9.04",
  tax: "1.04",
  subtotal: "8",
  lines: [line],
  recordedAt: "2026-01-01T00:00:00Z",
  author: { subject: "staff", issuer: "realm" },
};
const record = {
  id: "f",
  saleId: "sale",
  environment: "production",
  key: "1".repeat(50),
  state: "pending",
  issue: null,
  createdAt: sale.recordedAt,
  hasSignedXml: false,
  hasReceipt: false,
};
const props = (fiscal, admin = false) => ({
  scope: { subject: "staff", clinicId: "clinic", organizationId: "org" },
  account: { issuer: "realm", subject: "staff", organizations: [] },
  client: {
    fiscal,
    billing: {
      sales: async () => ({ sales: [sale], page: 1, hasNextPage: false }),
      sale: async () => sale,
      payments: async () => ({ payments: [], page: 1, hasNextPage: false }),
    },
  },
  admin,
  styles: {},
  back() {},
});
async function open(ui, initial) {
  await ui.render(initial);
  await ui.press("Sales invoices");
  await ui.press("Open invoice 13");
  await ui.press("Electronic invoice");
}
test("the invoice shows an unconfigured clinic, switches environment, reviews and replays an exact credit issuance after refresh", async (t) => {
  let queued = null;
  const calls = [],
    submissions = [];
  const fiscal = {
    status: async (scope, id, environment) => {
      calls.push([scope.clinicId, id, environment]);
      return {
        enabled: environment === "production",
        invoice: environment === "production" ? queued : null,
      };
    },
    issue: async (scope, id, env, body) => {
      submissions.push({ scope, id, env, body });
      if (submissions.length === 1) throw Error("lost response");
      queued = record;
      return queued;
    },
  };
  const initial = props(fiscal),
    ui = screen(t, ClinicBilling);
  await open(ui, initial);
  assert.ok(ui.hasText("Electronic invoicing is not enabled for this clinic in this environment."));
  assert.equal(ui.button("Prepare electronic invoice"), undefined);
  await ui.press("Production");
  await ui.press("Prepare electronic invoice");
  await ui.fill("Recipient’s legal name", "Clinic client");
  await ui.press("01 · National ID");
  await ui.fill("Identification number", "001234567");
  await ui.fill("Credit term in days", "30");
  await ui.press("Service");
  assert.equal(ui.button("Immediate payment").disabled, true);
  await ui.press("Review invoice details");
  assert.ok(ui.hasText("Invoice environment · Production"));
  assert.ok(ui.hasText("Credit · 30 days"));
  await ui.press("Queue production invoice");
  assert.ok(ui.button("Retry the same request"));
  await ui.render({ ...initial, account: { ...initial.account }, scope: { ...initial.scope } });
  await ui.press("Retry the same request");
  assert.deepEqual(submissions[1], submissions[0]);
  assert.deepEqual(submissions[0].body.terms, { code: "02", days: 30 });
  assert.equal(submissions[0].body.lines[0].vatTariffCode, "08");
  assert.ok(ui.hasText("Queued for signing"));
  assert.deepEqual(calls[0], ["clinic", "sale", "sandbox"]);
  assert.deepEqual(calls.at(-1), ["clinic", "sale", "production"]);
});
test("blocked fiscal retry is admin-only and status controls expose only retained XML", async (t) => {
  let invoice = { ...record, state: "blocked", issue: "configuration", hasSignedXml: true };
  const retries = [];
  const fiscal = {
    status: async () => ({ enabled: true, invoice }),
    retry: async (scope, id, env) => {
      retries.push([scope.clinicId, id, env]);
      invoice = { ...invoice, state: "signed", issue: null, hasReceipt: true };
      return invoice;
    },
  };
  const initial = props(fiscal),
    ui = screen(t, ClinicBilling);
  await open(ui, initial);
  assert.ok(ui.hasText("Processing blocked"));
  assert.ok(ui.button("Download signed invoice XML"));
  assert.equal(ui.button("Download Hacienda receipt XML"), undefined);
  assert.equal(ui.button("Retry blocked invoice"), undefined);
  await ui.render({ ...initial, admin: true });
  await ui.press("Retry blocked invoice");
  assert.deepEqual(retries, [["clinic", "sale", "sandbox"]]);
  assert.ok(ui.button("Download Hacienda receipt XML"));
  assert.equal(ui.button("Retry blocked invoice"), undefined);
});
