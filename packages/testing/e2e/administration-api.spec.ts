import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { mobileSession, setting, type createIdentity } from "./support/identity.js";

test.use({ trace: "off" });

async function staffHeaders(browser: Browser, user: Awaited<ReturnType<typeof createIdentity>>) {
  const context = await browser.newContext();
  try {
    const session = await mobileSession(await context.newPage(), user, "STAFF");
    return { Authorization: `Bearer ${session.accessToken}` };
  } finally {
    await context.close();
  }
}

test("an administrator's grants and revocations take effect for an already signed-in employee", async ({
  browser,
  request,
}) => {
  const fixture = await createDirectoryFixture();
  const api = setting("API_INTERNAL_URL");
  const org = `${api}/organizations/${fixture.organizationId}`;
  const clinic = randomUUID();
  try {
    const admin = await staffHeaders(browser, fixture.admin);
    const staff = await staffHeaders(browser, fixture.staff);
    const first = await request.get(`${org}/administration`, { headers: admin });
    expect(first.status()).toBe(200);
    const { revision } = (await first.json()) as { revision: number };
    const addClinic = await request.put(`${org}/administration/clinics/${clinic}`, {
      headers: admin,
      data: { name: "Morning clinic", revision },
    });
    expect(addClinic.status()).toBe(200);
    const next = (await addClinic.json()) as { revision: number };
    const membership = {
      subject: fixture.staff.id,
      role: "STAFF",
      clinicIds: [clinic],
      revision: next.revision,
    };
    const assigned = await request.put(`${org}/administration/members`, {
      headers: admin,
      data: membership,
    });
    expect(assigned.status()).toBe(200);
    const saved = (await assigned.json()) as { revision: number };
    expect(
      (
        await request.put(`${org}/administration/members`, { headers: admin, data: membership })
      ).status(),
    ).toBe(200);
    expect(await (await request.get(`${org}/clinics`, { headers: staff })).json()).toEqual({
      clinics: [{ id: clinic, name: "Morning clinic" }],
    });
    expect((await request.get(`${org}/administration`, { headers: staff })).status()).toBe(403);
    const stale = await request.put(`${org}/administration/clinics/${clinic}`, {
      headers: admin,
      data: { name: "Another name", revision },
    });
    expect(stale.status()).toBe(409);
    const last = await request.post(`${org}/administration/members/revoke`, {
      headers: admin,
      data: { subject: fixture.admin.id, revision: saved.revision },
    });
    expect(last.status()).toBe(409);
    expect((await last.json()).error.code).toBe("LAST_ORGANIZATION_ADMIN");
    const revoked = await request.post(`${org}/administration/members/revoke`, {
      headers: admin,
      data: { subject: fixture.staff.id, revision: saved.revision },
    });
    expect(revoked.status()).toBe(200);
    expect((await request.get(`${org}/clinics`, { headers: staff })).status()).toBe(403);
    expect(await (await request.get(`${api}/me`, { headers: staff })).json()).toEqual({
      subject: fixture.staff.id,
      organizations: [],
    });
  } finally {
    await fixture.cleanup();
  }
});
