import { randomUUID } from "node:crypto";
import { expect, type Page, type Browser, type APIRequestContext } from "@playwright/test";
import { createDirectoryFixture } from "./directory.js";
import { mobileSession, enterCredentials, setting } from "./identity.js";

export async function openClinicalChart(page: Page, browser: Browser, request: APIRequestContext) {
  const f = await createDirectoryFixture(),
    setup = await browser.newContext();
  const clinicId = randomUUID(),
    patientId = randomUUID(),
    encounterId = randomUUID(),
    guardianId = randomUUID();
  const org = "/organizations/" + f.organizationId,
    patient = org + "/clinics/" + clinicId + "/patients/" + patientId;
  const api = setting("API_INTERNAL_URL"),
    stamp = "2026-11-22T15:00:22.123Z";
  try {
    const staff = await mobileSession(await setup.newPage(), f.admin, "STAFF");
    const headers = { Authorization: "Bearer " + staff.accessToken };
    for (const [url, data] of [
      [org + "/administration/clinics/" + clinicId, { name: "Clinical services", revision: 0 }],
      [patient, { name: "Luna", species: "Cat", birthDate: null, revision: 0 }],
      [
        patient + "/encounters/" + encounterId,
        {
          occurredAt: stamp,
          reason: "Annual visit",
          subjective: "Routine visit",
          objective: "",
          assessment: "",
          plan: "",
        },
      ],
      [patient + "/guardians/" + guardianId, { name: "Ari Vega", email: f.staff.email }],
    ] as const) {
      expect((await request.put(api + url, { headers, data })).ok()).toBe(true);
    }
    const invite = await request.post(api + patient + "/guardians/" + guardianId + "/invitations", {
      headers,
      data: { requestId: randomUUID() },
    });
    expect(invite.ok()).toBe(true);
    await setup.clearCookies();
    const owner = await mobileSession(await setup.newPage(), f.staff, "OWNER"),
      ownerHeaders = { Authorization: "Bearer " + owner.accessToken };
    const pet = await request.post(api + "/owner/pet-links/redeem", {
      headers: ownerHeaders,
      data: { code: (await invite.json()).code, requestId: randomUUID() },
    });
    expect(pet.ok()).toBe(true);
    const ownerUrl = api + "/owner/pets/" + (await pet.json()).petId + "/clinical-records";
    async function ownerRecords() {
      const res = await request.get(ownerUrl, { headers: ownerHeaders });
      expect(res.ok()).toBe(true);
      return (await res.json()).records;
    }
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, f.admin);
    await expect(page.getByRole("link", { name: f.organizationName })).toBeVisible();
    await page.goto("/en" + patient);
    await page.getByRole("link", { name: "Clinical records", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Clinical records for Luna" })).toBeVisible();
    return {
      encounterId,
      endpoint: `/clinical/${f.organizationId}/${clinicId}/${patientId}`,
      ownerRecords,
      cleanup: f.cleanup,
    };
  } catch (error) {
    await f.cleanup();
    throw error;
  } finally {
    await setup.close();
  }
}
