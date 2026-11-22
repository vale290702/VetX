import { locales, type Locale } from "@vetx/i18n";
import { Button } from "@vetx/ui-web";
import { getTranslations } from "next-intl/server";
import { Link } from "../../i18n/routing";

export async function Masthead({ locale, href = "/" }: { locale: Locale; href?: string }) {
  const t = await getTranslations();
  return (
    <header className="masthead">
      <span className="wordmark">{t("brand")}</span>
      <nav aria-label={t("language.label")} className="language-control">
        {locales.map((option) => (
          <Button asChild key={option} variant={locale === option ? "selected" : "ghost"}>
            <Link
              aria-current={locale === option ? "page" : undefined}
              href={href}
              hrefLang={option}
              lang={option}
              locale={option}
            >
              {t(`language.${option}`)}
            </Link>
          </Button>
        ))}
      </nav>
    </header>
  );
}
