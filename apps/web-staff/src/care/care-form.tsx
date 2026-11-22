"use client";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@vetx/ui-web";

type SaveError = "invalid" | "conflict" | "denied" | "missing" | "unavailable" | "overlap";

export function CareForm({
  endpoint,
  children,
  labels,
}: {
  endpoint: string;
  children: ReactNode;
  labels: Record<SaveError | "submit" | "saving", string>;
}) {
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const body = new FormData(event.currentTarget);
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
      });
      if (response.status === 401 || response.status === 403) {
        setError("denied");
        return;
      }
      const result = await response.json();
      if (response.ok && result.notice === "saved") {
        window.location.assign(result.location);
        return;
      }
      const errors: SaveError[] = [
        "invalid",
        "conflict",
        "denied",
        "missing",
        "unavailable",
        "overlap",
      ];
      setError(errors.includes(result.notice) ? result.notice : "unavailable");
    } catch {
      setError("unavailable");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <form
      action={endpoint}
      method="post"
      onSubmit={submit}
      className="directory-form"
      autoComplete="off"
    >
      <fieldset disabled={pending} className="care-fields">
        {children}
      </fieldset>
      {error && (
        <p className="directory-notice" role="alert">
          {labels[error]}
        </p>
      )}
      <Button variant="selected" type="submit" disabled={pending}>
        {labels[pending ? "saving" : "submit"]}
      </Button>
    </form>
  );
}
