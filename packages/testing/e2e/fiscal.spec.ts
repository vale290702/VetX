import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { enterCredentials, mobileSession, setting } from "./support/identity.js";
test.use({ trace: "off" });
test.setTimeout(120000);
test("staff queue a sandbox fiscal invoice once and retrieve the retained XML for that sale", async ({
  page,
  browser,
  request,
}) => {
  const f = await createDirectoryFixture(),
    setup = await browser.newContext();
  const clinic = randomUUID(),
    sale = randomUUID(),
    price = randomUUID(),
    org = setting("API_INTERNAL_URL") + "/organizations/" + f.organizationId,
    base = org + "/clinics/" + clinic + "/billing";
  const url = new URL(setting("DATABASE_URL"));
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Fiscal fixtures require local PostgreSQL");
  url.username = "vetx_bootstrap";
  url.password = setting("POSTGRES_PASSWORD");
  const db = new pg.Client({ connectionString: url.href });
  try {
    await db.connect();
    const session = await mobileSession(await setup.newPage(), f.admin, "STAFF"),
      headers = { Authorization: "Bearer " + session.accessToken };
    expect(
      (
        await request.put(org + "/administration/clinics/" + clinic, {
          headers,
          data: { name: "Fiscal clinic", revision: 0 },
        })
      ).status(),
    ).toBe(200);
    const issuer = "3" + randomInt(100000000, 999999999);
    await db.query("SELECT public.fiscal_provision($1,$2,'sandbox',$3::jsonb,1,true)", [
      f.organizationId,
      clinic,
      JSON.stringify({
        branch: "001",
        terminal: "00001",
        providerId: "3101000000",
        issuerActivity: "750000",
        issuer: {
          name: "Clínica de prueba",
          identity: { type: "02", number: issuer },
          email: "clinic@example.test",
          address: { province: "1", canton: "01", district: "01", details: "Dirección de prueba" },
        },
      }),
    ]);
    expect(
      (
        await request.put(base + "/prices/" + price, {
          headers,
          data: {
            name: "Veterinary consultation",
            unit: "visit",
            currency: "CRC",
            unitPrice: "100",
            taxRate: "13",
            cabys: "8352000000000",
            stockItemId: null,
            revision: 0,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.put(base + "/sales/" + sale, {
          headers,
          data: {
            currency: "CRC",
            patientId: null,
            lines: [
              { priceId: price, priceRevision: 1, quantity: "1", warehouseId: null, lot: "" },
            ],
          },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, f.admin);
    await page.getByRole("link", { name: f.organizationName, exact: true }).click();
    await page.getByRole("link", { name: "Billing at Fiscal clinic" }).click();
    await page.getByRole("link", { name: "Sale 1", exact: true }).click();
    const panel = page.getByRole("region", { name: "Electronic invoice" });
    await panel.getByRole("link", { name: "Production", exact: true }).click();
    await expect(
      panel.getByText("Electronic invoicing is not enabled for this clinic in this environment."),
    ).toBeVisible();
    await expect(panel.locator("summary")).toHaveCount(0);
    // Both enabled environments still use this isolated local database and no worker.
    await db.query(
      "INSERT INTO fiscal_profiles(organization_id,clinic_id,environment,issuer_number,branch,terminal,profile,enabled,next_number) SELECT organization_id,clinic_id,'production',issuer_number,branch,terminal,profile,true,1 FROM fiscal_profiles WHERE organization_id=$1 AND clinic_id=$2 AND environment='sandbox'",
      [f.organizationId, clinic],
    );
    await page.reload();
    await panel.getByRole("link", { name: "Sandbox", exact: true }).click();
    const input = panel.getByRole("form", { name: "Queue sandbox invoice" });
    async function fillSandbox() {
      await expect(panel.getByText("Invoice environment · Sandbox", { exact: true })).toBeVisible();
      if (!(await input.isVisible())) await panel.getByText("Prepare electronic invoice").click();
      await input.getByLabel("Recipient’s legal name").fill("Ana Mora");
      await input.getByRole("combobox", { name: /Identification type/ }).selectOption("01");
      await input.getByLabel("Identification number").fill("100000001");
      await input.getByLabel("Credit term in days").fill("15");
      await input.getByRole("combobox", { name: /Fiscal category/ }).selectOption("service");
      await input.getByRole("combobox", { name: /Fiscal unit code/ }).selectOption("Sp");
    }
    await fillSandbox();
    // Lose the response before it reaches the server. Changing environment must
    // discard the captured recipient, body and retry action.
    await page.route(
      "**/billing/*/*/sales/*/fiscal/sandbox",
      (route) => route.fulfill({ status: 503, body: "" }),
      { times: 1 },
    );
    await input.getByRole("button", { name: "Queue sandbox invoice" }).click();
    await expect(input.getByRole("button", { name: "Retry original submission" })).toBeVisible();
    await panel.getByRole("link", { name: "Production", exact: true }).click();
    await expect(
      panel.getByText("Invoice environment · Production", { exact: true }),
    ).toBeVisible();
    await panel.getByText("Prepare electronic invoice").click();
    const live = panel.getByRole("form", { name: "Queue production invoice" });
    await expect(live.getByLabel("Recipient’s legal name")).toHaveValue("");
    await expect(live.getByRole("button", { name: "Retry original submission" })).toHaveCount(0);
    await panel.getByRole("link", { name: "Sandbox", exact: true }).click();
    await fillSandbox();
    const sent: string[] = [];
    await page.route("**/billing/*/*/sales/*/fiscal/sandbox", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      sent.push(route.request().postData()!);
      if (sent.length === 1) {
        expect((await route.fetch()).status()).toBe(204);
        return route.fulfill({ status: 503, body: "" });
      }
      return route.continue();
    });
    await input.getByRole("button", { name: "Queue sandbox invoice" }).click();
    await input.getByRole("button", { name: "Retry original submission" }).click();
    await expect(panel.getByRole("status")).toHaveText("Queued for signing");
    expect(sent).toHaveLength(2);
    expect(sent[1] === sent[0]).toBe(true);
    const status = await (
      await request.get(base + "/sales/" + sale + "/fiscal/sandbox", { headers })
    ).json();
    expect(status.invoice.state).toBe("pending");
    await expect(panel.getByText(status.invoice.key, { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("name")).toBe(false);
    await expect(panel.getByRole("link", { name: "Download signed invoice XML" })).toHaveCount(0);
    // Retained-artifact fixtures isolate UI delivery from signing and the authority network.
    const invoice = Buffer.from("<LocalFixtureInvoice/>"),
      receipt = Buffer.from("<LocalFixtureReceipt/>");
    await db.query(
      "UPDATE fiscal_invoices SET state='accepted',signed_xml=$4,receipt_xml=$5 WHERE organization_id=$1 AND clinic_id=$2 AND sale_id=$3 AND environment='sandbox'",
      [f.organizationId, clinic, sale, invoice, receipt],
    );
    await panel.getByRole("link", { name: "Refresh invoice status" }).click();
    await expect(panel.getByRole("status")).toHaveText("Accepted by Hacienda");
    for (const [label, bytes] of [
      ["Download signed invoice XML", invoice],
      ["Download Hacienda receipt XML", receipt],
    ] as const) {
      const href = await panel.getByRole("link", { name: label }).getAttribute("href");
      const file = await page.request.get(href!);
      expect(file.status()).toBe(200);
      expect(file.headers()["content-disposition"]).toMatch(/^attachment;/);
      expect(file.headers()["cache-control"]).toContain("no-store");
      expect((await file.body()).equals(bytes)).toBe(true);
    }
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page.getByText("Aceptada por Hacienda", { exact: true })).toBeVisible();
  } finally {
    await db.end();
    await setup.close();
    await f.cleanup();
  }
});
