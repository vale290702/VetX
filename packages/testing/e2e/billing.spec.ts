import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import {
  enterCredentials,
  mobileSession,
  setting,
  type createIdentity,
} from "./support/identity.js";

test.use({ trace: "off" });
test.setTimeout(150_000);
async function enterBilling(
  page: Page,
  user: Awaited<ReturnType<typeof createIdentity>>,
  org: string,
) {
  await page.goto("/en");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await enterCredentials(page, user);
  await page.getByRole("link", { name: org, exact: true }).click();
  await page.getByRole("link", { name: "Billing at Central", exact: true }).click();
}
test("a clinic prices inventory, sells a lot and reconciles external and cash payments", async ({
  page,
  browser,
  request,
}) => {
  const f = await createDirectoryFixture(),
    setup = await browser.newContext();
  const api = setting("API_INTERNAL_URL"),
    org = api + "/organizations/" + f.organizationId,
    clinic = randomUUID(),
    base = org + "/clinics/" + clinic,
    inv = base + "/inventory";
  const item = randomUUID(),
    wh = randomUUID(),
    service = randomUUID();
  try {
    const token = await mobileSession(await setup.newPage(), f.admin, "STAFF"),
      headers = { Authorization: "Bearer " + token.accessToken };
    const created = await request.put(org + "/administration/clinics/" + clinic, {
      headers,
      data: { name: "Central", revision: 0 },
    });
    expect(created.status()).toBe(200);
    expect(
      (
        await request.put(org + "/administration/members", {
          headers,
          data: {
            revision: (await created.json()).revision,
            subject: f.staff.id,
            role: "STAFF",
            clinicIds: [clinic],
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.put(inv + "/items/" + item, {
          headers,
          data: { name: "Recovery food", sku: "REC", unit: "kg", revision: 0 },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.put(inv + "/warehouses/" + wh, {
          headers,
          data: { name: "Main warehouse", revision: 0 },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.put(inv + "/movements/" + randomUUID(), {
          headers,
          data: {
            kind: "RECEIPT",
            unit: "kg",
            quantity: "5.250",
            reason: "Delivery",
            lot: "LOT-7",
            itemId: item,
            fromWarehouseId: null,
            toWarehouseId: wh,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.put(base + "/billing/prices/" + service, {
          headers,
          data: {
            name: "Consultation",
            unit: "visit",
            currency: "CRC",
            unitPrice: "8.12",
            taxRate: "0",
            cabys: "1234567890123",
            stockItemId: null,
            revision: 0,
          },
        })
      ).status(),
    ).toBe(200);
    await enterBilling(page, f.admin, f.organizationName);
    await page.getByRole("link", { name: "Price catalog", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Add price" }).click();
    const price = page.getByRole("form", { name: "Add price" });
    await price.getByLabel("Price name").fill("Food by weight");
    await price.getByRole("combobox", { name: /Price type/ }).selectOption("stock");
    await price
      .getByRole("combobox", { name: "Linked inventory item", exact: true })
      .selectOption(item);
    await expect(price.getByLabel("Sales unit")).toHaveValue("kg");
    await price.getByLabel("Unit price before tax").fill("12.34567");
    await price.getByLabel("Tax rate (%)").fill("13");
    await price.getByLabel("CABYS code").fill("0123456789123");
    await price.getByRole("button", { name: "Save price" }).click();
    await expect(page.getByRole("heading", { name: "Food by weight" })).toBeVisible();
    const actual = (
      await (await request.get(base + "/billing/prices?query=Food", { headers })).json()
    ).prices[0];
    await page.context().clearCookies();
    await enterBilling(page, f.staff, f.organizationName);
    await page.getByRole("link", { name: "Price catalog", exact: true }).click();
    await expect(page.locator("summary").filter({ hasText: "Add price" })).toHaveCount(0);
    await page.getByRole("link", { name: "Cash drawers", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Open a cash drawer" }).click();
    const open = page.getByRole("form", { name: "Open a cash drawer" });
    await open.getByLabel("Drawer name").fill("Desk 1");
    await open.getByLabel("Opening float").fill("10");
    await open.getByRole("button", { name: "Open a cash drawer" }).click();
    await expect(page.getByRole("heading", { name: "Desk 1" })).toBeVisible();
    await page.getByRole("link", { name: "New sale", exact: true }).click();
    const checkout = page.getByRole("form", { name: "Record sale" }),
      choose = checkout.getByRole("combobox", { name: "Catalog price", exact: true });
    await choose.selectOption(actual.id);
    await checkout.getByRole("combobox", { name: "Warehouse", exact: true }).selectOption(wh);
    await checkout
      .getByRole("combobox", { name: "Stock lot", exact: true })
      .selectOption("lot-LOT-7");
    await checkout.getByLabel("Quantity (kg)").fill("6");
    await checkout.getByRole("button", { name: "Add to sale" }).click();
    await expect(checkout.getByRole("alert")).toContainText("available stock");
    await checkout.getByLabel("Quantity (kg)").fill("0.125");
    await checkout.getByRole("button", { name: "Add to sale" }).click();
    await choose.selectOption(service);
    await checkout.getByRole("button", { name: "Add to sale" }).click();
    const sent: { url: string; body: string | null }[] = [];
    await page.route("**/billing/*/*/sales/*", async (route) => {
      sent.push({ url: route.request().url(), body: route.request().postData() });
      if (sent.length === 1) {
        expect((await route.fetch()).status()).toBe(204);
        return route.fulfill({ status: 503, body: "" });
      }
      return route.continue();
    });
    await checkout.getByRole("button", { name: "Record sale", exact: true }).click();
    await expect(checkout.getByRole("button", { name: "Retry original submission" })).toBeVisible();
    await expect(choose).toBeDisabled();
    await checkout.getByRole("button", { name: "Retry original submission" }).click();
    await expect(page.getByRole("heading", { name: "Sale 1", exact: true })).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    await page.unroute("**/billing/*/*/sales/*");
    const saleId = new URL(page.url()).searchParams.get("sale")!;
    const sale = await (await request.get(base + "/billing/sales/" + saleId, { headers })).json();
    expect(sale.total).toBe("9.86383");
    expect(sale.lines[0].priceRevision).toBe(actual.revision);
    expect(
      (await (await request.get(inv + "/warehouses/" + wh + "/balances", { headers })).json())
        .balances[0].quantity,
    ).toBe("5.125");
    await page.locator("summary").filter({ hasText: "Add payment" }).click();
    const pay = page.getByRole("form", { name: "Record payment" });
    await pay.getByLabel(/^Payment amount/).fill("8.12");
    await pay.getByLabel(/^External payment reference/).fill("POS-RECEIPT-7");
    await pay.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("External payment reference · POS-RECEIPT-7")).toBeVisible();
    await page.locator("summary").filter({ hasText: "Add payment" }).click();
    await pay.getByRole("combobox", { name: /Payment method/ }).selectOption("CASH");
    await pay
      .getByRole("combobox", { name: "Your open drawer in this currency" })
      .selectOption({ label: "Desk 1 · CRC" });
    await pay.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("Cash · CRC 1.74383")).toBeVisible();
    await expect(page.locator("summary").filter({ hasText: "Add payment" })).toHaveCount(0);
    await page.getByRole("link", { name: "Cash drawers", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Close drawer" }).click();
    const close = page.getByRole("form", { name: "Close drawer" });
    await close.getByLabel("Counted cash").fill("11.75");
    await close.getByRole("button", { name: "Close drawer" }).click();
    await expect(page.getByText("CRC 0.00617")).toBeVisible();
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page.getByRole("heading", { name: "Cajas", exact: true })).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
  } finally {
    await setup.close();
    await f.cleanup();
  }
});
