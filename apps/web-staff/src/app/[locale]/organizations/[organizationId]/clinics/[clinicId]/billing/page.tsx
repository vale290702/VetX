import { isLocale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { notFound, redirect } from "next/navigation";
import { readStaffSession } from "../../../../../../../auth/account.ts";
import { loadDirectory } from "../../../../../../../directory/api.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../i18n/routing";
import { billingMessages } from "../../../../../../../billing/messages.ts";
import { billingPath, BillingView, type View } from "../../../../../../../billing/views";
import type { ClinicScope } from "../../../../../../../patients/forms.ts";
import { Masthead } from "../../../../../masthead";
export const dynamic = "force-dynamic";
export default async function Billing({
  params,
  searchParams,
}: {
  params: Promise<ClinicScope & { locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, organizationId, clinicId }, q] = await Promise.all([params, searchParams]);
  if (
    !isLocale(locale) ||
    ![organizationId, clinicId].every(isDirectoryId) ||
    (q.sale !== undefined && !isDirectoryId(q.sale))
  )
    notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect("/" + locale);
  const environment = q.environment === "production" ? "production" : "sandbox";
  const scope = { organizationId, clinicId },
    t = billingMessages(locale),
    saleId = q.sale as string | undefined;
  const view: View =
    !saleId && (q.view === "prices" || q.view === "drawers" || q.view === "checkout")
      ? q.view
      : "sales";
  const query = view === "prices" && typeof q.q === "string" ? q.q.trim().slice(0, 120) : "",
    page = readDirectoryPage(q.page);
  const directory = await loadDirectory(access.config.apiOrigin, access.session, organizationId, 1);
  const clinics =
    directory.kind === "admin"
      ? directory.directory.clinics
      : directory.kind === "staff"
        ? directory.clinics
        : [];
  const clinic = clinics.find((c) => c.id === clinicId);
  const ctx = {
    locale,
    csrf: access.session.csrf,
    subject: access.session.subject,
    issuer: access.config.issuer.href,
    endpoint: `/billing/${organizationId}/${clinicId}`,
    pagePath: `/${locale}${billingPath(scope)}`,
  };
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={billingPath(scope, view, page, query, saleId, environment)} />
      <main className="directory-main">
        <header className="directory-header">
          <Link className="directory-back" href={"/organizations/" + organizationId}>
            {t("directory")}
          </Link>
          <h1>{clinic ? t("clinicBilling", { clinic: clinic.name }) : t("billing")}</h1>
        </header>
        {clinic ? (
          <>
            <nav className="directory-paging" aria-label={t("views")}>
              {(["sales", "checkout", "prices", "drawers"] as const).map((v) => (
                <Button key={v} asChild variant={v === view ? "selected" : "ghost"}>
                  <Link aria-current={v === view ? "page" : undefined} href={billingPath(scope, v)}>
                    {t(v)}
                  </Link>
                </Button>
              ))}
            </nav>
            <section className="directory-section">
              <BillingView
                ctx={ctx}
                scope={scope}
                access={access}
                admin={directory.kind === "admin"}
                view={view}
                query={query}
                page={page}
                saleId={saleId}
                environment={environment}
              />
            </section>
          </>
        ) : (
          <p role="alert">{t(directory.kind === "unavailable" ? "loadError" : "denied")}</p>
        )}
      </main>
    </div>
  );
}
