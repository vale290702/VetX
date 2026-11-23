import { isLocale } from "@vetx/i18n";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { readStaffSession } from "../../../../auth/account.ts";
import { AdminPanel } from "../../../../directory/admin-panel";
import { loadDirectory } from "../../../../directory/api.ts";
import { directoryNotices, isDirectoryId, readDirectoryPage } from "../../../../directory/forms.ts";
import { TradeLink } from "../../../../trade/nav";
import { InventoryLink } from "../../../../inventory/navigation";
import { BillingLink } from "../../../../billing/navigation";
import { ReferralLink } from "../../../../referrals/navigation";
import { Link } from "../../../../i18n/routing";
import { Masthead } from "../../masthead";

type Props = {
  params: Promise<{ locale: string; organizationId: string }>;
  searchParams: Promise<{ page?: string | string[]; notice?: string | string[] }>;
};

export const dynamic = "force-dynamic";

export default async function OrganizationDirectory({ params, searchParams }: Props) {
  const [{ locale, organizationId }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale) || !isDirectoryId(organizationId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect(`/${locale}`);
  const page = readDirectoryPage(query.page);
  const notice = directoryNotices.find((key) => key === query.notice);
  const [view, t, patients, care, exchange] = await Promise.all([
    loadDirectory(access.config.apiOrigin, access.session, organizationId, page),
    getTranslations("directory"),
    getTranslations("patients"),
    getTranslations("care"),
    getTranslations("webExchange"),
  ]);
  const path = `/organizations/${organizationId}${page === 1 ? "" : `?page=${page}`}`;
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={path} />
      <main className="directory-main">
        <header className="directory-header">
          <Link className="directory-back" href="/">
            {t("back")}
          </Link>
          <h1>{("organization" in view && view.organization?.name) || t("directory")}</h1>
        </header>
        {view.kind === "denied" ? (
          <p role="alert">{t("denied")}</p>
        ) : view.kind === "unavailable" ? (
          <div className="directory-message">
            <p role="alert">{t("loadUnavailable")}</p>
            <Link href={path}>{t("retry")}</Link>
          </div>
        ) : (
          <>
            {notice && (
              <p className="directory-notice" role={notice === "saved" ? "status" : "alert"}>
                {t(notice)}
              </p>
            )}
            {view.kind === "admin" ? (
              <AdminPanel
                csrf={access.session.csrf}
                locale={locale}
                organizationId={organizationId}
                directory={view.directory}
              />
            ) : (
              <section className="directory-section" aria-labelledby="clinics">
                <h2 id="clinics">{t("clinics")}</h2>
                {view.clinics.length ? (
                  <ul className="directory-list">
                    {view.clinics.map((clinic) => (
                      <li key={clinic.id}>
                        <strong>{clinic.name}</strong>
                        <Link
                          className="clinic-registry-link"
                          aria-label={patients("patientsAt", { clinic: clinic.name })}
                          href={`/organizations/${organizationId}/clinics/${clinic.id}/patients`}
                        >
                          {patients("registry")}
                        </Link>
                        <Link
                          className="clinic-registry-link"
                          aria-label={care("calendarAt", { clinic: clinic.name })}
                          href={`/organizations/${organizationId}/clinics/${clinic.id}/appointments`}
                        >
                          {care("calendar")}
                        </Link>
                        <Link
                          className="clinic-registry-link"
                          aria-label={exchange("importAt", { clinic: clinic.name })}
                          href={`/organizations/${organizationId}/clinics/${clinic.id}/exchange/import`}
                        >
                          {exchange("importTitle")}
                        </Link>
                        <TradeLink
                          locale={locale}
                          scope={{ organizationId, clinicId: clinic.id }}
                          clinic={clinic.name}
                        />
                        <InventoryLink
                          locale={locale}
                          scope={{ organizationId, clinicId: clinic.id }}
                          clinic={clinic.name}
                        />
                        <BillingLink
                          locale={locale}
                          scope={{ organizationId, clinicId: clinic.id }}
                          clinic={clinic.name}
                        />
                        <ReferralLink
                          scope={{ organizationId, clinicId: clinic.id }}
                          locale={locale}
                          clinicName={clinic.name}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("noAssignments")}</p>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
