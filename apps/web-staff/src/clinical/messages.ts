import type { Locale } from "@vetx/i18n";
import { createTranslator } from "next-intl";
import en from "../../../../packages/i18n/locales/web-clinical.en.json";
import es from "../../../../packages/i18n/locales/web-clinical.es.json";
const catalog = { en, es } satisfies Record<Locale, typeof en>;
export function clinicalMessages(locale: Locale) {
  return createTranslator({ locale, messages: catalog[locale] });
}
export function clinicalError(status: number) {
  if (status === 400 || status === 422) return "invalid";
  if (status === 401 || status === 403) return "denied";
  if (status === 404) return "missing";
  if (status === 409) return "conflict";
  return "unavailable";
}
