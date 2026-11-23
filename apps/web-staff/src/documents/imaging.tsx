"use client";
import type { components } from "@vetx/api-client";
import { Button } from "@vetx/ui-web";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useId, useState } from "react";
type Imaging = components["schemas"]["DicomMetadataDto"];
export function StudyPreview({
  imaging,
  endpoint,
  title,
}: {
  imaging?: Imaging;
  endpoint: string;
  title: string;
}) {
  const t = useTranslations("webDocuments"),
    id = useId();
  const [view, setView] = useState<"closed" | "loading" | "shown" | "failed">("closed");
  return (
    <div className="study-preview">
      {imaging && (
        <>
          <p>{t("imageSummary", { modality: imaging.modality, frames: imaging.frames })}</p>
          <details className="directory-disclosure">
            <summary>{t("imageDetails")}</summary>
            <dl className="patient-demographics">
              {(["studyInstanceUid", "seriesInstanceUid", "sopInstanceUid"] as const).map((k) => (
                <div key={k}>
                  <dt>{t(k)}</dt>
                  <dd>{imaging[k]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
      {imaging?.preview ? (
        <>
          <Button
            type="button"
            aria-expanded={view === "loading" || view === "shown"}
            aria-controls={id}
            onClick={() => setView(view === "shown" || view === "loading" ? "closed" : "loading")}
          >
            {t(
              view === "shown" || view === "loading"
                ? "hidePreview"
                : view === "failed"
                  ? "retryPreview"
                  : "viewPreview",
            )}
          </Button>
          <div id={id}>
            {view === "failed" && <p role="alert">{t("previewFailed")}</p>}
            {view === "loading" && <p role="status">{t("previewLoading")}</p>}
            {(view === "shown" || view === "loading") && (
              <Image
                unoptimized
                src={endpoint}
                alt={t("frameAlt", { title })}
                width={640}
                height={480}
                loading="eager"
                style={{
                  maxWidth: "100%",
                  width: "100%",
                  height: "auto",
                  maxHeight: "32rem",
                  objectFit: "contain",
                }}
                onLoad={() => setView("shown")}
                onError={() => setView("failed")}
              />
            )}
          </div>
        </>
      ) : (
        <p>{t("noPreview")}</p>
      )}
    </div>
  );
}
