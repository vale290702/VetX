import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PrismaDatabase } from "@vetx/database";
import { startTestDatabase } from "./postgres.ts";

test(
  "clinic POS, invoice and cash register stay consistent under retry and concurrency",
  { timeout: 120000 },
  async (t) => {
    const { database, runtimeUrl } = await startTestDatabase(t),
      sql = new pg.Client({ connectionString: database.getConnectionUri() }),
      db = new PrismaDatabase(runtimeUrl);
    await sql.connect();
    try {
      const org = randomUUID(),
        clinic = randomUUID(),
        other = randomUUID(),
        user = randomUUID();
      const admin = { kind: "staff" as const, issuer: "https://id.example", subject: "manager" },
        cashier = { ...admin, subject: "cashier" };
      await sql.query("INSERT INTO organizations(id,name) VALUES ($1,'Org')", [org]);
      await sql.query(
        "INSERT INTO clinics(organization_id,id,name) VALUES ($1,$2,'Clinic'),($1,$3,'Other')",
        [org, clinic, other],
      );
      await sql.query("INSERT INTO users(id,identity_issuer,identity_subject) VALUES($1,$2,$3)", [
        user,
        admin.issuer,
        admin.subject,
      ]);
      await sql.query(
        "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'ADMIN')",
        [org, user],
      );
      await db.saveMember(admin, org, cashier.subject, "STAFF", [clinic], 0);
      const warehouse = randomUUID(),
        item = randomUUID(),
        price = randomUUID(),
        second = randomUUID(),
        saleId = randomUUID();
      await db.saveWarehouse(admin, org, clinic, warehouse, { name: "Store", revision: 0 });
      await db.saveStockItem(admin, org, clinic, item, {
        name: "Unit",
        sku: "A",
        unit: "Each",
        revision: 0,
      });
      await db.recordStockMovement(cashier, org, clinic, randomUUID(), {
        itemId: item,
        kind: "RECEIPT",
        unit: "Each",
        fromWarehouseId: null,
        toWarehouseId: warehouse,
        quantity: "3",
        lot: "",
        reason: "Delivery",
      });
      const entry = {
        unit: "Each",
        name: "Unit",
        currency: "CRC",
        unitPrice: "10.00000",
        taxRate: "5.00",
        cabys: "1234567890123",
        stockItemId: item,
        revision: 0,
      };
      await assert.rejects(
        db.saveBillingPrice(admin, org, clinic, second, { ...entry, unit: "box" }),
        { code: "conflict" },
      );
      const priced = await db.saveBillingPrice(admin, org, clinic, price, entry);
      await assert.rejects(db.saveBillingPrice(cashier, org, clinic, second, entry), {
        code: "forbidden",
      });
      const lines = [
        {
          priceId: price,
          priceRevision: priced.revision,
          quantity: "2",
          warehouseId: warehouse,
          lot: "",
        },
      ];
      const saleInput = { currency: "CRC", patientId: null, lines };
      const mixed = {
        ...saleInput,
        lines: [
          { ...lines[0]!, quantity: "1" },
          { ...lines[0]!, priceId: randomUUID() },
        ],
      };
      await assert.rejects(db.createSale(cashier, org, clinic, randomUUID(), mixed), {
        code: "not_found",
      });
      assert.equal(
        (await db.listStockBalances(admin, org, clinic, warehouse, 1)).balances[0]?.quantity,
        "3.000",
      );
      const issue = () => db.createSale(cashier, org, clinic, saleId, saleInput);
      const [sale, again] = await Promise.all([issue(), issue()]);
      assert.deepEqual(sale, again);
      assert.equal(sale.total, "21.00000");
      assert.equal(sale.balance, "21.00000");
      assert.equal(sale.lines[0]?.unit, "Each");
      assert.equal(sale.lines[0]?.tax, "1.00000");
      await assert.rejects(db.createSale(cashier, org, clinic, randomUUID(), saleInput), {
        code: "conflict",
      });
      assert.equal(
        (await db.listStockBalances(admin, org, clinic, warehouse, 1)).balances[0]?.quantity,
        "1.000",
      );
      await db.saveBillingPrice(admin, org, clinic, price, {
        ...entry,
        unitPrice: "20",
        revision: priced.revision,
      });
      assert.equal((await issue()).total, "21.00000");
      await assert.rejects(db.createSale(cashier, org, clinic, randomUUID(), saleInput), {
        code: "conflict",
      });
      const shiftId = randomUUID(),
        payId = randomUUID();
      await db.openShift(cashier, org, clinic, shiftId, {
        label: "Front desk",
        currency: "CRC",
        openingFloat: "100",
      });
      const cash = { method: "CASH" as const, amount: "10", reference: "", shiftId };
      const pays = await Promise.all([
        db.takePayment(cashier, org, clinic, saleId, payId, cash),
        db.takePayment(cashier, org, clinic, saleId, payId, cash),
      ]);
      assert.deepEqual(pays[0], pays[1]);
      const outcomes = await Promise.allSettled(
        [randomUUID(), randomUUID()].map((id) =>
          db.takePayment(cashier, org, clinic, saleId, id, { ...cash, amount: "11.00" }),
        ),
      );
      assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await db.getSale(cashier, org, clinic, saleId)).balance, "0.00000");
      const closed = await db.closeShift(cashier, org, clinic, shiftId, "120");
      assert.equal(closed.expected, "121.00000");
      assert.equal(closed.difference, "-1.00000");
      assert.deepEqual(await db.closeShift(cashier, org, clinic, shiftId, "120.00000"), closed);
      assert.equal(
        (await db.listBillingPrices(cashier, org, clinic, "Uni", 1)).prices[0]?.name,
        "Unit",
      );
      assert.equal((await db.listSales(cashier, org, clinic, 1)).sales[0]?.balance, "0.00000");
      assert.equal((await db.listPayments(cashier, org, clinic, saleId, 1)).payments.length, 2);
      assert.equal(
        (await db.listShifts(cashier, org, clinic, 1)).shifts[0]?.difference,
        "-1.00000",
      );
      await assert.rejects(db.getSale(cashier, org, other, saleId), { code: "forbidden" });
    } finally {
      await db.onApplicationShutdown();
      await sql.end();
    }
  },
);
