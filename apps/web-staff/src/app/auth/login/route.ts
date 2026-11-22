import { beginLogin } from "../../../auth/flows.ts";
import {
  authCookieNames,
  authRedirect,
  authRejected,
  formLocale,
  setAuthCookie,
  staffRedirect,
} from "../../../auth/http.ts";
import { getWebAuthRuntime } from "../../../auth/runtime.ts";
import { isSameOriginPost, loginLifetimeSeconds } from "../../../auth/security.ts";

export async function POST(request: Request) {
  let auth;
  try {
    auth = getWebAuthRuntime();
  } catch {
    return authRejected(503);
  }
  if (!auth) return authRejected(503);
  const { config, oidc, store } = auth;
  if (!isSameOriginPost(request, config.webOrigin)) return authRejected(403);
  let form;
  try {
    form = await request.formData();
  } catch {
    return authRejected(400);
  }
  const locale = formLocale(form);
  try {
    const { browserId, authorizationUrl } = await beginLogin(locale, oidc, store);
    const response = authRedirect(authorizationUrl);
    setAuthCookie(
      response,
      config.webOrigin,
      authCookieNames(config.webOrigin).login,
      browserId,
      loginLifetimeSeconds,
    );
    return response;
  } catch {
    console.warn("Unable to start staff authorization.");
    return staffRedirect(config.webOrigin, locale, "unavailable");
  }
}
