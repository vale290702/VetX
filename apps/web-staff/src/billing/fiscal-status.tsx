import { Link } from "../i18n/routing";
import { FiscalForm, RetryFiscal, type Environment } from "./fiscal-form";
import { billingMessages } from "./messages.ts";
import type { Context, Sale, Schema } from "./model.ts";
const issues = [
  "configuration",
  "authentication",
  "invalid_submission",
  "rate_limited",
  "unconfirmed",
  "unexpected_response",
  "unavailable",
  "authority_error",
] as const;
export function FiscalStatus({
  ctx,
  sale,
  environment,
  status,
  admin,
  href,
}: {
  ctx: Context;
  sale: Sale;
  environment: Environment;
  status?: Schema["FiscalStatusDto"];
  admin: boolean;
  href: string;
}) {
  const t = billingMessages(ctx.locale),
    invoice = status?.invoice;
  const issue = issues.find((v) => v === invoice?.issue);
  return (
    <section className="directory-section" aria-labelledby="electronic-invoice">
      <h3 id="electronic-invoice">{t("electronicInvoice")}</h3>
      <nav className="agenda-nav" aria-label={t("fiscalEnvironment")}>
        {(["sandbox", "production"] as const).map((env) => (
          <Link
            className="directory-back"
            key={env}
            aria-current={environment === env ? "page" : undefined}
            href={href + "&environment=" + env}
          >
            {t(env)}
          </Link>
        ))}
      </nav>
      <p>{t("currentEnvironment", { environment: t(environment) })}</p>
      {!status ? (
        <p role="alert">{t("fiscalLoadFailed")}</p>
      ) : (
        <>
          {!status.enabled && <p>{t("fiscalDisabled")}</p>}
          {invoice ? (
            <>
              <p role="status">
                {t(invoice.state === "invalid" ? "invalidInvoice" : invoice.state)}
              </p>
              <dl className="patient-demographics">
                <div>
                  <dt>{t("invoiceKey")}</dt>
                  <dd>{invoice.key}</dd>
                </div>
                <div>
                  <dt>{t("signature")}</dt>
                  <dd>{t(invoice.hasSignedXml ? "available" : "notAvailable")}</dd>
                </div>
                <div>
                  <dt>{t("authorityReceipt")}</dt>
                  <dd>{t(invoice.hasReceipt ? "available" : "notAvailable")}</dd>
                </div>
              </dl>
              <div className="agenda-nav">
                {(["invoice", "receipt"] as const).map(
                  (kind) =>
                    (kind === "invoice" ? invoice.hasSignedXml : invoice.hasReceipt) && (
                      <a
                        key={kind}
                        className="directory-back"
                        href={`${ctx.endpoint}/sales/${sale.id}/fiscal/${environment}/artifacts/${kind}`}
                        download
                      >
                        {t(kind === "invoice" ? "downloadXml" : "downloadReceipt")}
                      </a>
                    ),
                )}
              </div>
              {issue && <p>{t(`issue_${issue}`)}</p>}
              {invoice.state === "blocked" && status.enabled && admin && (
                <RetryFiscal ctx={ctx} saleId={sale.id} environment={environment} />
              )}
            </>
          ) : (
            status.enabled && <FiscalForm ctx={ctx} sale={sale} environment={environment} />
          )}
        </>
      )}
      <a href={`/${ctx.locale}${href}&environment=${environment}`} className="directory-back">
        {t("refreshFiscal")}
      </a>
    </section>
  );
}
