"use client";

import type { components } from "@vetx/api-client";
import { Button } from "@vetx/ui-web";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition, type FormEvent } from "react";

async function send(endpoint: string, csrf: string, body: FormData | string) {
  const headers: Record<string, string> = { "X-VetX-CSRF": csrf };
  if (typeof body === "string") headers["Content-Type"] = "application/json";
  try {
    const result = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      redirect: "error",
    });
    return result.status;
  } catch {
    return 503;
  }
}

function errorKey(status: number, upload: boolean) {
  switch (status) {
    case 400:
    case 415:
      return upload ? "invalid" : "sharingInvalid";
    case 401:
    case 403:
      return "denied";
    case 404:
      return "missing";
    case 409:
      return upload ? "uploadConflict" : "conflict";
    case 413:
      return "tooLarge";
    default:
      return "writeError";
  }
}

type Props = { endpoint: string; csrf: string };

export function DocumentUpload({ endpoint, csrf, firstPage }: Props & { firstPage?: string }) {
  const t = useTranslations("webDocuments");
  const router = useRouter();
  const id = useRef<string | null>(null);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<number>();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const requestId = (id.current ??= crypto.randomUUID());
    setStatus(undefined);
    start(async () => {
      const response = await send(`${endpoint}/${requestId}`, csrf, data);
      setStatus(response);
      if (response === 204) {
        form.reset();
        id.current = null;
        if (firstPage) router.replace(firstPage);
        router.refresh();
      } else if (response === 409) {
        // The server confirmed this ID was used for different content.
        id.current = null;
        router.refresh();
      }
    });
  }
  return (
    <form
      method="post"
      onSubmit={submit}
      onChange={() => {
        id.current = null;
        setStatus(undefined);
      }}
      aria-label={t("uploadHeading")}
    >
      <fieldset className="directory-form" disabled={pending}>
        <label>
          {t("titleLabel")}
          <input name="title" required maxLength={180} />
        </label>
        <label>
          {t("fileLabel")}
          <input
            type="file"
            name="file"
            required
            accept="application/pdf,image/png,image/jpeg,application/dicom,.dcm"
            aria-describedby="document-types"
          />
        </label>
        <small id="document-types">{t("fileHint")}</small>
        <Button type="submit" variant="primary">
          {t(pending ? "uploading" : "upload")}
        </Button>
      </fieldset>
      {status !== undefined && (
        <p className="directory-notice" role={status === 204 ? "status" : "alert"}>
          {t(status === 204 ? "uploaded" : errorKey(status, true))}
        </p>
      )}
    </form>
  );
}

type SharingProps = Props & {
  guardians: Pick<components["schemas"]["GuardianDto"], "id" | "name" | "email">[];
  sharing: components["schemas"]["DocumentSharingDto"];
};

export function DocumentSharing({ endpoint, csrf, guardians, sharing }: SharingProps) {
  const t = useTranslations("webDocuments");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<number>();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const guardianIds = new FormData(event.currentTarget).getAll("guardianId");
    setStatus(undefined);
    start(async () => {
      const response = await send(
        endpoint,
        csrf,
        JSON.stringify({ guardianIds, revision: sharing.revision }),
      );
      setStatus(response);
      if (response === 204 || response === 409 || response === 404) router.refresh();
    });
  }
  if (sharing.guardianIds.some((id) => !guardians.some((guardian) => guardian.id === id))) {
    return (
      <div className="directory-form">
        <p role="status">{t("refreshRecipients")}</p>
        <Button type="button" onClick={() => router.refresh()}>
          {t("refresh")}
        </Button>
      </div>
    );
  }
  return guardians.length ? (
    <form method="post" onSubmit={submit} onChange={() => setStatus(undefined)}>
      <fieldset key={sharing.revision} className="directory-form" disabled={pending}>
        <legend>{t("guardianAccess")}</legend>
        {guardians.map((guardian) => (
          <label className="clinic-check" key={guardian.id}>
            <input
              type="checkbox"
              name="guardianId"
              value={guardian.id}
              defaultChecked={sharing.guardianIds.includes(guardian.id)}
            />
            <span>
              {guardian.name} <small>{guardian.email}</small>
            </span>
          </label>
        ))}
        <Button type="submit" variant="primary">
          {t(pending ? "saving" : "share")}
        </Button>
      </fieldset>
      {status !== undefined && (
        <p className="directory-notice" role={status === 204 ? "status" : "alert"}>
          {t(status === 204 ? "shared" : errorKey(status, false))}
        </p>
      )}
    </form>
  ) : (
    <p>{t("noGuardians")}</p>
  );
}
