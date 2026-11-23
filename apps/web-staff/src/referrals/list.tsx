import type { components } from "@vetx/api-client";
import type { Locale } from "@vetx/i18n";
import { Link } from "../i18n/routing";
import { registryPath, type ClinicScope } from "../patients/forms.ts";
import { CounterReferralForm } from "./controls";
import { referralPath, type Direction } from "./forms.ts";
import { referralMessages } from "./messages.ts";
import styles from "./referrals.module.css";

const statusLabels = {
  REQUESTED: "waiting",
  APPROVED: "approved",
  DECLINED: "declined",
  WITHDRAWN: "withdrawn",
  RESPONDED: "answered",
} as const;
type Props = {
  locale: Locale;
  scope: ClinicScope;
  direction: Direction;
  patientId?: string;
  list: components["schemas"]["ReferralPageDto"];
  csrf: string;
};
export function ReferralsList({ locale, scope, direction, patientId, list, csrf }: Props) {
  const t = referralMessages(locale);
  const dt = new Intl.DateTimeFormat(locale, {
    timeStyle: "long",
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const date = (iso: string) => <time dateTime={iso}>{dt.format(new Date(iso))}</time>;
  const incoming = direction === "incoming",
    page = list.page;
  return (
    <>
      {list.referrals.length ? (
        <ol className="directory-list">
          {list.referrals.map((ref) => {
            const other = incoming ? ref.source : ref.destination;
            return (
              <li key={ref.id} className={styles.record}>
                <div>
                  <h3>{ref.reason}</h3>
                  <p>{t(statusLabels[ref.status])}</p>
                </div>
                <dl className="patient-demographics">
                  {!patientId && (
                    <div>
                      <dt>{t("patient")}</dt>
                      <dd>
                        {incoming ? (
                          ref.patient.name
                        ) : (
                          <Link
                            className="directory-back"
                            href={registryPath(scope) + "/" + ref.patient.id}
                          >
                            {ref.patient.name}
                          </Link>
                        )}{" "}
                        · {ref.patient.species}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{t(incoming ? "source" : "destination")}</dt>
                    <dd>
                      {other.clinicName} · {other.organizationName}
                    </dd>
                  </div>
                  {ref.summary && (
                    <div>
                      <dt>{t("requestSummary")}</dt>
                      <dd className={styles.narrative}>{ref.summary}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t("when")}</dt>
                    <dd>{date(ref.requestedAt)}</dd>
                  </div>
                </dl>
                {ref.response && (
                  <div>
                    <h4>{t("response")}</h4>
                    <p className={styles.narrative}>{ref.response.summary}</p>
                  </div>
                )}
                {incoming && ref.status === "APPROVED" && (
                  <CounterReferralForm
                    key={ref.revision}
                    locale={locale}
                    csrf={csrf}
                    revision={ref.revision}
                    endpoint={`/referrals/${scope.organizationId}/${scope.clinicId}/${ref.id}/response`}
                  />
                )}
                <details className="directory-disclosure">
                  <summary>{t("details")}</summary>
                  <dl className="patient-demographics">
                    <div>
                      <dt>{t("requestAuthor")}</dt>
                      <dd>{ref.requestedBy.subject}</dd>
                    </div>
                    <div>
                      <dt>{t("issuer")}</dt>
                      <dd>{ref.requestedBy.issuer}</dd>
                    </div>
                    {ref.response && (
                      <>
                        <div>
                          <dt>{t("responseTime")}</dt>
                          <dd>{date(ref.response.recordedAt)}</dd>
                        </div>
                        <div>
                          <dt>{t("responseAuthor")}</dt>
                          <dd>{ref.response.author.subject}</dd>
                        </div>
                        <div>
                          <dt>{t("issuer")}</dt>
                          <dd>{ref.response.author.issuer}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>
          {t(
            page > 1
              ? "emptyPage"
              : patientId
                ? "emptyPatient"
                : incoming
                  ? "emptyIncoming"
                  : "emptyOutgoing",
          )}
        </p>
      )}
      {(page > 1 || list.hasNextPage) && (
        <nav className="directory-paging" aria-label={t("pages")}>
          {page > 1 && (
            <Link
              className="directory-back"
              href={referralPath(scope, patientId, direction, page - 1)}
            >
              {t("previous")}
            </Link>
          )}
          <span>{t("page", { number: page })}</span>
          {list.hasNextPage && (
            <Link
              className="directory-back"
              href={referralPath(scope, patientId, direction, page + 1)}
            >
              {t("next")}
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
