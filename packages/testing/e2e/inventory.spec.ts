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
test.setTimeout(120_000);
async function signIn(page: Page, user: Awaited<ReturnType<typeof createIdentity>>, org: string) {
  await page.goto("/en");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await enterCredentials(page, user);
  await page.getByRole("link", { name: org, exact: true }).click();
  await page.getByRole("link", { name: "Inventory at Main clinic", exact: true }).click();
}
test("an administrator maintains stock and assigned staff can retry, transfer and reconcile one lot", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  const fixture = await createDirectoryFixture(),
    clinic = randomUUID();
  const api = setting("API_INTERNAL_URL"),
    org = api + "/organizations/" + fixture.organizationId;
  const staffBrowser = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
    colorScheme: test.info().project.use.colorScheme,
  });
  const setup = await browser.newContext();
  try {
    const token = await mobileSession(await setup.newPage(), fixture.admin, "STAFF"),
      headers = { Authorization: "Bearer " + token.accessToken };
    const addClinic = await request.put(org + "/administration/clinics/" + clinic, {
      headers,
      data: { name: "Main clinic", revision: 0 },
    });
    expect(addClinic.status()).toBe(200);
    const grant = await request.put(org + "/administration/members", {
      headers,
      data: {
        revision: (await addClinic.json()).revision,
        subject: fixture.staff.id,
        role: "STAFF",
        clinicIds: [clinic],
      },
    });
    expect(grant.status()).toBe(200);
    await signIn(page, fixture.admin, fixture.organizationName);
    const catalog = page.getByRole("form", { name: "Add an item" });
    await page.getByText("Add an item", { exact: true }).click();
    await catalog.getByLabel("Item name").fill("Gauze swabs");
    await catalog.getByLabel("SKU").fill("GZ-20");
    await catalog.getByLabel("Base unit").fill("pack");
    await catalog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Gauze swabs" })).toBeVisible();
    await page.getByRole("link", { name: "Warehouses", exact: true }).click();
    await page.getByText("Add a warehouse", { exact: true }).click();
    const wh = page.getByRole("form", { name: "Add a warehouse" });
    for (const name of ["Pharmacy", "Surgery"]) {
      await wh.getByLabel("Warehouse name").fill(name);
      await wh.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    const inventory = org + "/clinics/" + clinic + "/inventory";
    // Both the working item and the two warehouses fall beyond the first 25 catalog entries.
    for (let n = 1; n <= 25; n++) {
      const [stock, location] = await Promise.all([
        request.put(inventory + "/items/" + randomUUID(), {
          headers,
          data: { name: "Auxiliary item " + n, sku: "AUX" + n, unit: "box", revision: 0 },
        }),
        request.put(inventory + "/warehouses/" + randomUUID(), {
          headers,
          data: { name: "Annex " + n, revision: 0 },
        }),
      ]);
      expect(stock.status()).toBe(200);
      expect(location.status()).toBe(200);
    }
    const staff = await staffBrowser.newPage();
    await signIn(staff, fixture.staff, fixture.organizationName);
    await expect(staff.getByText("Add an item", { exact: true })).toHaveCount(0);
    await expect(staff.getByRole("heading", { name: "Gauze swabs" })).toHaveCount(0);
    await staff.getByRole("link", { name: "Next", exact: true }).click();
    await expect(staff.getByRole("heading", { name: "Gauze swabs" })).toBeVisible();
    await staff.getByLabel("Search by item name or SKU").fill("GZ-20");
    await staff.getByRole("button", { name: "Search", exact: true }).click();
    await expect(staff.getByRole("heading", { name: "Gauze swabs" })).toBeVisible();
    await staff.getByText("Record a movement", { exact: true }).click();
    const form = staff.getByRole("form", { name: "Record a movement" }),
      go = form.getByRole("button", { name: "Record movement", exact: true });
    await form.getByRole("button", { name: "Load more warehouses" }).click();
    await form.getByLabel("To warehouse").selectOption({ label: "Pharmacy" });
    await form.getByLabel("Quantity (pack)").fill("5.250");
    await form.getByLabel("Lot (optional)").fill("LOT-1");
    await form.getByLabel("Reason").fill("Supplier delivery");
    const attempts: { url: string; body: string | null }[] = [];
    let csrf = "";
    await staff.route("**/inventory/*/*/movements/*", async (route) => {
      attempts.push({ url: route.request().url(), body: route.request().postData() });
      csrf = (await route.request().allHeaders())["x-vetx-csrf"] ?? "";
      if (attempts.length === 1) {
        expect((await route.fetch()).status()).toBe(204);
        return route.fulfill({ status: 503, body: "" });
      }
      return route.continue();
    });
    await go.click();
    await expect(form.getByRole("alert")).toContainText("could not be confirmed");
    await expect(form.getByLabel("Quantity (pack)")).toBeDisabled();
    await form.getByRole("button", { name: "Retry the same submission" }).click();
    await expect(form.getByRole("status")).toHaveText("Movement recorded.");
    expect(attempts.length).toBe(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await staff.unroute("**/inventory/*/*/movements/*");
    const endpoint = `/inventory/${fixture.organizationId}/${clinic}`;
    const denied = await staff.request.post(endpoint + "/warehouses/" + randomUUID(), {
      headers: { Origin: new URL(staff.url()).origin, "X-VetX-CSRF": csrf },
      data: { name: "Forbidden", revision: 0 },
    });
    expect(denied.status()).toBe(403);
    expect(
      (
        await staff.request.post(attempts[0]!.url, {
          headers: { Origin: new URL(staff.url()).origin },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await form.getByLabel("Movement type").selectOption("TRANSFER");
    await form.getByRole("button", { name: "Load more warehouses" }).click();
    await form.getByLabel("From warehouse").selectOption({ label: "Pharmacy" });
    await form.getByLabel("To warehouse").selectOption({ label: "Surgery" });
    await form.getByLabel("Quantity (pack)").fill("8");
    await form.getByLabel("Lot (optional)").fill("LOT-1");
    await form.getByLabel("Reason").fill("Surgery allocation");
    await go.click();
    await expect(form.getByRole("alert")).toContainText("available balance");
    await form.getByLabel("Quantity (pack)").fill("2");
    await go.click();
    await expect(form.getByRole("status")).toHaveText("Movement recorded.");
    await staff.getByRole("link", { name: "Warehouses", exact: true }).click();
    await staff.getByRole("link", { name: "Next", exact: true }).click();
    const warehouse = staff
      .getByRole("listitem")
      .filter({ has: staff.getByRole("heading", { name: "Pharmacy" }) });
    await warehouse.getByRole("link", { name: "View balances" }).click();
    await expect(staff.getByText("3.250 pack", { exact: true })).toBeVisible();
    await expect(staff.getByText("GZ-20 · LOT-1")).toBeVisible();
    await staff.getByRole("link", { name: "Movement journal", exact: true }).click();
    await expect(staff.getByRole("listitem")).toHaveCount(2);
    await expect(staff.getByRole("heading", { name: "Transfer · Gauze swabs" })).toBeVisible();
    await expect(staff.getByRole("heading", { name: "Receipt · Gauze swabs" })).toBeVisible();
    await staff.getByRole("link", { name: "Español", exact: true }).click();
    await expect(staff.getByRole("heading", { name: "Historial de movimientos" })).toBeVisible();
    await expect(staff.getByText("2,000 pack · GZ-20 · LOT-1", { exact: true })).toBeVisible();
    const axe = await new AxeBuilder({ page: staff })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "Items", exact: true }).click();
    await page.getByLabel("Search by item name or SKU").fill("GZ-20");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByText("Edit item", { exact: true }).click();
    const edit = page.getByRole("form", { name: "Edit item" });
    await expect(edit.getByLabel("Base unit")).toHaveAttribute("readonly", "");
    await expect(
      edit.getByText(
        "The base unit is fixed because this item has a movement, purchase order, or prescription.",
      ),
    ).toBeVisible();
  } finally {
    await Promise.all([setup.close(), staffBrowser.close()]);
    await fixture.cleanup();
  }
});
