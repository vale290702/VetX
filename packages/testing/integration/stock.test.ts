import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PrismaDatabase } from "@vetx/database";
import { startTestDatabase } from "./postgres.ts";

test(
  "warehouse quantities are conserved through concurrent dispensing, transfer and retries",
  { timeout: 120000 },
  async (t) => {
    const { database, runtimeUrl, migrationUrl } = await startTestDatabase(t);
    const sql = new pg.Client({ connectionString: database.getConnectionUri() }),
      db = new PrismaDatabase(runtimeUrl);
    await sql.connect();
    try {
      const org = randomUUID(),
        clinic = randomUUID(),
        other = randomUUID(),
        user = randomUUID();
      const admin = {
          kind: "staff" as const,
          issuer: "https://test.example/vetx",
          subject: "lead",
        },
        staff = { ...admin, subject: "nurse" };
      await sql.query("INSERT INTO organizations(id,name) VALUES ($1,'Hospital')", [org]);
      await sql.query(
        "INSERT INTO clinics(id,organization_id,name) VALUES ($1,$3,'Clinic'),($2,$3,'Other')",
        [clinic, other, org],
      );
      await sql.query("INSERT INTO users(id,identity_issuer,identity_subject) VALUES ($1,$2,$3)", [
        user,
        admin.issuer,
        admin.subject,
      ]);
      await sql.query(
        "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'ADMIN')",
        [org, user],
      );
      await db.saveMember(admin, org, staff.subject, "STAFF", [clinic], 0);
      const room = randomUUID(),
        dispensary = randomUUID(),
        item = randomUUID();
      await db.saveWarehouse(admin, org, clinic, room, { name: "Main", revision: 0 });
      await db.saveWarehouse(admin, org, clinic, dispensary, { name: "Dispensary", revision: 0 });
      const product = { name: "Exam supplies", sku: "EXAM-1", unit: "pieces", revision: 0 };
      await db.saveStockItem(admin, org, clinic, item, product);
      await assert.rejects(db.saveStockItem(staff, org, clinic, randomUUID(), product), {
        code: "forbidden",
      });
      await assert.rejects(db.saveStockItem(admin, org, clinic, randomUUID(), product), {
        code: "conflict",
      });
      const request = randomUUID(),
        receipt = {
          itemId: item,
          unit: product.unit,
          fromWarehouseId: null,
          toWarehouseId: room,
          kind: "RECEIPT" as const,
          quantity: "5.125",
          lot: "LOT-01",
          reason: "Delivery",
        };
      const post = (id: string, input: Parameters<PrismaDatabase["recordStockMovement"]>[4]) =>
        db.recordStockMovement(staff, org, clinic, id, input);
      const runs = await Promise.all([post(request, receipt), post(request, receipt)]);
      assert.deepEqual(runs[0], runs[1]);
      assert.equal(runs[0].toBalance, "5.125");
      await assert.rejects(post(request, { ...receipt, quantity: "6.000" }), { code: "conflict" });
      const issue = {
        ...receipt,
        fromWarehouseId: room,
        toWarehouseId: null,
        kind: "ISSUE" as const,
        quantity: "3.000",
        reason: "Dispensed",
      };
      const outcomes = await Promise.allSettled([
        post(randomUUID(), issue),
        post(randomUUID(), issue),
      ]);
      assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        outcomes.filter((x) => x.status === "rejected" && x.reason.code === "conflict").length,
        1,
      );
      const transfer = await post(randomUUID(), {
        ...issue,
        toWarehouseId: dispensary,
        kind: "TRANSFER",
        quantity: "2.125",
        reason: "Restock",
      });
      assert.equal(transfer.fromBalance, "0.000");
      assert.equal(transfer.toBalance, "2.125");
      await assert.rejects(post(randomUUID(), { ...issue, quantity: "0.0001" }), {
        code: "invalid",
      });
      await assert.rejects(
        post(randomUUID(), { ...issue, toWarehouseId: room, kind: "TRANSFER" }),
        { code: "invalid" },
      );
      await assert.rejects(db.recordStockMovement(staff, org, other, randomUUID(), receipt), {
        code: "forbidden",
      });
      const positions = await db.listStockBalances(staff, org, clinic, dispensary, 1);
      assert.deepEqual(
        positions.balances.map((p) => [p.itemId, p.lot, p.quantity]),
        [[item, "LOT-01", "2.125"]],
      );
      const ledger = await db.listStockMovements(staff, org, clinic, 1);
      assert.equal(ledger.movements.length, 3);
      assert.equal(ledger.movements[0]!.actor.subject, staff.subject);

      await t.test(
        "catalog edits require clinic administration and preserve established base units",
        async () => {
          assert.deepEqual(
            (await db.listWarehouses(staff, org, clinic, 1)).warehouses.map((w) => w.name),
            ["Dispensary", "Main"],
          );
          await assert.rejects(
            db.saveWarehouse(staff, org, clinic, randomUUID(), {
              name: "Unauthorized",
              revision: 0,
            }),
            { code: "forbidden" },
          );
          await assert.rejects(
            db.saveWarehouse(admin, org, clinic, randomUUID(), { name: " main ", revision: 0 }),
            { code: "conflict" },
          );
          await assert.rejects(
            db.saveStockItem(admin, org, clinic, randomUUID(), { ...product, sku: "exam-1" }),
            { code: "conflict" },
          );
          const sameUnit = await db.saveStockItem(admin, org, clinic, item, {
            ...product,
            name: "Exam items",
            revision: 1,
          });
          assert.equal(sameUnit.revision, 2);
          assert.equal(sameUnit.unitLocked, true);
          const original = await db.recordStockMovement(staff, org, clinic, request, receipt);
          assert.equal(original.itemName, product.name);
          assert.equal(original.toWarehouseName, "Main");
          assert.equal(original.fromWarehouseName, null);
          assert.deepEqual(
            await db.saveStockItem(admin, org, clinic, item, {
              ...product,
              name: "Exam items",
              revision: 1,
            }),
            sameUnit,
          );
          await assert.rejects(
            db.saveStockItem(admin, org, clinic, item, { ...product, unit: "packs", revision: 2 }),
            { code: "conflict" },
          );
          await assert.rejects(
            db.saveStockItem(admin, org, clinic, item, { ...product, revision: 0 }),
            { code: "conflict" },
          );
          assert.deepEqual((await db.listStockItems(staff, org, clinic, "ExAm-1", 1)).items, [
            sameUnit,
          ]);
          assert.deepEqual((await db.listStockItems(staff, org, clinic, "unknown", 1)).items, []);
          const newId = randomUUID(),
            otherItem = { ...product, sku: "KIT", unit: "single" };
          await db.saveStockItem(admin, org, clinic, newId, otherItem);
          assert.equal(
            (
              await db.saveStockItem(admin, org, clinic, newId, {
                ...otherItem,
                unit: "box",
                revision: 1,
              })
            ).unit,
            "box",
          );
          const stale = { ...receipt, itemId: newId, unit: otherItem.unit };
          await assert.rejects(post(randomUUID(), stale), { code: "conflict" });
          const balances = await db.listStockBalances(staff, org, clinic, null, 1);
          assert.ok(balances.balances.every((b) => b.itemId !== newId));
          const journal = await db.listStockMovements(staff, org, clinic, 1);
          assert.ok(journal.movements.every((m) => m.itemId !== newId));
          assert.equal((await db.saveStockItem(admin, org, other, item, product)).revision, 1);
          await assert.rejects(db.listStockItems(staff, org, other, "", 1), { code: "forbidden" });
          assert.deepEqual((await db.listStockBalances(admin, org, other, null, 1)).balances, []);
          await assert.rejects(db.listStockBalances(admin, org, other, room, 1), {
            code: "not_found",
          });
        },
      );

      await t.test(
        "identical resource IDs and client request IDs are independent across organizations",
        async () => {
          const remoteOrg = randomUUID(),
            remoteClinic = randomUUID();
          await sql.query("INSERT INTO organizations(id,name) VALUES ($1,'Remote')", [remoteOrg]);
          await sql.query(
            "INSERT INTO clinics(id,organization_id,name) VALUES ($1,$2,'Other hospital')",
            [remoteClinic, remoteOrg],
          );
          await sql.query(
            "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'ADMIN')",
            [remoteOrg, user],
          );
          await db.saveWarehouse(admin, remoteOrg, remoteClinic, room, {
            name: "Remote warehouse",
            revision: 0,
          });
          await db.saveStockItem(admin, remoteOrg, remoteClinic, item, product);
          const remote = await db.recordStockMovement(admin, remoteOrg, remoteClinic, request, {
            ...receipt,
            quantity: "9",
          });
          assert.equal(remote.toBalance, "9.000");
          assert.deepEqual(
            (await db.listStockBalances(admin, remoteOrg, remoteClinic, room, 1)).balances.map(
              (b) => b.quantity,
            ),
            ["9.000"],
          );
          assert.deepEqual(
            (await db.listStockBalances(admin, org, clinic, room, 1)).balances.map(
              (b) => b.quantity,
            ),
            ["0.000"],
          );
          await assert.rejects(db.listStockMovements(staff, remoteOrg, remoteClinic, 1), {
            code: "forbidden",
          });
          await assert.rejects(
            db.recordStockMovement(admin, remoteOrg, remoteClinic, randomUUID(), {
              ...receipt,
              toWarehouseId: dispensary,
            }),
            { code: "not_found" },
          );
        },
      );

      await t.test(
        "returns, adjustments and transfers use exact quantities per lot and actor-bound receipts",
        async () => {
          const returned = {
            ...receipt,
            kind: "RETURN" as const,
            quantity: "1",
            reason: "Unused stock",
          };
          const saved = await post(randomUUID(), returned);
          assert.equal(saved.quantity, "1.000");
          assert.equal(saved.toBalance, "1.000");
          assert.deepEqual(saved.actor, { issuer: staff.issuer, subject: staff.subject });
          assert.match(saved.recordedAt, /^\d{4}-.*Z$/);
          const adjust = await post(randomUUID(), {
            ...receipt,
            kind: "ADJUST_IN",
            quantity: "0.001",
            lot: "",
            reason: "Count reconciliation",
          });
          assert.equal(adjust.toBalance, "0.001");
          const depleted = await post(randomUUID(), {
            ...issue,
            kind: "ADJUST_OUT",
            quantity: "0.001",
            lot: "",
            reason: "Count correction",
          });
          assert.equal(depleted.fromBalance, "0.000");
          await assert.rejects(post(randomUUID(), { ...issue, quantity: "0.001", lot: "OTHER" }), {
            code: "conflict",
          });
          await assert.rejects(db.recordStockMovement(admin, org, clinic, request, receipt), {
            code: "conflict",
          });
          assert.deepEqual(await post(request, receipt), runs[0]);
          await assert.rejects(post(randomUUID(), { ...receipt, toWarehouseId: randomUUID() }), {
            code: "not_found",
          });
          for (const amount of ["0", "-1", "1.0001", "1e1", "NaN", "1000000000000000", " 1 "]) {
            await assert.rejects(post(randomUUID(), { ...receipt, quantity: amount }), {
              code: "invalid",
            });
          }
          for (const candidate of [
            { ...receipt, fromWarehouseId: room },
            { ...issue, fromWarehouseId: null },
            { ...receipt, lot: "new\nline" },
            { ...receipt, reason: "  " },
          ]) {
            await assert.rejects(post(randomUUID(), candidate), { code: "invalid" });
          }
          const maximum = "999999999999999.999",
            lot = "maximum";
          await post(randomUUID(), {
            ...receipt,
            lot,
            toWarehouseId: dispensary,
            quantity: maximum,
          });
          await post(randomUUID(), { ...receipt, lot, quantity: "1" });
          await assert.rejects(
            post(randomUUID(), {
              ...issue,
              kind: "TRANSFER",
              toWarehouseId: dispensary,
              quantity: "0.001",
              lot,
            }),
            { code: "conflict" },
          );
          const balances = (await db.listStockBalances(staff, org, clinic, null, 1)).balances;
          assert.equal(
            balances.find((b) => b.lot === lot && b.warehouseId === room)?.quantity,
            "1.000",
          );
          assert.equal(
            balances.find((b) => b.lot === lot && b.warehouseId === dispensary)?.quantity,
            maximum,
          );
        },
      );

      await t.test("catalog and ledger pagination is stable at the boundary", async () => {
        for (let n = 0; n < 26; n++) {
          const name = "Supply " + String(n).padStart(2, "0");
          await db.saveStockItem(admin, org, clinic, randomUUID(), {
            ...product,
            name,
            sku: "SUP-" + n,
          });
          await db.saveWarehouse(admin, org, clinic, randomUUID(), { name, revision: 0 });
          await post(randomUUID(), { ...receipt, lot: name, quantity: "0.5" });
        }
        const [first, last] = await Promise.all(
          [1, 2].map((page) => db.listStockItems(staff, org, clinic, "Supply", page)),
        );
        assert.equal(first!.hasNextPage, true);
        assert.equal(first!.items.length, 25);
        assert.equal(last!.hasNextPage, false);
        assert.deepEqual(
          last!.items.map((i) => i.name),
          ["Supply 25"],
        );
        const warehouses = await db.listWarehouses(staff, org, clinic, 2);
        assert.deepEqual(
          warehouses.warehouses.map((w) => w.name),
          ["Supply 23", "Supply 24", "Supply 25"],
        );
        const positions = await db.listStockBalances(staff, org, clinic, room, 2);
        assert.equal(positions.hasNextPage, false);
        assert.ok(positions.balances.every((b) => b.warehouseId === room));
        const p1 = await db.listStockMovements(staff, org, clinic, 1),
          p2 = await db.listStockMovements(staff, org, clinic, 2);
        assert.equal(p1.movements.length, 25);
        assert.ok(p1.hasNextPage);
        assert.ok(p2.movements.length > 0);
        const events = [...p1.movements, ...p2.movements];
        assert.equal(new Set(events.map((m) => m.id)).size, events.length);
        await assert.rejects(db.listWarehouses(staff, org, clinic, 0), { code: "invalid" });
        await assert.rejects(db.listStockBalances(staff, org, clinic, room, -1), {
          code: "invalid",
        });
      });

      await t.test(
        "journal order follows committed movements when clock readings tie",
        async () => {
          const earlier = "00000000-0000-4000-8000-000000000002";
          const later = "00000000-0000-4000-8000-000000000003";
          await post(earlier, { ...receipt, lot: "ORDER", quantity: "1" });
          await post(later, { ...receipt, lot: "ORDER", quantity: "2" });
          // Use the isolated bootstrap connection to reproduce a database clock tie.
          await sql.query(
            "UPDATE stock_movements SET recorded_at = '2020-01-01T00:00:00Z' WHERE id IN ($1,$2)",
            [earlier, later],
          );
          const { movements } = await db.listStockMovements(staff, org, clinic, 1);
          assert.deepEqual(
            movements.filter((m) => m.lot === "ORDER").map((m) => [m.id, m.toBalance]),
            [
              [later, "3.000"],
              [earlier, "1.000"],
            ],
          );
          assert.equal(
            (await post(later, { ...receipt, lot: "ORDER", quantity: "2" })).toBalance,
            "3.000",
          );
          await assert.rejects(
            post(later, { ...receipt, lot: "ORDER", quantity: "2", unit: "packs" }),
            { code: "conflict" },
          );
        },
      );

      await t.test(
        "stock data is tenant-protected, movement entries are immutable, and revoking grants takes effect immediately",
        async () => {
          const runtime = new pg.Client({ connectionString: runtimeUrl }),
            migration = new pg.Client({ connectionString: migrationUrl });
          await Promise.all([runtime.connect(), migration.connect()]);
          try {
            for (const table of [
              "inventory_items",
              "inventory_warehouses",
              "stock_balances",
              "stock_movements",
            ]) {
              for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
                assert.equal(
                  (
                    await runtime.query(
                      "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
                      [table, privilege],
                    )
                  ).rows[0].allowed,
                  false,
                );
              }
            }
            await runtime.query("BEGIN");
            await runtime.query(
              "SELECT set_config('vetx.client_kind','owner',true),set_config('vetx.organization_id',$1,true),set_config('vetx.clinic_id',$2,true),set_config('vetx.identity_issuer',$3,true),set_config('vetx.identity_subject',$4,true)",
              [org, clinic, admin.issuer, admin.subject],
            );
            assert.deepEqual(
              (await runtime.query("SELECT public.stock_list_items('',1) AS result")).rows[0]
                .result,
              { error: "forbidden" },
            );
            await runtime.query("ROLLBACK");
            await migration.query("BEGIN");
            await migration.query(
              "SELECT set_config('vetx.client_kind','staff',true),set_config('vetx.organization_id',$1,true),set_config('vetx.clinic_id',$2,true),set_config('vetx.identity_issuer',$3,true),set_config('vetx.identity_subject',$4,true)",
              [org, clinic, staff.issuer, staff.subject],
            );
            assert.equal(
              (await migration.query("SELECT FROM stock_movements WHERE id=$1", [request]))
                .rowCount,
              1,
            );
            assert.equal(
              (
                await migration.query("UPDATE stock_movements SET reason='Changed' WHERE id=$1", [
                  request,
                ])
              ).rowCount,
              0,
            );
            assert.equal(
              (await migration.query("DELETE FROM stock_movements WHERE id=$1", [request]))
                .rowCount,
              0,
            );
            assert.equal(
              (
                await migration.query("UPDATE inventory_items SET sku='Altered' WHERE id=$1", [
                  item,
                ])
              ).rowCount,
              0,
            );
            await migration.query("ROLLBACK");
            await sql.query("ALTER TABLE stock_balances NO FORCE ROW LEVEL SECURITY");
            try {
              await assert.rejects(db.listStockMovements(staff, org, clinic, 1), /row security/i);
            } finally {
              await sql.query("ALTER TABLE stock_balances FORCE ROW LEVEL SECURITY");
            }
            await db.checkReady();
            await db.removeMember(admin, org, staff.subject, 1);
            await assert.rejects(post(request, receipt), { code: "forbidden" });
            await assert.rejects(db.listStockBalances(staff, org, clinic, room, 1), {
              code: "forbidden",
            });
          } finally {
            await Promise.all([runtime.end(), migration.end()]);
          }
        },
      );
    } finally {
      await db.onApplicationShutdown();
      await sql.end();
    }
  },
);
