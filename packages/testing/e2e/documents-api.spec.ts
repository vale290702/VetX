import { randomUUID, createHash } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { mobileSession, setting, type createIdentity } from "./support/identity.js";

test.use({ trace: "off" });
async function authorized(
  browser: Browser,
  user: Awaited<ReturnType<typeof createIdentity>>,
  role: "STAFF" | "OWNER",
) {
  const context = await browser.newContext();
  try {
    const session = await mobileSession(await context.newPage(), user, role);
    return { Authorization: "Bearer " + session.accessToken };
  } finally {
    await context.close();
  }
}
test("verified guardians can download only individually released files and withdrawal stops new downloads", async ({
  request,
  browser,
}) => {
  const f = await createDirectoryFixture();
  try {
    const staff = await authorized(browser, f.admin, "STAFF");
    const owner = await authorized(browser, f.staff, "OWNER");
    const clinic = randomUUID(),
      patient = randomUUID(),
      guardian = randomUUID(),
      doc = randomUUID();
    const api = setting("API_INTERNAL_URL"),
      org = api + "/organizations/" + f.organizationId;
    const record = `${org}/clinics/${clinic}/patients/${patient}`,
      contact = `${record}/guardians/${guardian}`;
    expect(
      (
        await request.put(`${org}/administration/clinics/${clinic}`, {
          headers: staff,
          data: { name: "File test clinic", revision: 0 },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.put(record, {
          headers: staff,
          data: { name: "Pet", species: "Dog", birthDate: null, revision: 0 },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.put(contact, {
          headers: staff,
          data: { name: "Guardian", email: f.staff.email },
        })
      ).status(),
    ).toBe(200);
    const inv = await request.post(contact + "/invitations", {
      headers: staff,
      data: { requestId: randomUUID() },
    });
    expect(inv.status()).toBe(201);
    const { code } = (await inv.json()) as { code: string };
    const link = await request.post(api + "/owner/pet-links/redeem", {
      headers: owner,
      data: { code, requestId: randomUUID() },
    });
    expect(link.status()).toBe(200);
    const { petId } = (await link.json()) as { petId: string };
    const list = api + "/owner/pets/" + petId + "/documents",
      object = record + "/documents/" + doc;
    const bytes = Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n");
    const upload = {
      title: "Clinical report",
      file: { name: "local.pdf", mimeType: "application/pdf", buffer: bytes },
    };
    const saved = await request.put(object, { headers: staff, multipart: upload });
    expect(saved.status()).toBe(200);
    const meta = (await saved.json()) as {
      assetId: string;
      sha256: string;
      sharing: { revision: number };
    };
    expect(meta.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const download = list + "/" + meta.assetId + "/content";
    expect((await request.get(download, { headers: owner })).status()).toBe(404);
    expect((await request.get(list, { headers: owner })).ok()).toBe(true);
    const release = await request.put(object + "/sharing", {
      headers: staff,
      data: { guardianIds: [guardian], revision: meta.sharing.revision },
    });
    expect(release.status()).toBe(200);
    const { revision } = (await release.json()) as { revision: number };
    const content = await request.get(download, { headers: owner });
    expect(content.status()).toBe(200);
    expect(content.headers()["cache-control"]).toBe("no-store");
    expect(content.headers()["content-disposition"]).toContain("attachment");
    expect(await content.body()).toEqual(bytes);
    expect(
      (
        await request.put(object + "/sharing", {
          headers: staff,
          data: { guardianIds: [], revision },
        })
      ).status(),
    ).toBe(200);
    expect((await request.get(download, { headers: owner })).status()).toBe(404);
  } finally {
    await f.cleanup();
  }
});
