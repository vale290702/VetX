import { isLocale } from "@vetx/i18n";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { readStaffSession } from "../../../../../../../../../auth/account.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../../../../../directory/forms.ts";
import { Link } from "../../../../../../../../../i18n/routing";
import { registryPath, type ClinicScope } from "../../../../../../../../../patients/forms.ts";
import {
  destinationList,
  patientInfo,
  referralList,
} from "../../../../../../../../../referrals/api.ts";
import {
  ReferralRequestForm,
  RefreshReferrals,
} from "../../../../../../../../../referrals/controls";
import { referralPath } from "../../../../../../../../../referrals/forms.ts";
import { ReferralsList } from "../../../../../../../../../referrals/list";
import {
  noticeForReferral,
  referralMessages,
} from "../../../../../../../../../referrals/messages.ts";
import { Masthead } from "../../../../../../../masthead";

export const dynamic = "force-dynamic";
type Props = {
  params: Promise<ClinicScope & { patientId: string; locale: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};
export default async function PatientReferrals({ params, searchParams }: Props) {
  const [{ locale, organizationId, clinicId, patientId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!isLocale(locale) || ![organizationId, clinicId, patientId].every(isDirectoryId)) notFound();
  const access = await readStaffSession();
  if (access.kind !== "active") redirect(`/${locale}`);
  const scope = { organizationId, clinicId },
    t = referralMessages(locale),
    page = readDirectoryPage(query.page);
  const [record, locations, rows, patient] = await Promise.all([
    patientInfo(access, { ...scope, patientId }),
    destinationList(access, scope),
    referralList(access, scope, "outgoing", page, patientId),
    getTranslations("patients"),
  ]);
  const guardians = record.data?.guardians.filter((g) => g.linked) ?? [];
  return (
    <div className="entry-layout">
      <Masthead locale={locale} href={referralPath(scope, patientId, "outgoing", page)} />
      <main className="directory-main">
        <header className="directory-header">
          <nav className="registry-trail" aria-label={patient("clinicRegistry")}>
            <Link className="directory-back" href={`${registryPath(scope)}/${patientId}`}>
              {record.data?.patient.name ?? patient("details")}
            </Link>
            <Link className="directory-back" href={referralPath(scope, undefined, "outgoing")}>
              {t("clinicQueue")}
            </Link>
          </nav>
          <h1>
            {record.data
              ? t("patientHeading", { patient: record.data.patient.name })
              : t("patientLink")}
          </h1>
        </header>
        {!record.data ? (
          <div>
            <p role="alert" className="directory-notice">
              {t(noticeForReferral(record.error))}
            </p>
            <RefreshReferrals locale={locale} />
          </div>
        ) : (
          <div className="directory-columns">
            <section className="directory-section" aria-labelledby="referral-request">
              <h2 id="referral-request">{t("request")}</h2>
              {!guardians.length ? (
                <p>{t("noGuardians")}</p>
              ) : !locations.data ? (
                <p role="alert" className="directory-notice">
                  {t(noticeForReferral(locations.error))}
                </p>
              ) : !locations.data.destinations.length ? (
                <p>{t("noDestinations")}</p>
              ) : (
                <ReferralRequestForm
                  locale={locale}
                  csrf={access.session.csrf}
                  endpoint={`/referrals/${organizationId}/${clinicId}/patients/${patientId}`}
                  guardians={guardians}
                  destinations={locations.data.destinations}
                />
              )}
            </section>
            <section className="directory-section" aria-labelledby="referral-history">
              <h2 id="referral-history">{t("history")}</h2>
              <div>
                <RefreshReferrals locale={locale} />
              </div>
              {rows.data ? (
                <ReferralsList
                  locale={locale}
                  scope={scope}
                  patientId={patientId}
                  direction="outgoing"
                  list={rows.data}
                  csrf={access.session.csrf}
                />
              ) : (
                <p role="alert" className="directory-notice">
                  {t(noticeForReferral(rows.error))}
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
