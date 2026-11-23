"use client";
import type { components } from "@vetx/api-client";
import { Button } from "@vetx/ui-web";
import type { Locale } from "@vetx/i18n";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { localInput } from "../care/time.ts";
import { buildRevision, kinds, limits, recordFields, type Edit, type Kind } from "./forms.ts";
import { clinicalMessages, clinicalError } from "./messages.ts";
import type { ClinicalRecord } from "./api.ts";
type Context = { locale: Locale; csrf: string; endpoint: string };
type Submission = { url: string; body: string };

function uncertainResponse(status: number | undefined) {
  return status === 408 || (status !== undefined && status >= 500);
}

function SaveForm({
  context,
  build,
  label,
  children,
  afterSave,
}: {
  context: Context;
  build: (form: FormData) => Submission | null;
  label: "save" | "order" | "saveVersion" | "reviewConfirm" | "saveAccess";
  children: ReactNode;
  afterSave?: () => void;
}) {
  const router = useRouter(),
    t = clinicalMessages(context.locale);
  const [status, setStatus] = useState<number>(),
    [busy, start] = useTransition();
  const submission = useRef<Submission | null>(null),
    inFlight = useRef(false);
  const uncertain = uncertainResponse(status);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || inFlight.current) return;
    const form = event.currentTarget;
    const task = submission.current ?? build(new FormData(form));
    if (!task) {
      setStatus(400);
      return;
    }
    inFlight.current = true;
    submission.current = task;
    setStatus(undefined);
    start(async () => {
      let status = 503;
      try {
        status = (
          await fetch(task.url, {
            method: "POST",
            cache: "no-store",
            redirect: "error",
            headers: { "Content-Type": "application/json", "X-VetX-CSRF": context.csrf },
            body: task.body,
          })
        ).status;
      } catch {
        /* The upstream may already have applied this version. */
      }
      setStatus(status);
      inFlight.current = false;
      if (!uncertainResponse(status)) submission.current = null;
      if (status === 204) {
        form.reset();
        afterSave?.();
        router.refresh();
      }
    });
  }
  return (
    <form
      method="post"
      onSubmit={submit}
      onChange={() => {
        if (!submission.current) setStatus(undefined);
      }}
    >
      <fieldset className="directory-form" disabled={busy || uncertain}>
        {children}
        <Button variant="selected" type="submit">
          {t(busy ? "busy" : label)}
        </Button>
      </fieldset>
      {status !== undefined && (
        <p role={status === 204 ? "status" : "alert"} className="directory-notice">
          {t(status === 204 ? "saved" : uncertain ? "uncertain" : clinicalError(status))}
        </p>
      )}
      {uncertain && (
        <Button type="submit" disabled={busy}>
          {t("retry")}
        </Button>
      )}
      {status === 409 && (
        <Button type="button" disabled={busy} onClick={() => start(() => router.refresh())}>
          {t("refresh")}
        </Button>
      )}
    </form>
  );
}

type EncounterChoice = { id: string; label: string };
export function EditRecord({
  context,
  zone,
  now,
  encounters = [],
  current,
  edit,
}: {
  context: Context;
  zone: string;
  now: string;
  encounters?: EncounterChoice[];
  current?: ClinicalRecord;
  edit: Edit;
}) {
  const t = clinicalMessages(context.locale);
  const [selected, setSelected] = useState<Kind>(current?.kind ?? "diagnosis");
  const fields = recordFields(selected, edit);
  function build(form: FormData) {
    const body = buildRevision(selected, edit, form, zone, current);
    if (!body) return null;
    const recordId = current?.id ?? crypto.randomUUID();
    return {
      url: context.endpoint + "/" + recordId + "/" + crypto.randomUUID(),
      body: JSON.stringify(body),
    };
  }
  return (
    <SaveForm
      context={context}
      label={
        edit === "review"
          ? "reviewConfirm"
          : edit === "new"
            ? selected === "lab"
              ? "order"
              : "save"
            : "saveVersion"
      }
      build={build}
      afterSave={() => setSelected(current?.kind ?? "diagnosis")}
    >
      {!current && (
        <>
          <label>
            {t("encounter")}
            <select name="encounterId" required defaultValue="">
              <option value="" disabled>
                {t("selectEncounter")}
              </option>
              {encounters.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("kind")}
            <select value={selected} onChange={(e) => setSelected(e.target.value as Kind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {edit !== "review" && (
        <>
          <label>
            {t("occurredAt", { zone })}
            <input
              required
              name="occurredAt"
              type="datetime-local"
              step="any"
              defaultValue={localInput(current?.occurredAt ?? now, zone, !!current)}
            />
          </label>
          {fields.map((field, i) => {
            const required = i === 0 || field === "result";
            return (
              <label key={field}>
                {t(field)}
                {!required && " (" + t("requiredHint") + ")"}
                {limits[field] === 8000 ? (
                  <textarea
                    name={field}
                    rows={3}
                    maxLength={limits[field]}
                    required={required}
                    defaultValue={current?.data[field] ?? ""}
                  />
                ) : (
                  <input
                    name={field}
                    type={field === "nextDueDate" ? "date" : "text"}
                    maxLength={limits[field]}
                    required={required}
                    defaultValue={current?.data[field] ?? ""}
                  />
                )}
              </label>
            );
          })}
        </>
      )}
      {current && (
        <>
          <p>{t(edit === "review" ? "reviewHint" : "correctionHint")}</p>
          <label>
            {t("changeReason")}
            <input type="text" name="changeReason" required maxLength={500} />
          </label>
        </>
      )}
    </SaveForm>
  );
}

export function ReleaseForm({
  context,
  record,
  guardians,
}: {
  context: Context;
  record: ClinicalRecord;
  guardians: { id: string; name: string; email: string }[];
}) {
  const t = clinicalMessages(context.locale);
  return (
    <SaveForm
      context={context}
      label="saveAccess"
      build={(form) => ({
        url: context.endpoint + "/" + record.id + "/sharing",
        body: JSON.stringify({
          recordRevision: record.revision,
          revision: record.sharing.revision,
          guardianIds: form.getAll("guardianIds").map(String),
        } satisfies components["schemas"]["ClinicalSharingDto"]),
      })}
    >
      <fieldset>
        <legend>{t("selectRecipients")}</legend>
        {guardians.map((g) => (
          <label className="clinic-check" key={g.id}>
            <input
              type="checkbox"
              name="guardianIds"
              value={g.id}
              defaultChecked={record.sharing.guardianIds.includes(g.id)}
            />
            {g.name} · {g.email}
          </label>
        ))}
      </fieldset>
      <small>{t("sharingHint")}</small>
    </SaveForm>
  );
}
