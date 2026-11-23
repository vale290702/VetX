import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import {
  enterCredentials,
  mobileSession,
  setting,
  type createIdentity,
} from "./support/identity.js";
type User = Awaited<ReturnType<typeof createIdentity>>;
async function auth(browser: Browser, user: User, kind: "OWNER" | "STAFF") {
  const c = await browser.newContext();
  try {
    const token = await mobileSession(await c.newPage(), user, kind);
    return { Authorization: "Bearer " + token.accessToken };
  } finally {
    await c.close();
  }
}
async function signIn(page: Page, user: User, org: string) {
  await page.goto("/en");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await enterCredentials(page, user);
  await page.getByRole("link", { name: org, exact: true }).click();
}
test.use({ trace: "off", actionTimeout: 30_000 });
test.setTimeout(150000);
test("clinic purchases, supplier returns and prescription dispensing honor separate grants and guardian release", async ({
  browser,
  page,
  request,
  baseURL,
}, info) => {
  const f = await createDirectoryFixture(),
    clinic = randomUUID(),
    item = randomUUID(),
    warehouse = randomUUID(),
    patient = randomUUID();
  const second = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
    colorScheme: info.project.use.colorScheme,
  });
  try {
    const [admin, owner] = await Promise.all([
      auth(browser, f.admin, "STAFF"),
      auth(browser, f.staff, "OWNER"),
    ]);
    const otherOwner = await auth(browser, f.admin, "OWNER");
    const api = setting("API_INTERNAL_URL"),
      org = api + "/organizations/" + f.organizationId,
      scope = org + "/clinics/" + clinic,
      record = scope + "/patients/" + patient;
    const put = async (url: string, data: unknown) => {
      const r = await request.put(url, { headers: admin, data });
      expect(r.status()).toBe(200);
      return r.json();
    };
    const created = await put(org + "/administration/clinics/" + clinic, {
      name: "Central",
      revision: 0,
    });
    await put(org + "/administration/members", {
      subject: f.staff.id,
      role: "STAFF",
      clinicIds: [clinic],
      revision: created.revision,
    });
    await put(scope + "/inventory/warehouses/" + warehouse, { name: "Dispensary", revision: 0 });
    await put(scope + "/inventory/items/" + item, {
      name: "Clinic supply",
      sku: "CS-1",
      unit: "pack",
      revision: 0,
    });
    await put(record, { name: "Luna", species: "Gato", birthDate: null, revision: 0 });
    async function linkOwner(user: User, name: string, headers: { Authorization: string }) {
      const guardian = randomUUID(),
        target = record + "/guardians/" + guardian;
      await put(target, { name, email: user.email });
      const invite = await request.post(target + "/invitations", {
        headers: admin,
        data: { requestId: randomUUID() },
      });
      expect(invite.status()).toBe(201);
      const redeemed = await request.post(api + "/owner/pet-links/redeem", {
        headers,
        data: { code: (await invite.json()).code, requestId: randomUUID() },
      });
      expect(redeemed.status()).toBe(200);
      const url = api + "/owner/pets/" + (await redeemed.json()).petId + "/prescriptions";
      return async () => {
        const response = await request.get(url, { headers });
        expect(response.status()).toBe(200);
        return (await response.json()).prescriptions;
      };
    }
    const ownerList = await linkOwner(f.staff, "Alex", owner);
    const privateList = await linkOwner(f.admin, "Sam", otherOwner);
    await signIn(page, f.admin, f.organizationName);
    await page.getByRole("link", { name: "Purchasing at Central", exact: true }).click();
    await page.getByRole("link", { name: "Suppliers", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Add supplier" }).click();
    const newSupplier = page.getByRole("form", { name: "Add supplier" });
    await newSupplier.getByLabel("Supplier name").fill("Río Supplies");
    await newSupplier.getByRole("button", { name: "Add supplier", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Río Supplies" })).toBeVisible();
    await page.getByRole("link", { name: "Purchase orders", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Create purchase order" }).click();
    const order = page.getByRole("form", { name: "Create purchase order" });
    await order
      .getByRole("combobox", { name: "Supplier", exact: true })
      .selectOption({ label: "Río Supplies" });
    await order.getByLabel("Stock item and base unit").selectOption(item);
    await order.getByLabel("Quantity in base units").fill("5");
    await order.getByRole("button", { name: "Create purchase order", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Río Supplies · Open" })).toBeVisible();
    await page.locator("summary").filter({ hasText: "Receive delivery" }).click();
    const receipt = page.getByRole("form", { name: "Receive delivery" });
    await receipt.getByLabel("Stock item and base unit").selectOption(item);
    await receipt.getByRole("combobox", { name: "Warehouse", exact: true }).selectOption(warehouse);
    await receipt.getByLabel("Lot (optional)").fill("A1");
    await receipt.getByLabel("Quantity in base units").fill("4");
    const attempts: { id: string; payload: string | null }[] = [];
    await page.route("**/trade/*/*/receipt/*", async (r) => {
      attempts.push({ id: r.request().url(), payload: r.request().postData() });
      if (attempts.length === 1) {
        expect((await r.fetch()).status()).toBe(204);
        return r.fulfill({ status: 503, body: "" });
      }
      return r.continue();
    });
    await Promise.all([
      page.waitForResponse((r) => r.url() === attempts[0]?.id && r.status() === 503),
      receipt.getByRole("button", { name: "Receive delivery", exact: true }).click(),
    ]);
    await expect(receipt.getByRole("alert")).toContainText("could not be confirmed");
    await receipt.getByRole("button", { name: "Retry this submission" }).click();
    await expect(
      page.getByRole("heading", { name: "Río Supplies · Partially received" }),
    ).toBeVisible();
    expect(attempts[0]).toEqual(attempts[1]);
    await page.unroute("**/trade/*/*/receipt/*");
    await page.locator("summary").filter({ hasText: "Receipts" }).click();
    const history = page.getByRole("region", { name: "Receipts", exact: true });
    await expect(history.getByText("4.000 pack · Dispensary · A1")).toBeVisible();
    await history.locator("summary").filter({ hasText: "Return stock to supplier" }).click();
    const ret = history.getByRole("form", { name: "Return stock to supplier" });
    await ret.getByLabel("Quantity (pack)").fill("1");
    await ret.getByLabel("Reason for return").fill("Damaged package");
    await ret.getByRole("button", { name: "Return stock to supplier" }).click();
    await expect(ret.getByRole("status")).toHaveText("Changes saved.");
    await page.locator("summary").filter({ hasText: "Supplier returns" }).click();
    await expect(page.getByText("Damaged package", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Pharmacy permissions" }).click();
    for (const [subject, permission] of [
      [f.admin.id, "Can prescribe and share"],
      [f.staff.id, "Can dispense"],
    ]) {
      const row = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: "Staff ID · " + subject, exact: true }) });
      await row.getByLabel(permission!).check();
      const saved = page.waitForResponse(
        (r) => r.url().includes("/trade/") && r.url().includes("/grant/") && r.status() === 204,
      );
      await row.getByRole("button", { name: "Save pharmacy permissions" }).click();
      await saved;
    }
    const navigateRx = async (p: Page) => {
      await p.getByRole("link", { name: "Patients at Central" }).click();
      await p.getByRole("link", { name: "Luna", exact: true }).click();
      await p.getByRole("link", { name: "Prescriptions", exact: true }).click();
    };
    await page.getByRole("link", { name: "Clinic directory", exact: true }).click();
    await navigateRx(page);
    await page.locator("summary").filter({ hasText: "Write prescription" }).click();
    const rx = page.getByRole("form", { name: "Write prescription" });
    await rx.getByLabel("Stock item and base unit").selectOption(item);
    await rx.getByLabel("Medication", { exact: true }).fill("Clinic product");
    await rx.getByLabel("Prescriber’s directions").fill("Directions entered by the prescriber.");
    await rx.getByLabel("Quantity in base units").fill("2");
    await rx.getByRole("button", { name: "Write prescription" }).click();
    await expect(page.getByRole("heading", { name: "Clinic product" })).toBeVisible();
    expect(await ownerList()).toEqual([]);
    await expect(page.getByText("Dispense stock", { exact: true })).toHaveCount(0);
    await page.locator("summary").filter({ hasText: "Guardian access" }).click();
    const share = page.getByRole("form", { name: "Save guardian access" });
    await share.getByLabel("Alex").check();
    await share.getByRole("button", { name: "Save guardian access" }).click();
    await expect.poll(async () => (await ownerList()).length).toBe(1);
    expect(await privateList()).toEqual([]);
    const staff = await second.newPage();
    await signIn(staff, f.staff, f.organizationName);
    await navigateRx(staff);
    await expect(staff.getByText("Write prescription", { exact: true })).toHaveCount(0);
    await expect(staff.getByText("Guardian access", { exact: true })).toHaveCount(0);
    await staff.locator("summary").filter({ hasText: "Dispense stock" }).click();
    const dispense = staff.getByRole("form", { name: "Dispense stock" });
    await dispense
      .getByRole("combobox", { name: "Warehouse", exact: true })
      .selectOption(warehouse);
    await dispense.getByLabel("Lot (optional)").fill("A1");
    await dispense.getByLabel("Quantity (pack)").fill("1");
    await dispense.getByRole("button", { name: "Dispense stock", exact: true }).click();
    await expect(staff.getByText("Dispensed quantity · 1.000 pack")).toBeVisible();
    await staff.locator("summary").filter({ hasText: "Dispensing history" }).click();
    await expect(
      staff.getByRole("region", { name: "Dispensing history" }).getByText("Dispensary · A1"),
    ).toBeVisible();
    if (!(await share.isVisible()))
      await page.locator("summary").filter({ hasText: "Guardian access" }).click();
    await share.getByLabel("Alex").uncheck();
    await share.getByRole("button", { name: "Save guardian access" }).click();
    await expect.poll(async () => (await ownerList()).length).toBe(0);
    await staff.getByRole("link", { name: "Español" }).click();
    await expect(staff.getByRole("heading", { name: "Recetas de Luna" })).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page: staff })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await second.close();
    await f.cleanup();
  }
});
