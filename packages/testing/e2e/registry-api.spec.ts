import { randomUUID } from "node:crypto";
import { test, expect, type Browser } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { mobileSession, setting, type createIdentity } from "./support/identity.js";

test.use({ trace: "off" });
async function authorization(
  browser: Browser,
  user: Awaited<ReturnType<typeof createIdentity>>,
  role: "STAFF" | "OWNER",
) {
  const context = await browser.newContext();
  try {
    const session = await mobileSession(await context.newPage(), user, role);
    return { Authorization: `Bearer ${session.accessToken}` };
  } finally {
    await context.close();
  }
}

test("only the intended guardian can link a clinic record and revocation removes it from an active owner session", async ({
  browser,
  request,
}) => {
  const f = await createDirectoryFixture();
  try {
    const operator = await authorization(browser, f.admin, "STAFF");
    const other = await authorization(browser, f.admin, "OWNER");
    const owner = await authorization(browser, f.staff, "OWNER");
    const clinic = randomUUID(),
      patient = randomUUID(),
      guardian = randomUUID();
    const api = setting("API_INTERNAL_URL"),
      org = `${api}/organizations/${f.organizationId}`;
    const record = `${org}/clinics/${clinic}/patients/${patient}`;
    expect(
      (
        await request.put(`${org}/administration/clinics/${clinic}`, {
          headers: operator,
          data: { name: "VetX test clinic", revision: 0 },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.put(record, {
          headers: operator,
          data: { name: "VetX patient", species: "Dog", birthDate: null, revision: 0 },
        })
      ).status(),
    ).toBe(200);
    const address = `${record}/guardians/${guardian}`;
    expect(
      (
        await request.put(address, {
          headers: operator,
          data: { name: "Test guardian", email: f.staff.email },
        })
      ).status(),
    ).toBe(200);
    const invitation = await request.post(`${address}/invitations`, {
      headers: operator,
      data: { requestId: randomUUID() },
    });
    expect(invitation.status()).toBe(201);
    const { code } = (await invitation.json()) as { code: string };
    const target = `${api}/owner/pet-links/redeem`;
    expect(
      (
        await request.post(target, { headers: other, data: { code, requestId: randomUUID() } })
      ).status(),
    ).toBe(404);
    const retry = { code, requestId: randomUUID() };
    const redeemed = await request.post(target, { headers: owner, data: retry });
    expect(redeemed.status()).toBe(200);
    const { petId } = (await redeemed.json()) as { petId: string };
    expect(petId).toBeTruthy();
    expect(await (await request.post(target, { headers: owner, data: retry })).json()).toEqual({
      petId,
    });
    expect(
      (
        await request.post(target, { headers: owner, data: { code, requestId: randomUUID() } })
      ).status(),
    ).toBe(404);
    expect(await (await request.get(`${api}/owner/pets`, { headers: owner })).json()).toEqual({
      pets: [
        {
          id: petId,
          name: "VetX patient",
          species: "Dog",
          clinics: [
            {
              recordId: patient,
              clinicId: clinic,
              clinicName: "VetX test clinic",
              organizationName: f.organizationName,
            },
          ],
        },
      ],
    });
    expect((await request.get(record, { headers: owner })).status()).toBe(403);
    expect((await request.delete(address, { headers: operator })).status()).toBe(204);
    expect(await (await request.get(`${api}/owner/pets`, { headers: owner })).json()).toEqual({
      pets: [],
    });
  } finally {
    await f.cleanup();
  }
});
