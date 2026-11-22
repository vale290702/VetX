"use client";

import { Button } from "@vetx/ui-web";
import type { Locale } from "@vetx/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { noticeForStatus, type PatientNotice } from "./forms.ts";

type Props = {
  endpoint: string;
  csrf: string;
  patientId: string;
  guardianId: string;
  locale: Locale;
  initialRequestId: string;
  labels: Record<
    | Exclude<PatientNotice, "saved">
    | "issue"
    | "issuing"
    | "code"
    | "expires"
    | "copy"
    | "copied"
    | "manual"
    | "dismiss"
    | "expired"
    | "instructions",
    string
  >;
};

export function Invitation({
  endpoint,
  csrf,
  patientId,
  guardianId,
  locale,
  initialRequestId,
  labels,
}: Props) {
  const requestId = useRef(initialRequestId);
  const inflight = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const issueButton = useRef<HTMLButtonElement>(null);
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<{ code: string; expiresAt: string } | null>(null);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!result) return;
    input.current?.focus();
    const expiresAt = Date.parse(result.expiresAt);
    let timer: number | undefined;
    function checkExpiry() {
      window.clearTimeout(timer);
      const remaining = expiresAt - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
        return;
      }
      setResult(null);
      setFeedback(labels.expired);
      if (document.hasFocus()) requestAnimationFrame(() => issueButton.current?.focus());
    }
    checkExpiry();
    document.addEventListener("visibilitychange", checkExpiry);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkExpiry);
    };
  }, [result, labels.expired]);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inflight.current) return;
    inflight.current = true;
    setIssuing(true);
    setFeedback("");
    const form = new FormData(event.currentTarget);
    form.set("requestId", requestId.current);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: form,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        if (response.status === 409) requestId.current = crypto.randomUUID();
        setFeedback(labels[noticeForStatus(response.status)]);
        return;
      }
      const data: { code: string; expiresAt: string } = await response.json();
      setResult(data);
      requestId.current = crypto.randomUUID();
    } catch {
      setFeedback(labels.writeUnavailable);
    } finally {
      inflight.current = false;
      setIssuing(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setFeedback(labels.copied);
    } catch {
      input.current?.focus();
      input.current?.select();
      setFeedback(labels.manual);
    }
  }

  return (
    <div className="invitation">
      <form onSubmit={issue} action={endpoint} method="post" hidden={!!result}>
        <input type="hidden" name="action" value="invite" />
        <input type="hidden" name="csrf" value={csrf} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="patientId" value={patientId} />
        <input type="hidden" name="guardianId" value={guardianId} />
        <input type="hidden" name="requestId" value={initialRequestId} />
        <Button type="submit" ref={issueButton} disabled={issuing} variant="selected">
          {issuing ? labels.issuing : labels.issue}
        </Button>
      </form>
      {result && (
        <div className="directory-form invitation-code">
          <p>{labels.instructions}</p>
          <label>
            {labels.code}
            <textarea
              rows={2}
              ref={input}
              readOnly
              value={result.code}
              autoComplete="off"
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p>
            {labels.expires}{" "}
            <time dateTime={result.expiresAt}>
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(result.expiresAt),
              )}
            </time>
          </p>
          <div className="auth-actions">
            <Button type="button" variant="selected" onClick={copy}>
              {labels.copy}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setResult(null);
                setFeedback("");
                requestAnimationFrame(() => issueButton.current?.focus());
              }}
            >
              {labels.dismiss}
            </Button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite">
        {feedback}
      </p>
    </div>
  );
}
