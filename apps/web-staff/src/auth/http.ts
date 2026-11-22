import "server-only";

import { defaultLocale, isLocale, type Locale } from "@vetx/i18n";
import { NextResponse } from "next/server";

export const authMessages = ["loginFailed", "unavailable", "providerLogoutFailed"] as const;
export type AuthMessage = (typeof authMessages)[number];

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

export function authRedirect(url: URL): NextResponse {
  return NextResponse.redirect(url, { status: 303, headers });
}

export function authRejected(status: 400 | 403 | 503): NextResponse {
  return new NextResponse(null, { status, headers });
}

export function staffRedirect(origin: URL, locale: Locale, message?: AuthMessage): NextResponse {
  const url = new URL(`/${locale}`, origin);
  if (message) url.searchParams.set("auth", message);
  return authRedirect(url);
}

export function formLocale(form: FormData): Locale {
  const value = form.get("locale");
  return isLocale(value) ? value : defaultLocale;
}

export function authCookieNames(origin: URL) {
  const prefix = origin.protocol === "https:" ? "__Host-" : "";
  return { session: `${prefix}vetx-session`, login: `${prefix}vetx-login` };
}

export function setAuthCookie(
  response: NextResponse,
  origin: URL,
  name: string,
  value: string,
  maxAge: number,
) {
  response.cookies.set(name, value, {
    maxAge,
    httpOnly: true,
    secure: origin.protocol === "https:",
    sameSite: "lax",
    path: "/",
  });
}
