import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dicomFixture } from "../fixtures/dicom.mjs";
import { createDirectoryFixture } from "./support/directory.js";
import { mobileSession, enterCredentials, setting } from "./support/identity.js";
test.use({ trace: "off" });
test.setTimeout(120_000);

test("staff view a DICOM first frame and release or revoke both the preview and original", async ({
  page,
  browser,
  request,
}) => {
  const fixture = await createDirectoryFixture(),
    setup = await browser.newContext(),
    clinicId = randomUUID(),
    patientId = randomUUID(),
    guardianId = randomUUID();
  const org = "/organizations/" + fixture.organizationId,
    patient = org + "/clinics/" + clinicId + "/patients/" + patientId,
    api = setting("API_INTERNAL_URL"),
    original = dicomFixture();
  try {
    const staff = await mobileSession(await setup.newPage(), fixture.admin, "STAFF"),
      headers = { Authorization: "Bearer " + staff.accessToken };
    for (const [path, data] of [
      [org + "/administration/clinics/" + clinicId, { name: "Imaging clinic", revision: 0 }],
      [patient, { name: "Coco", species: "Cat", birthDate: null, revision: 0 }],
      [patient + "/guardians/" + guardianId, { name: "Ari Vega", email: fixture.staff.email }],
    ] as const)
      expect((await request.put(api + path, { headers, data })).status()).toBe(200);
    const invite = await request.post(api + patient + "/guardians/" + guardianId + "/invitations", {
      headers,
      data: { requestId: randomUUID() },
    });
    expect(invite.ok()).toBe(true);
    await setup.clearCookies();
    const owner = await mobileSession(await setup.newPage(), fixture.staff, "OWNER"),
      ownerHeaders = { Authorization: "Bearer " + owner.accessToken };
    const link = await request.post(api + "/owner/pet-links/redeem", {
      headers: ownerHeaders,
      data: { code: (await invite.json()).code, requestId: randomUUID() },
    });
    expect(link.ok()).toBe(true);
    const ownerDocs = api + "/owner/pets/" + (await link.json()).petId + "/documents";
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, fixture.admin);
    await expect(page.getByRole("link", { name: fixture.organizationName })).toBeVisible();
    await page.goto("/en" + patient);
    await page.getByRole("link", { name: "Medical documents", exact: true }).click();
    await page.getByLabel("Document title").fill("Synthetic study");
    await page
      .getByLabel("File", { exact: true })
      .setInputFiles({ name: "scan.DCM", mimeType: "application/octet-stream", buffer: original });
    await page.getByRole("button", { name: "Upload document", exact: true }).click();
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Synthetic study" }) });
    await expect(row.getByText("Modality OT · 1 frame")).toBeVisible();
    const listing = await request.get(api + patient + "/documents", { headers });
    expect(listing.ok()).toBe(true);
    const [doc] = (await listing.json()).documents;
    const previewRoute = `/registry/${fixture.organizationId}/${clinicId}/${patientId}/documents/${doc.id}/preview`;
    expect((await request.get(previewRoute)).status()).toBe(401);
    const ownerAsset = ownerDocs + "/" + doc.assetId;
    expect((await request.get(ownerAsset + "/preview", { headers: ownerHeaders })).status()).toBe(
      404,
    );
    await row.getByText("DICOM identifiers", { exact: true }).click();
    for (const key of ["studyInstanceUid", "seriesInstanceUid", "sopInstanceUid"])
      await expect(row.getByText(doc.imaging[key], { exact: true })).toBeVisible();
    await page.route("**" + previewRoute, (route) => route.fulfill({ status: 503, body: "" }), {
      times: 1,
    });
    await row.getByRole("button", { name: "View first frame" }).click();
    await expect(row.getByRole("alert")).toContainText("could not be opened");
    const [frame] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(previewRoute)),
      row.getByRole("button", { name: "Retry preview" }).click(),
    ]);
    expect(frame.status()).toBe(200);
    expect(frame.headers()["content-type"]).toBe("image/png");
    expect(frame.headers()["cache-control"]).toContain("no-store");
    const image = row.getByRole("img", { name: "First frame of Synthetic study" });
    await expect
      .poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBe(2);
    expect(
      createHash("sha256")
        .update(await frame.body())
        .digest("hex"),
    ).toBe(doc.imaging.preview.sha256);
    await row.getByRole("button", { name: "Hide preview" }).click();
    await expect(image).toHaveCount(0);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      row.getByRole("link", { name: "Download original DICOM" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("Synthetic study.dcm");
    expect(await readFile((await download.path())!)).toEqual(original);
    await row.getByRole("checkbox", { name: /Ari Vega/ }).check();
    await row.getByRole("button", { name: "Save sharing" }).click();
    await expect(row.getByRole("status")).toHaveText("Sharing saved.");
    expect(
      await (await request.get(ownerAsset + "/preview", { headers: ownerHeaders })).body(),
    ).toEqual(await frame.body());
    expect(
      await (await request.get(ownerAsset + "/content", { headers: ownerHeaders })).body(),
    ).toEqual(original);
    await page.getByRole("link", { name: "Español" }).click();
    await expect(row.getByRole("button", { name: "Ver el primer fotograma" })).toBeVisible();
    await row.getByRole("checkbox", { name: /Ari Vega/ }).uncheck();
    await row.getByRole("button", { name: "Guardar acceso" }).click();
    await expect(row.getByRole("status")).toHaveText("Acceso actualizado.");
    for (const route of ["preview", "content"])
      expect(
        (await request.get(ownerAsset + "/" + route, { headers: ownerHeaders })).status(),
      ).toBe(404);
    await row.getByRole("button", { name: "Ver el primer fotograma" }).click();
    await expect(
      row.getByRole("img", { name: "Primer fotograma de Synthetic study" }),
    ).toBeVisible();
    const checks = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(checks.violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await setup.close();
    await fixture.cleanup();
  }
});
