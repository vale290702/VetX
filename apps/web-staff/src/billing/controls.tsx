"use client";
import { Button } from "@vetx/ui-web";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { billingMessages } from "./messages.ts";
import type { Context } from "./model.ts";
export function failure(status: number) {
  if (status === 400 || status === 413) return "invalid";
  if (status === 401 || status === 403) return "denied";
  if (status === 404) return "missing";
  if (status === 409) return "conflict";
  return "uncertain";
}
export function BillingForm({
  ctx,
  label,
  resource,
  id,
  prepare,
  onSaved,
  children,
  submitLabel,
}: {
  ctx: Context;
  label: string;
  submitLabel?: string;
  resource: string;
  id?: string;
  prepare: (form: FormData) => object | null;
  onSaved?: (id: string) => void;
  children: ReactNode;
}) {
  const t = billingMessages(ctx.locale);
  const last = useRef<{ id: string; body: string } | null>(null),
    busy = useRef(false);
  const [pending, setPending] = useState(false),
    [status, setStatus] = useState(0);
  const uncertain = status >= 500 || status === 408;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    let attempt = last.current;
    if (!attempt) {
      const data = prepare(new FormData(event.currentTarget));
      if (!data) {
        setStatus(400);
        return;
      }
      attempt = { id: id ?? crypto.randomUUID(), body: JSON.stringify(data) };
      last.current = attempt;
    }
    busy.current = true;
    setPending(true);
    setStatus(0);
    let result = 503;
    try {
      const route = resource.replace("{id}", attempt.id);
      result = (
        await fetch(ctx.endpoint + "/" + route, {
          method: "POST",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: { "Content-Type": "application/json", "X-VetX-CSRF": ctx.csrf },
          body: attempt.body,
        })
      ).status;
    } catch {
      /* Retrying sends the exact original transaction. */
    }
    if (result === 204) {
      if (onSaved) onSaved(attempt.id);
      else window.location.reload();
      return;
    }
    if (result < 500 && result !== 408) last.current = null;
    setStatus(result);
    busy.current = false;
    setPending(false);
  }
  return (
    <form
      method="post"
      action={ctx.endpoint}
      onSubmit={submit}
      aria-label={label}
      className="directory-form"
      autoComplete="off"
    >
      <fieldset className="care-fields" disabled={pending || uncertain}>
        {children}
      </fieldset>
      {!!status && (
        <p role="alert" className="directory-notice">
          {t(uncertain ? "uncertain" : failure(status))}
        </p>
      )}
      <Button type="submit" variant="selected" disabled={pending}>
        {pending ? t("saving") : uncertain ? t("retry") : (submitLabel ?? label)}
      </Button>
    </form>
  );
}

export function Picker<T>({
  ctx,
  resource,
  field,
  label,
  searchable = false,
  optionKey,
  describe,
  include,
  selected,
  onPick,
  optional = false,
}: {
  ctx: Context;
  resource: string;
  field: string;
  label: string;
  searchable?: boolean;
  optionKey: (row: T) => string;
  describe: (row: T) => string;
  include?: (row: T) => boolean;
  selected: T | null;
  onPick: (row: T | null) => void;
  optional?: boolean;
}) {
  const t = billingMessages(ctx.locale);
  const [input, setInput] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    url: string;
    rows: T[];
    next: boolean;
    status: number;
  } | null>(null);
  const url =
    ctx.endpoint + "/" + resource + "?" + new URLSearchParams({ page: String(page), q: query });
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then(async (res) => {
        if (!res.ok) throw res.status;
        const data = await res.json();
        if (!Array.isArray(data[field])) throw 503;
        if (live)
          setResult({ url, rows: data[field], next: data.hasNextPage === true, status: 200 });
      })
      .catch((err) => {
        if (live)
          setResult({ url, rows: [], next: false, status: typeof err === "number" ? err : 503 });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [url, field, retry]);
  const current = result?.url === url ? result : null,
    rows = current?.rows.filter(include ?? (() => true)) ?? [];
  const key = selected ? optionKey(selected) : "";
  return (
    <fieldset className="billing-picker">
      <legend>{label}</legend>
      {searchable && (
        <div className="registry-search">
          <label>
            {t("searchFor", { field: label })}
            <input
              value={input}
              maxLength={120}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setPage(1);
                  setQuery(input.trim());
                }
              }}
            />
          </label>
          <Button
            type="button"
            onClick={() => {
              setPage(1);
              setQuery(input.trim());
            }}
          >
            {t("search")}
          </Button>
        </div>
      )}
      <select
        aria-label={label}
        value={key}
        onChange={(e) => onPick(rows.find((row) => optionKey(row) === e.target.value) ?? null)}
      >
        <option value="">{t(optional ? "none" : "select")}</option>
        {selected && !rows.some((row) => optionKey(row) === key) && (
          <option value={key}>{describe(selected)}</option>
        )}
        {rows.map((row) => (
          <option key={optionKey(row)} value={optionKey(row)}>
            {describe(row)}
          </option>
        ))}
      </select>
      {!current ? (
        <small role="status">{t("loading")}</small>
      ) : current.status !== 200 ? (
        <div>
          <p role="alert">
            {t(current.status === 401 || current.status === 403 ? "denied" : "loadError")}
          </p>
          <Button
            type="button"
            onClick={() => {
              setResult(null);
              setRetry((r) => r + 1);
            }}
          >
            {t("refresh")}
          </Button>
        </div>
      ) : (
        !rows.length && <small>{t("noOptions")}</small>
      )}
      {current?.status === 200 && (
        <Button
          type="button"
          onClick={() => {
            setResult(null);
            setRetry((r) => r + 1);
          }}
        >
          {t("reloadOptions")}
        </Button>
      )}
      {(page > 1 || current?.next) && (
        <div className="agenda-nav">
          {page > 1 && (
            <Button type="button" onClick={() => setPage((p) => p - 1)}>
              {t("previous")}
            </Button>
          )}
          {current?.next && (
            <Button type="button" onClick={() => setPage((p) => p + 1)}>
              {t("next")}
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function Currency({ ctx, value = "CRC" }: { ctx: Context; value?: string }) {
  return (
    <label>
      {billingMessages(ctx.locale)("currency")}
      <input
        name="currency"
        required
        defaultValue={value}
        pattern="[A-Z]{3}"
        maxLength={3}
        autoCapitalize="characters"
      />
    </label>
  );
}
export function Amount({
  label,
  name,
  value = "",
  required = true,
}: {
  label: string;
  name: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="text"
        inputMode="decimal"
        name={name}
        required={required}
        defaultValue={value}
        maxLength={20}
      />
    </label>
  );
}
