import { createInstance } from "i18next";
import ICU from "i18next-icu";

import enAuth from "../locales/native-auth.en.json";
import esAuth from "../locales/native-auth.es.json";

import { defaultLocale, locales, messages, type Locale, type Messages } from "./index";

const nativeAuth = { en: enAuth, es: esAuth } satisfies Record<Locale, typeof esAuth>;

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: Messages & { nativeAuth: typeof esAuth } };
  }
}

export async function createNativeI18n(locale: Locale) {
  const instance = createInstance();
  await instance.use(ICU).init({
    lng: locale,
    fallbackLng: defaultLocale,
    supportedLngs: locales,
    resources: {
      es: { translation: { ...messages.es, nativeAuth: nativeAuth.es } },
      en: { translation: { ...messages.en, nativeAuth: nativeAuth.en } },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}
