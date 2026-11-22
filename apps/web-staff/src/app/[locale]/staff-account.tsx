import { type Locale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { getTranslations } from "next-intl/server";

import { loadStaffAccount } from "../../auth/account.ts";
import type { AuthMessage } from "../../auth/http.ts";

type Props = { locale: Locale; notice?: AuthMessage };

function SignOutForm({ locale, csrf, label }: { locale: Locale; csrf: string; label: string }) {
  return (
    <form action="/auth/logout" method="post">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="csrf" value={csrf} />
      <Button type="submit" variant="selected">
        {label}
      </Button>
    </form>
  );
}

export async function StaffAccount({ locale, notice }: Props) {
  const [account, t] = await Promise.all([loadStaffAccount(locale), getTranslations("webAuth")]);
  if (account.kind === "disabled") return null;
  if (account.kind === "unavailable") {
    return (
      <p className="auth-notice" role="alert">
        {t("unavailable")}
      </p>
    );
  }
  if (account.kind === "anonymous") {
    return (
      <div className="auth-section">
        {notice && (
          <p className="auth-notice" role="alert">
            {t(notice)}
          </p>
        )}
        <form action="/auth/login" method="post">
          <input type="hidden" name="locale" value={locale} />
          <Button className="auth-primary" type="submit" variant="selected">
            {t("signIn")}
          </Button>
        </form>
      </div>
    );
  }

  if (account.kind === "locked") {
    return (
      <div className="auth-section">
        <p className="auth-notice" role="alert">
          {t("sessionLocked")}
        </p>
        <SignOutForm locale={locale} csrf={account.csrf} label={t("signOut")} />
      </div>
    );
  }

  const organizations = account.organizationProfile;
  return (
    <section className="auth-section" aria-labelledby="staff-account-title">
      {notice && (
        <p className="auth-notice" role="alert">
          {t(notice)}
        </p>
      )}
      <div>
        <h2 id="staff-account-title">{t("accountTitle")}</h2>
        <p>{account.username}</p>
      </div>
      <div>
        <h3>{t("organizations")}</h3>
        {organizations === null ? (
          <p className="auth-notice" role="alert">
            {t("organizationsUnavailable")}
          </p>
        ) : organizations.length ? (
          <ul className="organization-list">
            {organizations.map((org) => (
              <li key={org.id}>{org.name}</li>
            ))}
          </ul>
        ) : (
          <p>{t("noOrganizations")}</p>
        )}
      </div>
      <div className="auth-actions">
        <Button asChild>
          <a href={account.accountUrl.href}>{t("manageAccount")}</a>
        </Button>
        <SignOutForm locale={locale} csrf={account.csrf} label={t("signOut")} />
      </div>
    </section>
  );
}
