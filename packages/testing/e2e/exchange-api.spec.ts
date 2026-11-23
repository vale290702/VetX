import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type APIResponse } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { readExchangeRoute } from "./support/exchange.js";
import { mobileSession, setting, type createIdentity } from "./support/identity.js";

test.use({ trace: "off" });
test.setTimeout(120_000);
async function headers(
  browser: Browser,
  identity: Awaited<ReturnType<typeof createIdentity>>,
  role: "OWNER" | "STAFF",
) {
  const context = await browser.newContext();
  try {
    const session = await mobileSession(await context.newPage(), identity, role);
    return { Authorization: "Bearer " + session.accessToken };
  } finally {
    await context.close();
  }
}
async function success(response: APIResponse) {
  expect(response.status(), response.url()).toBeGreaterThanOrEqual(200);
  expect(response.status(), response.url()).toBeLessThan(300);
  return response.json();
}
test("a guardian exports selected releases for another clinic, which reviews and imports immutable records", async ({
  browser,
  request,
}) => {
  const route = await readExchangeRoute("api");
  const source = await createDirectoryFixture(route.source.organizationId);
  try {
    const dest = await createDirectoryFixture(route.destination.organizationId);
    try {
      const [sender, receiver, owner] = await Promise.all([
        headers(browser, source.admin, "STAFF"),
        headers(browser, dest.admin, "STAFF"),
        headers(browser, source.staff, "OWNER"),
      ]);
      const api = setting("API_INTERNAL_URL");
      for (const [clinic, auth] of [
        [route.source, sender],
        [route.destination, receiver],
      ] as const) {
        await success(
          await request.put(
            api +
              "/organizations/" +
              clinic.organizationId +
              "/administration/clinics/" +
              clinic.clinicId,
            { headers: auth, data: { name: "Exchange clinic", revision: 0 } },
          ),
        );
      }
      const clinicPath = (c: typeof route.source) =>
        api + "/organizations/" + c.organizationId + "/clinics/" + c.clinicId;
      const patient = randomUUID(),
        guardian = randomUUID(),
        note = randomUUID(),
        withheld = randomUUID(),
        document = randomUUID();
      const record = clinicPath(route.source) + "/patients/" + patient,
        contact = record + "/guardians/" + guardian;
      await success(
        await request.put(record, {
          headers: sender,
          data: { name: "Nube", species: "Cat", birthDate: "2023-04-07", revision: 0 },
        }),
      );
      await success(
        await request.put(contact, {
          headers: sender,
          data: { name: "Guardian", email: source.staff.email },
        }),
      );
      const { code } = await success(
        await request.post(contact + "/invitations", {
          headers: sender,
          data: { requestId: randomUUID() },
        }),
      );
      const { petId } = await success(
        await request.post(api + "/owner/pet-links/redeem", {
          headers: owner,
          data: { code, requestId: randomUUID() },
        }),
      );
      const occurrence = "2026-04-01T10:09:08.000Z";
      const history = record + "/encounters/";
      for (const id of [note, withheld]) {
        await success(
          await request.put(history + id, {
            headers: sender,
            data: {
              occurredAt: occurrence,
              reason: id === note ? "Routine examination" : "Unreleased visit",
              subjective: "Owner observation",
              objective: "",
              assessment: "",
              plan: "",
            },
          }),
        );
      }
      await success(
        await request.put(history + note + "/sharing", {
          headers: sender,
          data: { guardianIds: [guardian], revision: 0 },
        }),
      );
      const bytes = Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n");
      const documentUrl = record + "/documents/" + document;
      const meta = await success(
        await request.put(documentUrl, {
          headers: sender,
          multipart: {
            title: "Exam report",
            file: { name: "report.pdf", mimeType: "application/pdf", buffer: bytes },
          },
        }),
      );
      await success(
        await request.put(documentUrl + "/sharing", {
          headers: sender,
          data: { guardianIds: [guardian], revision: meta.sharing.revision },
        }),
      );
      const pet = api + "/owner/pets/" + petId;
      const options = await success(
        await request.get(pet + "/exchange-options", { headers: owner }),
      );
      expect(options.sources[0].destinations).toContainEqual(
        expect.objectContaining(route.destination),
      );
      const choices = await success(
        await request.get(
          pet +
            "/exchange-options/" +
            route.source.organizationId +
            "/" +
            route.source.clinicId +
            "/" +
            patient +
            "/records",
          { headers: owner },
        ),
      );
      expect(choices.records.map((r: { id: string }) => r.id).sort()).toEqual(
        [note, meta.assetId].sort(),
      );
      const selection = {
        source: { ...route.source, patientId: patient },
        destination: route.destination,
        encounterIds: [note],
        documentAssetIds: [meta.assetId],
        includeOwner: false,
      };
      const send = (data: typeof selection) =>
        request.post(pet + "/exports", { headers: owner, data });
      expect((await send({ ...selection, encounterIds: [withheld] })).status()).toBe(404);
      expect((await send({ ...selection, destination: route.source })).status()).toBe(403);
      const archive = await send(selection);
      expect(archive.status()).toBe(200);
      expect(archive.headers()["cache-control"]).toBe("no-store");
      expect(archive.headers()["content-disposition"]).toContain(".vetpkg");
      const encrypted = await archive.body();
      expect(encrypted.includes(Buffer.from("Routine examination"))).toBe(false);
      const imports = clinicPath(route.destination) + "/exchange/imports";
      const upload = (buffer: Buffer, auth = receiver) =>
        request.post(imports + "/preview", {
          headers: auth,
          multipart: {
            file: { name: "transfer.vetpkg", mimeType: "application/octet-stream", buffer },
          },
        });
      expect((await upload(encrypted, sender)).status()).toBe(403);
      const preview = await success(await upload(encrypted));
      expect(preview.owner).toBeUndefined();
      expect(preview.patient).toMatchObject({ id: patient, name: "Nube" });
      expect(preview.recordCount).toBe(2);
      const commit = () =>
        request.put(imports + "/" + preview.receiptId + "/commit", {
          headers: receiver,
          data: { mode: "create" },
        });
      const result = await success(await commit());
      expect(result.inserted).toBe(2);
      expect(await success(await commit())).toEqual(result);
      const imported =
        clinicPath(route.destination) + "/patients/" + result.patientId + "/imported-records";
      const records = await success(await request.get(imported, { headers: receiver }));
      expect(records.records).toHaveLength(2);
      const original = records.records.find((r: { kind: string }) => r.kind === "encounter");
      expect(original).toMatchObject({
        source: { ...route.source, patientId: patient },
        author: { subject: source.admin.id },
        data: { reason: "Routine examination" },
      });
      expect(Date.parse(original.occurredAt)).toBe(Date.parse(occurrence));
      const file = records.records.find((r: { id: string }) => r.id === meta.assetId);
      const opened = await request.get(imported + "/" + file.importedId + "/content", {
        headers: receiver,
      });
      expect(opened.status()).toBe(200);
      expect(await opened.body()).toEqual(bytes);
      const consented = await send({ ...selection, includeOwner: true });
      expect(consented.status()).toBe(200);
      const repeat = await success(await upload(await consented.body()));
      expect(repeat.owner).toMatchObject({ email: source.staff.email });
      expect(repeat.mappedPatientId).toBe(result.patientId);
      const matched = await success(
        await request.put(imports + "/" + repeat.receiptId + "/commit", {
          headers: receiver,
          data: { mode: "match", patientId: result.patientId },
        }),
      );
      expect(matched).toMatchObject({ inserted: 0, skipped: 2 });
      await success(
        await request.put(history + note + "/sharing", {
          headers: sender,
          data: { guardianIds: [], revision: 1 },
        }),
      );
      expect((await send(selection)).status()).toBe(404);
    } finally {
      await dest.cleanup();
    }
  } finally {
    await source.cleanup();
  }
});
