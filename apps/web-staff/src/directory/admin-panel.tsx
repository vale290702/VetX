import { randomUUID } from "node:crypto";

import type { components } from "@vetx/api-client";
import { type Locale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { getTranslations } from "next-intl/server";

import { TradeLink } from "../trade/nav";
import { InventoryLink } from "../inventory/navigation";
import { ReferralLink } from "../referrals/navigation";
import { Link } from "../i18n/routing";
import { MemberFields, type Clinic, type Member } from "./member-fields";

type AdminDirectory = components["schemas"]["AdministrationDto"];
type Props = { csrf: string; locale: Locale; organizationId: string; directory: AdminDirectory };
type CommonFields = Pick<Props, "csrf" | "locale"> & { revision: number; page: number };

function HiddenFields({ csrf, locale, revision, page }: CommonFields) {
  return (
    <>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="page" value={page} />
    </>
  );
}

export async function AdminPanel({ csrf, locale, organizationId, directory }: Props) {
  const [t, patients, care, exchange] = await Promise.all([
    getTranslations("directory"),
    getTranslations("patients"),
    getTranslations("care"),
    getTranslations("webExchange"),
  ]);
  const { clinics, members, page, hasNextPage, revision } = directory;
  const action = `/directory/${organizationId}`;
  const path = `/organizations/${organizationId}`;
  const common = { csrf, locale, page, revision };
  const fieldLabels = {
    role: t("role"),
    staff: t("staff"),
    admin: t("admin"),
    clinicAccess: t("clinicAccess"),
    allClinics: t("allClinics"),
    noClinicChoices: t("noClinicChoices"),
  };
  const clinicNames = new Map(clinics.map((clinic) => [clinic.id, clinic.name]));
  const singleAdmin =
    page === 1 && !hasNextPage && members.filter((m) => m.role === "ADMIN").length === 1;

  function clinicForm(clinic?: Clinic) {
    return (
      <form method="post" action={action} className="directory-form">
        <HiddenFields {...common} />
        <input type="hidden" name="action" value="clinic" />
        <input type="hidden" name="clinicId" value={clinic?.id ?? randomUUID()} />
        <label>
          {t("clinicName")}
          <input name="name" required maxLength={120} defaultValue={clinic?.name} />
        </label>
        <Button type="submit" variant="selected">
          {clinic ? t("saveName") : t("createClinic")}
        </Button>
      </form>
    );
  }

  function memberForm(member?: Member) {
    return (
      <form method="post" action={action} className="directory-form">
        <HiddenFields {...common} />
        <input type="hidden" name="action" value="member" />
        {member ? (
          <input type="hidden" name="subject" value={member.subject} />
        ) : (
          <label>
            {t("staffId")}
            <input name="subject" required maxLength={255} autoComplete="off" spellCheck={false} />
            <small>{t("idHelp")}</small>
          </label>
        )}
        <MemberFields member={member} clinics={clinics} labels={fieldLabels} />
        <Button type="submit" variant="selected">
          {t("saveAccess")}
        </Button>
      </form>
    );
  }

  return (
    <div className="directory-columns">
      <section className="directory-section" aria-labelledby="clinics">
        <h2 id="clinics">{t("clinics")}</h2>
        <details className="directory-disclosure">
          <summary>{t("addClinic")}</summary>
          {clinicForm()}
        </details>
        {clinics.length ? (
          <ul className="directory-list">
            {clinics.map((clinic) => (
              <li key={clinic.id}>
                <strong>{clinic.name}</strong>
                <Link
                  className="clinic-registry-link"
                  aria-label={patients("patientsAt", { clinic: clinic.name })}
                  href={`/organizations/${organizationId}/clinics/${clinic.id}/patients`}
                >
                  {patients("registry")}
                </Link>
                <Link
                  className="clinic-registry-link"
                  aria-label={care("calendarAt", { clinic: clinic.name })}
                  href={`/organizations/${organizationId}/clinics/${clinic.id}/appointments`}
                >
                  {care("calendar")}
                </Link>
                <Link
                  className="clinic-registry-link"
                  aria-label={exchange("importAt", { clinic: clinic.name })}
                  href={`/organizations/${organizationId}/clinics/${clinic.id}/exchange/import`}
                >
                  {exchange("importTitle")}
                </Link>
                <TradeLink
                  locale={locale}
                  scope={{ organizationId, clinicId: clinic.id }}
                  clinic={clinic.name}
                />
                <InventoryLink
                  locale={locale}
                  scope={{ organizationId, clinicId: clinic.id }}
                  clinic={clinic.name}
                />
                <ReferralLink
                  scope={{ organizationId, clinicId: clinic.id }}
                  locale={locale}
                  clinicName={clinic.name}
                />
                <details className="directory-disclosure">
                  <summary>{t("rename")}</summary>
                  {clinicForm(clinic)}
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("noClinicsAdmin")}</p>
        )}
      </section>
      <section className="directory-section" aria-labelledby="employees">
        <h2 id="employees">{t("employees")}</h2>
        <details className="directory-disclosure">
          <summary>{t("addEmployee")}</summary>
          {memberForm()}
        </details>
        {members.length ? (
          <ul className="directory-list">
            {members.map((member) => {
              const lastAdmin = singleAdmin && member.role === "ADMIN";
              const grants = member.clinicIds
                .map((id) => clinicNames.get(id))
                .filter(Boolean)
                .join(", ");
              return (
                <li key={member.subject}>
                  <p className="member-role">{member.role === "ADMIN" ? t("admin") : t("staff")}</p>
                  <strong className="member-subject">{member.subject}</strong>
                  <p>{member.role === "ADMIN" ? t("allClinics") : grants || t("noAssignments")}</p>
                  {lastAdmin ? (
                    <p>{t("lastAdmin")}</p>
                  ) : (
                    <>
                      <details className="directory-disclosure">
                        <summary>{t("editAccess")}</summary>
                        {memberForm(member)}
                      </details>
                      <details className="directory-disclosure">
                        <summary>{t("removeAccess")}</summary>
                        <form method="post" action={action} className="directory-form">
                          <HiddenFields {...common} />
                          <input type="hidden" name="action" value="revoke" />
                          <input type="hidden" name="subject" value={member.subject} />
                          <p>{t("confirmRevoke", { subject: member.subject })}</p>
                          <Button variant="selected" type="submit">
                            {t("confirmRemoval")}
                          </Button>
                        </form>
                      </details>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{t("emptyPage")}</p>
        )}
        {(page > 1 || hasNextPage) && (
          <nav className="directory-paging" aria-label={t("employeePages")}>
            {page > 1 && (
              <Button asChild>
                <Link href={{ pathname: path, query: { page: page - 1 } }}>{t("previous")}</Link>
              </Button>
            )}
            <span>{t("page", { page })}</span>
            {hasNextPage && (
              <Button asChild>
                <Link href={{ pathname: path, query: { page: page + 1 } }}>{t("next")}</Link>
              </Button>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
