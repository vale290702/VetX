import type { Locale } from "@vetx/i18n";
import { Link } from "../i18n/routing";
import type { ClinicScope } from "../patients/forms.ts";
import { tradeMessages } from "./messages.ts";
export const clinicPath = (scope: ClinicScope) =>
  `/organizations/${scope.organizationId}/clinics/${scope.clinicId}`;
export function TradeLink({
  scope,
  locale,
  clinic,
  patientId,
}: {
  scope: ClinicScope;
  locale: Locale;
  clinic?: string;
  patientId?: string;
}) {
  const t = tradeMessages(locale);
  return (
    <Link
      className={clinic ? "clinic-registry-link" : "directory-back"}
      aria-label={clinic ? t("purchasingAt", { clinic }) : undefined}
      href={
        clinicPath(scope) +
        (patientId ? "/patients/" + patientId + "/prescriptions" : "/purchasing")
      }
    >
      {t(patientId ? "prescriptions" : "purchasing")}
    </Link>
  );
}
export function Paging({
  path,
  page,
  next,
  locale,
}: {
  path: string;
  page: number;
  next: boolean;
  locale: Locale;
}) {
  const t = tradeMessages(locale),
    href = (n: number) => path + (path.includes("?") ? "&" : "?") + "page=" + n;
  return page === 1 && !next ? null : (
    <nav className="directory-paging" aria-label={t("pages")}>
      {page > 1 && (
        <Link className="directory-back" href={href(page - 1)}>
          {t("previous")}
        </Link>
      )}
      <span>{t("page", { n: page })}</span>
      {next && (
        <Link className="directory-back" href={href(page + 1)}>
          {t("next")}
        </Link>
      )}
    </nav>
  );
}
