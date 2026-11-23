import { isLocale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { readStaffSession } from "../../../../../../../../auth/account.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../../directory/forms.ts";
import { TradeLink } from "../../../../../../../../trade/nav";
import { ReferralLink } from "../../../../../../../../referrals/navigation";
import { Link } from "../../../../../../../../i18n/routing";
import { readRegistry } from "../../../../../../../../patients/api.ts";
import { Guardians, PatientForm } from "../../../../../../../../patients/fields";
import {
  patientNotices,
  registryPath,
  type ClinicScope,
} from "../../../../../../../../patients/forms.ts";
import { ClinicalHistory } from "../../../../../../../../care/encounters";
import { carePath, careNotices } from "../../../../../../../../care/forms.ts";
import { operatorZone } from "../../../../../../../../care/time.ts";
import { Masthead } from "../../../../../../masthead";

type Props = {
  params: Promise<ClinicScope & { locale: string; record?: string[] }>;
  searchParams: Promise<{
    search?: string | string[];
    page?: string | string[];
    notice?: string | string[];
    careNotice?: string | string[];
    timeZone?: string | string[];
    historyPage?: string | string[];
  }>;
};
export const dynamic = "force-dynamic";

export default async function Patients({ params, searchParams }: Props) {
  const [{ locale, organizationId, clinicId, record }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  if (
    !isLocale(locale) ||
    !isDirectoryId(organizationId) ||
    !isDirectoryId(clinicId) ||
    (record && (record.length !== 1 || !isDirectoryId(record[0])))
  )
    notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect(`/${locale}`);
  const scope = { organizationId, clinicId };
  const patientId = record?.[0];
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 120) : "";
  const page = readDirectoryPage(query.page);
  const timeZone = operatorZone(query.timeZone),
    historyPage = readDirectoryPage(query.historyPage);
  const careNotice = careNotices.find((key) => key === query.careNotice);
  const listPath = registryPath(scope, { timeZone });
  const listQuery = (page: number, search: string) =>
    registryPath(scope, { timeZone, page, search });
  const path = patientId
    ? carePath(scope, patientId, { timeZone, page: historyPage })
    : listQuery(page, search);
  const [view, t, d, care] = await Promise.all([
    readRegistry(access.config.apiOrigin, access.session.accessToken, scope, patientId, {
      page,
      search,
    }),
    getTranslations("patients"),
    getTranslations("directory"),
    getTranslations("care"),
  ]);
  const documents = await getTranslations("webDocuments");
  const exchange = await getTranslations("webExchange");
  const notice = patientNotices.find((key) => key === query.notice);
  const context = {
    csrf: access.session.csrf,
    locale,
    endpoint: `/registry/${organizationId}/${clinicId}`,
  };
  const result = view.data;
  const detail = result && "patient" in result ? result : undefined;
  const list = result && "patients" in result ? result : undefined;
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={path} />
      <main className="directory-main">
        <header className="directory-header">
          <div className="registry-trail">
            <Link className="directory-back" href={`/organizations/${organizationId}`}>
              {t("directory")}
            </Link>
            {patientId && (
              <Link className="directory-back" href={listPath}>
                {view.clinic ? t("patientsAt", { clinic: view.clinic.name }) : t("registry")}
              </Link>
            )}
          </div>
          <h1>
            {detail?.patient.name ??
              (view.clinic ? t("patientsAt", { clinic: view.clinic.name }) : t("registry"))}
          </h1>
        </header>
        {view.error ? (
          <div className="directory-message">
            <p role="alert">
              {t(view.error === "writeUnavailable" ? "loadUnavailable" : view.error)}
            </p>
            {view.error === "writeUnavailable" && <Link href={path}>{d("retry")}</Link>}
          </div>
        ) : (
          <>
            {careNotice && (
              <p className="directory-notice" role={careNotice === "saved" ? "status" : "alert"}>
                {care(careNotice)}
              </p>
            )}
            {notice && (
              <p className="directory-notice" role={notice === "saved" ? "status" : "alert"}>
                {t(notice)}
              </p>
            )}
            {list && (
              <section className="directory-section" aria-label={t("clinicRegistry")}>
                <Link className="directory-back" href={carePath(scope, undefined, { timeZone })}>
                  {care("calendar")}
                </Link>
                <Link
                  className="directory-back"
                  href={`/organizations/${organizationId}/clinics/${clinicId}/exchange/import`}
                >
                  {exchange("importTitle")}
                </Link>
                <ReferralLink scope={scope} locale={locale} />
                <PatientForm context={context} />
                <form
                  className="directory-form registry-search"
                  method="get"
                  action={`/${locale}${listPath}`}
                >
                  <label>
                    <input type="hidden" name="timeZone" value={timeZone} />
                    {t("search")}
                    <input type="search" name="search" defaultValue={search} maxLength={120} />
                  </label>
                  <Button variant="selected" type="submit">
                    {t("searchButton")}
                  </Button>
                  {search && (
                    <Link className="directory-back" href={listPath}>
                      {t("clear")}
                    </Link>
                  )}
                </form>
                {list.patients.length ? (
                  <ul className="directory-list">
                    {list.patients.map((patient) => (
                      <li key={patient.id} className="registry-row">
                        <Link
                          className="directory-back"
                          href={carePath(scope, patient.id, { timeZone })}
                        >
                          {patient.name}
                        </Link>
                        <span>{patient.species}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t(page > 1 ? "emptyPage" : search ? "noMatches" : "empty")}</p>
                )}
                {(page > 1 || list.hasNextPage) && (
                  <nav className="directory-paging" aria-label={t("pages")}>
                    {page > 1 && (
                      <Link className="directory-back" href={listQuery(page - 1, search)}>
                        {d("previous")}
                      </Link>
                    )}
                    <span>{d("page", { page })}</span>
                    {list.hasNextPage && (
                      <Link className="directory-back" href={listQuery(page + 1, search)}>
                        {d("next")}
                      </Link>
                    )}
                  </nav>
                )}
              </section>
            )}
            {detail && (
              <>
                <div className="directory-columns">
                  <section className="directory-section" aria-labelledby="patient-details">
                    <h2 id="patient-details">{t("details")}</h2>
                    <dl className="patient-demographics">
                      <div>
                        <dt>{t("species")}</dt>
                        <dd>{detail.patient.species}</dd>
                      </div>
                      <div>
                        <dt>{t("birthDate")}</dt>
                        <dd>
                          {detail.patient.birthDate ? (
                            <time dateTime={detail.patient.birthDate}>
                              {new Intl.DateTimeFormat(locale, {
                                dateStyle: "long",
                                timeZone: "UTC",
                              }).format(new Date(detail.patient.birthDate + "T00:00:00Z"))}
                            </time>
                          ) : (
                            t("unknown")
                          )}
                        </dd>
                      </div>
                    </dl>
                    <Link
                      className="directory-back"
                      href={`${registryPath(scope)}/${detail.patient.id}/documents`}
                    >
                      {documents("title")}
                    </Link>
                    <Link
                      className="directory-back"
                      href={`${registryPath(scope)}/${detail.patient.id}/imported-records`}
                    >
                      {exchange("history")}
                    </Link>
                    <TradeLink scope={scope} locale={locale} patientId={detail.patient.id} />
                    <ReferralLink scope={scope} locale={locale} patientId={detail.patient.id} />
                    <PatientForm context={context} patient={detail.patient} />
                  </section>
                  <Guardians context={context} record={detail} />
                </div>
                <ClinicalHistory
                  context={{ ...context, scope, timeZone }}
                  viewer={{ subject: access.session.subject, issuer: access.config.issuer.href }}
                  credentials={{
                    origin: access.config.apiOrigin,
                    token: access.session.accessToken,
                  }}
                  record={detail}
                  page={historyPage}
                />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
