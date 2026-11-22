import { randomUUID } from "node:crypto";
import { Button } from "@vetx/ui-web";
import { getTranslations } from "next-intl/server";
import { Link } from "../i18n/routing";
import type { RecordView } from "../patients/api.ts";
import { readEncounters, type Credentials } from "./api.ts";
import { carePath, sections, sharingOptions } from "./forms.ts";
import { Fields, SaveForm, Paging, ZoneField, endpoint, type CareFormContext } from "./controls";
import { displayTime, localInput } from "./time.ts";
import { AppointmentForm } from "./appointments";

async function EncounterForm({
  context,
  patientId,
  addendumTo,
}: {
  context: CareFormContext;
  patientId: string;
  addendumTo?: string;
}) {
  const t = await getTranslations("care");
  return (
    <details className="directory-disclosure">
      <summary>{t(addendumTo ? "newAddendum" : "newNote")}</summary>
      <SaveForm context={context} label="saveNote">
        <Fields context={context} patientId={patientId} />
        <input type="hidden" name="action" value="encounter" />
        <input type="hidden" name="encounterId" value={randomUUID()} />
        {addendumTo && <input type="hidden" name="addendumTo" value={addendumTo} />}
        <label>
          {t("occurredAt", { zone: context.timeZone })}
          <input
            type="datetime-local"
            name="occurredAt"
            required
            defaultValue={localInput(new Date().toISOString(), context.timeZone)}
          />
        </label>
        <label>
          {t("visitReason")}
          <input name="reason" required maxLength={250} />
        </label>
        <fieldset className="soap-fields">
          <legend>{t("soap")}</legend>
          {sections.map((key) => (
            <label key={key}>
              {t(key)}
              <textarea name={key} rows={3} maxLength={8000} />
            </label>
          ))}
        </fieldset>
        <small>{t("noteHint")}</small>
      </SaveForm>
    </details>
  );
}

export async function ClinicalHistory({
  context,
  credentials,
  record,
  viewer,
  page,
}: {
  context: CareFormContext;
  credentials: Credentials;
  viewer: { subject: string; issuer: string };
  record: RecordView;
  page: number;
}) {
  const { scope, timeZone, locale } = context,
    patientId = record.patient.id;
  const [result, t, d] = await Promise.all([
    readEncounters(credentials, scope, patientId, page),
    getTranslations("care"),
    getTranslations("directory"),
  ]);
  const parentNotes = new Map(result.data?.encounters.map((note) => [note.id, note.reason]));
  return (
    <>
      <section className="directory-section" aria-labelledby="clinical-history">
        <h2 id="clinical-history">{t("history")}</h2>
        <details className="directory-disclosure">
          <summary>{t("timeIn", { zone: timeZone })}</summary>
          <form
            method="get"
            className="directory-form registry-search"
            action={`/${locale}${carePath(scope, patientId)}`}
          >
            <ZoneField timeZone={timeZone} />
            <Button type="submit">{t("apply")}</Button>
          </form>
        </details>
        {result.data ? (
          <>
            <EncounterForm context={context} patientId={patientId} />
            {result.data.encounters.length ? (
              <ol className="directory-list">
                {result.data.encounters.map((note) => {
                  const linked = sharingOptions(record.guardians, note.sharing.guardianIds);
                  return (
                    <li className="clinical-entry" id={`encounter-${note.id}`} key={note.id}>
                      <p>
                        {t(note.addendumTo ? "addendum" : "encounter")} ·{" "}
                        <time dateTime={note.occurredAt}>
                          {displayTime(note.occurredAt, locale, timeZone)}
                        </time>
                      </p>
                      <h3>{note.reason}</h3>
                      {note.addendumTo && (
                        <p>
                          {parentNotes.has(note.addendumTo) ? (
                            <a className="directory-back" href={`#encounter-${note.addendumTo}`}>
                              {t("parent", { id: parentNotes.get(note.addendumTo)! })}
                            </a>
                          ) : (
                            t("parent", { id: note.addendumTo })
                          )}
                        </p>
                      )}
                      <details className="directory-disclosure">
                        <summary>{t("recordReference")}</summary>
                        <p>{note.id}</p>
                      </details>
                      <p>
                        {t("authored", {
                          author:
                            note.authorSubject === viewer.subject &&
                            note.authorIssuer === viewer.issuer
                              ? t("you")
                              : note.authorSubject,
                          date: displayTime(note.recordedAt, locale, timeZone),
                        })}
                      </p>
                      <dl className="soap-note">
                        {sections
                          .filter((key) => note[key])
                          .map((key) => (
                            <div key={key}>
                              <dt>{t(key)}</dt>
                              <dd>{note[key]}</dd>
                            </div>
                          ))}
                      </dl>
                      <p>
                        {!linked
                          ? t("guardiansChanged")
                          : note.sharing.guardianIds.length
                            ? t("sharedWith", {
                                names: linked
                                  .filter((g) => note.sharing.guardianIds.includes(g.id))
                                  .map((g) => g.name)
                                  .join(", "),
                              })
                            : t("privateNote")}
                      </p>
                      {!linked && (
                        <a
                          className="directory-back"
                          href={`/${locale}${carePath(scope, patientId, { timeZone, page })}`}
                        >
                          {d("retry")}
                        </a>
                      )}
                      {linked && linked.length > 0 && (
                        <details className="directory-disclosure">
                          <summary>{t("manageSharing")}</summary>
                          <form action={endpoint(context)} method="post" className="directory-form">
                            <Fields context={context} patientId={patientId} />
                            <input type="hidden" name="action" value="sharing" />
                            <input type="hidden" name="encounterId" value={note.id} />
                            <input type="hidden" name="revision" value={note.sharing.revision} />
                            <fieldset>
                              <legend>{t("recipients")}</legend>
                              {linked.map((g) => (
                                <label key={g.id} className="clinic-check">
                                  <input
                                    type="checkbox"
                                    name="guardianIds"
                                    value={g.id}
                                    defaultChecked={note.sharing.guardianIds.includes(g.id)}
                                  />
                                  {g.name} ({g.email})
                                </label>
                              ))}
                            </fieldset>
                            <small>{t("revokeHelp")}</small>
                            <Button type="submit" variant="selected">
                              {t("saveSharing")}
                            </Button>
                          </form>
                        </details>
                      )}
                      {!note.addendumTo && (
                        <EncounterForm
                          context={context}
                          patientId={patientId}
                          addendumTo={note.id}
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p>{t(page === 1 ? "emptyHistory" : "emptyPage")}</p>
            )}
            <Paging
              scope={scope}
              patientId={patientId}
              timeZone={timeZone}
              page={page}
              hasNextPage={result.data.hasNextPage}
            />
          </>
        ) : (
          <div className="directory-message">
            <p role="alert">
              {t(result.error === "unavailable" ? "historyUnavailable" : result.error!)}
            </p>
            <Link href={carePath(scope, patientId, { timeZone, page })}>{d("retry")}</Link>
          </div>
        )}
      </section>
      <section className="directory-section" aria-labelledby="patient-appointments">
        <h2 id="patient-appointments">{t("appointments")}</h2>
        <Link className="directory-back" href={carePath(scope, undefined, { timeZone })}>
          {t("calendar")}
        </Link>
        <AppointmentForm context={context} patientId={patientId} />
      </section>
    </>
  );
}
