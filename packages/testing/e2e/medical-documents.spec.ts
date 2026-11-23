import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { enterCredentials, mobileSession, setting } from "./support/identity.js";

test.use({ trace: "off" });
test.setTimeout(120_000);

test("staff can retry an upload, download the file, and grant and revoke a linked guardian's access", async ({
  page,
  browser,
  request,
}) => {
  const f = await createDirectoryFixture();
  const ownerBrowser = await browser.newContext();
  try {
    const owner = await mobileSession(await ownerBrowser.newPage(), f.staff, "OWNER");
    const ownerHeaders = { Authorization: `Bearer ${owner.accessToken}` };
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, f.admin);
    await page.getByRole("link", { name: f.organizationName }).click();
    await page.getByText("Add clinic", { exact: true }).click();
    await page.getByLabel("Clinic name").fill("Savia");
    await page.getByRole("button", { name: "Create clinic" }).click();
    await page.getByRole("link", { name: "Patients at Savia" }).click();
    await page.getByText("Add patient", { exact: true }).click();
    await page.getByLabel("Patient name", { exact: true }).fill("Luna");
    await page.getByLabel("Species", { exact: true }).fill("Cat");
    await page.getByRole("button", { name: "Create patient" }).click();
    await page.getByText("Add guardian", { exact: true }).click();
    await page.getByLabel("Guardian name", { exact: true }).fill("Ariel Mora");
    await page.getByLabel("Guardian’s email").fill(f.staff.email);
    await page.getByRole("button", { name: "Save guardian" }).click();
    await page.getByRole("button", { name: "Issue linking code" }).click();
    const code = await page.getByLabel("One-time linking code").inputValue();
    const api = setting("API_INTERNAL_URL");
    const redeem = await request.post(`${api}/owner/pet-links/redeem`, {
      headers: ownerHeaders,
      data: { code, requestId: randomUUID() },
    });
    expect(redeem.status()).toBe(200);
    const { petId } = await redeem.json();
    const ownerDocuments = `${api}/owner/pets/${petId}/documents`;

    await page.getByRole("link", { name: "Medical documents", exact: true }).click();
    await expect(page.getByText("This patient has no documents yet.")).toBeVisible();
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    await page.getByLabel("Document title").fill("Luna – lab report");
    await page
      .getByLabel("File", { exact: true })
      .setInputFiles({ name: "private.pdf", mimeType: "application/pdf", buffer: pdf });
    const uploads: string[] = [];
    await page.route("**/registry/**/documents/*", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      uploads.push(route.request().url());
      // The upstream commits the file but the browser loses the first success response.
      if (uploads.length === 1) {
        const first = await route.fetch();
        expect(first.ok()).toBe(true);
        return route.fulfill({ status: 503, body: "" });
      }
      return route.continue();
    });
    const upload = page.getByRole("button", { name: "Upload document", exact: true });
    await upload.click();
    await expect(
      page.getByRole("form", { name: "Add a document" }).getByRole("alert"),
    ).toContainText("Try again");
    await expect(page.getByLabel("Document title")).toHaveValue("Luna – lab report");
    await upload.click();
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Luna – lab report" }) });
    await expect(row).toHaveCount(1);
    expect(uploads).toHaveLength(2);
    expect(uploads[1]).toBe(uploads[0]);
    await page.unroute("**/registry/**/documents/*");
    const rows = await (await request.get(ownerDocuments, { headers: ownerHeaders })).json();
    expect(rows.documents).toEqual([]);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      row.getByRole("link", { name: "Download file" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("Luna – lab report.pdf");
    expect(await readFile((await download.path())!)).toEqual(pdf);
    const bff = uploads[0]!;
    const noCsrf = await page.request.post(bff, {
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(noCsrf.status()).toBe(403);
    const noSession = await request.get(bff, { maxRedirects: 0 });
    expect(noSession.status()).toBe(401);

    await row.getByLabel("Ariel Mora").check();
    await row.getByRole("button", { name: "Save sharing" }).click();
    await expect(row.getByRole("status")).toHaveText("Sharing saved.");
    const shared = await (await request.get(ownerDocuments, { headers: ownerHeaders })).json();
    expect(shared.documents.map((doc: { title: string }) => doc.title)).toEqual([
      "Luna – lab report",
    ]);
    const content = `${ownerDocuments}/${shared.documents[0].assetId}/content`;
    expect(await (await request.get(content, { headers: ownerHeaders })).body()).toEqual(pdf);
    await page.getByRole("link", { name: "Español" }).click();
    await expect(
      page.getByRole("heading", { name: "Documentos médicos", exact: true }),
    ).toBeVisible();
    await row.getByLabel("Ariel Mora").uncheck();
    await row.getByRole("button", { name: "Guardar acceso" }).click();
    await expect(row.getByRole("status")).toHaveText("Acceso actualizado.");
    expect((await request.get(content, { headers: ownerHeaders })).status()).toBe(404);
    expect(
      (await (await request.get(ownerDocuments, { headers: ownerHeaders })).json()).documents,
    ).toEqual([]);
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
    await ownerBrowser.close();
    await f.cleanup();
  }
});
