import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("opens in Spanish and switches the whole staff entry screen to English", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1, name: "Equipo veterinario" })).toBeVisible();
  await expect(page.getByText("Servicio disponible")).toBeVisible();

  await expect(page.getByRole("link", { name: "Español" })).toHaveCSS(
    "text-decoration-line",
    "underline",
  );
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Veterinary team" })).toBeVisible();
  await expect(page.getByText("Service available")).toBeVisible();

  await expect(page.getByRole("link", { name: "English" })).toHaveCSS(
    "text-decoration-line",
    "underline",
  );
  await page.getByRole("link", { name: "Español" }).click();
  await expect(page).toHaveURL(/\/es$/);
});

test("the entry screen has no automated accessibility violations", async ({ page }) => {
  await page.goto("/es");
  await expect(page.getByText("Servicio disponible")).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, selectors: nodes.map(({ target }) => target) })),
  ).toEqual([]);
});
