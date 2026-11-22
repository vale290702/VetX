import { createInstance } from "i18next";
import ICU from "i18next-icu";

import enCare from "../locales/native-care.en.json";
import esCare from "../locales/native-care.es.json";
import enAuth from "../locales/native-auth.en.json";
import esAuth from "../locales/native-auth.es.json";
import enDirectory from "../locales/native-directory.en.json";
import esDirectory from "../locales/native-directory.es.json";
import enPatients from "../locales/native-patients.en.json";
import esPatients from "../locales/native-patients.es.json";

import { defaultLocale, locales, messages, type Locale, type Messages } from "./index";

const nativeCare = { en: enCare, es: esCare } satisfies Record<Locale, typeof esCare>;
const nativeAuth = { en: enAuth, es: esAuth } satisfies Record<Locale, typeof esAuth>;
const nativePatients = { en: enPatients, es: esPatients } satisfies Record<
  Locale,
  typeof esPatients
>;
const directory = { en: enDirectory, es: esDirectory } satisfies Record<Locale, typeof esDirectory>;

declare module "i18next" {
  interface CustomTypeOptions {
    resources: {
      translation: Messages & {
        nativeCare: typeof esCare;
        nativeAuth: typeof esAuth;
        directory: typeof esDirectory;
        nativePatients: typeof esPatients;
      };
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
      es: {
        translation: {
          ...messages.es,
          nativeAuth: nativeAuth.es,
          nativeCare: nativeCare.es,
          directory: directory.es,
          nativePatients: nativePatients.es,
        },
      },
      en: {
        translation: {
          ...messages.en,
          nativeAuth: nativeAuth.en,
          nativeCare: nativeCare.en,
          directory: directory.en,
          nativePatients: nativePatients.en,
        },
      },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}
