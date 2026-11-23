import { isLocale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { notFound, redirect } from "next/navigation";
import { readStaffSession } from "../../../../../../../auth/account.ts";
import { loadDirectory } from "../../../../../../../directory/api.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../i18n/routing";
import { inventoryPath, type Filter, type View } from "../../../../../../../inventory/forms.ts";
import { RefreshInventory } from "../../../../../../../inventory/controls";
import { Items, Warehouses, Journal } from "../../../../../../../inventory/views";
import { inventoryMessages } from "../../../../../../../inventory/messages.ts";
import type { ClinicScope } from "../../../../../../../patients/forms.ts";
import { Masthead } from "../../../../../masthead";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<ClinicScope & { locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function Inventory({ params, searchParams }: Props) {
  const [{ locale, organizationId, clinicId }, q] = await Promise.all([params, searchParams]);
  if (!isLocale(locale) || ![organizationId, clinicId].every(isDirectoryId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect("/" + locale);
  const scope = { organizationId, clinicId },
    t = inventoryMessages(locale),
    view: View = q.view === "warehouses" || q.view === "journal" ? q.view : "items";
  const filter: Filter = {
    view,
    page: readDirectoryPage(q.page),
    query: view === "items" && typeof q.q === "string" ? q.q.trim().slice(0, 120) : undefined,
    warehouse: view === "warehouses" && isDirectoryId(q.warehouse) ? q.warehouse : undefined,
  };
  const path = inventoryPath(scope, filter);
  const directory = await loadDirectory(access.config.apiOrigin, access.session, organizationId, 1);
  const clinic =
    directory.kind === "admin"
      ? directory.directory.clinics.find((c) => c.id === clinicId)
      : directory.kind === "staff"
        ? directory.clinics.find((c) => c.id === clinicId)
        : undefined;
  const props = {
    scope,
    filter,
    context: {
      locale,
      csrf: access.session.csrf,
      endpoint: `/inventory/${organizationId}/${clinicId}`,
    },
    admin: directory.kind === "admin",
    access,
  };
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={path} />
      <main className="directory-main">
        <header className="directory-header">
          <Link className="directory-back" href={"/organizations/" + organizationId}>
            {t("directory")}
          </Link>
          <h1>{clinic ? t("clinicInventory", { clinic: clinic.name }) : t("inventory")}</h1>
        </header>
        {!clinic ? (
          <>
            <p className="directory-notice" role="alert">
              {t(directory.kind === "unavailable" ? "unavailable" : "denied")}
            </p>
            <RefreshInventory locale={locale} />
          </>
        ) : (
          <>
            <nav className="directory-paging" aria-label={t("views")}>
              {(["items", "warehouses", "journal"] as const).map((v) => (
                <Button key={v} asChild variant={view === v ? "selected" : "ghost"}>
                  <Link
                    href={inventoryPath(scope, { view: v })}
                    aria-current={view === v ? "page" : undefined}
                  >
                    {t(v)}
                  </Link>
                </Button>
              ))}
            </nav>
            <section className="directory-section" aria-labelledby="inventory-section">
              <h2 id="inventory-section">{t(filter.warehouse ? "balance" : view)}</h2>
              <div>
                <RefreshInventory locale={locale} />
              </div>
              {view === "items" ? (
                <Items {...props} />
              ) : view === "warehouses" ? (
                <Warehouses {...props} />
              ) : (
                <Journal {...props} />
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
