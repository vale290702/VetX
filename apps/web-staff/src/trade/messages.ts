import type { Locale } from "@vetx/i18n";
import { createTranslator } from "next-intl";
import en from "../../../../packages/i18n/locales/web-trade.en.json";
import es from "../../../../packages/i18n/locales/web-trade.es.json";
const catalog = { en, es } satisfies Record<Locale, typeof en>;
export const tradeMessages = (locale: Locale) =>
  createTranslator({ locale, messages: catalog[locale] });
export function notice(status: number) {
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
