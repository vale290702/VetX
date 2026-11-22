import "@fontsource-variable/instrument-sans";
import "@fontsource/instrument-serif/latin-400.css";
import "../globals.css";

import { isLocale } from "@vetx/i18n";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

type LayoutProps = { params: Promise<{ locale: string }>; children: ReactNode };

export async function generateMetadata({ params }: Pick<LayoutProps, "params">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale });
  return {
    title: `${t("brand")} · ${t("entry.staff.title")}`,
    description: t("entry.staff.description"),
  };
}

export default async function LocaleLayout({ params, children }: LayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={null}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
