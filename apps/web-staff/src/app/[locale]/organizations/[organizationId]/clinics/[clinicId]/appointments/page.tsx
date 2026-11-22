import { isLocale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { readStaffSession } from "../../../../../../../auth/account.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../i18n/routing";
import { registryPath, type ClinicScope } from "../../../../../../../patients/forms.ts";
import { carePath, careNotices } from "../../../../../../../care/forms.ts";
import { agendaDay, operatorZone } from "../../../../../../../care/time.ts";
import { readAgenda } from "../../../../../../../care/api.ts";
import { Paging, ZoneField } from "../../../../../../../care/controls";
import { AgendaRow } from "../../../../../../../care/appointments";
import { Masthead } from "../../../../../masthead";

type Props = {
  params: Promise<ClinicScope & { locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export const dynamic = "force-dynamic";
export default async function Calendar({ params, searchParams }: Props) {
  const [{ locale, organizationId, clinicId }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale) || !isDirectoryId(organizationId) || !isDirectoryId(clinicId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect(`/${locale}`);
  const scope = { organizationId, clinicId },
    page = readDirectoryPage(query.page);
  const timeZone = operatorZone(query.timeZone),
    dates = agendaDay(query.day, timeZone);
  const context = { scope, timeZone, locale, csrf: access.session.csrf };
  const [view, t, p, d] = await Promise.all([
    readAgenda({ origin: access.config.apiOrigin, token: access.session.accessToken }, scope, {
      from: dates.from,
      to: dates.to,
      page,
    }),
    getTranslations("care"),
    getTranslations("patients"),
    getTranslations("directory"),
  ]);
  const path = carePath(scope, undefined, { timeZone, day: dates.day, page });
  const notice = careNotices.find((key) => key === query.careNotice);
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={path} />
      <main className="directory-main">
        <header className="directory-header">
          <div className="registry-trail">
            <Link className="directory-back" href={`/organizations/${organizationId}`}>
              {p("directory")}
            </Link>
            <Link className="directory-back" href={registryPath(scope)}>
              {p("registry")}
            </Link>
          </div>
          <h1>{view.clinic ? t("calendarAt", { clinic: view.clinic.name }) : t("calendar")}</h1>
        </header>
        {notice && (
          <p className="directory-notice" role={notice === "saved" ? "status" : "alert"}>
            {t(notice)}
          </p>
        )}
        <section className="directory-section" aria-labelledby="agenda-date">
          <h2 id="agenda-date">
            {new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone }).format(
              new Date(dates.from),
            )}
          </h2>
          <form
            className="directory-form registry-search"
            method="get"
            action={`/${locale}${carePath(scope)}`}
          >
            <label>
              {t("day")}
              <input name="day" type="date" required defaultValue={dates.day} />
            </label>
            <ZoneField timeZone={timeZone} />
            <Button variant="selected" type="submit">
              {t("showDay")}
            </Button>
          </form>
          <nav className="agenda-nav" aria-label={t("days")}>
            <Link
              className="directory-back"
              href={carePath(scope, undefined, { timeZone, day: dates.previous })}
            >
              {t("previousDay")}
            </Link>
            <Link className="directory-back" href={carePath(scope, undefined, { timeZone })}>
              {t("today")}
            </Link>
            <Link
              className="directory-back"
              href={carePath(scope, undefined, { timeZone, day: dates.next })}
            >
              {t("nextDay")}
            </Link>
          </nav>
          {view.data ? (
            <>
              {view.data.appointments.length ? (
                <ol className="directory-list">
                  {view.data.appointments.map((a) => (
                    <AgendaRow
                      key={a.id}
                      appointment={a}
                      day={dates.day}
                      page={page}
                      context={context}
                    />
                  ))}
                </ol>
              ) : (
                <p>{t(page === 1 ? "noAppointments" : "emptyPage")}</p>
              )}
              <Paging
                scope={scope}
                timeZone={timeZone}
                day={dates.day}
                page={page}
                hasNextPage={view.data.hasNextPage}
              />
              <Link className="directory-back" href={registryPath(scope, { timeZone })}>
                {t("findPatient")}
              </Link>
            </>
          ) : (
            <div className="directory-message">
              <p role="alert">
                {t(view.error === "unavailable" ? "agendaUnavailable" : view.error!)}
              </p>
              <Link href={path}>{d("retry")}</Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
