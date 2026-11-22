import { defaultLocale } from "@vetx/i18n";
import type { NextRequest } from "next/server";

import { finishLogin } from "../../../auth/flows.ts";
import { authCookieNames, authRejected, setAuthCookie, staffRedirect } from "../../../auth/http.ts";
import { getWebAuthRuntime } from "../../../auth/runtime.ts";
import { createSecret, isSecret, sessionLifetimeSeconds } from "../../../auth/security.ts";

export async function GET(request: NextRequest) {
  let auth;
  try {
    auth = getWebAuthRuntime();
  } catch {
    return authRejected(503);
  }
  if (!auth) return authRejected(503);
  const { config, oidc, store } = auth;
  const names = authCookieNames(config.webOrigin);
  let locale: "es" | "en" = defaultLocale;
  try {
    const login = await finishLogin(
      config.webOrigin,
      request.nextUrl,
      request.cookies.get(names.login)?.value,
      oidc,
      store,
    );
    if (!login) return staffRedirect(config.webOrigin, locale, "loginFailed");
    locale = login.locale;
    if (!login.session) {
      const response = staffRedirect(config.webOrigin, locale, "loginFailed");
      setAuthCookie(response, config.webOrigin, names.login, "", 0);
      return response;
    }

    const previous = request.cookies.get(names.session)?.value;
    if (isSecret(previous)) await store.removeSession(previous);
    const id = createSecret();
    await store.createSession(id, login.session);
    const response = staffRedirect(config.webOrigin, locale);
    setAuthCookie(response, config.webOrigin, names.session, id, sessionLifetimeSeconds);
    setAuthCookie(response, config.webOrigin, names.login, "", 0);
    return response;
  } catch {
    console.warn("Unable to complete staff authorization.");
    return staffRedirect(config.webOrigin, locale, "unavailable");
  }
}
