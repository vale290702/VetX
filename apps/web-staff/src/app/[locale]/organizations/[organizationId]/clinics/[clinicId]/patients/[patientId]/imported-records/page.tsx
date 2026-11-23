import { isLocale, messages } from "@vetx/i18n";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { readStaffSession } from "../../../../../../../../../auth/account.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../../../i18n/routing";
import { registryPath, type ClinicScope } from "../../../../../../../../../patients/forms.ts";
import {
  fileKinds,
  importPath,
  visibleRecordFields,
} from "../../../../../../../../../exchange/forms.ts";
import { readImportedHistory } from "../../../../../../../../../exchange/api.ts";
import { Masthead } from "../../../../../../../masthead";

export const dynamic = "force-dynamic";
type Props = {
  params: Promise<ClinicScope & { locale: string; patientId: string }>;
  searchParams: Promise<{ page?: string | string[]; download?: string | string[] }>;
};
function fieldValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value) ?? "";
}
export default async function ImportedRecords({ params, searchParams }: Props) {
  const [{ locale, organizationId, clinicId, patientId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!isLocale(locale) || ![organizationId, clinicId, patientId].every(isDirectoryId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect(`/${locale}`);
  const ids = { organizationId, clinicId, patientId };
  const page = readDirectoryPage(query.page),
    recordPath = registryPath(ids) + "/" + patientId;
  const path = recordPath + "/imported-records",
    pagePath = (n: number) => (n > 1 ? path + "?page=" + n : path);
  const [view, t, p] = await Promise.all([
    readImportedHistory(access.config.apiOrigin, access.session.accessToken, ids, page),
    getTranslations("webExchange"),
    getTranslations("patients"),
  ]);
  const { history } = view;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "UTC",
  });
  const stamp = (iso: string) => <time dateTime={iso}>{date.format(new Date(iso))}</time>;
  const fieldNames: Record<string, string> = messages[locale].webExchange.fields,
    kinds: Record<string, string> = messages[locale].webExchange.kinds;
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={pagePath(page)} />
      <main className="directory-main">
        <header className="directory-header">
          <nav className="registry-trail" aria-label={p("clinicRegistry")}>
            <Link href={recordPath} className="directory-back">
              {view.name ?? p("details")}
            </Link>
            <Link href={importPath(ids)} className="directory-back">
              {t("importTitle")}
            </Link>
          </nav>
          <h1>{t("history")}</h1>
        </header>
        {query.download === "failed" && (
          <p className="directory-notice" role="alert">
            {t("downloadFailed")}
          </p>
        )}
        {!history ? (
          <div className="directory-message">
            <p role="alert">
              {t(view.error === 403 ? "denied" : view.error === 404 ? "missing" : "unavailable")}
            </p>
            <Link href={pagePath(page)}>{t("retry")}</Link>
          </div>
        ) : (
          <section className="directory-section" aria-label={t("history")}>
            {history.records.length ? (
              <ol className="directory-list">
                {history.records.map((record) => (
                  <li className="exchange-record" key={record.importedId}>
                    <h2>{kinds[record.kind] ?? record.kind}</h2>
                    <p>{stamp(record.occurredAt)}</p>
                    <dl className="patient-demographics exchange-data">
                      {visibleRecordFields(record.data).map(([key, value]) => (
                        <div key={key}>
                          <dt>{fieldNames[key] ?? key}</dt>
                          <dd>
                            {value !== null &&
                            typeof value === "object" &&
                            "clinicId" in value &&
                            "organizationId" in value ? (
                              <dl>
                                <div>
                                  <dt>{t("organizationId")}</dt>
                                  <dd>{String(value.organizationId)}</dd>
                                </div>
                                <div>
                                  <dt>{t("clinicId")}</dt>
                                  <dd>{String(value.clinicId)}</dd>
                                </div>
                              </dl>
                            ) : (
                              fieldValue(value)
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {fileKinds.includes(record.kind) && (
                      <a
                        className="directory-back"
                        href={`/exchange/${organizationId}/${clinicId}/patients/${patientId}/records/${record.importedId}?locale=${locale}&page=${page}`}
                      >
                        {t("download")}
                      </a>
                    )}
                    <details className="directory-disclosure">
                      <summary>{t("provenance")}</summary>
                      <dl className="patient-demographics">
                        {[
                          [t("sourceOrganization"), record.source.organizationId],
                          [t("sourceClinic"), record.source.clinicId],
                          [t("sourcePatientId"), record.source.patientId],
                          [t("sourceRecord"), record.id],
                          [t("packageId"), record.packageId],
                          [t("author"), record.author.subject],
                          [t("issuer"), record.author.issuer],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                        <div>
                          <dt>{t("recordedAt")}</dt>
                          <dd>{stamp(record.recordedAt)}</dd>
                        </div>
                        <div>
                          <dt>{t("importedAt")}</dt>
                          <dd>{stamp(record.importedAt)}</dd>
                        </div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t(page > 1 ? "emptyPage" : "empty")}</p>
            )}
            {(page > 1 || history.hasNextPage) && (
              <nav className="directory-paging" aria-label={t("recordPages")}>
                {page > 1 && (
                  <Link className="directory-back" href={pagePath(page - 1)}>
                    {t("previous")}
                  </Link>
                )}
                <span>{t("page", { page })}</span>
                {history.hasNextPage && (
                  <Link className="directory-back" href={pagePath(page + 1)}>
                    {t("next")}
                  </Link>
                )}
              </nav>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
