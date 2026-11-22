import { checkVetxReadiness } from "@vetx/api-client";
import { parseHttpOrigin } from "@vetx/config/public";
import { type ServiceStatus } from "@vetx/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { authMessages } from "../../auth/http.ts";
import { Masthead } from "./masthead";
import { StaffAccount } from "./staff-account";

export const dynamic = "force-dynamic";

async function ServiceLabel({ status }: { status: ServiceStatus }) {
  const t = await getTranslations("service");
  return (
    <p className="service-label" role="status">
      <span className="service-dot" data-status={status} aria-hidden="true" />
      {t(status)}
    </p>
  );
}

async function ServiceReadiness() {
  const origin = parseHttpOrigin(process.env.API_INTERNAL_URL);
  const status = origin
    ? await checkVetxReadiness(origin, AbortSignal.timeout(3_000))
    : "unconfigured";
  return <ServiceLabel status={status} />;
}

export default async function StaffEntry({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string | string[] }>;
}) {
  const [locale, t, query] = await Promise.all([getLocale(), getTranslations(), searchParams]);
  const notice = authMessages.find((message) => message === query.auth);
  return (
    <div className="entry-layout">
      <Masthead locale={locale} />
      <main className="entry-main">
        <article className="entry-folio" aria-labelledby="entry-title">
          <div className="entry-copy">
            <div className="entry-heading">
              <h1 id="entry-title">{t("entry.staff.title")}</h1>
              <p>{t("entry.staff.description")}</p>
              <StaffAccount locale={locale} notice={notice} />
            </div>
            <div className="entry-footer">
              <Suspense fallback={<ServiceLabel status="checking" />}>
                <ServiceReadiness />
              </Suspense>
            </div>
          </div>
          <div className="folio-art" aria-hidden="true">
            <div className="folio-frame" />
            <div className="folio-mark" />
          </div>
        </article>
      </main>
    </div>
  );
}
