import { defaultZone } from "../care/time.ts";
import { defaultLocale, isLocale, messages } from "@vetx/i18n";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : defaultLocale;
  return { locale, messages: messages[locale], timeZone: defaultZone };
});
