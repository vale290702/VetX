import assert from "node:assert/strict";
import { test } from "node:test";
import {
  remaining,
  orderBody,
  receiptBody,
  returnBody,
  prescriptionBody,
  dispenseBody,
  allowedActions,
  capabilityBody,
} from "../src/trade-forms.ts";
import { preserveAttempt } from "../src/inventory-forms.ts";
import { createTrade } from "../src/trade-client.ts";
import { createPatientTransport } from "../src/patient-transport.ts";

const line = {
  itemId: "i",
  itemName: "Supplies",
  unit: "u",
  quantity: "3.000",
  receivedQuantity: "0.500",
};
const purchaseLine = { itemId: "i", expectedUnit: "u", quantity: "3.000" };
const catalogItem = { id: "i", unit: "u" };
const delivery = { itemId: "i", warehouseId: "w", lot: " L ", quantity: "1,125" };
test("multi-item orders and split-lot receipts enforce exact cumulative quantities", () => {
  assert.equal(remaining("999999999999999.999", ["0.001", "1.230"]), "999999999999998.768");
  assert.deepEqual(orderBody("s", [{ itemId: "i", expectedUnit: "u", quantity: "0,001" }]), {
    supplierId: "s",
    lines: [{ itemId: "i", expectedUnit: "u", quantity: "0.001" }],
  });
  assert.equal(orderBody("s", [purchaseLine, purchaseLine]), undefined);
  assert.equal(orderBody("s", []), undefined);
  assert.equal(orderBody("s", [{ itemId: "i", quantity: "1", expectedUnit: "" }]), undefined);
  assert.equal(
    receiptBody([line], [delivery, { ...delivery, lot: "Y", quantity: "1.376" }]),
    undefined,
  );
  const partial = receiptBody([line], [delivery, { ...delivery, lot: "Y", quantity: "1.375" }]);
  assert.equal(partial.lines[0].lot, "L");
  assert.equal(partial.lines.length, 2);
  assert.equal(receiptBody([line], [{ ...delivery, itemId: "other" }]), undefined);
  assert.equal(returnBody("move", "1.9", "1", "2", "Reason"), undefined);
  assert.deepEqual(returnBody("move", "1,000", "1", "2", " Reason "), {
    receiptMovementId: "move",
    quantity: "1.000",
    reason: "Reason",
  });
});
test("dispensing is limited by both prescribed quantity and the selected lot balance", () => {
  assert.equal(prescriptionBody(catalogItem, "", "authored directions", "1"), undefined);
  assert.deepEqual(prescriptionBody(catalogItem, " M ", " directions\nfrom prescriber ", "2,01"), {
    itemId: "i",
    expectedUnit: "u",
    medication: "M",
    instructions: "directions\nfrom prescriber",
    quantity: "2.01",
  });
  assert.deepEqual(dispenseBody("w", "lot", "0,5", "0.5", "0.500"), {
    warehouseId: "w",
    lot: "lot",
    quantity: "0.5",
  });
  assert.equal(dispenseBody("w", "lot", "0.501", "0.5", "5"), undefined);
  assert.equal(dispenseBody("w", "lot", "0.501", "5", "0.5"), undefined);
});
test("only verified current account and clinic grants enable each pharmacy action", () => {
  const g = {
    subject: "staff",
    issuer: "realm",
    clinicAccess: true,
    canPrescribe: false,
    canDispense: true,
    revision: 3,
  };
  assert.deepEqual(allowedActions(g, "staff"), { prescribe: false, dispense: true });
  assert.deepEqual(allowedActions({ ...g, clinicAccess: false }, "staff"), {
    prescribe: false,
    dispense: false,
  });
  assert.deepEqual(allowedActions(g, "other"), { prescribe: false, dispense: false });
  assert.equal(capabilityBody(g, false, true), undefined);
  assert.deepEqual(capabilityBody(g, true, true), {
    canPrescribe: true,
    canDispense: true,
    revision: 3,
  });
  assert.equal(capabilityBody({ ...g, clinicAccess: false }, true, false), undefined);
  assert.deepEqual(capabilityBody({ ...g, clinicAccess: false }, false, false), {
    canPrescribe: false,
    canDispense: false,
    revision: 3,
  });
});
test("all 17 purchasing/pharmacy calls preserve verified clinic or pet scope, request IDs and exact bodies", async () => {
  const requests = [],
    signal = new AbortController().signal,
    scope = { organizationId: "org", clinicId: "c", subject: "staff" };
  const s = {
    forAccount: (sub, w) => {
      assert.equal(sub, "owner");
      return w("owner-token", signal);
    },
    forOrganization: (sub, org, w) => {
      assert.equal(sub, "staff");
      assert.equal(org, "org");
      return w("staff-token", signal);
    },
  };
  const trade = createTrade(
    createPatientTransport(s, "https://vet.test", async (url, init) => {
      assert.equal(init.signal, signal);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      requests.push(new Request(url, init));
      return Response.json({});
    }),
  );
  const grant = { canPrescribe: true, canDispense: false, revision: 2 },
    sharing = { revision: 3, guardianIds: ["g"] },
    rx = prescriptionBody(catalogItem, "M", "Authored", "3");
  await trade.suppliers(scope, 2);
  await trade.saveSupplier(scope, "s", { name: "Supplier", revision: 0 });
  await trade.orders(scope, 3);
  await trade.order(scope, "o", orderBody("s", [purchaseLine]));
  await trade.receipts(scope, "o", 2);
  await trade.receive(scope, "o", "r", receiptBody([line], [delivery]));
  await trade.returns(scope, "o", 4);
  await trade.returnStock(scope, "o", "ret", returnBody("movement", "1", "1", "1", "reason"));
  await trade.me(scope);
  await trade.grants(scope, 5);
  await trade.grant(scope, "staff:two", grant);
  await trade.prescriptions(scope, "patient", 2);
  await trade.prescribe(scope, "patient", "rx", rx);
  await trade.dispensings(scope, "patient", "rx", 2);
  await trade.dispense(scope, "patient", "rx", "d", dispenseBody("w", "lot", "1", "3", "3"));
  await trade.share(scope, "patient", "rx", sharing);
  await trade.owner("owner", "pet", 7);
  const paths = requests.map((r) =>
    r.url
      .replace("https://vet.test/organizations/org/clinics/c/", "")
      .replace("https://vet.test/", ""),
  );
  assert.deepEqual(paths, [
    "purchasing/suppliers?page=2",
    "purchasing/suppliers/s",
    "purchasing/orders?page=3",
    "purchasing/orders/o",
    "purchasing/orders/o/receipts?page=2",
    "purchasing/orders/o/receipts/r",
    "purchasing/orders/o/returns?page=4",
    "purchasing/orders/o/returns/ret",
    "pharmacy/me",
    "pharmacy/capabilities?page=5",
    "pharmacy/capabilities/staff%3Atwo",
    "patients/patient/prescriptions?page=2",
    "patients/patient/prescriptions/rx",
    "patients/patient/prescriptions/rx/dispensings?page=2",
    "patients/patient/prescriptions/rx/dispensings/d",
    "patients/patient/prescriptions/rx/sharing",
    "owner/pets/pet/prescriptions?page=7",
  ]);
  assert.ok(
    requests.slice(0, -1).every((r) => r.headers.get("Authorization") === "Bearer staff-token"),
  );
  assert.equal(requests.at(-1).headers.get("Authorization"), "Bearer owner-token");
  assert.deepEqual((await requests[3].json()).lines, [purchaseLine]);
  assert.deepEqual(await requests[10].json(), grant);
  assert.deepEqual(await requests[12].json(), rx);
  assert.deepEqual(await requests[15].json(), sharing);
});

test("return history resolves the actual receipt movement and its lot across pages", async () => {
  const { receiptMovements, warehouseLabels } = await import("../src/trade-labels.ts");
  const pages = [];
  const matches = await receiptMovements(["m2"], async (page) => {
    pages.push(page);
    return {
      receipts: [
        { lines: [{ movementId: "m" + page, lot: "LOT" + page, warehouseId: "w" + page }] },
      ],
      hasNextPage: page < 8,
    };
  });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(matches.get("m2").lot, "LOT2");
  const names = await warehouseLabels(["w2"], async (page) => ({
    warehouses: [{ id: "w" + page, name: "Store " + page }],
    hasNextPage: page < 8,
  }));
  assert.equal(names.get("w2"), "Store 2");
});

test("sharing refresh reloads current recipients and guardians after a prescription moves to another page", async () => {
  const { readRxRecipients } = await import("../src/pharmacy-read.ts");
  const scope = { subject: "s", organizationId: "o", clinicId: "c" },
    pages = [];
  let rev = 3,
    grant = true;
  const client = {
    detail: async () => ({ guardians: [{ id: "g" + rev, linked: true }] }),
    trade: {
      me: async () => ({ subject: "s", clinicAccess: true, canPrescribe: grant }),
      prescriptions: async (_scope, _patient, page) => {
        pages.push(page);
        return {
          prescriptions:
            page === 1 ? [{ id: "rx", sharing: { revision: rev, guardianIds: ["g" + rev] } }] : [],
          hasNextPage: page === 1,
        };
      },
    },
  };
  const initial = await readRxRecipients(client, scope, "patient", "rx", 2);
  assert.equal(initial.rx.sharing.revision, 3);
  rev = 4;
  const fresh = await readRxRecipients(client, scope, "patient", "rx", 2);
  assert.deepEqual(fresh.rx.sharing.guardianIds, ["g4"]);
  assert.equal(fresh.guardians[0].id, "g4");
  assert.deepEqual(pages, [2, 1, 2, 1]);
  grant = false;
  await assert.rejects(
    readRxRecipients(client, scope, "patient", "rx", 2),
    (e) => e.status === 403,
  );
  assert.equal(pages.length, 4);
});

test("purchase and prescription retries retain the original displayed unit even after the catalog changes", () => {
  const initial = preserveAttempt(
    undefined,
    "purchase",
    orderBody("supplier", [{ itemId: "i", quantity: "1", expectedUnit: "box" }]),
  );
  const edited = orderBody("supplier", [{ itemId: "i", quantity: "2", expectedUnit: "each" }]);
  assert.deepEqual(preserveAttempt(initial, "new", edited), {
    id: "purchase",
    body: { supplierId: "supplier", lines: [{ itemId: "i", quantity: "1", expectedUnit: "box" }] },
  });
  const rx = preserveAttempt(
    undefined,
    "rx",
    prescriptionBody({ id: "i", unit: "box" }, "Medication", "Written instructions", "1"),
  );
  const retry = preserveAttempt(
    rx,
    "other",
    prescriptionBody({ id: "i", unit: "each" }, "Medication", "Written instructions", "1"),
  );
  assert.equal(retry.id, "rx");
  assert.equal(retry.body.expectedUnit, "box");
});
