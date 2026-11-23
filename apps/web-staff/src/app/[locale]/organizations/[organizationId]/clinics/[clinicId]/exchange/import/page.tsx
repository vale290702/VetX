import { isLocale, messages } from "@vetx/i18n";
import { createVetxClient } from "@vetx/api-client";
import { notFound, redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { readStaffSession, staffRequestOptions } from "../../../../../../../../auth/account.ts";
import { isDirectoryId } from "../../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../../i18n/routing";
import { registryPath, type ClinicScope } from "../../../../../../../../patients/forms.ts";
import { importPath } from "../../../../../../../../exchange/forms.ts";
import { ImportForm } from "../../../../../../../../exchange/import-form";
import { Masthead } from "../../../../../../masthead";
export const dynamic = "force-dynamic";

export default async function Import({
  params,
}: {
  params: Promise<ClinicScope & { locale: string }>;
}) {
  const { locale, organizationId, clinicId } = await params;
  if (!isLocale(locale) || !isDirectoryId(organizationId) || !isDirectoryId(clinicId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect(`/${locale}`);
  const ids = { organizationId, clinicId },
    path = importPath(ids);
  const [t, p] = await Promise.all([getTranslations("webExchange"), getTranslations("patients")]);
  const clinics = await createVetxClient(access.config.apiOrigin)
    .GET("/organizations/{organizationId}/clinics", {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: { organizationId } },
    })
    .catch(() => undefined);
  const name = clinics?.data?.clinics.find((c) => c.id === clinicId)?.name;
  const denied =
    Boolean(clinics?.data && !name) || [401, 403, 404].includes(clinics?.response.status ?? 503);
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={path} />
      <main className="directory-main">
        <header className="directory-header">
          <Link className="directory-back" href={registryPath(ids)}>
            {name ? p("patientsAt", { clinic: name }) : p("registry")}
          </Link>
          <h1>{t("importTitle")}</h1>
        </header>
        {name ? (
          <NextIntlClientProvider
            locale={locale}
            messages={{ webExchange: messages[locale].webExchange }}
          >
            <ImportForm
              endpoint={`/exchange/${organizationId}/${clinicId}`}
              csrf={access.session.csrf}
              registry={registryPath(ids)}
            />
          </NextIntlClientProvider>
        ) : (
          <div className="directory-message">
            <p role="alert">{t(denied ? "denied" : "unavailable")}</p>
            <Link href={path}>{t("retry")}</Link>
          </div>
        )}
      </main>
    </div>
  );
}
