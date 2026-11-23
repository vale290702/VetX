import { randomUUID } from "node:crypto";
import { type Locale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { getTranslations } from "next-intl/server";
import type { Patient, RecordView } from "./api.ts";
import { today } from "./forms.ts";
import { Invitation } from "./invitation";

type FormContext = { csrf: string; locale: Locale; endpoint: string };
function HiddenFields({
  csrf,
  locale,
  patientId,
  source,
}: FormContext & { patientId: string; source: "list" | "detail" }) {
  return (
    <>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="source" value={source} />
    </>
  );
}

export async function PatientForm({
  context,
  patient,
}: {
  context: FormContext;
  patient?: Patient;
}) {
  const t = await getTranslations("patients");
  return (
    <details className="directory-disclosure">
      <summary>{t(patient ? "edit" : "newPatient")}</summary>
      <form method="post" action={context.endpoint} className="directory-form">
        <HiddenFields
          {...context}
          patientId={patient?.id ?? randomUUID()}
          source={patient ? "detail" : "list"}
        />
        <input type="hidden" name="action" value="patient" />
        <input type="hidden" name="revision" value={patient?.revision ?? 0} />
        <label>
          {t("patientName")}
          <input name="name" required maxLength={120} defaultValue={patient?.name} />
        </label>
        <label>
          {t("species")}
          <input name="species" required maxLength={80} defaultValue={patient?.species} />
        </label>
        <label>
          {t("optionalBirthDate")}
          <input
            name="birthDate"
            type="date"
            max={today()}
            defaultValue={patient?.birthDate ?? ""}
          />
        </label>
        <Button variant="primary" type="submit">
          {t(patient ? "savePatient" : "createPatient")}
        </Button>
      </form>
    </details>
  );
}

export async function Guardians({ context, record }: { context: FormContext; record: RecordView }) {
  const t = await getTranslations("patients");
  const { patient, guardians } = record;
  const hidden = { ...context, patientId: patient.id, source: "detail" as const };
  return (
    <section className="directory-section" aria-labelledby="guardians">
      <h2 id="guardians">{t("guardians")}</h2>
      <details className="directory-disclosure">
        <summary>{t("newGuardian")}</summary>
        <form method="post" action={context.endpoint} className="directory-form">
          <HiddenFields {...hidden} />
          <input type="hidden" name="action" value="guardian" />
          <input type="hidden" name="guardianId" value={randomUUID()} />
          <label>
            {t("guardianName")}
            <input name="name" autoComplete="off" required maxLength={120} />
          </label>
          <label>
            {t("email")}
            <input
              name="email"
              type="email"
              autoComplete="off"
              required
              maxLength={254}
              aria-describedby="guardian-email-help"
            />
          </label>
          <small id="guardian-email-help">{t("emailHelp")}</small>
          <Button variant="primary" type="submit">
            {t("saveGuardian")}
          </Button>
        </form>
      </details>
      {guardians.length ? (
        <ul className="directory-list">
          {guardians.map((guardian) => (
            <li className="guardian-row" key={guardian.id}>
              <h3>{guardian.name}</h3>
              <p>{guardian.email}</p>
              <p className="guardian-status">{t(guardian.linked ? "linked" : "pending")}</p>
              {!guardian.linked && (
                <Invitation
                  {...context}
                  patientId={patient.id}
                  guardianId={guardian.id}
                  initialRequestId={randomUUID()}
                  labels={{
                    issue: t("issue"),
                    issuing: t("issuing"),
                    code: t("code"),
                    expires: t("expires"),
                    copy: t("copy"),
                    copied: t("copied"),
                    manual: t("manual"),
                    dismiss: t("dismiss"),
                    expired: t("expired"),
                    instructions: t("instructions"),
                    invalid: t("invalid"),
                    conflict: t("conflict"),
                    denied: t("denied"),
                    missing: t("missing"),
                    writeUnavailable: t("writeUnavailable"),
                  }}
                />
              )}
              <details className="directory-disclosure">
                <summary>{t("revoke")}</summary>
                <form method="post" action={context.endpoint} className="directory-form">
                  <HiddenFields {...hidden} />
                  <input type="hidden" name="action" value="revoke" />
                  <input type="hidden" name="guardianId" value={guardian.id} />
                  <p>{t("confirm", { name: guardian.name })}</p>
                  <Button type="submit" variant="destructive">
                    {t("confirmRevoke")}
                  </Button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("noGuardians")}</p>
      )}
    </section>
  );
}
