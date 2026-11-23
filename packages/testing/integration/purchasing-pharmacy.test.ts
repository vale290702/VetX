import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PrismaDatabase } from "@vetx/database";
import { startTestDatabase } from "./postgres.ts";

const admin = { kind: "staff" as const, issuer: "https://identity.test", subject: "admin" };
const clinician = { ...admin, subject: "clinician" },
  pharmacist = { ...admin, subject: "pharmacy" };
const owner = {
  kind: "owner" as const,
  issuer: admin.issuer,
  subject: "guardian",
  verifiedEmail: "family@example.test",
};
const otherOwner = { ...owner, subject: "second-family", verifiedEmail: "second@example.test" };

test(
  "purchasing, pharmacy grants, signed prescriptions and released owner records on PostgreSQL",
  { timeout: 120000 },
  async (t) => {
    const { database, runtimeUrl, migrationUrl } = await startTestDatabase(t);
    const sql = new pg.Client({ connectionString: database.getConnectionUri() }),
      db = new PrismaDatabase(runtimeUrl);
    await sql.connect();
    try {
      const org = randomUUID(),
        clinic = randomUUID(),
        neighbor = randomUUID(),
        room = randomUUID(),
        item = randomUUID(),
        secondary = randomUUID(),
        supplier = randomUUID(),
        patient = randomUUID(),
        order = randomUUID(),
        rx = randomUUID();
      await sql.query("INSERT INTO organizations(id,name) VALUES ($1,'North')", [org]);
      await sql.query(
        "INSERT INTO clinics(id,organization_id,name) VALUES ($1,$3,'Clinic'),($2,$3,'Other')",
        [clinic, neighbor, org],
      );
      const {
        rows: [user],
      } = await sql.query(
        "INSERT INTO users(identity_issuer,identity_subject) VALUES($1,$2) RETURNING id",
        [admin.issuer, admin.subject],
      );
      await sql.query("INSERT INTO organization_memberships VALUES($1,$2,'ADMIN')", [org, user.id]);
      await db.saveMember(admin, org, clinician.subject, "STAFF", [clinic], 0);
      await db.saveMember(admin, org, pharmacist.subject, "STAFF", [clinic], 1);
      await db.savePatient(admin, org, clinic, patient, {
        name: "Patient",
        species: "Feline",
        birthDate: null,
        revision: 0,
      });
      await db.saveWarehouse(admin, org, clinic, room, { name: "Pharmacy", revision: 0 });
      const product = { name: "Catalog item", unit: "units", sku: "CAT", revision: 0 };
      await db.saveStockItem(admin, org, clinic, item, product);
      await db.saveStockItem(admin, org, clinic, secondary, {
        ...product,
        name: "Second item",
        sku: "TWO",
      });
      const signed = {
        itemId: item,
        expectedUnit: product.unit,
        medication: "Clinician-entered medication",
        instructions: "Directions recorded by the clinician.",
        quantity: "3",
      };
      const line = { itemId: item, warehouseId: room, lot: "L", quantity: "1.000" };
      const patientRx = (id = rx) => db.prescribe(clinician, org, clinic, patient, id, signed);
      const post = (id: string, lines: (typeof line)[]) =>
        db.receivePurchaseOrder(pharmacist, org, clinic, order, id, { lines });
      const balance = () => db.listStockBalances(admin, org, clinic, room, 1);
      let receiptMovement = "";

      await t.test(
        "purchase authorship, partial receipts, lot quantities, rollback and concurrent retries",
        async () => {
          await assert.rejects(
            db.saveSupplier(pharmacist, org, clinic, supplier, { name: "Vendor", revision: 0 }),
            { code: "forbidden" },
          );
          await db.saveSupplier(admin, org, clinic, supplier, { name: "Vendor", revision: 0 });
          await assert.rejects(
            db.saveSupplier(admin, org, clinic, randomUUID(), { name: " vendor ", revision: 0 }),
            { code: "conflict" },
          );
          assert.deepEqual((await db.listSuppliers(pharmacist, org, clinic, 1)).suppliers, [
            { id: supplier, name: "Vendor", revision: 1 },
          ]);
          const input = {
            supplierId: supplier,
            lines: [
              { itemId: item, quantity: "5", expectedUnit: product.unit },
              { itemId: secondary, quantity: "2.125", expectedUnit: product.unit },
            ],
          };
          const created = await db.createPurchaseOrder(pharmacist, org, clinic, order, input);
          assert.equal(created.status, "OPEN");
          assert.equal(created.author.subject, pharmacist.subject);
          assert.deepEqual(
            created.lines.map((l) => [l.quantity, l.receivedQuantity]),
            [
              ["5.000", "0.000"],
              ["2.125", "0.000"],
            ],
          );
          assert.deepEqual(
            await db.createPurchaseOrder(pharmacist, org, clinic, order, input),
            created,
          );
          await assert.rejects(db.createPurchaseOrder(clinician, org, clinic, order, input), {
            code: "conflict",
          });
          await assert.rejects(
            db.saveStockItem(admin, org, clinic, item, {
              ...product,
              unit: "bottles",
              revision: 1,
            }),
            { code: "conflict" },
          );
          await assert.rejects(
            db.createPurchaseOrder(pharmacist, org, clinic, randomUUID(), {
              ...input,
              lines: [input.lines[0]!, input.lines[0]!],
            }),
            { code: "invalid" },
          );
          await assert.rejects(
            post(randomUUID(), [line, { ...line, itemId: secondary, quantity: "3" }]),
            { code: "conflict" },
          );
          await assert.rejects(post(randomUUID(), [line, { ...line, warehouseId: randomUUID() }]), {
            code: "not_found",
          });
          assert.deepEqual((await balance()).balances, []);
          assert.deepEqual(
            (await db.listPurchaseReceipts(pharmacist, org, clinic, order, 1)).receipts,
            [],
          );
          const id = randomUUID(),
            lines = [line, { ...line, itemId: secondary, quantity: "2.125", lot: "SECOND" }];
          const [left, right] = await Promise.all([post(id, lines), post(id, lines)]);
          assert.deepEqual(left, right);
          receiptMovement = left.lines[0]!.movementId;
          assert.deepEqual(
            left.lines.map((l) => [l.lot, l.quantity]),
            [
              ["L", "1.000"],
              ["SECOND", "2.125"],
            ],
          );
          await assert.rejects(
            db.receivePurchaseOrder(clinician, org, clinic, order, id, { lines }),
            { code: "conflict" },
          );
          await assert.rejects(post(id, [line]), { code: "conflict" });
          assert.equal(
            (await db.listPurchaseOrders(pharmacist, org, clinic, 1)).orders[0]?.status,
            "PARTIALLY_RECEIVED",
          );
          const race = await Promise.allSettled([
            post(randomUUID(), [{ ...line, quantity: "4" }]),
            post(randomUUID(), [{ ...line, quantity: "4" }]),
          ]);
          assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
          assert.equal(race.find((r) => r.status === "rejected")?.reason.code, "conflict");
          assert.equal(
            (await db.listPurchaseOrders(pharmacist, org, clinic, 1)).orders[0]?.status,
            "RECEIVED",
          );
          assert.equal(
            (await db.listStockMovements(pharmacist, org, clinic, 1)).movements.length,
            3,
          );
        },
      );

      await t.test(
        "supplier returns are limited by the specific receipt and stock on hand",
        async () => {
          const id = randomUUID(),
            input = {
              receiptMovementId: receiptMovement,
              quantity: "0.750",
              reason: "Damaged delivery",
            };
          const ret = await db.returnPurchaseStock(pharmacist, org, clinic, order, id, input);
          assert.notEqual(ret.movementId, receiptMovement);
          const ledger = (await db.listStockMovements(pharmacist, org, clinic, 1)).movements;
          assert.equal(ledger.find((m) => m.id === receiptMovement)?.unit, product.unit);
          assert.equal(ledger.find((m) => m.id === ret.movementId)?.unit, product.unit);
          assert.equal(ret.author.subject, pharmacist.subject);
          assert.deepEqual(
            await db.returnPurchaseStock(pharmacist, org, clinic, order, id, input),
            ret,
          );
          await assert.rejects(
            db.returnPurchaseStock(pharmacist, org, clinic, order, randomUUID(), {
              ...input,
              quantity: "0.251",
            }),
            { code: "conflict" },
          );
          await assert.rejects(
            db.returnPurchaseStock(pharmacist, org, clinic, randomUUID(), randomUUID(), input),
            { code: "not_found" },
          );
          assert.deepEqual(
            (await db.listSupplierReturns(pharmacist, org, clinic, order, 1)).returns,
            [ret],
          );
          assert.equal(
            (await balance()).balances.find((b) => b.itemId === item)?.quantity,
            "4.250",
          );
          await assert.rejects(post(randomUUID(), [line]), { code: "conflict" });
        },
      );

      await t.test(
        "clinic membership and individual prescribing or dispensing permission are independently required",
        async () => {
          assert.equal((await db.getPharmacyCapability(admin, org, clinic)).canPrescribe, false);
          await assert.rejects(db.prescribe(admin, org, clinic, patient, rx, signed), {
            code: "forbidden",
          });
          await assert.rejects(patientRx(), { code: "forbidden" });
          const grants = { canPrescribe: true, canDispense: false, revision: 0 };
          await assert.rejects(
            db.savePharmacyCapability(clinician, org, clinic, clinician.subject, grants),
            { code: "forbidden" },
          );
          await assert.rejects(db.listPharmacyCapabilities(pharmacist, org, clinic, 1), {
            code: "forbidden",
          });
          await db.savePharmacyCapability(admin, org, clinic, clinician.subject, grants);
          await db.savePharmacyCapability(admin, org, clinic, pharmacist.subject, {
            ...grants,
            canPrescribe: false,
            canDispense: true,
          });
          const caps = (await db.listPharmacyCapabilities(admin, org, clinic, 1)).capabilities;
          assert.deepEqual(
            caps.filter((c) => c.canPrescribe).map((c) => c.subject),
            [clinician.subject],
          );
          assert.deepEqual(
            caps.filter((c) => c.canDispense).map((c) => c.subject),
            [pharmacist.subject],
          );
          const original = await patientRx();
          assert.deepEqual(original.sharing, { guardianIds: [], revision: 0 });
          assert.equal(original.quantity, "3.000");
          assert.equal(original.dispensedQuantity, "0.000");
          assert.deepEqual(original.author, {
            issuer: clinician.issuer,
            subject: clinician.subject,
          });
          assert.deepEqual(await patientRx(), original);
          await assert.rejects(
            db.prescribe(clinician, org, clinic, patient, rx, {
              ...signed,
              instructions: "Different",
            }),
            { code: "conflict" },
          );
          await assert.rejects(
            db.prescribe(pharmacist, org, clinic, patient, randomUUID(), signed),
            { code: "forbidden" },
          );
          await assert.rejects(
            db.prescribe(clinician, org, neighbor, patient, randomUUID(), signed),
            { code: "forbidden" },
          );
          await assert.rejects(
            db.dispensePrescription(clinician, org, clinic, patient, rx, randomUUID(), {
              warehouseId: room,
              lot: "L",
              quantity: "1",
            }),
            { code: "forbidden" },
          );
        },
      );

      await t.test(
        "dispense remains within both authorization and stock, with immutable attributable events",
        async () => {
          const one = { warehouseId: room, lot: "L", quantity: "1.250" };
          const dispense = (id: string, amount = one.quantity) =>
            db.dispensePrescription(pharmacist, org, clinic, patient, rx, id, {
              ...one,
              quantity: amount,
            });
          await assert.rejects(
            db.dispensePrescription(pharmacist, org, clinic, patient, rx, randomUUID(), {
              ...one,
              lot: "missing lot",
            }),
            { code: "conflict" },
          );
          await assert.rejects(
            db.dispensePrescription(pharmacist, org, clinic, randomUUID(), rx, randomUUID(), one),
            { code: "not_found" },
          );
          const id = randomUUID();
          const [a, b] = await Promise.all([dispense(id), dispense(id)]);
          assert.deepEqual(a, b);
          assert.equal(a.author.subject, pharmacist.subject);
          assert.equal(
            (await db.listStockMovements(pharmacist, org, clinic, 1)).movements.find(
              (m) => m.id === a.movementId,
            )?.unit,
            product.unit,
          );
          const race = await Promise.allSettled([
            dispense(randomUUID(), "1.750"),
            dispense(randomUUID(), "1.750"),
          ]);
          assert.equal(race.filter((v) => v.status === "fulfilled").length, 1);
          assert.equal(race.find((r) => r.status === "rejected")?.reason.code, "conflict");
          assert.equal(
            (await db.listPrescriptions(clinician, org, clinic, patient, 1)).prescriptions[0]
              ?.dispensedQuantity,
            "3.000",
          );
          assert.equal(
            (await db.listDispensings(pharmacist, org, clinic, patient, rx, 1)).dispensings.length,
            2,
          );
          assert.equal(
            (await balance()).balances.find((b) => b.itemId === item)?.quantity,
            "1.250",
          );
          assert.deepEqual(await dispense(id), a);
          await db.savePharmacyCapability(admin, org, clinic, pharmacist.subject, {
            canPrescribe: false,
            canDispense: false,
            revision: 1,
          });
          await assert.rejects(dispense(id), { code: "forbidden" });
          await db.saveMember(admin, org, clinician.subject, "STAFF", [neighbor], 2);
          await assert.rejects(patientRx(randomUUID()), { code: "forbidden" });
          assert.equal(
            (await db.getPharmacyCapability(clinician, org, neighbor)).canPrescribe,
            false,
          );
          assert.equal(
            (await db.listPharmacyCapabilities(admin, org, clinic, 1)).capabilities.find(
              (c) => c.subject === clinician.subject,
            )?.clinicAccess,
            false,
          );
          await db.saveMember(admin, org, clinician.subject, "STAFF", [clinic], 3);
          assert.equal((await db.getPharmacyCapability(clinician, org, clinic)).canPrescribe, true);
        },
      );

      await t.test(
        "only an explicitly released prescription reaches its active guardian, without staff identity or dispensing history",
        async () => {
          async function link(identity: typeof owner) {
            const guardian = randomUUID(),
              digest = createHash("sha256").update(randomUUID()).digest("hex");
            await db.addGuardian(admin, org, clinic, patient, guardian, {
              name: "Guardian",
              email: identity.verifiedEmail,
            });
            await db.issuePetLink(admin, org, clinic, patient, guardian, {
              digest,
              requestId: randomUUID(),
              lifetimeSeconds: 600,
            });
            const { petId } = await db.redeemPetLink(identity, {
              digest,
              requestId: randomUUID(),
              attemptLimit: 5,
              windowSeconds: 60,
            });
            return { guardian, petId };
          }
          const first = await link(owner),
            second = await link(otherOwner),
            privateRx = await patientRx(randomUUID());
          assert.notEqual(privateRx.id, rx);
          const list = () => db.listOwnerPrescriptions(owner, first.petId, 1);
          assert.deepEqual((await list()).prescriptions, []);
          await assert.rejects(
            db.sharePrescription(pharmacist, org, clinic, patient, rx, {
              guardianIds: [first.guardian],
              revision: 0,
            }),
            { code: "forbidden" },
          );
          const release = await db.sharePrescription(clinician, org, clinic, patient, rx, {
            guardianIds: [first.guardian],
            revision: 0,
          });
          assert.equal(release.revision, 1);
          const scope = { organizationId: org, clinicId: clinic, patientId: patient };
          const select = {
            prescriptionIds: [rx],
            encounterIds: [],
            documentAssetIds: [],
            includeOwner: false,
          };
          const destination = { organizationId: randomUUID(), clinicId: randomUUID() };
          const choices = await db.ownerExportChoices(owner, first.petId, scope, 1);
          assert.ok(choices.records.some((c) => c.id === rx && c.kind === "prescription"));
          const snapshot = await db.ownerExportSource(owner, first.petId, scope, select);
          assert.deepEqual(snapshot.prescriptions?.[0]?.data, {
            medication: signed.medication,
            instructions: signed.instructions,
            quantity: "3.000",
            unit: "units",
          });
          assert.equal(snapshot.prescriptions?.[0]?.author.subject, clinician.subject);
          assert.deepEqual(
            await db.confirmOwnerExport(
              owner,
              first.petId,
              scope,
              select,
              destination,
              randomUUID(),
            ),
            { ok: true },
          );
          await assert.rejects(db.ownerExportSource(otherOwner, second.petId, scope, select), {
            code: "not_found",
          });
          const visible = (await list()).prescriptions;
          assert.equal(visible.length, 1);
          assert.deepEqual(visible[0], {
            id: rx,
            patientId: patient,
            clinicId: clinic,
            clinicName: "Clinic",
            organizationName: "North",
            medication: signed.medication,
            instructions: signed.instructions,
            quantity: "3.000",
            unit: "units",
            recordedAt: visible[0]!.recordedAt,
          });
          assert.deepEqual(
            (await db.listOwnerPrescriptions(otherOwner, second.petId, 1)).prescriptions,
            [],
          );
          await assert.rejects(db.listOwnerPrescriptions(otherOwner, first.petId, 1), {
            code: "not_found",
          });
          await db.sharePrescription(clinician, org, clinic, patient, rx, {
            guardianIds: [],
            revision: 1,
          });
          assert.deepEqual((await list()).prescriptions, []);
          await assert.rejects(
            db.confirmOwnerExport(owner, first.petId, scope, select, destination, randomUUID()),
            { code: "not_found" },
          );
          await db.sharePrescription(clinician, org, clinic, patient, rx, {
            guardianIds: [first.guardian],
            revision: 2,
          });
          await db.removeGuardian(admin, org, clinic, patient, first.guardian);
          await assert.rejects(list(), { code: "not_found" });
        },
      );
      await t.test(
        "authenticated HTTP entry points perform a purchase, partial receipt, prescription and dispense on the restricted database",
        async () => {
          const { createApplication } = await import(
            new URL("../../../apps/api/dist/application.js", import.meta.url).href
          );
          const sessions = new Map<string, typeof admin>([
            ["admin.test.token", admin],
            ["doctor.test.token", clinician],
            ["pharmacy.test.token", pharmacist],
          ]);
          const app = await createApplication(db, false, {
            procurement: db,
            tokenVerifier: { verify: async (token: string) => sessions.get(token) },
          });
          try {
            await app.listen(0, "127.0.0.1");
            const url = await app.getUrl(),
              base = "/organizations/" + org + "/clinics/" + clinic;
            const call = (token: string, path: string, data?: unknown) =>
              fetch(url + base + path, {
                method: data === undefined ? "GET" : "PUT",
                headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
                body: data === undefined ? undefined : JSON.stringify(data),
              });
            const purchase = "/purchasing/orders/" + randomUUID();
            assert.equal(
              (
                await call("pharmacy.test.token", purchase, {
                  supplierId: supplier,
                  lines: [{ itemId: item, quantity: "1.500", expectedUnit: product.unit }],
                })
              ).status,
              200,
            );
            const receipt = await call(
              "pharmacy.test.token",
              purchase + "/receipts/" + randomUUID(),
              { lines: [{ ...line, lot: "HTTP", quantity: "1" }] },
            );
            assert.equal(receipt.status, 200);
            const id = randomUUID(),
              path = "/patients/" + patient + "/prescriptions/" + id;
            assert.equal(
              (await call("doctor.test.token", path, { ...signed, quantity: "1" })).status,
              200,
            );
            const dispensePath = path + "/dispensings/" + randomUUID(),
              input = { warehouseId: room, lot: "HTTP", quantity: "1" };
            assert.equal((await call("pharmacy.test.token", dispensePath, input)).status, 403);
            assert.equal(
              (
                await call("admin.test.token", "/pharmacy/capabilities/" + pharmacist.subject, {
                  canPrescribe: false,
                  canDispense: true,
                  revision: 2,
                })
              ).status,
              200,
            );
            const done = await call("pharmacy.test.token", dispensePath, input);
            assert.equal(done.status, 200);
            assert.equal((await done.json()).author.subject, pharmacist.subject);
            assert.equal(
              (await call("pharmacy.test.token", path + "/dispensings/" + randomUUID(), input))
                .status,
              409,
            );
          } finally {
            await app.close();
          }
        },
      );
      await t.test(
        "catalog unit changes invalidate an open draft and saved units bind retries",
        async () => {
          const purchaseItem = randomUUID(),
            prescriptionItem = randomUUID(),
            draftedOrder = randomUUID(),
            draftedRx = randomUUID();
          for (const [id, sku] of [
            [purchaseItem, "DRAFT-ORDER"],
            [prescriptionItem, "DRAFT-RX"],
          ] as const) {
            await db.saveStockItem(admin, org, clinic, id, { ...product, sku, unit: "boxes" });
            await db.saveStockItem(admin, org, clinic, id, {
              ...product,
              sku,
              unit: "vials",
              revision: 1,
            });
          }
          const orderDraft = (expectedUnit: string) =>
            db.createPurchaseOrder(pharmacist, org, clinic, draftedOrder, {
              supplierId: supplier,
              lines: [
                { itemId: item, quantity: "1", expectedUnit: product.unit },
                { itemId: purchaseItem, quantity: "2", expectedUnit },
              ],
            });
          const rxDraft = (expectedUnit: string) =>
            db.prescribe(clinician, org, clinic, patient, draftedRx, {
              ...signed,
              itemId: prescriptionItem,
              expectedUnit,
            });
          await assert.rejects(orderDraft(""), { code: "invalid" });
          await assert.rejects(rxDraft(""), { code: "invalid" });
          await assert.rejects(orderDraft("boxes"), { code: "conflict" });
          await assert.rejects(rxDraft("boxes"), { code: "conflict" });
          assert.equal(
            (await db.listPurchaseOrders(admin, org, clinic, 1)).orders.some(
              (o) => o.id === draftedOrder,
            ),
            false,
          );
          assert.equal(
            (await db.listPrescriptions(clinician, org, clinic, patient, 1)).prescriptions.some(
              (r) => r.id === draftedRx,
            ),
            false,
          );
          const untouched = randomUUID();
          await db.saveStockItem(admin, org, clinic, untouched, {
            ...product,
            sku: "DRAFT-UNUSED",
          });
          const projectedLocks = async () => {
            const { items } = await db.listStockItems(pharmacist, org, clinic, "DRAFT-", 1);
            return [purchaseItem, prescriptionItem, untouched].map(
              (id) => items.find((row) => row.id === id)?.unitLocked,
            );
          };
          assert.deepEqual(await projectedLocks(), [false, false, false]);
          const savedOrder = await orderDraft("vials"),
            savedRx = await rxDraft("vials");
          // These items have an order or signed prescription and no ledger movement.
          assert.deepEqual(await projectedLocks(), [true, true, false]);
          assert.equal(savedOrder.lines[1]!.unit, "vials");
          assert.equal("expectedUnit" in savedOrder.lines[1]!, false);
          assert.equal(savedRx.unit, "vials");
          assert.equal("expectedUnit" in savedRx, false);
          assert.deepEqual(await orderDraft("vials"), savedOrder);
          assert.deepEqual(await rxDraft("vials"), savedRx);
          await assert.rejects(orderDraft("boxes"), { code: "conflict" });
          await assert.rejects(rxDraft("boxes"), { code: "conflict" });
          for (const [id, sku] of [
            [purchaseItem, "DRAFT-ORDER"],
            [prescriptionItem, "DRAFT-RX"],
          ] as const) {
            await assert.rejects(
              db.saveStockItem(admin, org, clinic, id, {
                ...product,
                sku,
                unit: "boxes",
                revision: 2,
              }),
              { code: "conflict" },
            );
          }
        },
      );
      await t.test(
        "a concurrent catalog unit edit and first procurement use cannot both commit",
        async () => {
          for (const operation of ["order", "prescription"] as const) {
            const itemId = randomUUID(),
              sku = "RACE-" + operation;
            await db.saveStockItem(admin, org, clinic, itemId, { ...product, sku });
            const submit =
              operation === "order"
                ? db.createPurchaseOrder(pharmacist, org, clinic, randomUUID(), {
                    supplierId: supplier,
                    lines: [{ itemId, quantity: "2", expectedUnit: product.unit }],
                  })
                : db.prescribe(clinician, org, clinic, patient, randomUUID(), {
                    ...signed,
                    itemId,
                  });
            const [use, edit] = await Promise.allSettled([
              submit,
              db.saveStockItem(admin, org, clinic, itemId, {
                ...product,
                sku,
                unit: "boxes",
                revision: 1,
              }),
            ]);
            assert.equal([use, edit].filter((result) => result.status === "fulfilled").length, 1);
            assert.equal(
              [use, edit].find((result) => result.status === "rejected")?.reason.code,
              "conflict",
            );
            const catalog = await db.listStockItems(admin, org, clinic, sku, 1);
            assert.equal(
              catalog.items[0]?.unit,
              use.status === "fulfilled" ? product.unit : "boxes",
            );
          }
        },
      );
      await t.test(
        "multi-line orders and receipts can wait for a clinic write past the probe deadline",
        async () => {
          const input = {
            supplierId: supplier,
            lines: [item, secondary].map((itemId) => ({
              itemId,
              quantity: "1",
              expectedUnit: product.unit,
            })),
          };
          const original = await db.createPurchaseOrder(
            pharmacist,
            org,
            clinic,
            randomUUID(),
            input,
          );
          await sql.query("BEGIN");
          try {
            await sql.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [org]);
            const writes = Promise.allSettled([
              db.createPurchaseOrder(pharmacist, org, clinic, randomUUID(), input),
              db.receivePurchaseOrder(pharmacist, org, clinic, original.id, randomUUID(), {
                lines: [item, secondary].map((itemId) => ({ ...line, itemId })),
              }),
            ]);
            // The ordinary connection has a one-second statement timeout. Both writes
            // must survive a held organization lock using the bounded bulk pool.
            await sql.query("SELECT pg_sleep(1.4)");
            await sql.query("COMMIT");
            for (const result of await writes) {
              if (result.status === "rejected") throw result.reason;
              assert.equal(result.value.lines.length, 2);
            }
          } catch (error) {
            await sql.query("ROLLBACK");
            throw error;
          }
        },
      );
      await t.test(
        "a full receipt can split a single ordered item across one hundred distinct lots",
        async () => {
          const orderId = randomUUID(),
            receiptId = randomUUID();
          await db.createPurchaseOrder(pharmacist, org, clinic, orderId, {
            supplierId: supplier,
            lines: [{ itemId: secondary, quantity: "1", expectedUnit: product.unit }],
          });
          const lines = Array.from({ length: 100 }, (_, i) => ({
            itemId: secondary,
            warehouseId: room,
            lot: "batch-" + i,
            quantity: "0.010",
          }));
          const result = await db.receivePurchaseOrder(
            pharmacist,
            org,
            clinic,
            orderId,
            receiptId,
            { lines },
          );
          assert.equal(result.lines.length, 100);
          assert.equal(new Set(result.lines.map((l) => l.movementId)).size, 100);
          assert.deepEqual(
            await db.receivePurchaseOrder(pharmacist, org, clinic, orderId, receiptId, { lines }),
            result,
          );
        },
      );
      await t.test(
        "credit, stock and clinical records cannot cross a clinic or organization boundary",
        async () => {
          const remoteOrg = randomUUID(),
            remoteClinic = randomUUID();
          await sql.query("INSERT INTO organizations(id,name) VALUES ($1,'West')", [remoteOrg]);
          await sql.query("INSERT INTO clinics(id,organization_id,name) VALUES ($1,$2,'West')", [
            remoteClinic,
            remoteOrg,
          ]);
          await sql.query("INSERT INTO organization_memberships VALUES ($1,$2,'ADMIN')", [
            remoteOrg,
            user.id,
          ]);
          const input = {
            supplierId: supplier,
            lines: [{ itemId: item, quantity: "1", expectedUnit: product.unit }],
          };
          await assert.rejects(
            db.createPurchaseOrder(admin, remoteOrg, remoteClinic, order, input),
            { code: "not_found" },
          );
          await assert.rejects(
            db.receivePurchaseOrder(admin, org, neighbor, order, randomUUID(), { lines: [line] }),
            { code: "not_found" },
          );
          await assert.rejects(db.listPrescriptions(admin, remoteOrg, remoteClinic, patient, 1), {
            code: "not_found",
          });
          assert.deepEqual(
            (await db.listPurchaseOrders(admin, remoteOrg, remoteClinic, 1)).orders,
            [],
          );
          await assert.rejects(
            db.listPurchaseReceipts(pharmacist, remoteOrg, remoteClinic, order, 1),
            { code: "forbidden" },
          );
          const runtime = new pg.Client({ connectionString: runtimeUrl });
          await runtime.connect();
          try {
            for (const tbl of [
              "trade_suppliers",
              "purchase_orders",
              "purchase_lines",
              "purchase_receipts",
              "purchase_receipt_lines",
              "supplier_returns",
              "pharmacy_capabilities",
              "patient_prescriptions",
              "prescription_sharing",
              "prescription_dispensings",
              "pharmacy_events",
            ]) {
              for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"])
                assert.equal(
                  (
                    await runtime.query(
                      "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
                      [tbl, privilege],
                    )
                  ).rows[0].allowed,
                  false,
                );
            }
            await sql.query("ALTER TABLE prescription_dispensings NO FORCE ROW LEVEL SECURITY");
            try {
              await assert.rejects(
                db.getPharmacyCapability(clinician, org, clinic),
                /row security/i,
              );
            } finally {
              await sql.query("ALTER TABLE prescription_dispensings FORCE ROW LEVEL SECURITY");
            }
            const migration = new pg.Client({ connectionString: migrationUrl });
            await migration.connect();
            try {
              await migration.query("BEGIN");
              await migration.query(
                "SELECT set_config('vetx.client_kind','staff',true),set_config('vetx.organization_id',$1,true),set_config('vetx.clinic_id',$2,true),set_config('vetx.identity_issuer',$3,true),set_config('vetx.identity_subject',$4,true)",
                [org, clinic, clinician.issuer, clinician.subject],
              );
              assert.equal(
                (await migration.query("SELECT FROM patient_prescriptions WHERE id=$1", [rx]))
                  .rowCount,
                1,
              );
              assert.equal(
                (
                  await migration.query(
                    "UPDATE patient_prescriptions SET instructions='altered' WHERE id=$1",
                    [rx],
                  )
                ).rowCount,
                0,
              );
              assert.equal(
                (
                  await migration.query(
                    "DELETE FROM prescription_dispensings WHERE prescription_id=$1",
                    [rx],
                  )
                ).rowCount,
                0,
              );
              await migration.query("ROLLBACK");
            } finally {
              await migration.end();
            }
            await db.checkReady();
          } finally {
            await runtime.end();
          }
        },
      );
    } finally {
      await Promise.all([db.onApplicationShutdown(), sql.end()]);
    }
  },
);
