import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createDirectoryFixture } from "./support/directory.js";
import { readExchangeRoute } from "./support/exchange.js";
import {
  enterCredentials,
  mobileSession,
  setting,
  type createIdentity,
} from "./support/identity.js";

type Identity = Awaited<ReturnType<typeof createIdentity>>;
async function headers(browser: Browser, user: Identity, role: "OWNER" | "STAFF") {
  const context = await browser.newContext();
  try {
    const token = await mobileSession(await context.newPage(), user, role);
    return { Authorization: "Bearer " + token.accessToken };
  } finally {
    await context.close();
  }
}
async function signIn(page: Page, identity: Identity, org: string) {
  await page.goto("/en");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await enterCredentials(page, identity);
  await page.getByRole("link", { name: org }).click();
}

test.use({ trace: "off" });
test.setTimeout(120_000);
test("a receiving clinic sees a referral after guardian approval and returns its counter-referral", async ({
  browser,
  page,
  request,
  baseURL,
}, testInfo) => {
  const route = await readExchangeRoute(
    testInfo.project.name === "mobile-dark" ? "referral-mobile-dark" : "referral-desktop",
  );
  const source = await createDirectoryFixture(route.source.organizationId);
  try {
    const dest = await createDirectoryFixture(route.destination.organizationId);
    const receiving = await browser.newContext({
      baseURL,
      viewport: page.viewportSize(),
      colorScheme: testInfo.project.use.colorScheme,
    });
    try {
      const [sourceAuth, destAuth, owner] = await Promise.all([
        headers(browser, source.admin, "STAFF"),
        headers(browser, dest.admin, "STAFF"),
        headers(browser, source.staff, "OWNER"),
      ]);
      const api = setting("API_INTERNAL_URL"),
        registry =
          api +
          "/organizations/" +
          source.organizationId +
          "/clinics/" +
          route.source.clinicId +
          "/patients/";
      for (const [scope, name, auth] of [
        [route.source, "Primaria", sourceAuth],
        [route.destination, "Especialidad", destAuth],
      ] as const) {
        expect(
          (
            await request.put(
              `${api}/organizations/${scope.organizationId}/administration/clinics/${scope.clinicId}`,
              { headers: auth, data: { name, revision: 0 } },
            )
          ).status(),
        ).toBe(200);
      }
      const patientId = randomUUID(),
        guardian = randomUUID(),
        record = registry + patientId;
      expect(
        (
          await request.put(record, {
            headers: sourceAuth,
            data: { name: "Mora", species: "Perro", birthDate: null, revision: 0 },
          })
        ).status(),
      ).toBe(200);
      const guardianPath = record + "/guardians/" + guardian;
      expect(
        (
          await request.put(guardianPath, {
            headers: sourceAuth,
            data: { name: "Vale Mora", email: source.staff.email },
          })
        ).status(),
      ).toBe(200);
      const invitation = await request.post(guardianPath + "/invitations", {
        headers: sourceAuth,
        data: { requestId: randomUUID() },
      });
      expect(invitation.status()).toBe(201);
      const redeemed = await request.post(api + "/owner/pet-links/redeem", {
        headers: owner,
        data: { code: (await invitation.json()).code, requestId: randomUUID() },
      });
      expect(redeemed.status()).toBe(200);
      const pet = (await redeemed.json()).petId,
        ownerList = `${api}/owner/pets/${pet}/referrals`;

      await signIn(page, source.admin, source.organizationName);
      await page.getByRole("link", { name: "Patients at Primaria" }).click();
      await page.getByRole("link", { name: "Mora", exact: true }).click();
      await page.getByRole("link", { name: "Patient referrals", exact: true }).click();
      const form = page.getByRole("form", { name: "Request a referral" });
      await form.getByLabel("Guardian for approval").selectOption(guardian);
      await form
        .getByLabel("Destination clinic")
        .selectOption(route.destination.organizationId + "/" + route.destination.clinicId);
      await form.getByLabel("Reason for referral").fill("Cardiology consultation");
      await form.getByLabel("Clinical summary (optional)").fill("Intermittent cough at night.");
      const submit = form.getByRole("button", { name: "Request guardian approval" });
      // The successful first request is repeated using the original request ID after a lost response.
      const attempts: string[] = [];
      await page.route("**/referrals/**/patients/*/*", async (r) => {
        attempts.push(r.request().url());
        if (attempts.length === 1) {
          expect((await r.fetch()).status()).toBe(204);
          return r.fulfill({ status: 503, body: "" });
        }
        return r.continue();
      });
      await submit.click();
      await expect(form.getByRole("alert")).toContainText("Try again");
      const reason = form.getByLabel("Reason for referral");
      await reason.fill("Adding a detail");
      await reason.fill("Cardiology consultation");
      await submit.click();
      await expect(form.getByRole("status")).toContainText("Referral requested");
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toBe(attempts[1]);
      await page.unroute("**/referrals/**/patients/*/*");
      const noCsrf = await page.request.post(attempts[0]!, {
        headers: { Origin: new URL(page.url()).origin },
        data: {},
      });
      expect(noCsrf.status()).toBe(403);

      const receiver = await receiving.newPage();
      await signIn(receiver, dest.admin, dest.organizationName);
      await receiver.getByRole("link", { name: "Referrals at Especialidad", exact: true }).click();
      await expect(receiver.getByText("This clinic has no incoming referrals.")).toBeVisible();
      const list = await request.get(ownerList, { headers: owner });
      expect(list.status()).toBe(200);
      const { referrals } = await list.json();
      expect(referrals).toHaveLength(1);
      const [ref] = referrals;
      const decision = ownerList + "/" + ref.id + "/decision";
      const approve = await request.put(decision, {
        headers: owner,
        data: { action: "approve", revision: ref.revision },
      });
      expect(approve.status()).toBe(200);
      await receiver.getByRole("button", { name: "Refresh referrals" }).click();
      const row = receiver
        .getByRole("listitem")
        .filter({ has: receiver.getByRole("heading", { name: "Cardiology consultation" }) });
      await expect(row.getByText("Intermittent cough at night.")).toBeVisible();
      await row.getByLabel("Response to the referring clinic").fill("Schedule an echocardiogram.");
      await row.getByRole("button", { name: "Send counter-referral" }).click();
      await expect(row.getByText("Counter-referral recorded")).toBeVisible();
      await page.getByRole("button", { name: "Refresh referrals" }).click();
      await expect(page.getByText("Schedule an echocardiogram.")).toBeVisible();
      await page.getByRole("link", { name: "Clinic referrals", exact: true }).click();
      await expect(page.getByRole("link", { name: "Outgoing", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByText("Schedule an echocardiogram.")).toBeVisible();
      const latest = (await (await request.get(ownerList, { headers: owner })).json()).referrals[0];
      expect(latest.status).toBe("RESPONDED");
      expect(latest.response.summary).toBe("Schedule an echocardiogram.");
      expect(
        (
          await request.put(decision, {
            headers: owner,
            data: { action: "withdraw", revision: latest.revision },
          })
        ).status(),
      ).toBe(200);
      await receiver.getByRole("button", { name: "Refresh referrals" }).click();
      await expect(receiver.getByText("This clinic has no incoming referrals.")).toBeVisible();
      await page.getByRole("link", { name: "Español" }).click();
      await expect(page.getByText("Autorización retirada")).toBeVisible();
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
      await receiving.close();
      await dest.cleanup();
    }
  } finally {
    await source.cleanup();
  }
});
