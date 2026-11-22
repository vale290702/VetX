import type { ReactNode } from "react";
import { CareForm } from "./care-form";
import { Button } from "@vetx/ui-web";
import type { Locale } from "@vetx/i18n";
import { getTranslations } from "next-intl/server";
import { Link } from "../i18n/routing";
import { carePath } from "./forms.ts";
import type { ClinicScope } from "../patients/forms.ts";
import { zoneOptions } from "./time.ts";

export type CareFormContext = {
  csrf: string;
  locale: Locale;
  scope: ClinicScope;
  timeZone: string;
};
export function endpoint({ scope }: CareFormContext) {
  return `/care/${scope.organizationId}/${scope.clinicId}`;
}
export function Fields({ context, patientId }: { context: CareFormContext; patientId: string }) {
  return (
    <>
      <input type="hidden" name="csrf" value={context.csrf} />
      <input type="hidden" name="locale" value={context.locale} />
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="timeZone" value={context.timeZone} />
    </>
  );
}
export async function ZoneField({ timeZone }: { timeZone: string }) {
  const t = await getTranslations("care");
  return (
    <label>
      <span id="care-time-zone-label">{t("zone")}</span>
      <select aria-labelledby="care-time-zone-label" name="timeZone" defaultValue={timeZone}>
        {zoneOptions.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
export async function Paging({
  scope,
  patientId,
  timeZone,
  day,
  page,
  hasNextPage,
}: {
  scope: ClinicScope;
  patientId?: string;
  timeZone: string;
  day?: string;
  page: number;
  hasNextPage: boolean;
}) {
  if (page === 1 && !hasNextPage) return null;
  const [d, t] = await Promise.all([getTranslations("directory"), getTranslations("care")]);
  const path = (p: number) => carePath(scope, patientId, { timeZone, day, page: p });
  return (
    <nav className="directory-paging" aria-label={t(patientId ? "historyPages" : "agendaPages")}>
      {page > 1 && (
        <Button asChild>
          <Link href={path(page - 1)}>{d("previous")}</Link>
        </Button>
      )}
      <span>{d("page", { page })}</span>
      {hasNextPage && (
        <Button asChild>
          <Link href={path(page + 1)}>{d("next")}</Link>
        </Button>
      )}
    </nav>
  );
}

export async function SaveForm({
  context,
  label,
  children,
}: {
  context: CareFormContext;
  label: "saveNote" | "saveAppointment" | "book";
  children: ReactNode;
}) {
  const t = await getTranslations("care");
  return (
    <CareForm
      endpoint={endpoint(context)}
      labels={{
        invalid: t("invalid"),
        conflict: t("conflict"),
        denied: t("denied"),
        missing: t("missing"),
        unavailable: t("unavailable"),
        overlap: t("overlap"),
        submit: t(label),
        saving: t("saving"),
      }}
    >
      {children}
    </CareForm>
  );
}
