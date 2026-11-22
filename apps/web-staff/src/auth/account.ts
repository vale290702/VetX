import "server-only";

import { createVetxClient } from "@vetx/api-client";
import { cookies } from "next/headers";

import { readSessionAccess } from "./flows.ts";
import { authCookieNames } from "./http.ts";
import { getWebAuthRuntime } from "./runtime.ts";
import { providerTimeoutSeconds } from "./security.ts";

export async function loadStaffAccount(locale: string) {
  try {
    const runtime = getWebAuthRuntime();
    if (!runtime) return { kind: "disabled" } as const;
    const { config, oidc, store } = runtime;
    const sessionId = (await cookies()).get(authCookieNames(config.webOrigin).session)?.value;
    const access = await readSessionAccess(sessionId, oidc, store);
    if (access.kind === "locked") console.warn("Unable to verify the staff session.");
    if (access.kind !== "active") return access;
    const { session } = access;

    const accountUrl = new URL(
      `${config.issuer.pathname.replace(/\/$/, "")}/account/`,
      config.issuer.origin,
    );
    accountUrl.searchParams.set("kc_locale", locale);
    const { subject, username, csrf } = session;
    const organizationProfile = await loadOrganizationProfile(
      config.apiOrigin,
      session.accessToken,
      subject,
    );
    return {
      kind: "authenticated",
      username: username ?? subject,
      csrf,
      accountUrl,
      organizationProfile,
    } as const;
  } catch {
    console.warn("Unable to read the staff session.");
    return { kind: "unavailable" } as const;
  }
}

async function loadOrganizationProfile(
  apiOrigin: string,
  accessToken: string,
  expectedSubject: string,
) {
  try {
    const { data } = await createVetxClient(apiOrigin).GET("/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(providerTimeoutSeconds * 1_000),
    });
    if (data?.subject === expectedSubject) return data.organizations;
  } catch {
    console.warn("Unable to load staff organizations from the API.");
  }
  return null;
}
