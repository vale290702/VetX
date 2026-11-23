"use client";
import { Button } from "@vetx/ui-web";
import type { Locale } from "@vetx/i18n";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { parseTrade, type Change, type ChoiceKind, type Choices, type Choice } from "./forms.ts";
import { tradeMessages, notice } from "./messages.ts";
export type Context = { locale: Locale; endpoint: string; csrf: string };
export function Refresh({ locale }: { locale: Locale }) {
  const router = useRouter(),
    [pending, start] = useTransition();
  return (
    <Button type="button" disabled={pending} onClick={() => start(() => router.refresh())}>
      {tradeMessages(locale)("refresh")}
    </Button>
  );
}
export function Write({
  ctx,
  action,
  id,
  label,
  fields,
  children,
  onSaved,
}: {
  ctx: Context;
  action: Change["action"];
  id?: string;
  label: string;
  fields: (data: FormData) => object;
  children: ReactNode;
  onSaved?: () => void;
}) {
  const t = tradeMessages(ctx.locale),
    router = useRouter(),
    key = useRef<string | null>(null),
    [pending, start] = useTransition(),
    [retry, setRetry] = useState<string | null>(null),
    [status, setStatus] = useState<number>(),
    [draftVersion, setDraftVersion] = useState(0);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    let payload = retry;
    if (payload === null) {
      const body = fields(new FormData(form));
      if (!parseTrade(action, body)) {
        setStatus(400);
        return;
      }
      payload = JSON.stringify(body);
    }
    const body = payload,
      target = id ?? (key.current ??= crypto.randomUUID());
    setStatus(undefined);
    start(async () => {
      let code = 503;
      try {
        code = (
          await fetch(ctx.endpoint + "/" + action + "/" + target, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-VetX-CSRF": ctx.csrf },
            body,
            cache: "no-store",
            redirect: "error",
          })
        ).status;
      } catch {
        /* Preserve the exact request for retry. */
      }
      setStatus(code);
      setRetry(code >= 500 || code === 408 || code === 429 ? body : null);
      if (code === 204) {
        key.current = null;
        if (!id) {
          form.reset();
          setDraftVersion((previous) => previous + 1);
          onSaved?.();
        }
        router.refresh();
      }
    });
  }
  return (
    <form
      className="directory-form"
      aria-label={label}
      method="post"
      onSubmit={submit}
      onChange={() => {
        if (!retry) setStatus(undefined);
      }}
    >
      <fieldset key={draftVersion} className="directory-form" disabled={pending || retry !== null}>
        {children}
      </fieldset>
      <Button type="submit" variant="selected" disabled={pending}>
        {pending ? t("pending") : retry ? t("retry") : label}
      </Button>
      {status !== undefined && (
        <p className="directory-notice" role={status === 204 ? "status" : "alert"}>
          {t(status === 204 ? "saved" : retry ? "uncertain" : notice(status))}
        </p>
      )}
    </form>
  );
}
export function Picker({
  ctx,
  kind,
  initial,
  name,
  label,
  unitName,
  quantityName,
}: {
  ctx: Context;
  kind: ChoiceKind;
  initial: Choices;
  name: string;
  label: string;
  unitName?: string;
  quantityName?: string;
}) {
  const t = tradeMessages(ctx.locale),
    [extra, setExtra] = useState<{ first: Choices; all: Choices }>(),
    [pending, start] = useTransition(),
    [status, setStatus] = useState<number>(),
    [chosen, setChosen] = useState<Choice>(),
    [reviewUnit, setReviewUnit] = useState(false);
  const list = extra?.first === initial ? extra.all : initial;
  const current = chosen && list.options.find((option) => option.id === chosen.id);
  if (chosen && (!current || (unitName && current.unit !== chosen.unit))) {
    setChosen(undefined);
    if (unitName) setReviewUnit(true);
  }
  function more() {
    start(async () => {
      try {
        const response = await fetch(
          ctx.endpoint + "/options?kind=" + kind + "&page=" + (list.page + 1),
          { cache: "no-store", redirect: "error" },
        );
        if (!response.ok) {
          setStatus(response.status);
          return;
        }
        const next: Choices = await response.json();
        setExtra({
          first: initial,
          all: {
            ...next,
            options: [
              ...new Map([...list.options, ...next.options].map((v) => [v.id, v])).values(),
            ],
          },
        });
        setStatus(undefined);
      } catch {
        setStatus(503);
      }
    });
  }
  return (
    <>
      <label>
        {label}
        <select
          name={name}
          required
          value={chosen?.id ?? ""}
          onChange={(event) => {
            setChosen(list.options.find((option) => option.id === event.currentTarget.value));
            setReviewUnit(false);
          }}
        >
          <option disabled value="">
            {t("select")}
          </option>
          {list.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {unitName && (
        <>
          {reviewUnit && <p role="alert">{t("reviewUnit")}</p>}
          <input name={unitName} type="hidden" value={current?.unit ?? ""} />
          <Quantity
            key={JSON.stringify([current?.id, current?.unit])}
            ctx={ctx}
            unit={current?.unit}
            name={quantityName}
            disabled={!current}
          />
        </>
      )}
      {list.hasNextPage && (
        <Button type="button" onClick={more} disabled={pending}>
          {t("more")}
        </Button>
      )}
      {status !== undefined && <p role="alert">{t(notice(status))}</p>}
    </>
  );
}
export function Quantity({
  ctx,
  name = "quantity",
  unit,
  disabled = false,
}: {
  ctx: Context;
  name?: string;
  unit?: string;
  disabled?: boolean;
}) {
  const t = tradeMessages(ctx.locale);
  return (
    <label>
      {unit ? t("quantity") + " (" + unit + ")" : t("total")}
      <input name={name} inputMode="decimal" maxLength={19} required disabled={disabled} />
    </label>
  );
}
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="directory-disclosure">
      <summary>{label}</summary>
      {children}
    </details>
  );
}
