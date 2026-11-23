import type { Locale } from "@vetx/i18n";
import { Link } from "../i18n/routing";
import type { ClinicScope } from "../patients/forms.ts";
import { referralPath } from "./forms.ts";
import { referralMessages } from "./messages.ts";

export function ReferralLink({
  scope,
  locale,
  patientId,
  clinicName,
}: {
  scope: ClinicScope;
  locale: Locale;
  patientId?: string;
  clinicName?: string;
}) {
  const t = referralMessages(locale);
  return (
    <Link
      href={referralPath(scope, patientId)}
      className={clinicName ? "clinic-registry-link" : "directory-back"}
      aria-label={clinicName ? t("clinicLink", { clinic: clinicName }) : undefined}
    >
      {t(clinicName ? "clinicShort" : patientId ? "patientLink" : "clinicQueue")}
    </Link>
  );
}
