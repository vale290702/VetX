import type { Locale } from "@vetx/i18n";
import { createTranslator } from "next-intl";
import en from "../../../../packages/i18n/locales/web-inventory.en.json";
import es from "../../../../packages/i18n/locales/web-inventory.es.json";
const catalog = { en, es } satisfies Record<Locale, typeof en>;
export const inventoryMessages = (locale: Locale) =>
  createTranslator({ locale, messages: catalog[locale] });
export function inventoryNotice(status: number, movement = false) {
  if (status === 400) return movement ? "invalid" : "invalidCatalog";
  if (status === 401 || status === 403) return "denied";
  if (status === 404) return "missing";
  if (status === 409) return movement ? "stockConflict" : "catalogConflict";
  return "unavailable";
}
