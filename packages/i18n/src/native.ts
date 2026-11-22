import { createInstance } from "i18next";
import ICU from "i18next-icu";

import enAuth from "../locales/native-auth.en.json";
import esAuth from "../locales/native-auth.es.json";
import enDirectory from "../locales/native-directory.en.json";
import esDirectory from "../locales/native-directory.es.json";

import { defaultLocale, locales, messages, type Locale, type Messages } from "./index";

const nativeAuth = { en: enAuth, es: esAuth } satisfies Record<Locale, typeof esAuth>;
const directory = { en: enDirectory, es: esDirectory } satisfies Record<Locale, typeof esDirectory>;

declare module "i18next" {
  interface CustomTypeOptions {
    resources: {
      translation: Messages & { nativeAuth: typeof esAuth; directory: typeof esDirectory };
    };
  }
}

export async function createNativeI18n(locale: Locale) {
  const instance = createInstance();
  await instance.use(ICU).init({
    lng: locale,
    fallbackLng: defaultLocale,
    supportedLngs: locales,
    resources: {
      es: { translation: { ...messages.es, nativeAuth: nativeAuth.es, directory: directory.es } },
      en: { translation: { ...messages.en, nativeAuth: nativeAuth.en, directory: directory.en } },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}
