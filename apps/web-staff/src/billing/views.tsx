import { Link } from "../i18n/routing";
import type { Access } from "../inventory/api.ts";
import type { ClinicScope } from "../patients/forms.ts";
import { Button } from "@vetx/ui-web";
import { billingMessages } from "./messages.ts";
import { billingRequest } from "./server.ts";
import { formatAmount, type Context, type Sale, type Schema } from "./model.ts";
import { PriceForm } from "./catalog";
import { FiscalStatus } from "./fiscal-status";
import type { Environment } from "./fiscal-form";
import { Checkout } from "./checkout";
import { DrawerForm, PaymentForm } from "./payments";
export type View = "sales" | "checkout" | "prices" | "drawers";
export function billingPath(
  scope: ClinicScope,
  view: View = "sales",
  page = 1,
  q = "",
  sale?: string,
  environment?: Environment,
) {
  const query = new URLSearchParams();
  if (sale) query.set("sale", sale);
  else if (view !== "sales") query.set("view", view);
  if (sale && environment) query.set("environment", environment);
  if (q) query.set("q", q);
  if (page > 1) query.set("page", String(page));
  return (
    `/organizations/${scope.organizationId}/clinics/${scope.clinicId}/billing` +
    (query.size ? "?" + query : "")
  );
}
type Props = {
  ctx: Context;
  scope: ClinicScope;
  view: View;
  page: number;
  query: string;
  saleId?: string;
  environment: Environment;
  admin: boolean;
  access: Access;
};
async function read<T>(props: Props, path: string) {
  const result = await billingRequest(props.access, props.scope, path);
  if (!result.ok) return { status: result.status } as const;
  try {
    return { data: (await result.json()) as T } as const;
  } catch {
    return { status: 503 } as const;
  }
}
function Notice({ ctx, status }: { ctx: Context; status: number }) {
  const t = billingMessages(ctx.locale);
  return (
    <div>
      <p className="directory-notice" role="alert">
        {t(status === 403 || status === 401 ? "denied" : status === 404 ? "missing" : "loadError")}
      </p>
    </div>
  );
}
function Paging({ props, next }: { props: Props; next: boolean }) {
  const { ctx, page, view, query, saleId, scope } = props,
    t = billingMessages(ctx.locale);
  if (!next && page === 1) return null;
  return (
    <nav className="directory-paging" aria-label={t("pages")}>
      {page > 1 && (
        <Link
          className="directory-back"
          href={billingPath(scope, view, page - 1, query, saleId, props.environment)}
        >
          {t("previous")}
        </Link>
      )}
      <span>{t("page", { page })}</span>
      {next && (
        <Link
          className="directory-back"
          href={billingPath(scope, view, page + 1, query, saleId, props.environment)}
        >
          {t("next")}
        </Link>
      )}
    </nav>
  );
}
function FinancialSummary({ ctx, sale }: { ctx: Context; sale: Sale }) {
  const t = billingMessages(ctx.locale);
  return (
    <dl className="patient-demographics">
      {(["subtotal", "tax", "total", "paid", "balance"] as const).map((key) => (
        <div key={key}>
          <dt>{t(key === "subtotal" ? "net" : key)}</dt>
          <dd>
            {sale.currency} {formatAmount(sale[key], ctx.locale)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function clock(value: string, ctx: Context) {
  return new Intl.DateTimeFormat(ctx.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/Costa_Rica",
  }).format(new Date(value));
}
export async function BillingView(props: Props) {
  const { ctx, view, scope, saleId, page, query } = props,
    t = billingMessages(ctx.locale);
  if (saleId) {
    const [result, history, fiscal] = await Promise.all([
      read<Sale>(props, "billing/sales/" + saleId),
      read<Schema["PaymentsDto"]>(props, `billing/sales/${saleId}/payments?page=${page}`),
      read<Schema["FiscalStatusDto"]>(props, `billing/sales/${saleId}/fiscal/${props.environment}`),
    ]);
    if (!result.data) return <Notice ctx={ctx} status={result.status} />;
    const sale = result.data;
    return (
      <>
        <h2>{t("saleNumber", { number: sale.number })}</h2>
        <p>
          <time dateTime={sale.recordedAt}>{clock(sale.recordedAt, ctx)}</time>
        </p>
        {sale.patientId && (
          <Link
            className="directory-back"
            href={`/organizations/${scope.organizationId}/clinics/${scope.clinicId}/patients/${sale.patientId}`}
          >
            {t("patientRecord")}
          </Link>
        )}
        <ol className="directory-list">
          {sale.lines.map((l, n) => (
            <li key={n}>
              <strong>{l.name}</strong>
              <p>
                {l.quantity} {l.unit} × {sale.currency} {formatAmount(l.unitPrice, ctx.locale)} ·{" "}
                {t("tax")} {formatAmount(l.taxRate, ctx.locale)}%
              </p>
              {l.stockItemId && (
                <p>
                  {t("lot")} · {l.lot || t("noLot")}
                </p>
              )}
              <p>
                {t("cabys")} {l.cabys} · {t("total")} {formatAmount(l.total, ctx.locale)}{" "}
                {sale.currency}
              </p>
            </li>
          ))}
        </ol>
        <FinancialSummary ctx={ctx} sale={sale} />
        <FiscalStatus
          ctx={ctx}
          sale={sale}
          admin={props.admin}
          environment={props.environment}
          status={fiscal.data}
          href={billingPath(scope, view, page, query, saleId)}
        />
        {!/^0(?:\.0+)?$/.test(sale.balance) && <PaymentForm ctx={ctx} sale={sale} />}
        <h3>{t("payments")}</h3>
        {history.data ? (
          <>
            {history.data.payments.length ? (
              <ul className="directory-list">
                {history.data.payments.map((p) => (
                  <li key={p.id}>
                    <strong>
                      {t(p.method)} · {p.currency} {formatAmount(p.amount, ctx.locale)}
                    </strong>
                    <p>{clock(p.recordedAt, ctx)}</p>
                    {p.reference && (
                      <p>
                        {t("reference")} · {p.reference}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("noPayments")}</p>
            )}
            <Paging props={props} next={history.data.hasNextPage} />
          </>
        ) : (
          <Notice ctx={ctx} status={history.status} />
        )}
      </>
    );
  }
  if (view === "checkout")
    return (
      <>
        <h2>{t("checkout")}</h2>
        <Checkout ctx={ctx} />
      </>
    );
  if (view === "prices") {
    const result = await read<Schema["PricesDto"]>(
      props,
      "billing/prices?" + new URLSearchParams({ page: String(page), query }),
    );
    return (
      <>
        <h2>{t("prices")}</h2>
        {props.admin && <PriceForm ctx={ctx} />}
        <form className="directory-form registry-search" method="get" action={ctx.pagePath}>
          <input type="hidden" name="view" value="prices" />
          <label>
            {t("searchPrices")}
            <input name="q" type="search" maxLength={120} defaultValue={query} />
          </label>
          <Button type="submit">{t("search")}</Button>
        </form>
        {result.data ? (
          <>
            {result.data.prices.length ? (
              <ul className="directory-list">
                {result.data.prices.map((p) => (
                  <li key={p.id}>
                    <h3>
                      <strong>{p.name}</strong>
                    </h3>
                    <p>
                      {p.currency} {formatAmount(p.unitPrice, ctx.locale)} / {p.unit} ·{" "}
                      {formatAmount(p.taxRate, ctx.locale)}%
                    </p>
                    <p>
                      {t("cabys")} {p.cabys} · {t(p.stockItemId ? "stock" : "service")}
                    </p>
                    {props.admin && <PriceForm ctx={ctx} price={p} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("noPrices")}</p>
            )}
            <Paging props={props} next={result.data.hasNextPage} />
          </>
        ) : (
          <Notice ctx={ctx} status={result.status} />
        )}
      </>
    );
  }
  if (view === "drawers") {
    const result = await read<Schema["ShiftsDto"]>(props, "billing/shifts?page=" + page);
    return (
      <>
        <h2>{t("drawers")}</h2>
        <DrawerForm ctx={ctx} />
        {result.data ? (
          <>
            {result.data.shifts.length ? (
              <ul className="directory-list">
                {result.data.shifts.map((s) => (
                  <li key={s.id}>
                    <h3>
                      <strong>{s.label}</strong>
                    </h3>
                    <p>
                      {t(s.closedAt ? "closed" : "open")} · {clock(s.openedAt, ctx)}
                      {s.closedAt ? " – " + clock(s.closedAt, ctx) : ""}
                    </p>
                    <p>
                      {t("cashier")} ·{" "}
                      {s.cashier.subject === ctx.subject && s.cashier.issuer === ctx.issuer
                        ? t("you")
                        : s.cashier.subject}
                    </p>
                    <dl className="patient-demographics">
                      {(["openingFloat", "expected", "counted", "difference"] as const).map(
                        (k) =>
                          s[k] !== null && (
                            <div key={k}>
                              <dt>{t(k === "openingFloat" ? "opening" : k)}</dt>
                              <dd>
                                {s.currency} {formatAmount(s[k]!, ctx.locale)}
                              </dd>
                            </div>
                          ),
                      )}
                    </dl>
                    {!s.closedAt &&
                      s.cashier.subject === ctx.subject &&
                      s.cashier.issuer === ctx.issuer && <DrawerForm ctx={ctx} shift={s} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("noDrawers")}</p>
            )}
            <Paging props={props} next={result.data.hasNextPage} />
          </>
        ) : (
          <Notice ctx={ctx} status={result.status} />
        )}
      </>
    );
  }
  const result = await read<Schema["SalesDto"]>(props, "billing/sales?page=" + page);
  return (
    <>
      <h2>{t("sales")}</h2>
      {result.data ? (
        <>
          {result.data.sales.length ? (
            <ol className="directory-list">
              {result.data.sales.map((s) => (
                <li key={s.id}>
                  <Link className="directory-back" href={billingPath(scope, "sales", 1, "", s.id)}>
                    {t("saleNumber", { number: s.number })}
                  </Link>
                  <p>
                    {clock(s.recordedAt, ctx)} · {s.currency} {formatAmount(s.total, ctx.locale)}
                  </p>
                  <p>
                    {t("balance")} · {s.currency} {formatAmount(s.balance, ctx.locale)}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("noSales")}</p>
          )}
          <Paging props={props} next={result.data.hasNextPage} />
        </>
      ) : (
        <Notice ctx={ctx} status={result.status} />
      )}
    </>
  );
}
