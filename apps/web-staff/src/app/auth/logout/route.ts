import type { NextRequest } from "next/server";

import { signOutSession } from "../../../auth/flows.ts";

import {
  authCookieNames,
  authRedirect,
  authRejected,
  formLocale,
  setAuthCookie,
  staffRedirect,
} from "../../../auth/http.ts";
import { getWebAuthRuntime } from "../../../auth/runtime.ts";
import { isSameOriginPost, isSecret } from "../../../auth/security.ts";

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = getWebAuthRuntime();
  } catch {
    return authRejected(503);
  }
  if (!auth) return authRejected(503);
  const { config, oidc, store } = auth;
  if (!isSameOriginPost(request, config.webOrigin)) return authRejected(403);
  const name = authCookieNames(config.webOrigin).session;
  const id = request.cookies.get(name)?.value;
  if (!isSecret(id)) return authRejected(403);
  let form;
  try {
    form = await request.formData();
  } catch {
    return authRejected(400);
  }
  const locale = formLocale(form);
  try {
    const logout = await signOutSession(id, form.get("csrf"), oidc, store);
    if (logout.kind === "rejected") return authRejected(403);
    if (logout.kind === "local") console.warn("Unable to initiate staff sign-out at Keycloak.");
    const response =
      logout.kind === "provider"
        ? authRedirect(logout.destination)
        : staffRedirect(config.webOrigin, locale, "providerLogoutFailed");
    setAuthCookie(response, config.webOrigin, name, "", 0);
    return response;
  } catch {
    console.warn("Unable to remove the staff session from its store.");
    return staffRedirect(config.webOrigin, locale, "unavailable");
  }
}
