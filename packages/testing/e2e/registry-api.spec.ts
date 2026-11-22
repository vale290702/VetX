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
    const timeline = `${api}/owner/pets/${petId}/encounters`;
    const id = randomUUID();
    const note = `${record}/encounters/${id}`;
    const clinical = {
      occurredAt: "2026-02-20T13:00:00-06:00",
      reason: "Clinical review",
      subjective: "",
      objective: "",
      assessment: "",
      plan: "Schedule follow-up",
    };
    const readTimeline = async () => {
      const response = await request.get(timeline, { headers: owner });
      expect(response.status()).toBe(200);
      return (await response.json()) as { encounters: Record<string, unknown>[] };
    };
    await test.step("record a private encounter and explicitly release it to the linked guardian", async () => {
      const saved = await request.put(note, { headers: operator, data: clinical });
      expect(saved.status()).toBe(200);
      const original = (await saved.json()) as { sharing: { revision: number } };
      expect((await readTimeline()).encounters).toEqual([]);
      const release = await request.put(note + "/sharing", {
        headers: operator,
        data: { guardianIds: [guardian], revision: original.sharing.revision },
      });
      expect(release.status()).toBe(200);
      const timelineNote = (await readTimeline()).encounters[0];
      expect(timelineNote).toMatchObject({
        id,
        clinicId: clinic,
        patientId: patient,
        reason: clinical.reason,
        plan: clinical.plan,
        occurredAt: "2026-02-20T19:00:00.000Z",
      });
      expect(timelineNote).not.toHaveProperty("authorSubject");
      expect(timelineNote).not.toHaveProperty("sharing");
      expect(
        (
          await request.put(note, {
            headers: operator,
            data: { ...clinical, assessment: "Changed in place" },
          })
        ).status(),
      ).toBe(409);
      const rev = (await release.json()) as { revision: number };
      expect(
        (
          await request.put(note + "/sharing", {
            headers: operator,
            data: { guardianIds: [], revision: rev.revision },
          })
        ).status(),
      ).toBe(200);
      expect((await readTimeline()).encounters).toEqual([]);
    });
    await test.step("book, detect an overlapping visit, then release the time by cancelling", async () => {
      const appointments = `${org}/clinics/${clinic}/appointments`;
      const slot = {
        patientId: patient,
        startAt: "2026-02-20T12:00:00-06:00",
        endAt: "2026-02-20T12:30:00-06:00",
        reason: "Clinical review",
        status: "BOOKED",
        revision: 0,
      };
      const address = appointments + "/" + randomUUID();
      const booked = await request.put(address, { headers: operator, data: slot });
      expect(booked.status()).toBe(200);
      const { revision } = (await booked.json()) as { revision: number };
      const nextAddress = appointments + "/" + randomUUID();
      const overlaps = await request.put(nextAddress, { headers: operator, data: slot });
      expect(overlaps.status()).toBe(409);
      expect(await overlaps.json()).toMatchObject({ error: { code: "APPOINTMENT_OVERLAP" } });
      expect(
        (
          await request.put(address, {
            headers: operator,
            data: { ...slot, revision, status: "CANCELLED" },
          })
        ).status(),
      ).toBe(200);
      expect((await request.put(nextAddress, { headers: operator, data: slot })).status()).toBe(
        200,
      );
    });
    expect((await request.delete(address, { headers: operator })).status()).toBe(204);
    expect(await (await request.get(`${api}/owner/pets`, { headers: owner })).json()).toEqual({
      pets: [],
    });
  } finally {
    await f.cleanup();
  }
});
