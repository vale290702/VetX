import type { Locale } from "@vetx/i18n";
import { createTranslator } from "next-intl";
import en from "../../../../packages/i18n/locales/web-referrals.en.json";
import es from "../../../../packages/i18n/locales/web-referrals.es.json";
const catalog = { en, es } satisfies Record<Locale, typeof en>;
export function referralMessages(locale: Locale) {
  return createTranslator({ locale, messages: catalog[locale] });
}
export function noticeForReferral(status: number) {
  switch (status) {
    case 400:
      return "invalid";
    case 401:
    case 403:
      return "denied";
    case 404:
      return "missing";
    case 409:
      return "conflict";
    default:
      return "unavailable";
  }
}
