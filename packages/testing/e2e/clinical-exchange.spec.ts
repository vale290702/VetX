import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { readExchangeRoute, sealFixturePackage } from "./support/exchange.js";
import { enterCredentials, mobileSession, setting } from "./support/identity.js";

test.use({ trace: "off" });
test.setTimeout(120_000);
test("staff verify a signed package, explicitly match a clinic patient, and read its imported records", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const route = await readExchangeRoute(
    testInfo.project.name === "mobile-dark" ? "web-mobile-dark" : "web-desktop",
  );
  const f = await createDirectoryFixture(route.destination.organizationId);
  const api = setting("API_INTERNAL_URL");
  const clinic = route.destination.clinicId;
  const base = `/organizations/${f.organizationId}/clinics/${clinic}`;
  const patientId = randomUUID(),
    sourceId = randomUUID(),
    labSourceId = randomUUID(),
    packageId = randomUUID(),
    pdf = Buffer.from("%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");
  const archive = await sealFixturePackage(route, {
    version: 1,
    packageId,
    createdAt: "2026-04-01T13:00:00Z",
    patient: { id: sourceId, name: "Nube Vega", species: "Gato", birthDate: "2021-01-22" },
    owner: { name: "Ariel Sol" },
    records: [
      {
        id: randomUUID(),
        kind: "diagnosis",
        occurredAt: "2026-03-31T11:00:00Z",
        recordedAt: "2026-03-31T11:05:00Z",
        author: { issuer: "https://issuer.example", subject: "referring-vet" },
        data: { diagnosis: "Seguimiento renal" },
      },
      {
        id: randomUUID(),
        kind: "labResult",
        occurredAt: "2026-03-31T11:00:00Z",
        recordedAt: "2026-03-31T11:55:00Z",
        author: { issuer: "https://issuer.example", subject: "reviewing-vet" },
        data: { test: "Specimen evaluation", specimen: "Slide", result: "Reviewed observation" },
        clinicalRevision: {
          recordId: labSourceId,
          revision: 3,
          resultAuthor: { issuer: "https://issuer.example", subject: "lab-author" },
          resultRecordedAt: "2026-03-31T11:45:00Z",
        },
      },
      {
        id: randomUUID(),
        kind: "document",
        occurredAt: "2026-03-31T12:00:00Z",
        recordedAt: "2026-03-31T12:05:00Z",
        author: { issuer: "https://issuer.example", subject: "referring-vet" },
        data: {
          title: "Informe",
          mediaType: "application/pdf",
          byteLength: pdf.length,
          sha256: createHash("sha256").update(pdf).digest("hex"),
          content: pdf.toString("base64url"),
        },
      },
    ],
  });
  const setup = await browser.newContext();
  try {
    const auth = await mobileSession(await setup.newPage(), f.admin, "STAFF");
    const headers = { Authorization: "Bearer " + auth.accessToken };
    const clinicResponse = await request.put(
      `${api}/organizations/${f.organizationId}/administration/clinics/${clinic}`,
      { headers, data: { name: "Destino", revision: 0 } },
    );
    expect(clinicResponse.status()).toBe(200);
    const record = api + base + "/patients/" + patientId;
    expect(
      (
        await request.put(record, {
          headers,
          data: { name: "Nube Sol", species: "Gato", birthDate: null, revision: 0 },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, f.admin);
    await page.getByRole("link", { name: f.organizationName }).click();
    await page.getByRole("link", { name: "Import clinical package at Destino" }).click();
    const choose = page.getByRole("region", { name: "Choose a package" });
    const file = choose.getByLabel("Clinical package (.vetpkg)");
    await file.setInputFiles({
      name: "invalid.vetpkg",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("invalid"),
    });
    await choose.getByRole("button", { name: "Preview package" }).click();
    await expect(choose.getByRole("alert")).toContainText("could not be verified");
    const putArchive = async (bytes: Buffer = archive) => {
      await file.setInputFiles({
        name: "referral.vetpkg",
        mimeType: "application/octet-stream",
        buffer: bytes,
      });
      await choose.getByRole("button", { name: "Preview package" }).click();
    };
    await putArchive();
    const preview = page.getByRole("region", { name: "Verified package" });
    await expect(preview.getByText(packageId)).toBeVisible();
    await expect(preview.getByText(route.source.clinicId)).toBeVisible();
    await expect(preview.getByText("Ariel Sol")).toBeVisible();
    const button = page.getByRole("button", { name: "Confirm import" });
    await expect(button).toBeDisabled();
    expect(
      (await (await request.get(record + "/imported-records", { headers })).json()).records,
    ).toEqual([]);
    await page.getByLabel("Search clinic patients by name").fill("Nube Sol");
    await page.getByRole("button", { name: "Search patients", exact: true }).click();
    const matched = page.getByRole("radio", { name: /Nube Sol/ });
    await matched.check();
    // The commit reaches the API but its response is lost before reaching the user.
    await page.route(
      "**/exchange/**/commit",
      async (route) => {
        expect((await route.fetch()).status()).toBe(200);
        await route.fulfill({ status: 503, body: "" });
      },
      { times: 1 },
    );
    await button.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Try again");
    await expect(matched).toBeChecked();
    await button.click();
    await expect(page.getByText("3 records imported. 0 existing records skipped.")).toBeVisible();
    await page.getByRole("link", { name: "Imported clinical history" }).click();
    await expect(page.getByText("Seguimiento renal")).toBeVisible();
    const diagnosis = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Diagnosis" }) });
    await diagnosis.getByText("Source and import details").click();
    await expect(diagnosis.getByText("referring-vet")).toBeVisible();
    await expect(diagnosis.getByText(sourceId)).toBeVisible();
    const lab = page
      .getByRole("listitem")
      .filter({ has: page.getByText("Reviewed observation", { exact: true }) });
    await expect(lab.getByText("Slide", { exact: true })).toBeVisible();
    await lab.getByText("Source and import details").click();
    for (const value of [
      labSourceId,
      "Source version",
      "Result recorded by",
      "Result recorded on",
      "lab-author",
      "reviewing-vet",
    ]) {
      await expect(lab.getByText(value, { exact: true })).toBeVisible();
    }
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download file" }).click(),
    ]);
    expect(await readFile((await download.path())!)).toEqual(pdf);
    await page.getByRole("link", { name: "Import clinical package", exact: true }).click();
    await putArchive();
    await expect(page.getByText("This package was already imported.")).toBeVisible();
    await expect(button).toHaveCount(0);

    const newPatient = await sealFixturePackage(route, {
      version: 1,
      packageId: randomUUID(),
      createdAt: "2026-04-02T09:00:00Z",
      patient: { id: randomUUID(), name: "Brisa", species: "Gato" },
      records: [
        {
          id: randomUUID(),
          kind: "vaccination",
          occurredAt: "2026-03-31T12:00:00Z",
          recordedAt: "2026-03-31T12:05:00Z",
          author: { issuer: "https://issuer.example", subject: "referring-vet" },
          data: { vaccine: "Rabia" },
        },
      ],
    });
    await preview.getByRole("button", { name: "Choose another package" }).click();
    await putArchive(newPatient);
    await expect(button).toBeDisabled();
    await page.getByRole("radio", { name: "Create a new patient named Brisa" }).check();
    await button.click();
    await expect(page.getByText("1 record imported. 0 existing records skipped.")).toBeVisible();
    await page.getByRole("link", { name: "Imported clinical history" }).click();
    await expect(page.getByRole("link", { name: "Brisa", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page.getByRole("heading", { name: "Historial clínico importado" })).toBeVisible();
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
    await setup.close();
    await f.cleanup();
  }
});
