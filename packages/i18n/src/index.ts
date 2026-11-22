import en from "../locales/en.json";
import es from "../locales/es.json";

export const locales = ["es", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale = "es" satisfies Locale;

export type Messages = typeof es;
export const messages = { es, en } satisfies Record<Locale, Messages>;

export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale === value);
}

export type EntryAudience = keyof Messages["entry"];
export type ServiceStatus = keyof Messages["service"];
