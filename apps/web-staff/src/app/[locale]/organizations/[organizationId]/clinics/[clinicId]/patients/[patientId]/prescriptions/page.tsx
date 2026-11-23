import { isLocale } from "@vetx/i18n";
import { notFound, redirect } from "next/navigation";
import { readStaffSession } from "../../../../../../../../../auth/account.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../../../i18n/routing";
import { stockQuantity } from "../../../../../../../../../inventory/forms.ts";
import { registryPath, type ClinicScope } from "../../../../../../../../../patients/forms.ts";
import { patientInfo } from "../../../../../../../../../referrals/api.ts";
import { prescriptions, myGrant, options } from "../../../../../../../../../trade/api.ts";
import { Refresh } from "../../../../../../../../../trade/controls";
import { remaining } from "../../../../../../../../../trade/forms.ts";
import { History } from "../../../../../../../../../trade/history";
import { tradeMessages, notice } from "../../../../../../../../../trade/messages.ts";
import { Paging } from "../../../../../../../../../trade/nav";
import { Prescribe, Share, Dispense } from "../../../../../../../../../trade/pharmacy-forms";
import { Masthead } from "../../../../../../../masthead";
export const dynamic = "force-dynamic";
export default async function Pharmacy({
  params,
  searchParams,
}: {
  params: Promise<ClinicScope & { locale: string; patientId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ locale, organizationId, clinicId, patientId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!isLocale(locale) || ![organizationId, clinicId, patientId].every(isDirectoryId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect("/" + locale);
  const scope = { organizationId, clinicId },
    page = readDirectoryPage(query.page),
    t = tradeMessages(locale),
    ctx = { locale, csrf: access.session.csrf, endpoint: `/trade/${organizationId}/${clinicId}` };
  const path = registryPath(scope) + "/" + patientId,
    listPath = path + "/prescriptions";
  const [patient, grant, list] = await Promise.all([
    patientInfo(access, { ...scope, patientId }),
    myGrant(access, scope),
    prescriptions(access, scope, patientId, page),
  ]);
  const active = grant.data?.clinicAccess && grant.data.subject === access.session.subject,
    canRx = active && grant.data?.canPrescribe,
    canDispense = active && grant.data?.canDispense;
  const [catalog, locations] = await Promise.all([
    canRx ? options(access, scope, "items", 1) : undefined,
    patient.data ? options(access, scope, "warehouses", 1) : undefined,
  ]);
  const alert = (code: number) => (
      <p role="alert" className="directory-notice">
        {t(notice(code))}
      </p>
    ),
    qty = (v: string) => stockQuantity(v, locale);
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={listPath + "?page=" + page} />
      <main className="directory-main" key={listPath}>
        <header className="directory-header">
          <Link className="directory-back" href={path}>
            {patient.data?.patient.name ?? t("patient")}
          </Link>
          <h1>
            {patient.data ? t("rxFor", { patient: patient.data.patient.name }) : t("prescriptions")}
          </h1>
        </header>
        <div>
          <Refresh locale={locale} />
        </div>
        {!patient.data ? (
          alert(patient.error)
        ) : (
          <section className="directory-section" aria-label={t("prescriptions")}>
            {!grant.data ? (
              alert(grant.error)
            ) : !canRx && !canDispense ? (
              <p>{t("needAccess")}</p>
            ) : null}
            {canRx &&
              catalog &&
              (catalog.data ? (
                <Prescribe ctx={ctx} patientId={patientId} catalog={catalog.data} />
              ) : (
                alert(catalog.error)
              ))}
            {locations && !locations.data && alert(locations.error)}
            {!list.data ? (
              alert(list.error)
            ) : (
              <>
                {list.data.prescriptions.length ? (
                  <ol className="directory-list">
                    {list.data.prescriptions.map((rx) => (
                      <li key={rx.id}>
                        <h2>{rx.medication}</h2>
                        <p>
                          {rx.itemName} · {rx.unit}
                        </p>
                        <p style={{ whiteSpace: "pre-wrap" }}>{rx.instructions}</p>
                        <p>
                          {t("authorized")} · {qty(rx.quantity)} {rx.unit}
                        </p>
                        <p>
                          {t("dispensed")} · {qty(rx.dispensedQuantity)} {rx.unit}
                        </p>
                        <p>
                          {t("date")} ·{" "}
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                            timeStyle: "long",
                            timeZone: "UTC",
                          }).format(new Date(rx.recordedAt))}
                        </p>
                        <p>
                          {t("actor")} · {rx.author.subject}
                        </p>
                        <p>
                          {rx.sharing.guardianIds.length
                            ? t("guardians") + " · " + rx.sharing.guardianIds.length
                            : t("private")}
                        </p>
                        {canRx && (
                          <Share
                            key={rx.sharing.revision}
                            ctx={ctx}
                            rx={rx}
                            guardians={patient.data.guardians}
                          />
                        )}
                        {canDispense &&
                          locations?.data &&
                          remaining(rx.quantity, rx.dispensedQuantity) !== "0.000" &&
                          (locations.data.options.length ? (
                            <Dispense ctx={ctx} rx={rx} locations={locations.data} />
                          ) : (
                            <p>{t("noLocations")}</p>
                          ))}
                        {locations?.data && (
                          <History
                            ctx={ctx}
                            kind="dispensings"
                            rx={rx}
                            locations={locations.data}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>{t("empty")}</p>
                )}
                <Paging path={listPath} locale={locale} page={page} next={list.data.hasNextPage} />
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
