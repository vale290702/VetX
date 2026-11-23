import { isLocale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { readStaffSession } from "../../../../../../../auth/account.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../i18n/routing";
import { registryPath, type ClinicScope } from "../../../../../../../patients/forms.ts";
import { clinics, referralList } from "../../../../../../../referrals/api.ts";
import { RefreshReferrals } from "../../../../../../../referrals/controls";
import { referralPath, type Direction } from "../../../../../../../referrals/forms.ts";
import { ReferralsList } from "../../../../../../../referrals/list";
import { noticeForReferral, referralMessages } from "../../../../../../../referrals/messages.ts";
import styles from "../../../../../../../referrals/referrals.module.css";
import { Masthead } from "../../../../../masthead";

export const dynamic = "force-dynamic";
type Props = {
  params: Promise<ClinicScope & { locale: string }>;
  searchParams: Promise<{ direction?: string | string[]; page?: string | string[] }>;
};
export default async function ClinicReferrals({ params, searchParams }: Props) {
  const [{ locale, organizationId, clinicId }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale) || !isDirectoryId(organizationId) || !isDirectoryId(clinicId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect(`/${locale}`);
  const scope = { organizationId, clinicId },
    t = referralMessages(locale);
  const direction: Direction = query.direction === "outgoing" ? "outgoing" : "incoming",
    page = readDirectoryPage(query.page);
  const [locations, rows, patient] = await Promise.all([
    clinics(access, organizationId),
    referralList(access, scope, direction, page),
    getTranslations("patients"),
  ]);
  const name = locations.data?.clinics.find((c) => c.id === clinicId)?.name;
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={referralPath(scope, undefined, direction, page)} />
      <main className="directory-main">
        <header className="directory-header">
          <nav className="registry-trail" aria-label={patient("directory")}>
            <Link className="directory-back" href={`/organizations/${organizationId}`}>
              {patient("directory")}
            </Link>
            <Link className="directory-back" href={registryPath(scope)}>
              {patient("registry")}
            </Link>
          </nav>
          <h1>{name ? t("clinicHeading", { clinic: name }) : t("clinicQueue")}</h1>
        </header>
        <section className="directory-section" aria-label={t(direction)}>
          <div className={styles.queueControls}>
            <nav className={styles.directions} aria-label={t("queueDirections")}>
              {(["incoming", "outgoing"] as const).map((dir) => (
                <Button asChild variant={dir === direction ? "selected" : "ghost"} key={dir}>
                  <Link
                    href={referralPath(scope, undefined, dir)}
                    aria-current={dir === direction ? "page" : undefined}
                  >
                    {t(dir)}
                  </Link>
                </Button>
              ))}
            </nav>
            <RefreshReferrals locale={locale} />
          </div>
          {rows.data ? (
            <ReferralsList
              locale={locale}
              scope={scope}
              direction={direction}
              list={rows.data}
              csrf={access.session.csrf}
            />
          ) : (
            <p role="alert" className="directory-notice">
              {t(noticeForReferral(rows.error))}
            </p>
          )}
          <Link className="directory-back" href={registryPath(scope)}>
            {t("choosePatient")}
          </Link>
        </section>
      </main>
    </div>
  );
}
