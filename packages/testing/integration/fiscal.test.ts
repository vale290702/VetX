import { exerciseFiscalWorker } from "./fiscal-worker-flow.ts";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PrismaDatabase, type FiscalDraft } from "@vetx/database";
import { startTestDatabase } from "./postgres.ts";

test(
  "only a provisioned clinic can reserve its fiscal series; worker leases fence signed snapshots and receipts",
  { timeout: 120000 },
  async (t) => {
    const { database, runtimeUrl } = await startTestDatabase(t),
      admin = new pg.Client({ connectionString: database.getConnectionUri() }),
      runtime = new pg.Client({ connectionString: runtimeUrl }),
      db = new PrismaDatabase(runtimeUrl);
    await Promise.all([admin.connect(), runtime.connect()]);
    const secret = randomBytes(24).toString("hex"),
      url = new URL(runtimeUrl);
    url.username = "vetx_test_dispatch";
    url.password = secret;
    // Ephemeral cluster; only a dedicated, restricted login is a member of the queue role.
    await admin.query(
      "CREATE ROLE vetx_test_dispatch LOGIN IN ROLE vetx_fiscal_worker PASSWORD '" + secret + "'",
    );
    const dispatch = new pg.Client({ connectionString: url.href });
    await dispatch.connect();
    try {
      const org = randomUUID(),
        clinic = randomUUID(),
        other = randomUUID(),
        user = randomUUID(),
        price = randomUUID(),
        sale = randomUUID();
      const staff = {
        kind: "staff" as const,
        issuer: "https://issuer.example.test",
        subject: "cashier",
      };
      await admin.query("INSERT INTO organizations(id,name) VALUES ($1,'Org')", [org]);
      await admin.query(
        "INSERT INTO clinics(organization_id,id,name) VALUES ($1,$2,'Clinic'),($1,$3,'Other')",
        [org, clinic, other],
      );
      await admin.query(
        "INSERT INTO users(id,identity_issuer,identity_subject) VALUES ($1,$2,$3)",
        [user, staff.issuer, staff.subject],
      );
      await admin.query(
        "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'ADMIN')",
        [org, user],
      );
      const p = await db.saveBillingPrice(staff, org, clinic, price, {
        name: "Consulta clínica",
        unit: "servicio",
        currency: "CRC",
        unitPrice: "100",
        taxRate: "13",
        cabys: "8352000000000",
        stockItemId: null,
        revision: 0,
      });
      await db.createSale(staff, org, clinic, sale, {
        currency: "CRC",
        patientId: null,
        lines: [
          { priceId: price, priceRevision: p.revision, warehouseId: null, lot: "", quantity: "1" },
        ],
      });
      await db.takePayment(staff, org, clinic, sale, randomUUID(), {
        method: "CARD",
        amount: "113",
        reference: "test-payment",
        shiftId: null,
      });
      const draft: FiscalDraft = {
        recipient: { name: "Persona de prueba", identity: { type: "01", number: "100000001" } },
        terms: { code: "01" },
        exchangeRate: "1",
        lines: [{ vatTariffCode: "08", unitCode: "Sp", category: "service" }],
      };
      const profile = {
        branch: "001",
        terminal: "00001",
        providerId: "3101000000",
        issuerActivity: "750000",
        issuer: {
          name: "Clínica de prueba",
          identity: { type: "02", number: "3101000001" },
          address: { province: "1", canton: "01", district: "01", details: "Dirección de prueba" },
          email: "clinic@example.test",
        },
      };
      assert.deepEqual(await db.fiscalStatus(staff, org, clinic, sale, "sandbox"), {
        enabled: false,
        invoice: null,
      });
      await assert.rejects(db.issueFiscalInvoice(staff, org, clinic, sale, "sandbox", draft), {
        code: "conflict",
      });
      const provision = "SELECT public.fiscal_provision($1,$2,$3,$4::jsonb,$5,$6)";
      await assert.rejects(runtime.query(provision, [org, clinic, "sandbox", profile, 19, true]), {
        code: "42501",
      });
      await assert.rejects(runtime.query("SELECT public.fiscal_claim('sandbox',20)"), {
        code: "42501",
      });
      await dispatch.query(provision, [org, clinic, "sandbox", profile, 19, true]);
      await assert.rejects(
        db.issueFiscalInvoice(staff, org, clinic, sale, "sandbox", {
          ...draft,
          lines: [{ ...draft.lines[0]!, vatTariffCode: "02" }],
        }),
        { code: "invalid" },
      );
      const issue = () => db.issueFiscalInvoice(staff, org, clinic, sale, "sandbox", draft);
      await t.test(
        "schema-invalid invoice content rolls back the reservation, event and series before correction",
        async () => {
          const unchanged = async () => {
            assert.equal(
              (await db.fiscalStatus(staff, org, clinic, sale, "sandbox")).invoice,
              null,
            );
            assert.equal(
              (
                await admin.query(
                  "SELECT next_number FROM fiscal_profiles WHERE organization_id=$1 AND clinic_id=$2 AND environment='sandbox'",
                  [org, clinic],
                )
              ).rows[0].next_number,
              "19",
            );
            assert.equal(
              (await admin.query("SELECT count(*) AS n FROM fiscal_events")).rows[0].n,
              "0",
            );
          };
          for (const issuer of [
            { ...profile.issuer, name: "ABC" },
            { ...profile.issuer, address: { ...profile.issuer.address, details: "XYZ" } },
          ]) {
            await assert.rejects(
              dispatch.query(provision, [org, clinic, "sandbox", { ...profile, issuer }, 19, true]),
              /Invalid fiscal profile/,
            );
            // Read a legacy provisioned profile directly, as it could predate the stricter provisioner.
            await admin.query(
              "UPDATE fiscal_profiles SET profile=$1::jsonb WHERE organization_id=$2 AND clinic_id=$3",
              [JSON.stringify({ ...profile, issuer }), org, clinic],
            );
            await assert.rejects(issue(), { code: "invalid" });
            await unchanged();
          }
          await dispatch.query(provision, [org, clinic, "sandbox", profile, 19, true]);
          const shortPrice = randomUUID(),
            badSale = randomUUID();
          const pr = await db.saveBillingPrice(staff, org, clinic, shortPrice, {
            name: "IV",
            unit: "servicio",
            currency: "CRC",
            unitPrice: "100",
            taxRate: "13",
            cabys: "8352000000000",
            stockItemId: null,
            revision: 0,
          });
          await db.createSale(staff, org, clinic, badSale, {
            currency: "CRC",
            patientId: null,
            lines: [
              {
                priceId: shortPrice,
                priceRevision: pr.revision,
                warehouseId: null,
                lot: "",
                quantity: "1",
              },
            ],
          });
          await assert.rejects(
            db.issueFiscalInvoice(staff, org, clinic, badSale, "sandbox", {
              ...draft,
              terms: { code: "02", days: 30 },
            }),
            { code: "invalid" },
          );
          assert.equal(
            (await db.fiscalStatus(staff, org, clinic, badSale, "sandbox")).invoice,
            null,
          );
          await unchanged();
        },
      );
      const originalPath = process.env.PATH!;
      try {
        process.env.PATH = "/nonexistent/vetx-validator";
        await assert.rejects(issue(), { name: "FiscalXmlValidationError", kind: "unavailable" });
        assert.equal((await db.fiscalStatus(staff, org, clinic, sale, "sandbox")).invoice, null);
      } finally {
        process.env.PATH = originalPath;
      }
      const [a, b] = await Promise.all([issue(), issue()]);
      try {
        process.env.PATH = "/nonexistent/vetx-validator";
        assert.deepEqual(await issue(), a);
      } finally {
        process.env.PATH = originalPath;
      }
      assert.deepEqual(a, b);
      assert.equal(a.key.slice(21, 41), "00100001010000000019");
      assert.equal((await db.fiscalStatus(staff, org, clinic, sale, "production")).invoice, null);
      await assert.rejects(
        db.fiscalStatus({ ...staff, subject: "stranger" }, org, clinic, sale, "sandbox"),
        { code: "forbidden" },
      );
      await assert.rejects(db.fiscalStatus(staff, org, other, sale, "sandbox"), {
        code: "not_found",
      });
      await assert.rejects(
        db.issueFiscalInvoice(staff, org, clinic, sale, "sandbox", {
          ...draft,
          recipient: { ...draft.recipient, name: "Another person" },
        }),
        { code: "conflict" },
      );
      const claim = async () =>
        (await dispatch.query("SELECT public.fiscal_claim('sandbox',20) AS j")).rows[0].j;
      await assert.rejects(db.fiscalArtifact(staff, org, clinic, sale, "sandbox", "invoice"), {
        code: "not_found",
      });
      const job = await claim();
      assert.ok(job.lease);
      assert.equal(job.snapshot.total, "113.00000");
      assert.equal(job.snapshot.payments[0].code, "02");
      assert.equal(await claim(), null);
      const bytes = Buffer.from("test bytes for SQL storage");
      assert.equal(
        (
          await dispatch.query("SELECT public.fiscal_save_signature($1,$2,$3) AS ok", [
            job.id,
            randomUUID(),
            bytes,
          ])
        ).rows[0].ok,
        false,
      );
      assert.equal(
        (
          await dispatch.query("SELECT public.fiscal_save_signature($1,$2,$3) AS ok", [
            job.id,
            job.lease,
            bytes,
          ])
        ).rows[0].ok,
        true,
      );
      await dispatch.query("SELECT public.fiscal_start_delivery($1,$2)", [job.id, job.lease]);
      await admin.query(
        "UPDATE fiscal_invoices SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [job.id],
      );
      const reclaimed = await claim();
      assert.equal(reclaimed.state, "sending");
      assert.notEqual(reclaimed.lease, job.lease);
      assert.equal(reclaimed.signed, bytes.toString("base64"));
      const finish = "SELECT public.fiscal_finish($1,$2,'accepted',NULL,0,$3) AS ok";
      assert.equal((await dispatch.query(finish, [job.id, job.lease, bytes])).rows[0].ok, false);
      assert.equal(
        (await dispatch.query(finish, [job.id, reclaimed.lease, bytes])).rows[0].ok,
        true,
      );
      assert.equal(await claim(), null);
      assert.deepEqual(await db.fiscalArtifact(staff, org, clinic, sale, "sandbox", "receipt"), {
        key: a.key,
        xml: bytes,
      });
      await assert.rejects(
        db.fiscalArtifact({ ...staff, subject: "other" }, org, clinic, sale, "sandbox", "invoice"),
        { code: "forbidden" },
      );
      const status = await db.fiscalStatus(staff, org, clinic, sale, "sandbox");
      assert.equal(status.invoice?.state, "accepted");
      assert.equal(status.invoice.hasReceipt, true);
      await assert.rejects(db.retryFiscalInvoice(staff, org, clinic, sale, "sandbox"), {
        code: "conflict",
      });
      await assert.rejects(runtime.query("SELECT snapshot FROM fiscal_invoices"), {
        code: "42501",
      });
      await assert.rejects(dispatch.query("SELECT snapshot FROM fiscal_invoices"), {
        code: "42501",
      });
      await t.test(
        "a real BullMQ worker signs, submits once and retrieves the delayed receipt via loopback",
        async (sub) => {
          const another = randomUUID();
          await db.createSale(staff, org, clinic, another, {
            currency: "CRC",
            patientId: null,
            lines: [
              {
                priceId: price,
                priceRevision: p.revision,
                warehouseId: null,
                lot: "",
                quantity: "1",
              },
            ],
          });
          const invoice = await db.issueFiscalInvoice(staff, org, clinic, another, "sandbox", {
            ...draft,
            terms: { code: "02", days: 30 },
          });
          const artifacts = await exerciseFiscalWorker(
            sub,
            org,
            clinic,
            url.href,
            invoice.key,
            async () => (await db.fiscalStatus(staff, org, clinic, another, "sandbox")).invoice,
          );
          assert.deepEqual(
            (await db.fiscalArtifact(staff, org, clinic, another, "sandbox", "invoice")).xml,
            artifacts.xml,
          );
          assert.deepEqual(
            (await db.fiscalArtifact(staff, org, clinic, another, "sandbox", "receipt")).xml,
            artifacts.receipt,
          );
        },
      );
    } finally {
      await Promise.all([admin.end(), runtime.end(), dispatch.end(), db.onApplicationShutdown()]);
    }
  },
);
