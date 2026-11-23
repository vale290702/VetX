import type { Locale } from "@vetx/i18n";
import { createTranslator } from "next-intl";
import en from "../../../../packages/i18n/locales/web-billing.en.json";
import es from "../../../../packages/i18n/locales/web-billing.es.json";
const catalog = { en, es } satisfies Record<Locale, typeof en>;
export const billingMessages = (locale: Locale) =>
  createTranslator({ locale, messages: catalog[locale] });
export type Label = keyof typeof en;
