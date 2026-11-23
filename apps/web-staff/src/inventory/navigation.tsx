import type { Locale } from "@vetx/i18n";
import { Link } from "../i18n/routing";
import type { ClinicScope } from "../patients/forms.ts";
import { inventoryPath } from "./forms.ts";
import { inventoryMessages } from "./messages.ts";
export function InventoryLink({
  locale,
  scope,
  clinic,
}: {
  locale: Locale;
  scope: ClinicScope;
  clinic: string;
}) {
  const t = inventoryMessages(locale);
  return (
    <Link
      href={inventoryPath(scope)}
      className="clinic-registry-link"
      aria-label={t("clinicInventory", { clinic })}
    >
      {t("inventory")}
    </Link>
  );
}
