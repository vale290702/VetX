import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { enterCredentials } from "./support/identity.js";

test.use({ trace: "off" });
test.setTimeout(100_000);

test("an administrator manages clinics and grants access using an employee’s own staff ID", async ({
  page,
  browser,
  baseURL,
}) => {
  const fixture = await createDirectoryFixture();
  const staffBrowser = await browser.newContext({ baseURL });
  try {
    const staffPage = await staffBrowser.newPage();
    await staffPage.goto("/en");
    await staffPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(staffPage, fixture.staff);
    const subject = await staffPage.getByLabel("Staff ID").inputValue();
    expect(subject).toBe(fixture.staff.id);
    await expect(
      staffPage.getByText("You do not have any organization memberships."),
    ).toBeVisible();

    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, fixture.admin);
    await page.getByRole("link", { name: fixture.organizationName }).click();
    await expect(page.getByRole("heading", { name: fixture.organizationName })).toBeVisible();
    await expect(
      page.getByText("Add another administrator before changing this account’s access."),
    ).toBeVisible();
    const stale = await page.context().newPage();
    await stale.goto(page.url());
    await stale.getByText("Add clinic", { exact: true }).click();
    await stale.getByLabel("Clinic name").fill("Stale clinic");

    await page.getByText("Add clinic", { exact: true }).click();
    const addClinic = page
      .locator("details[open]")
      .filter({ has: page.getByRole("button", { name: "Create clinic" }) });
    await addClinic.getByLabel("Clinic name").fill("Clínica Norte");
    const csrf = await addClinic.locator('input[name="csrf"]').inputValue();
    const url = `/directory/${fixture.organizationId}`;
    const attemptedClinic = {
      action: "clinic",
      name: "Unsubmitted",
      clinicId: "9cf1861b-4b63-4001-abec-d831e1974b10",
      revision: "0",
      locale: "en",
    };
    for (const [origin, token] of [
      ["https://other.example", csrf],
      [new URL(page.url()).origin, "invalid"],
    ] as const) {
      const rejected = await page.request.post(url, {
        headers: { Origin: origin },
        form: { ...attemptedClinic, csrf: token },
        maxRedirects: 0,
      });
      expect(rejected.status()).toBe(403);
    }
    await addClinic.getByRole("button", { name: "Create clinic" }).click();
    await expect(
      page
        .getByRole("listitem")
        .filter({ has: page.locator("strong", { hasText: "Clínica Norte" }) }),
    ).toBeVisible();
    await stale.getByRole("button", { name: "Create clinic" }).click();
    await expect(stale.locator("main").getByRole("alert")).toContainText("The directory changed.");
    await expect(stale.getByText("Stale clinic", { exact: true })).toHaveCount(0);
    await stale.close();
    const clinic = page
      .getByRole("region", { name: "Clinics" })
      .getByRole("listitem")
      .filter({ hasText: "Clínica Norte" });
    await clinic.getByText("Rename", { exact: true }).click();
    await clinic.getByLabel("Clinic name").fill("Clínica Central");
    await page.getByRole("button", { name: "Save name" }).click();

    await page.getByText("Add employee", { exact: true }).click();
    const addEmployee = page.locator("details[open]").filter({ has: page.getByLabel("Staff ID") });
    await addEmployee.getByLabel("Staff ID").fill(subject);
    await addEmployee.getByLabel("Clínica Central").check();
    await addEmployee.getByRole("button", { name: "Save access" }).click();
    const employee = page.getByRole("listitem").filter({ hasText: subject });
    await expect(
      employee.locator(":scope > p").filter({ hasText: "Clínica Central" }),
    ).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await staffPage.reload();
    await staffPage.getByRole("link", { name: fixture.organizationName }).click();
    await expect(staffPage.getByText("Clínica Central")).toBeVisible();
    await expect(staffPage.getByRole("heading", { name: "Employees" })).toHaveCount(0);
    await staffPage.getByRole("link", { name: "Español" }).click();
    await expect(staffPage.getByRole("heading", { name: "Clínicas" })).toBeVisible();

    await employee.getByText("Edit access", { exact: true }).click();
    await employee.getByLabel("Clínica Central").uncheck();
    await employee.getByRole("button", { name: "Save access" }).click();
    await staffPage.reload();
    await expect(staffPage.getByText("Sin clínicas asignadas.")).toBeVisible();
    await employee.getByText("Remove access", { exact: true }).click();
    await employee.getByRole("button", { name: "Confirm removal" }).click();
    await expect(employee).toHaveCount(0);
    await staffPage.reload();
    await expect(staffPage.locator("main").getByRole("alert")).toContainText(
      "Tu cuenta no tiene acceso",
    );
  } finally {
    await staffBrowser.close();
    await fixture.cleanup();
  }
});
