import { defaultLocale, locales } from "@vetx/i18n";
import { createNavigation } from "next-intl/navigation";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({ locales, defaultLocale, localeDetection: false });
export const { Link } = createNavigation(routing);
