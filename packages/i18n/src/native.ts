import { createInstance } from "i18next";
import ICU from "i18next-icu";

import enInventory from "../locales/native-inventory.en.json";
import esInventory from "../locales/native-inventory.es.json";
import enReferrals from "../locales/native-referrals.en.json";
import esReferrals from "../locales/native-referrals.es.json";
import enExchange from "../locales/native-exchange.en.json";
import esExchange from "../locales/native-exchange.es.json";
import enDocuments from "../locales/native-documents.en.json";
import esDocuments from "../locales/native-documents.es.json";
import enCare from "../locales/native-care.en.json";
import esCare from "../locales/native-care.es.json";
import enAuth from "../locales/native-auth.en.json";
import esAuth from "../locales/native-auth.es.json";
import enDirectory from "../locales/native-directory.en.json";
import esDirectory from "../locales/native-directory.es.json";
import enPatients from "../locales/native-patients.en.json";
import esPatients from "../locales/native-patients.es.json";

import { defaultLocale, locales, messages, type Locale, type Messages } from "./index";

const nativeInventory = { en: enInventory, es: esInventory } satisfies Record<
  Locale,
  typeof esInventory
>;
const nativeReferrals = { en: enReferrals, es: esReferrals } satisfies Record<
  Locale,
  typeof esReferrals
>;
const nativeExchange = { en: enExchange, es: esExchange } satisfies Record<
  Locale,
  typeof esExchange
>;
const nativeDocuments = { en: enDocuments, es: esDocuments } satisfies Record<
  Locale,
  typeof esDocuments
>;
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
        nativeInventory: typeof esInventory;
        nativeReferrals: typeof esReferrals;
        nativeExchange: typeof esExchange;
        nativeDocuments: typeof esDocuments;
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
          nativeInventory: nativeInventory.es,
          nativeReferrals: nativeReferrals.es,
          nativeExchange: nativeExchange.es,
          nativeDocuments: nativeDocuments.es,
          nativeCare: nativeCare.es,
          directory: directory.es,
          nativePatients: nativePatients.es,
        },
      },
      en: {
        translation: {
          ...messages.en,
          nativeAuth: nativeAuth.en,
          nativeInventory: nativeInventory.en,
          nativeReferrals: nativeReferrals.en,
          nativeExchange: nativeExchange.en,
          nativeDocuments: nativeDocuments.en,
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
