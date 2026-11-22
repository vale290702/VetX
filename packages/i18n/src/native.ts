import { createInstance } from "i18next";
import ICU from "i18next-icu";

import { defaultLocale, locales, messages, type Locale, type Messages } from "./index";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: Messages };
  }
}

export async function createNativeI18n(locale: Locale) {
  const instance = createInstance();
  await instance.use(ICU).init({
    lng: locale,
    fallbackLng: defaultLocale,
    supportedLngs: locales,
    resources: {
      es: { translation: messages.es },
      en: { translation: messages.en },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}
