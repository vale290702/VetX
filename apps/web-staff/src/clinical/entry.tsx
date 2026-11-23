import type { Locale } from "@vetx/i18n";
import { sharingOptions } from "../care/forms.ts";
import { displayTime } from "../care/time.ts";
import { Link } from "../i18n/routing";
import type { ClinicalRecord } from "./api.ts";
import { EditRecord, ReleaseForm } from "./edit";
import { chartFields, type Edit } from "./forms.ts";
import { isWorkflow, terminalStatus, workflowActions, type WorkflowAction } from "./workflows.ts";
import { clinicalMessages } from "./messages.ts";
type Props = {
  record: ClinicalRecord;
  locale: Locale;
  timeZone: string;
  encounterLabel?: string;
  viewer: { subject: string; issuer: string };
  current?: {
    csrf: string;
    endpoint: string;
    guardians: { id: string; name: string; email: string; linked: boolean }[];
    historyUrl: string;
    pageUrl: string;
  };
};
export function ClinicalEntry({
  record,
  locale,
  timeZone,
  encounterLabel,
  current,
  viewer,
}: Props) {
  const t = clinicalMessages(locale),
    stamp = (value: string) => displayTime(value, locale, timeZone);
  const status = record.data.status,
    kind = record.kind;
  const linked = current ? sharingOptions(current.guardians, record.sharing.guardianIds) : null;
  const editableLab = kind === "lab" && status !== "ORDERED",
    review = editableLab && status === "RESULTED";
  const context = current && { locale, csrf: current.csrf, endpoint: current.endpoint };
  const editor = (
    edit: Exclude<Edit, "new">,
    label:
      "correct" | "orderCorrection" | "enterResult" | "correctResult" | "review" | WorkflowAction,
  ) =>
    context && (
      <details key={edit} className="directory-disclosure">
        <summary>{t(label)}</summary>
        <EditRecord
          context={context}
          zone={timeZone}
          now={isWorkflow(kind) ? new Date().toISOString() : record.occurredAt}
          current={record}
          edit={edit}
        />
      </details>
    );
  return (
    <li className="clinical-entry">
      <p>
        {t("version", { n: record.revision })} ·{" "}
        <time dateTime={record.occurredAt}>{stamp(record.occurredAt)}</time> · {timeZone}
      </p>
      <h3>
        {t(kind)}
        {status && (
          <>
            {" · "}
            <span className={review ? "awaiting-review" : undefined}>{t(status)}</span>
          </>
        )}
      </h3>
      <dl className="soap-note">
        {chartFields(kind).map(
          (field) =>
            record.data[field] && (
              <div key={field}>
                <dt>
                  {field === "scheduledAt"
                    ? t("scheduledAt", { zone: timeZone })
                    : field === "notes" && kind === "surgery"
                      ? t("surgicalNotes")
                      : t(field)}
                </dt>
                <dd>
                  {field === "nextDueDate"
                    ? new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      }).format(new Date(record.data[field] + "T12:00:00Z"))
                    : field === "scheduledAt"
                      ? stamp(record.data[field])
                      : record.data[field]}
                </dd>
              </div>
            ),
        )}
        {record.changeReason && (
          <div>
            <dt>{t("changeReason")}</dt>
            <dd>{record.changeReason}</dd>
          </div>
        )}
      </dl>
      <p>
        {t(status === "REVIEWED" ? "resultReviewedBy" : "recorded", {
          name:
            record.author.subject === viewer.subject && record.author.issuer === viewer.issuer
              ? t("you")
              : record.author.subject,
          when: stamp(record.recordedAt) + " · " + timeZone,
        })}
      </p>
      {encounterLabel && (
        <p>
          {t("encounter")} · {encounterLabel}
        </p>
      )}
      <details className="directory-disclosure">
        <summary>{t("reference")}</summary>
        <dl className="patient-demographics">
          {(
            [
              ["recordId", record.id],
              ["revisionId", record.revisionId],
              ["encounterId", record.encounterId],
              ["author", record.author.subject],
              ["issuer", record.author.issuer],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt>{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
      {current && context && (
        <>
          <Link className="directory-back" href={current.historyUrl}>
            {t("openHistory")}
          </Link>
          {isWorkflow(kind) ? (
            workflowActions(kind, status).map((action) => editor(action, action))
          ) : kind !== "lab" ? (
            editor("correct", "correct")
          ) : (
            <>
              {status === "ORDERED" && editor("correct", "orderCorrection")}
              {editor("result", editableLab ? "correctResult" : "enterResult")}
              {review && editor("review", "review")}
            </>
          )}
          {isWorkflow(kind) && !terminalStatus(status) ? (
            <p>{t("privateStage")}</p>
          ) : kind === "lab" && status !== "REVIEWED" ? (
            <p>{t("labPrivate")}</p>
          ) : (
            <>
              <p>
                {!linked
                  ? t("staleGuardians")
                  : record.sharing.guardianIds.length
                    ? t(isWorkflow(kind) ? "releasedSummary" : "released", {
                        names: linked
                          .filter((g) => record.sharing.guardianIds.includes(g.id))
                          .map((g) => g.name)
                          .join(", "),
                      })
                    : t("private")}
              </p>
              {linked?.length ? (
                <details key={record.sharing.revision} className="directory-disclosure">
                  <summary>{t("sharing")}</summary>
                  <ReleaseForm context={context} record={record} guardians={linked} />
                </details>
              ) : linked ? (
                <p>{t("noGuardians")}</p>
              ) : (
                <a href={`/${locale}${current.pageUrl}`} className="directory-back">
                  {t("refresh")}
                </a>
              )}
            </>
          )}
        </>
      )}
    </li>
  );
}
