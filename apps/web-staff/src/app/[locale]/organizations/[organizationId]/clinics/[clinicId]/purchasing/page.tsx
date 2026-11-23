import { isLocale } from "@vetx/i18n";
import { notFound, redirect } from "next/navigation";
import { readStaffSession } from "../../../../../../../auth/account.ts";
import { loadDirectory } from "../../../../../../../directory/api.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../i18n/routing";
import type { ClinicScope } from "../../../../../../../patients/forms.ts";
import { Refresh } from "../../../../../../../trade/controls";
import { clinicPath } from "../../../../../../../trade/nav";
import { tradeMessages } from "../../../../../../../trade/messages.ts";
import { PurchasingView } from "../../../../../../../trade/purchasing-view";
import { Masthead } from "../../../../../masthead";
export const dynamic = "force-dynamic";
export default async function Purchasing({
  params,
  searchParams,
}: {
  params: Promise<ClinicScope & { locale: string }>;
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const [{ locale, organizationId, clinicId }, q] = await Promise.all([params, searchParams]);
  if (!isLocale(locale) || ![organizationId, clinicId].every(isDirectoryId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect("/" + locale);
  const scope = { organizationId, clinicId },
    t = tradeMessages(locale),
    ctx = { locale, csrf: access.session.csrf, endpoint: `/trade/${organizationId}/${clinicId}` };
  const directory = await loadDirectory(access.config.apiOrigin, access.session, organizationId, 1);
  const clinic =
    directory.kind === "admin"
      ? directory.directory.clinics.find((c) => c.id === clinicId)
      : directory.kind === "staff"
        ? directory.clinics.find((c) => c.id === clinicId)
        : undefined;
  const view = q.view === "suppliers" || q.view === "permissions" ? q.view : "orders",
    page = readDirectoryPage(q.page);
  return (
    <div className="entry-layout">
      <Masthead
        locale={locale}
        href={clinicPath(scope) + "/purchasing?view=" + view + "&page=" + page}
      />
      <main className="directory-main" key={ctx.endpoint}>
        <header className="directory-header">
          <nav className="registry-trail" aria-label={t("directory")}>
            <Link className="directory-back" href={"/organizations/" + organizationId}>
              {t("directory")}
            </Link>
            {clinic && (
              <Link className="directory-back" href={clinicPath(scope) + "/inventory"}>
                {t("inventory")}
              </Link>
            )}
          </nav>
          <h1>{clinic ? t("purchasingAt", { clinic: clinic.name }) : t("purchasing")}</h1>
        </header>
        <div>
          <Refresh locale={locale} />
        </div>
        {clinic ? (
          <PurchasingView
            ctx={ctx}
            scope={scope}
            access={access}
            page={page}
            view={view}
            admin={directory.kind === "admin"}
          />
        ) : (
          <p className="directory-notice" role="alert">
            {t(directory.kind === "unavailable" ? "unavailable" : "denied")}
          </p>
        )}
      </main>
    </div>
  );
}
