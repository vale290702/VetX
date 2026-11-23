import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { screen } from "./support/native-screen.mjs";
const { ClinicBilling } = await import("../src/billing.tsx");
const sale = {
  id: "sale",
  number: "27",
  currency: "CRC",
  lines: [],
  subtotal: "8",
  tax: "0",
  total: "8",
  balance: "8",
  paid: "0",
  recordedAt: "2026-01-01T00:00:00Z",
  author: { issuer: "realm", subject: "Ada" },
};
const price = {
  id: "price",
  name: "Visit",
  stockItemId: null,
  unit: "visit",
  unitPrice: "1.25",
  taxRate: "0",
  currency: "CRC",
  cabys: "0123456789012",
  revision: 1,
};
const scope = { subject: "Ada", clinicId: "clinic", organizationId: "org" };
const account = { issuer: "realm", subject: "Ada", organizations: [] };
const empty = { page: 1, hasNextPage: false };
const props = (billing) => ({
  scope,
  account,
  client: { billing },
  styles: {},
  admin: true,
  back() {},
});
async function startCardPayment(ui) {
  await ui.press("Sales invoices");
  await ui.press("Open invoice 27");
  await ui.press("Record payment");
  await ui.press("Card");
  await ui.fill("Amount received (CRC)", "2.50");
  await ui.fill("External payment reference", "COUNTER-41");
  await ui.press("Record payment");
}
function paymentFixture() {
  const attempts = [];
  const payments = new Set();
  const api = {
    sales: async () => ({ ...empty, sales: [sale] }),
    sale: async () => sale,
    payments: async () => ({ ...empty, payments: [] }),
    pay: async (_scope, saleId, id, body) => {
      attempts.push({ saleId, id, body });
      if (!payments.has(id)) {
        payments.add(id);
        throw Error("response lost after payment committed");
      }
      return { id };
    },
  };
  return { store: { attempts, payments }, api, initial: props(api) };
}
test("a partially paid invoice retains the exact payment retry while the same verified clinic refreshes", async (t) => {
  const { store, api, initial } = paymentFixture();
  const ui = screen(t, ClinicBilling);
  await ui.render(initial);
  await startCardPayment(ui);
  assert.equal(store.attempts.length, 1);
  assert.ok(ui.button("Retry the same request"));
  const refresh = Promise.withResolvers();
  api.sale = () => refresh.promise;
  await ui.render({ ...initial, scope: { ...scope }, account: { ...account } });
  assert.equal(ui.button("Record payment"), undefined);
  assert.equal(ui.button("Retry the same request"), undefined);
  await act(async () => refresh.resolve({ ...sale, paid: "2.50", balance: "5.50" }));
  assert.ok(
    ui.button("Retry the same request"),
    "the unresolved payment survived the authorized refresh",
  );
  await ui.press("Retry the same request");
  assert.deepEqual(store.attempts[1], store.attempts[0]);
  assert.deepEqual(store.attempts[1].body, {
    method: "CARD",
    amount: "2.50",
    reference: "COUNTER-41",
    shiftId: null,
  });
  assert.equal(store.payments.size, 1);
});
test("a new clinic or account starts a fresh billing workspace without a previous payment attempt", async (t) => {
  const { store, initial } = paymentFixture();
  const ui = screen(t, ClinicBilling);
  await ui.render(initial);
  await startCardPayment(ui);
  assert.ok(ui.button("Retry the same request"));
  await ui.render({ ...initial, scope: { ...scope, clinicId: "other" } });
  assert.ok(ui.button("Sales invoices"));
  assert.equal(ui.button("Retry the same request"), undefined);
  await ui.render(initial);
  await startCardPayment(ui);
  await ui.render({ ...initial, account: { ...account, issuer: "other-issuer" } });
  assert.ok(ui.button("Sales invoices"));
  assert.equal(ui.button("Retry the same request"), undefined);
  assert.equal(store.attempts.length, 2);
});
test("an uncertain price save survives temporary grant verification and is discarded when admin access is revoked", async (t) => {
  const attempts = [],
    api = {
      prices: async () => ({ ...empty, prices: [price] }),
      price: async (_scope, id, body) => {
        attempts.push({ id, body });
        throw Error("response lost");
      },
    };
  const initial = props(api),
    ui = screen(t, ClinicBilling);
  await ui.render(initial);
  await ui.press("Price catalog");
  await ui.press("Edit price for Visit");
  await ui.fill("Unit price before tax", "2.75000");
  await ui.press("Save price");
  assert.equal(attempts.length, 1);
  assert.ok(ui.button("Retry the same request"));
  await ui.render({ ...initial, admin: undefined });
  assert.equal(ui.button("Retry the same request"), undefined);
  await ui.render({ ...initial, admin: true });
  await ui.press("Retry the same request");
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(attempts[1].body.unitPrice, "2.75000");
  await ui.render({ ...initial, admin: false });
  await ui.render(initial);
  assert.equal(ui.button("Retry the same request"), undefined);
  assert.ok(ui.button("Create price"));
});

test("an in-flight drawer opening inside a cash payment retains its request when the invoice refreshes", async (t) => {
  const { api, initial } = paymentFixture(),
    ui = screen(t, ClinicBilling),
    requests = [];
  api.shifts = async () => ({ ...empty, shifts: [] });
  api.open = async (_scope, id, body) => {
    requests.push({ id, body });
    if (requests.length === 1) throw Error("response lost");
    return { id, ...body, closedAt: null, cashier: account };
  };
  await ui.render(initial);
  await ui.press("Sales invoices");
  await ui.press("Open invoice 27");
  await ui.press("Record payment");
  await ui.press("Choose an open drawer in CRC");
  await ui.press("Open a cash drawer");
  await ui.fill("Drawer name", "Reception");
  await ui.fill("Opening float", "75");
  await ui.press("Open a cash drawer");
  assert.ok(ui.button("Retry the same request"));
  await ui.render({ ...initial, scope: { ...scope }, account: { ...account } });
  await ui.press("Retry the same request");
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[1].body.openingFloat, "75");
  assert.ok(ui.button("Drawer · Reception"));
});
test("an explicit denial clears an unresolved invoice payment before access is later restored", async (t) => {
  const { PatientError } = await import("../src/patient-transport.ts");
  const { store, api, initial } = paymentFixture(),
    ui = screen(t, ClinicBilling);
  await ui.render(initial);
  await startCardPayment(ui);
  assert.ok(ui.button("Retry the same request"));
  api.sale = async () => {
    throw new PatientError(403);
  };
  await ui.render({ ...initial, scope: { ...scope } });
  assert.equal(ui.button("Retry the same request"), undefined);
  api.sale = async () => sale;
  await ui.render({ ...initial, scope: { ...scope } });
  assert.ok(ui.button("Record payment"));
  await ui.press("Record payment");
  assert.equal(ui.button("Retry the same request"), undefined);
  assert.equal(ui.button("Record payment").disabled, true);
  assert.equal(store.attempts.length, 1);
});
