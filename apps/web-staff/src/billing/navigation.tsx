import type { Locale } from "@vetx/i18n";
import { Link } from "../i18n/routing";
import type { ClinicScope } from "../patients/forms.ts";

import { billingMessages } from "./messages.ts";
export function BillingLink({
  locale,
  scope,
  clinic,
}: {
  locale: Locale;
  scope: ClinicScope;
  clinic: string;
}) {
  const t = billingMessages(locale);
  return (
    <Link
      href={`/organizations/${scope.organizationId}/clinics/${scope.clinicId}/billing`}
      className="clinic-registry-link"
      aria-label={t("clinicBilling", { clinic })}
    >
      {t("billing")}
    </Link>
  );
}
