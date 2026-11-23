"use client";

import { Button } from "@vetx/ui-web";
import type { components } from "@vetx/api-client";
import type { Locale } from "@vetx/i18n";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { referralMessages, noticeForReferral } from "./messages.ts";
import styles from "./referrals.module.css";

type Context = { locale: Locale; csrf: string; endpoint: string };
async function send(endpoint: string, csrf: string, body: unknown) {
  try {
    return (
      await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: { "Content-Type": "application/json", "X-VetX-CSRF": csrf },
        body: JSON.stringify(body),
      })
    ).status;
  } catch {
    return 503;
  }
}
export function RefreshReferrals({ locale }: { locale: Locale }) {
  const t = referralMessages(locale),
    router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button type="button" disabled={pending} onClick={() => start(() => router.refresh())}>
      {t(pending ? "refreshing" : "refresh")}
    </Button>
  );
}
type RequestProps = Context & {
  guardians: components["schemas"]["GuardianDto"][];
  destinations: components["schemas"]["ReferralDestinationDto"][];
};

export function ReferralRequestForm({
  locale,
  csrf,
  endpoint,
  guardians,
  destinations,
}: RequestProps) {
  const t = referralMessages(locale),
    router = useRouter();
  const [status, setStatus] = useState<number>(),
    [pending, start] = useTransition();
  const requestId = useRef<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget,
      data = new FormData(form);
    const destination = destinations.find(
      (d) => d.organizationId + "/" + d.clinicId === data.get("destination"),
    );
    if (!destination) {
      setStatus(400);
      return;
    }
    const id = (requestId.current ??= crypto.randomUUID());
    const body = {
      guardianId: data.get("guardian"),
      reason: data.get("reason"),
      summary: data.get("summary"),
      destination: { organizationId: destination.organizationId, clinicId: destination.clinicId },
    };
    setStatus(undefined);
    start(async () => {
      const code = await send(endpoint + "/" + id, csrf, body);
      setStatus(code);
      if (code === 204) {
        requestId.current = null;
        form.reset();
        router.refresh();
      } else if ([403, 404, 409].includes(code)) {
        router.refresh();
      }
    });
  }
  return (
    <form
      method="post"
      onSubmit={submit}
      onChange={() =>
        setStatus((previous) => (previous === 409 || (previous ?? 0) >= 500 ? previous : undefined))
      }
      aria-label={t("request")}
    >
      <fieldset className="directory-form" disabled={pending}>
        <label>
          {t("guardian")}
          <select name="guardian" required defaultValue="">
            <option value="" disabled>
              {t("selectGuardian")}
            </option>
            {guardians.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("destination")}
          <select name="destination" required defaultValue="">
            <option value="" disabled>
              {t("selectClinic")}
            </option>
            {destinations.map((d) => (
              <option
                key={d.organizationId + "/" + d.clinicId}
                value={d.organizationId + "/" + d.clinicId}
              >
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("reason")}
          <input name="reason" required maxLength={250} />
        </label>
        <label>
          {t("summary")}
          <textarea className={styles.textarea} name="summary" maxLength={8000} rows={4} />
        </label>
        <small>{t("note")}</small>
        <Button type="submit" variant="selected">
          {t(pending ? "submitting" : "submit")}
        </Button>
      </fieldset>
      {status === 409 && (
        <Button
          type="reset"
          disabled={pending}
          onClick={() => {
            requestId.current = null;
            setStatus(undefined);
          }}
        >
          {t("newDraft")}
        </Button>
      )}
      {status !== undefined && (
        <p className="directory-notice" role={status === 204 ? "status" : "alert"}>
          {t(
            status === 204 ? "requested" : status >= 500 ? "uncertain" : noticeForReferral(status),
          )}
        </p>
      )}
    </form>
  );
}

export function CounterReferralForm({
  locale,
  csrf,
  endpoint,
  revision,
}: Context & { revision: number }) {
  const t = referralMessages(locale),
    router = useRouter();
  const [status, setStatus] = useState<number>(),
    [pending, start] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const summary = new FormData(event.currentTarget).get("summary");
    if (typeof summary !== "string" || !summary.trim()) {
      setStatus(400);
      return;
    }
    setStatus(undefined);
    start(async () => {
      const code = await send(endpoint, csrf, { revision, summary });
      setStatus(code);
      if ([204, 403, 404, 409].includes(code)) router.refresh();
    });
  }
  return (
    <form method="post" onSubmit={submit} onChange={() => setStatus(undefined)}>
      <fieldset className="directory-form" disabled={pending}>
        <label>
          {t("responseSummary")}
          <textarea name="summary" className={styles.textarea} rows={4} required maxLength={8000} />
        </label>
        <Button type="submit" variant="selected">
          {t(pending ? "submitting" : "sendResponse")}
        </Button>
      </fieldset>
      {status !== undefined && (
        <p className="directory-notice" role={status === 204 ? "status" : "alert"}>
          {t(
            status === 204 ? "responded" : status >= 500 ? "uncertain" : noticeForReferral(status),
          )}
        </p>
      )}
    </form>
  );
}
