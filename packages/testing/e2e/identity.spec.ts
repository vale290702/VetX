import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import {
  authenticatorCode,
  createIdentity,
  enterCredentials,
  mobileSession,
  revokeSession,
  setting,
} from "./support/identity.js";

test.use({ trace: "off" });
test.setTimeout(90_000);

test("independent web sessions survive another browser signing out and honor provider revocation", async ({
  browser,
  baseURL,
}) => {
  const user = await createIdentity();
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  try {
    const first = await a.newPage();
    const second = await b.newPage();
    for (const page of [first, second]) {
      await page.goto("/en");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await enterCredentials(page, user);
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    }
    expect(await user.sessions()).toHaveLength(2);
    await first.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(first.getByRole("button", { name: /^(Sign in|Iniciar sesión)$/ })).toBeVisible();
    await second.reload();
    await expect(second.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    const sessions = await user.sessions();
    expect(sessions).toHaveLength(1);
    await revokeSession(sessions[0]!.id);
    await second.reload();
    await expect(second.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  } finally {
    await Promise.all([a.close(), b.close()]);
    await user.remove();
  }
});

test("the same identity receives clinic access only through an authorized staff client", async ({
  browser,
  request,
}) => {
  const user = await createIdentity();
  const runtime = new URL(setting("DATABASE_URL"));
  runtime.username = "vetx_bootstrap";
  runtime.password = setting("POSTGRES_PASSWORD");
  const db = new pg.Client({ connectionString: runtime.href });
  const org = randomUUID(),
    clinic = randomUUID(),
    userId = randomUUID();
  const api = setting("API_INTERNAL_URL");
  try {
    await db.connect();
    await db.query("BEGIN");
    await db.query("INSERT INTO organizations (id,name) VALUES ($1,'VetX test')", [org]);
    await db.query("INSERT INTO clinics (id,organization_id,name) VALUES ($1,$2,'VetX test')", [
      clinic,
      org,
    ]);
    await db.query("INSERT INTO users (id,identity_issuer,identity_subject) VALUES ($1,$2,$3)", [
      userId,
      setting("OIDC_ISSUER_URL"),
      user.id,
    ]);
    await db.query(
      "INSERT INTO organization_memberships (organization_id,user_id,role) VALUES ($1,$2,'STAFF')",
      [org, userId],
    );
    await db.query(
      "INSERT INTO clinic_grants (organization_id,clinic_id,user_id) VALUES ($1,$2,$3)",
      [org, clinic, userId],
    );
    await db.query("COMMIT");
    for (const role of ["STAFF", "OWNER"] as const) {
      const context = await browser.newContext();
      try {
        const session = await mobileSession(await context.newPage(), user, role);
        const headers = { Authorization: `Bearer ${session.accessToken}` };
        const me = await request.get(api + "/me", { headers });
        expect(me.status()).toBe(200);
        expect(await me.json()).toEqual({
          subject: user.id,
          organizations: role === "STAFF" ? [{ id: org, name: "VetX test" }] : [],
        });
        const permitted = await request.get(`${api}/organizations/${org}/clinics`, { headers });
        expect(permitted.status()).toBe(role === "STAFF" ? 200 : 403);
        if (role === "STAFF")
          expect(await permitted.json()).toEqual({ clinics: [{ id: clinic, name: "VetX test" }] });
        expect(
          (await request.get(`${api}/organizations/${randomUUID()}/clinics`, { headers })).status(),
        ).toBe(403);
        await session.revoke();
        expect((await request.get(api + "/me", { headers })).status()).toBe(401);
      } finally {
        await context.close();
      }
    }
  } finally {
    try {
      await db.query("ROLLBACK");
      await db.query("DELETE FROM clinic_grants WHERE organization_id=$1", [org]);
      await db.query("DELETE FROM organization_memberships WHERE organization_id=$1", [org]);
      await db.query("DELETE FROM clinics WHERE id=$1", [clinic]);
      await db.query("DELETE FROM organizations WHERE id=$1", [org]);
      await db.query("DELETE FROM users WHERE id=$1", [userId]);
    } finally {
      await db.end();
      await user.remove();
    }
  }
});

test("password recovery delivers a usable link to the local mail inbox", async ({
  page,
  browser,
  request,
}) => {
  const user = await createIdentity();
  const inbox = new URL(`http://127.0.0.1:${setting("MAILPIT_PORT")}`);
  const search = new URL("/api/v1/search", inbox);
  search.searchParams.set("query", `to:${user.username}@example.test`);
  try {
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator('a[href*="reset-credentials"]').click();
    await page.locator('input[name="username"]').fill(user.username);
    await page.locator('form input[type="submit"], form button[type="submit"]').click();
    let mailId: string | undefined;
    await expect
      .poll(async () => {
        const response = await request.get(search.href);
        const mailbox = (await response.json()) as { messages: Array<{ ID: string }> };
        mailId = mailbox.messages[0]?.ID;
        return Boolean(mailId);
      })
      .toBe(true);
    const message = await request.get(new URL(`/api/v1/message/${mailId}`, inbox).href);
    const { HTML } = (await message.json()) as { HTML: string };
    const reset = await page.evaluate(
      (html) =>
        new DOMParser()
          .parseFromString(html, "text/html")
          .querySelector<HTMLAnchorElement>('a[href*="/login-actions/action-token"]')?.href,
      HTML,
    );
    if (!reset || new URL(reset).origin !== new URL(setting("OIDC_ISSUER_URL")).origin)
      throw new Error("Recovery message did not contain a local Keycloak link");
    await page.goto(reset);
    const newPassword = randomUUID() + randomUUID();
    await page.locator("#password-new").fill(newPassword);
    await page.locator("#password-confirm").fill(newPassword);
    await page.locator('form input[type="submit"], form button[type="submit"]').click();
    const context = await browser.newContext();
    try {
      await mobileSession(await context.newPage(), { ...user, password: newPassword }, "OWNER");
    } finally {
      await context.close();
    }
  } finally {
    await user.remove();
  }
});

test("a user can enroll an authenticator and sign in again with a second factor", async ({
  page,
  browser,
  baseURL,
}) => {
  const user = await createIdentity(["CONFIGURE_TOTP"]);
  const anotherBrowser = await browser.newContext({ baseURL });
  try {
    await page.goto("/en");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(page, user);
    await expect(page.locator("#totp")).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(setting("OIDC_ISSUER_URL")).origin);
    const secret = await page.locator("#totpSecret").inputValue();
    const enrollment = authenticatorCode(secret);
    await page.locator("#totp").fill(enrollment);
    await page.locator("#userLabel").fill("Test authenticator");
    await page.locator('#kc-totp-settings-form [type="submit"]').first().click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

    const second = await anotherBrowser.newPage();
    await second.goto("/en");
    await second.getByRole("button", { name: "Sign in", exact: true }).click();
    await enterCredentials(second, user);
    await expect(second.locator('input[name="otp"]')).toBeVisible();
    await expect
      .poll(() => authenticatorCode(secret) !== enrollment, { timeout: 35_000 })
      .toBe(true);
    await second.locator('input[name="otp"]').fill(authenticatorCode(secret));
    await second.locator('#kc-otp-login-form [type="submit"]').click();
    await expect(second.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  } finally {
    await anotherBrowser.close();
    await user.remove();
  }
});
