"use client";

import { Button } from "@vetx/ui-web";
import { useTranslations, useMessages } from "next-intl";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import type { Preview, Commit, CandidatePage } from "./api.ts";
import { Link } from "../i18n/routing";

type Props = { endpoint: string; csrf: string; registry: string };
type Choice = { mode: "create" } | { mode: "match"; patientId: string };
type ClientResult<T> = { data: T } | { status: number };

async function send<T>(
  url: string,
  csrf: string,
  body: FormData | string,
): Promise<ClientResult<T>> {
  try {
    const headers: Record<string, string> = { "X-VetX-CSRF": csrf };
    if (typeof body === "string") headers["Content-Type"] = "application/json";
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      redirect: "error",
    });
    return res.ok ? { data: (await res.json()) as T } : { status: res.status };
  } catch {
    return { status: 503 };
  }
}
function errorKey(status: number) {
  switch (status) {
    case 400:
    case 415:
    case 422:
      return "invalid";
    case 401:
    case 403:
      return "denied";
    case 404:
      return "missing";
    case 409:
      return "conflict";
    case 413:
      return "tooLarge";
    default:
      return "unavailable";
  }
}
export function ImportForm(props: Props) {
  const t = useTranslations("webExchange");
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<number>();
  const [busy, start] = useTransition();
  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setError(undefined);
    start(async () => {
      const result = await send<Preview>(props.endpoint + "/preview", props.csrf, data);
      if ("data" in result) setPreview(result.data);
      else setError(result.status);
    });
  }
  return preview ? (
    <Review
      key={preview.receiptId}
      {...props}
      preview={preview}
      reset={() => {
        setPreview(undefined);
        requestAnimationFrame(() => fileInput.current?.focus());
      }}
    />
  ) : (
    <section className="directory-section exchange-form" aria-labelledby="choose-package">
      <h2 id="choose-package">{t("choosePackage")}</h2>
      <form method="post" onSubmit={upload} encType="multipart/form-data">
        <fieldset className="directory-form" disabled={busy}>
          <label>
            {t("packageFile")}
            <input
              ref={fileInput}
              type="file"
              required
              name="file"
              accept=".vetpkg"
              aria-describedby="package-help"
              onChange={() => setError(undefined)}
            />
          </label>
          <small id="package-help">{t("previewHelp")}</small>
          <Button variant="primary" type="submit">
            {t(busy ? "verifying" : "preview")}
          </Button>
        </fieldset>
      </form>
      {error !== undefined && (
        <p role="alert" className="directory-notice">
          {t(errorKey(error))}
        </p>
      )}
    </section>
  );
}

function Review({
  preview,
  registry,
  endpoint,
  csrf,
  reset,
}: Props & { preview: Preview; reset: () => void }) {
  const t = useTranslations("webExchange");
  const [choice, setChoice] = useState<Choice>();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [page, setPage] = useState<CandidatePage>();
  const [result, setResult] = useState<Commit>();
  const [error, setError] = useState<number>();
  const [searchError, setSearchError] = useState<number>();
  const [committing, commitTransition] = useTransition(),
    [searching, searchTransition] = useTransition();
  const kinds: Record<string, string> = useMessages().webExchange.kinds;
  const done = preview.committedPatientId || result?.patientId;
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const completionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = done ? completionHeading.current : reviewHeading.current;
    heading?.focus();
  }, [done]);
  const candidates = (page?.patients ?? preview.candidates).filter(
    (p) => !preview.mappedPatientId || preview.mappedPatientId === p.id,
  );
  function search(name: string, n: number) {
    if (searching || committing || !name.trim()) return;
    setSearchError(undefined);
    searchTransition(async () => {
      const response = await send<CandidatePage>(
        endpoint + "/search",
        csrf,
        JSON.stringify({ search: name.trim(), page: n }),
      );
      if ("data" in response) {
        setPage(response.data);
        setChoice(undefined);
        setError(undefined);
        setSearched(name.trim());
      } else setSearchError(response.status);
    });
  }
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice || committing || done) return;
    setError(undefined);
    commitTransition(async () => {
      const response = await send<Commit>(
        endpoint + "/" + preview.receiptId + "/commit",
        csrf,
        JSON.stringify(choice),
      );
      if ("data" in response) setResult(response.data);
      else setError(response.status);
    });
  }
  return (
    <div className="directory-columns">
      <section className="directory-section" aria-labelledby="exchange-preview">
        <h2 ref={reviewHeading} tabIndex={-1} id="exchange-preview">
          {t("verifiedPackage")}
        </h2>
        <dl className="patient-demographics">
          <div>
            <dt>{t("sourcePatient")}</dt>
            <dd>
              {preview.patient.name} · {preview.patient.species}
              {preview.patient.birthDate && " · " + preview.patient.birthDate}
            </dd>
          </div>
          {preview.owner && (
            <div>
              <dt>{t("owner")}</dt>
              <dd>
                {preview.owner.name}
                {preview.owner.email && " · " + preview.owner.email}
              </dd>
            </div>
          )}
          <div>
            <dt>{t("sourceOrganization")}</dt>
            <dd>{preview.source.organizationId}</dd>
          </div>
          <div>
            <dt>{t("sourceClinic")}</dt>
            <dd>{preview.source.clinicId}</dd>
          </div>
          <div>
            <dt>{t("sourcePatientId")}</dt>
            <dd>{preview.patient.id}</dd>
          </div>
          <div>
            <dt>{t("packageId")}</dt>
            <dd>{preview.packageId}</dd>
          </div>
          <div>
            <dt>{t("records", { count: preview.recordCount })}</dt>
            <dd>
              <ul>
                {preview.counts.map(({ kind, count }) => (
                  <li key={kind}>
                    {kinds[kind] ?? kind} · {count}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
        <Button type="button" onClick={reset} disabled={committing}>
          {t("anotherPackage")}
        </Button>
      </section>
      <section className="directory-section" aria-labelledby="review-choice">
        <h2 ref={completionHeading} tabIndex={-1} id="review-choice">
          {t(done ? "imported" : "chooseDestination")}
        </h2>
        {done ? (
          <>
            <p role="status">
              {result
                ? t("importResult", { inserted: result.inserted, skipped: result.skipped })
                : t("previouslyImported")}
            </p>
            <Link className="directory-back" href={`${registry}/${done}/imported-records`}>
              {t("history")}
            </Link>
          </>
        ) : (
          <>
            {preview.mappedPatientId ? (
              <p>{t("alreadyMapped")}</p>
            ) : (
              <>
                <form
                  method="post"
                  className="directory-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    search(query, 1);
                  }}
                >
                  <label>
                    {t("searchPatient")}
                    <input
                      type="search"
                      required
                      maxLength={120}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={committing}
                    />
                  </label>
                  <Button type="submit" disabled={committing || searching}>
                    {t(searching ? "searching" : "search")}
                  </Button>
                </form>
                {page && (
                  <>
                    <p role="status">
                      {page.patients.length
                        ? t("searchResults", { count: page.patients.length, search: searched })
                        : t("noMatches")}
                    </p>
                    <Button
                      type="button"
                      disabled={committing || searching}
                      onClick={() => {
                        setPage(undefined);
                        setChoice(undefined);
                        setSearchError(undefined);
                        setError(undefined);
                        setQuery("");
                      }}
                    >
                      {t("showSuggestions")}
                    </Button>
                  </>
                )}
                {page && (page.page > 1 || page.hasNextPage) && (
                  <nav className="directory-paging" aria-label={t("searchPages")}>
                    {page.page > 1 && (
                      <Button
                        disabled={committing || searching}
                        onClick={() => search(searched, page.page - 1)}
                      >
                        {t("previous")}
                      </Button>
                    )}
                    <span>{t("page", { page: page.page })}</span>
                    {page.hasNextPage && (
                      <Button
                        disabled={committing || searching}
                        onClick={() => search(searched, page.page + 1)}
                      >
                        {t("next")}
                      </Button>
                    )}
                  </nav>
                )}
                {searchError !== undefined && (
                  <p role="alert" className="directory-notice">
                    {t(errorKey(searchError))}
                  </p>
                )}
              </>
            )}
            <form method="post" onSubmit={confirm}>
              <fieldset className="directory-form" disabled={committing || searching}>
                <legend>{t("destination")}</legend>
                {candidates.map((p) => (
                  <label className="clinic-check exchange-choice" key={p.id}>
                    <input
                      type="radio"
                      name="destination"
                      checked={choice?.mode === "match" && choice.patientId === p.id}
                      onChange={() => {
                        setChoice({ mode: "match", patientId: p.id });
                        setError(undefined);
                      }}
                    />
                    <span>
                      {p.name} · {p.species}
                      {p.birthDate && " · " + p.birthDate}
                      <small>{p.id}</small>
                    </span>
                  </label>
                ))}
                {!preview.mappedPatientId && (
                  <label className="clinic-check">
                    <input
                      type="radio"
                      name="destination"
                      checked={choice?.mode === "create"}
                      onChange={() => {
                        setChoice({ mode: "create" });
                        setError(undefined);
                      }}
                    />
                    {t("createPatient", { name: preview.patient.name })}
                  </label>
                )}
                <Button variant="primary" type="submit" disabled={!choice || committing}>
                  {t(committing ? "committing" : "confirm")}
                </Button>
              </fieldset>
            </form>
            {error !== undefined && (
              <p role="alert" className="directory-notice">
                {t(errorKey(error))}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
