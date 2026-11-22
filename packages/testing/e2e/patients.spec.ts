import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { enterCredentials } from "./support/identity.js";

test.use({ trace: "off" });
test.setTimeout(120_000);

test("assigned staff can register, find and edit a patient and manage guardian access", async ({
  page,
}) => {
  const fixture = await createDirectoryFixture();
  try {
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, fixture.admin);
    await page.getByRole("link", { name: fixture.organizationName }).click();
    await page.getByText("Add clinic", { exact: true }).click();
    await page.getByLabel("Clinic name").fill("Río Verde");
    await page.getByRole("button", { name: "Create clinic" }).click();
    await expect(page.getByRole("link", { name: "Patients at Río Verde" })).toBeVisible();
    await page.getByText("Add employee", { exact: true }).click();
    await page.getByLabel("Staff ID").fill(fixture.staff.id);
    const addEmployee = page.locator("details[open]").filter({ has: page.getByLabel("Staff ID") });
    await addEmployee.getByLabel("Río Verde").check();
    await addEmployee.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByText(fixture.staff.id, { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, fixture.staff);
    await page.getByRole("link", { name: fixture.organizationName }).click();
    await page.getByRole("link", { name: "Patients at Río Verde" }).click();
    await expect(page.getByText("This clinic has no patients yet.")).toBeVisible();
    await page.getByText("Add patient", { exact: true }).click();
    await page.getByLabel("Patient name", { exact: true }).fill("Canela");
    await page.getByLabel("Species", { exact: true }).fill("Cat");
    await page.getByLabel("Date of birth (optional)").fill("2021-06-12");
    await page.getByRole("button", { name: "Create patient" }).click();
    await expect(page.getByRole("heading", { name: "Canela" })).toBeVisible();
    await expect(page.getByText("June 12, 2021")).toBeVisible();

    const stale = await page.context().newPage();
    await stale.goto(page.url());
    await stale.getByText("Edit details", { exact: true }).click();
    await stale.getByLabel("Patient name", { exact: true }).fill("Outdated name");
    await page.getByText("Edit details", { exact: true }).click();
    await page.getByLabel("Patient name", { exact: true }).fill("Canela María");
    await page.getByRole("button", { name: "Save patient details" }).click();
    await expect(page.getByRole("heading", { name: "Canela María" })).toBeVisible();
    await stale.getByRole("button", { name: "Save patient details" }).click();
    await expect(stale.locator("main").getByRole("alert")).toContainText("The record has changed");
    await stale.close();

    await page.getByRole("link", { name: "Patients at Río Verde" }).click();
    await page.getByLabel("Search patients by name").fill("No matches");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("No patients match this search.")).toBeVisible();
    await page.getByLabel("Search patients by name").fill("Canela");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("link", { name: "Canela María" }).click();
    await page.getByText("Add guardian", { exact: true }).click();
    await page.getByLabel("Guardian name", { exact: true }).fill("Alex Mora");
    await page.getByLabel("Guardian’s email").fill(fixture.staff.email);
    await page.getByRole("button", { name: "Save guardian" }).click();
    await expect(page.getByText("Account not linked", { exact: true })).toBeVisible();
    const guardian = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Alex Mora" }) });
    const issue = guardian.getByRole("button", { name: "Issue linking code" });
    const endpoint = await issue.locator("..").getAttribute("action");
    const response = await page.request.post(endpoint!, {
      form: { action: "invite", csrf: "invalid" },
      headers: { Origin: new URL(page.url()).origin },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
    const attempts: string[] = [];
    const inviteUrl = new URL(endpoint!, page.url()).href;
    await page.route(inviteUrl, async (route) => {
      const id = route
        .request()
        .postData()
        ?.match(/name="requestId"\r?\n\r?\n([0-9a-f-]{36})/i)?.[1];
      if (!id) throw new Error("Missing invitation request ID");
      attempts.push(id);
      if (attempts.length <= 2) {
        await route.fulfill({ status: attempts.length === 1 ? 503 : 409, body: "" });
      } else {
        await route.continue();
      }
    });
    // An ambiguous result retries the original issuance. A superseded request needs a fresh ID.
    for (const expected of [1, 2, 3]) {
      await issue.click();
      await expect.poll(() => attempts.length).toBe(expected);
      if (expected < 3) await expect(issue).toBeEnabled();
    }
    expect(attempts[1]).toBe(attempts[0]);
    expect(attempts[2]).not.toBe(attempts[1]);
    await page.unroute(inviteUrl);
    const code = guardian.getByLabel("One-time linking code");
    await expect(code).toBeVisible();
    const issued = await code.inputValue();
    expect(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(issued)).toBe(true);
    expect(page.url().includes(issued)).toBe(false);
    await guardian.getByRole("button", { name: "Copy code" }).click();
    await expect(guardian.getByRole("status")).toHaveText("Code copied.");
    expect(
      await page.evaluate(
        async (expected) => (await navigator.clipboard.readText()) === expected,
        issued,
      ),
    ).toBe(true);
    await guardian.getByRole("button", { name: "Hide code" }).click();
    await expect(code).toHaveCount(0);
    await page.reload();
    await expect(code).toHaveCount(0);
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page.getByRole("heading", { name: "Responsables", exact: true })).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await guardian.getByText("Revocar acceso", { exact: true }).click();
    await guardian.getByRole("button", { name: "Confirmar eliminación" }).click();
    await expect(page.getByText("Aún no se han agregado responsables.")).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});
