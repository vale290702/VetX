import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { enterCredentials, mobileSession, setting } from "./support/identity.js";

test.use({ trace: "off" });
test.setTimeout(120_000);

test("staff document a visit, release an individual note, and manage the clinic schedule", async ({
  page,
  browser,
  request,
}) => {
  const f = await createDirectoryFixture();
  const clinic = randomUUID(),
    patient = randomUUID(),
    guardian = randomUUID();
  const org = `/organizations/${f.organizationId}`,
    base = `${org}/clinics/${clinic}`;
  const api = setting("API_INTERNAL_URL"),
    record = api + base + "/patients/" + patient;
  try {
    const setup = await browser.newContext();
    try {
      const session = await mobileSession(await setup.newPage(), f.admin, "STAFF");
      const headers = { Authorization: "Bearer " + session.accessToken };
      expect(
        (
          await request.put(api + org + "/administration/clinics/" + clinic, {
            headers,
            data: { name: "Clínica del Sol", revision: 0 },
          })
        ).ok(),
      ).toBe(true);
      expect(
        (
          await request.put(record, {
            headers,
            data: { name: "Nube", species: "Gato", birthDate: null, revision: 0 },
          })
        ).ok(),
      ).toBe(true);
      const link = record + "/guardians/" + guardian;
      expect(
        (
          await request.put(link, { headers, data: { name: "Ana Mora", email: f.staff.email } })
        ).ok(),
      ).toBe(true);
      const invitation = await request.post(link + "/invitations", {
        headers,
        data: { requestId: randomUUID() },
      });
      expect(invitation.ok()).toBe(true);
      await setup.clearCookies();
      const owner = await mobileSession(await setup.newPage(), f.staff, "OWNER");
      expect(
        (
          await request.post(api + "/owner/pet-links/redeem", {
            headers: { Authorization: "Bearer " + owner.accessToken },
            data: { code: (await invitation.json()).code, requestId: randomUUID() },
          })
        ).ok(),
      ).toBe(true);
    } finally {
      await setup.close();
    }
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, f.admin);
    await page.getByRole("link", { name: f.organizationName }).click();
    await page.getByRole("link", { name: "Calendar for Clínica del Sol" }).click();
    await page.getByRole("link", { name: "Find a patient to book an appointment" }).click();
    await page.getByRole("link", { name: "Nube" }).click();
    const patientUrl = page.url();
    const response = await page.request.get(patientUrl);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["referrer-policy"]).toBe("strict-origin");
    const noteSection = page.getByRole("region", { name: "Clinical history" });
    await noteSection.getByText("Record encounter", { exact: true }).click();
    const note = noteSection.locator("details[open] form");
    const endpoint = await note.getAttribute("action");
    expect(
      (
        await page.request.post(endpoint!, {
          form: { action: "sharing", csrf: "bad" },
          headers: { Origin: new URL(page.url()).origin },
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(403);
    await note.getByLabel("Reason for visit").fill("Routine examination");
    const routeUrl = new URL(endpoint!, page.url()).href;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      routeUrl,
      async (route) => {
        await pending;
        await route.continue();
      },
      { times: 1 },
    );
    await note.getByRole("button", { name: "Save note" }).click();
    try {
      await expect(note.getByLabel("Reason for visit")).toBeDisabled();
    } finally {
      release();
    }
    await expect(note.getByRole("alert")).toBeVisible();
    await expect(note.getByLabel("Reason for visit")).toHaveValue("Routine examination");
    await note.getByLabel("Assessment").fill("Weight is stable.");
    await note.getByRole("button", { name: "Save note" }).click();
    const entry = noteSection
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Routine examination" }) });
    await expect(entry.getByText("Only clinic staff can see this note.")).toBeVisible();
    await entry.getByText("Manage access to this note").click();
    await entry.getByRole("checkbox", { name: /Ana Mora/ }).check();
    await entry.getByRole("button", { name: "Save access to note" }).click();
    await expect(entry.getByText("Shared with Ana Mora")).toBeVisible();
    await entry.getByText("Add an addendum").click();
    await entry.getByLabel("Reason for visit").fill("Follow-up observation");
    await entry.getByLabel("Objective", { exact: true }).fill("Repeat weight confirmed.");
    await entry.getByRole("button", { name: "Save note" }).click();
    await expect(noteSection.getByRole("heading", { name: "Follow-up observation" })).toBeVisible();
    await entry.getByText("Manage access to this note").click();
    await entry.getByRole("checkbox", { name: /Ana Mora/ }).uncheck();
    await entry.getByRole("button", { name: "Save access to note" }).click();
    await expect(entry.getByText("Only clinic staff can see this note.")).toBeVisible();
    expect(page.url()).not.toContain("observation");

    await page.locator("summary").filter({ hasText: "Book appointment" }).click();
    const booking = page.getByRole("region", { name: "Appointments", exact: true });
    await booking.getByLabel(/^Start \(/).fill("2026-07-20T09:00");
    await booking.getByLabel(/^End \(/).fill("2026-07-20T09:30");
    await booking.getByLabel("Appointment reason").fill("Weight check");
    const bookingId = await booking.locator("input[name=appointmentId]").inputValue();
    await page.route(
      routeUrl,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ notice: "unavailable" }),
        }),
      { times: 1 },
    );
    await booking.getByRole("button", { name: "Book appointment" }).click();
    await expect(booking.getByRole("alert")).toBeVisible();
    await expect(booking.getByLabel("Appointment reason")).toHaveValue("Weight check");
    await expect(booking.locator("input[name=appointmentId]")).toHaveValue(bookingId);
    await booking.getByRole("button", { name: "Book appointment" }).click();
    await expect(page.getByRole("heading", { name: "Calendar for Clínica del Sol" })).toBeVisible();
    await expect(page.getByText("Weight check", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Time zone", exact: true }).selectOption("UTC");
    await page.getByRole("button", { name: "View schedule" }).click();
    await page.getByText("Reschedule appointment").click();
    await expect(page.getByLabel("Start (UTC)", { exact: true })).toHaveValue("2026-07-20T15:00");
    await page.getByLabel("Start (UTC)", { exact: true }).fill("2026-07-21T17:00");
    await page.getByLabel("End (UTC)", { exact: true }).fill("2026-07-21T17:45");
    await page.route(
      routeUrl,
      async (route) => {
        // Commit the move to the next day, then lose the reply to the browser.
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ notice: "unavailable" }),
        });
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Save appointment changes" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Save appointment changes" }).click();
    await expect(page.locator('time[datetime^="2026-07-21T17:00"]')).toBeVisible();
    await page.getByRole("link", { name: "Español" }).click();
    await page.getByText("Cambiar estado de la cita").click();
    await page.getByRole("button", { name: "Marcar como completada" }).click();
    await expect(page.getByText("Completada", { exact: true })).toBeVisible();
    await expect(page.getByText("Reprogramar cita", { exact: true })).toHaveCount(0);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await f.cleanup();
  }
});
