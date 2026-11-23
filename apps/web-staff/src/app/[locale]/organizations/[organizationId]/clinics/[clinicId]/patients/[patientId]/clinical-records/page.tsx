import { isLocale } from "@vetx/i18n";
import { notFound, redirect } from "next/navigation";
import { readStaffSession } from "../../../../../../../../../auth/account.ts";
import { readEncounters } from "../../../../../../../../../care/api.ts";
import { displayTime, operatorZone } from "../../../../../../../../../care/time.ts";
import { readClinical } from "../../../../../../../../../clinical/api.ts";
import { EditRecord } from "../../../../../../../../../clinical/edit";
import { ClinicalEntry } from "../../../../../../../../../clinical/entry";
import { clinicalPath } from "../../../../../../../../../clinical/forms.ts";
import { clinicalError, clinicalMessages } from "../../../../../../../../../clinical/messages.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../../../i18n/routing";
import { registryPath, type ClinicScope } from "../../../../../../../../../patients/forms.ts";
import { patientInfo } from "../../../../../../../../../referrals/api.ts";
import { Masthead } from "../../../../../../../masthead";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<ClinicScope & { patientId: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function ClinicalRecords({ params, searchParams }: Props) {
  const [{ locale, organizationId, clinicId, patientId }, q] = await Promise.all([
    params,
    searchParams,
  ]);
  if (
    !isLocale(locale) ||
    ![organizationId, clinicId, patientId].every(isDirectoryId) ||
    (q.recordId !== undefined && !isDirectoryId(q.recordId))
  )
    notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect("/" + locale);
  const ids = { organizationId, clinicId, patientId },
    t = clinicalMessages(locale);
  const credentials = { origin: access.config.apiOrigin, token: access.session.accessToken };
  const timeZone = operatorZone(q.timeZone),
    recordId = q.recordId;
  const pages = {
    page: readDirectoryPage(q.page),
    historyPage: readDirectoryPage(q.historyPage),
    encounterPage: readDirectoryPage(q.encounterPage),
    timeZone,
    recordId,
  };
  const patientPath = registryPath(ids) + "/" + patientId,
    path = (overrides: Partial<typeof pages> = {}) =>
      clinicalPath(patientPath, { ...pages, ...overrides });
  const [patient, chart, visits] = await Promise.all([
    patientInfo(access, ids),
    readClinical(
      credentials.origin,
      credentials.token,
      ids,
      recordId ? pages.historyPage : pages.page,
      recordId,
    ),
    recordId
      ? Promise.resolve(null)
      : readEncounters(credentials, ids, patientId, pages.encounterPage),
  ]);
  const context = {
    locale,
    csrf: access.session.csrf,
    endpoint: `/clinical/${organizationId}/${clinicId}/${patientId}`,
  };
  const encounters =
    visits?.data?.encounters.map((e) => ({
      id: e.id,
      label: displayTime(e.occurredAt, locale, timeZone) + " · " + e.reason,
    })) ?? [];
  const pager = (field: "page" | "historyPage" | "encounterPage", hasNext: boolean) => {
    const n = pages[field],
      label =
        field === "page"
          ? "chartPages"
          : field === "historyPage"
            ? "historyPages"
            : "encounterPages";
    return n === 1 && !hasNext ? null : (
      <nav className="directory-paging" aria-label={t(label)}>
        {n > 1 && (
          <Link className="directory-back" href={path({ [field]: n - 1 })}>
            {t("previous")}
          </Link>
        )}
        <span>{t("page", { n })}</span>
        {hasNext && (
          <Link className="directory-back" href={path({ [field]: n + 1 })}>
            {t("next")}
          </Link>
        )}
      </nav>
    );
  };
  const patientUrl = patientPath + "?" + new URLSearchParams({ timeZone });
  const reload = (
    <a className="directory-back" href={`/${locale}${path()}`}>
      {t("refresh")}
    </a>
  );
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={path()} />
      <main className="directory-main">
        <header className="directory-header">
          <nav className="registry-trail" aria-label={t("patient")}>
            <Link className="directory-back" href={patientUrl}>
              {patient.data?.patient.name ?? t("patient")}
            </Link>
            {recordId && (
              <Link className="directory-back" href={path({ recordId: undefined, historyPage: 1 })}>
                {t("all")}
              </Link>
            )}
          </nav>
          <h1>
            {patient.data
              ? t("patientHeading", { patient: patient.data.patient.name })
              : t("title")}
          </h1>
        </header>
        {!patient.data ? (
          <div>
            <p className="directory-notice" role="alert">
              {t(clinicalError(patient.error))}
            </p>
            {reload}
          </div>
        ) : (
          <>
            {!recordId && (
              <section className="directory-section" aria-label={t("new")}>
                <details className="directory-disclosure">
                  <summary>{t("new")}</summary>
                  {visits?.data ? (
                    <>
                      {pager("encounterPage", visits.data.hasNextPage)}
                      {encounters.length ? (
                        <EditRecord
                          key={pages.encounterPage}
                          context={context}
                          zone={timeZone}
                          now={new Date().toISOString()}
                          encounters={encounters}
                          edit="new"
                        />
                      ) : (
                        <>
                          <p>{t(pages.encounterPage === 1 ? "noEncounters" : "emptyPage")}</p>
                          <Link className="directory-back" href={patientUrl + "#clinical-history"}>
                            {t("openEncounters")}
                          </Link>
                        </>
                      )}
                    </>
                  ) : (
                    <div>
                      <p role="alert">
                        {t(
                          visits?.error === "denied"
                            ? "denied"
                            : visits?.error === "missing"
                              ? "missing"
                              : "unavailable",
                        )}
                      </p>
                      {reload}
                    </div>
                  )}
                </details>
              </section>
            )}
            <section className="directory-section" aria-labelledby="clinical-list">
              <h2 id="clinical-list">{t(recordId ? "history" : "chart")}</h2>
              {chart.data ? (
                <>
                  {chart.data.records.length ? (
                    <ol className="directory-list">
                      {chart.data.records.map((record) => (
                        <ClinicalEntry
                          key={record.revisionId}
                          locale={locale}
                          timeZone={timeZone}
                          record={record}
                          viewer={{
                            subject: access.session.subject,
                            issuer: access.config.issuer.href,
                          }}
                          encounterLabel={
                            encounters.find((e) => e.id === record.encounterId)?.label
                          }
                          current={
                            recordId
                              ? undefined
                              : {
                                  ...context,
                                  guardians: patient.data.guardians,
                                  historyUrl: path({ recordId: record.id, historyPage: 1 }),
                                  pageUrl: path(),
                                }
                          }
                        />
                      ))}
                    </ol>
                  ) : (
                    <p>{t(chart.data.page === 1 && !recordId ? "empty" : "emptyPage")}</p>
                  )}
                  {pager(recordId ? "historyPage" : "page", chart.data.hasNextPage)}
                </>
              ) : (
                <div>
                  <p role="alert">{t(clinicalError(chart.error))}</p>
                  {reload}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
