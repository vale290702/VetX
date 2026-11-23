import { isLocale, messages } from "@vetx/i18n";
import { notFound, redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";

import { readStaffSession } from "../../../../../../../../../auth/account.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../../../directory/forms.ts";
import { readDocuments } from "../../../../../../../../../documents/api.ts";
import { DocumentSharing, DocumentUpload } from "../../../../../../../../../documents/forms";
import type { PatientIds } from "../../../../../../../../../documents/transport.ts";
import { Link } from "../../../../../../../../../i18n/routing";
import { registryPath } from "../../../../../../../../../patients/forms.ts";
import { Masthead } from "../../../../../../../masthead";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<PatientIds & { locale: string }>;
  searchParams: Promise<{ page?: string | string[]; download?: string | string[] }>;
};

export default async function MedicalDocuments({ params, searchParams }: Props) {
  const [{ locale, organizationId, clinicId, patientId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!isLocale(locale) || ![organizationId, clinicId, patientId].every(isDirectoryId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect(`/${locale}`);
  const ids = { organizationId, clinicId, patientId };
  const page = readDirectoryPage(query.page);
  const recordPath = `${registryPath(ids)}/${patientId}`;
  const path = `${recordPath}/documents`;
  const pagePath = (n: number) => (n > 1 ? `${path}?page=${n}` : path);
  const endpoint = `/registry/${organizationId}/${clinicId}/${patientId}/documents`;
  const [view, t, d, p] = await Promise.all([
    readDocuments(access.config.apiOrigin, access.session.accessToken, ids, page),
    getTranslations("webDocuments"),
    getTranslations("directory"),
    getTranslations("patients"),
  ]);
  const { record, list } = view;
  const linkedGuardians = record?.guardians.filter((g) => g.linked) ?? [];
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const bytes = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  });
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={pagePath(page)} />
      <main className="directory-main">
        <header className="directory-header">
          <nav className="registry-trail" aria-label={p("clinicRegistry")}>
            <Link className="directory-back" href={registryPath(ids)}>
              {p("registry")}
            </Link>
            <Link className="directory-back" href={recordPath}>
              {record?.patient.name ?? p("details")}
            </Link>
          </nav>
          <h1>{t("title")}</h1>
        </header>
        {query.download === "failed" && (
          <p className="directory-notice" role="alert">
            {t("downloadFailed")}
          </p>
        )}
        {!list ? (
          <div className="directory-message">
            <p role="alert">
              {t(
                view.error === 403 || view.error === 401
                  ? "denied"
                  : view.error === 404
                    ? "missing"
                    : "loadError",
              )}
            </p>
            <Link href={pagePath(page)}>{d("retry")}</Link>
          </div>
        ) : (
          <NextIntlClientProvider
            locale={locale}
            messages={{ webDocuments: messages[locale].webDocuments }}
          >
            <div className="directory-columns">
              <section className="directory-section" aria-labelledby="new-document">
                <h2 id="new-document">{t("uploadHeading")}</h2>
                <DocumentUpload
                  endpoint={endpoint}
                  csrf={access.session.csrf}
                  firstPage={page > 1 ? `/${locale}${path}` : undefined}
                />
              </section>
              <section className="directory-section" aria-labelledby="document-files">
                <h2 id="document-files">{t("files")}</h2>
                {list.documents.length ? (
                  <ul className="directory-list">
                    {list.documents.map((doc) => (
                      <li key={doc.id} className="medical-document">
                        <h3>{doc.title}</h3>
                        <p>
                          {
                            (
                              {
                                "application/pdf": "PDF",
                                "image/png": "PNG",
                                "image/jpeg": "JPEG",
                              } as const
                            )[doc.mediaType]
                          }{" "}
                          · {bytes.format(doc.byteLength / 1000)} ·{" "}
                          <time dateTime={doc.recordedAt}>
                            {date.format(new Date(doc.recordedAt))}
                          </time>
                        </p>
                        {doc.ready ? (
                          <>
                            <a
                              className="directory-back"
                              href={`${endpoint}/${doc.id}?locale=${locale}&page=${page}`}
                            >
                              {t("download")}
                            </a>
                            <DocumentSharing
                              endpoint={`${endpoint}/${doc.id}/sharing`}
                              csrf={access.session.csrf}
                              guardians={linkedGuardians}
                              sharing={doc.sharing}
                            />
                          </>
                        ) : (
                          <p>{t("processing")}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t(page > 1 ? "emptyPage" : "empty")}</p>
                )}
                {(page > 1 || list.hasNextPage) && (
                  <nav className="directory-paging" aria-label={t("pages")}>
                    {page > 1 && (
                      <Link className="directory-back" href={pagePath(page - 1)}>
                        {d("previous")}
                      </Link>
                    )}
                    <span>{d("page", { page })}</span>
                    {list.hasNextPage && (
                      <Link className="directory-back" href={pagePath(page + 1)}>
                        {d("next")}
                      </Link>
                    )}
                  </nav>
                )}
              </section>
            </div>
          </NextIntlClientProvider>
        )}
      </main>
    </div>
  );
}
