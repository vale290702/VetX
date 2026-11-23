import { Button } from "@vetx/ui-web";
import { Link } from "../i18n/routing";
import type { ClinicScope } from "../patients/forms.ts";
import type { Access } from "../inventory/api.ts";
import { stockQuantity } from "../inventory/forms.ts";
import { suppliers, orders, grants, options } from "./api.ts";
import type { Context } from "./controls";
import { tradeMessages, notice } from "./messages.ts";
import { Paging, clinicPath } from "./nav";
import { SupplierForm, OrderForm, ReceiptForm } from "./purchase-forms";
import { GrantForm } from "./pharmacy-forms";
import { History } from "./history";
type Props = {
  access: Access;
  scope: ClinicScope;
  ctx: Context;
  admin: boolean;
  view: "orders" | "suppliers" | "permissions";
  page: number;
};
export async function PurchasingView({ access, scope, ctx, admin, view, page }: Props) {
  const t = tradeMessages(ctx.locale),
    base = clinicPath(scope) + "/purchasing",
    href = (v: string) => base + "?view=" + v;
  const alert = (status: number) => (
    <p role="alert" className="directory-notice">
      {t(notice(status))}
    </p>
  );
  let content;
  if (view === "suppliers") {
    const r = await suppliers(access, scope, page);
    content = r.data ? (
      <>
        {admin && <SupplierForm ctx={ctx} />}
        {r.data.suppliers.length ? (
          <ul className="directory-list">
            {r.data.suppliers.map((s) => (
              <li key={s.id}>
                <h3>{s.name}</h3>
                {admin && <SupplierForm key={s.revision} ctx={ctx} supplier={s} />}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("empty")}</p>
        )}
        <Paging path={href(view)} page={page} next={r.data.hasNextPage} locale={ctx.locale} />
      </>
    ) : (
      alert(r.error)
    );
  } else if (view === "permissions") {
    if (!admin) content = alert(403);
    else {
      const r = await grants(access, scope, page);
      content = r.data ? (
        <>
          {r.data.capabilities.length ? (
            <ul className="directory-list">
              {r.data.capabilities.map((g) => (
                <li key={g.issuer + "/" + g.subject}>
                  <h3>
                    {t("staff")} · {g.subject}
                  </h3>
                  <p>{g.issuer}</p>
                  <p>{t(g.clinicAccess ? "active" : "inactive")}</p>
                  <GrantForm key={g.revision} ctx={ctx} grant={g} />
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("empty")}</p>
          )}
          <Paging path={href(view)} page={page} next={r.data.hasNextPage} locale={ctx.locale} />
        </>
      ) : (
        alert(r.error)
      );
    }
  } else {
    const [r, s, i, w] = await Promise.all([
      orders(access, scope, page),
      options(access, scope, "suppliers", 1),
      options(access, scope, "items", 1),
      options(access, scope, "warehouses", 1),
    ]);
    content = (
      <>
        {!s.data ? (
          alert(s.error)
        ) : !i.data ? (
          alert(i.error)
        ) : (
          <OrderForm ctx={ctx} catalog={i.data} suppliers={s.data} />
        )}
        {!w.data && alert(w.error)}
        {!r.data ? (
          alert(r.error)
        ) : (
          <>
            {r.data.orders.length ? (
              <ol className="directory-list">
                {r.data.orders.map((o) => (
                  <li key={o.id}>
                    <h3>
                      {o.supplierName} · {t(o.status)}
                    </h3>
                    <p>
                      {new Intl.DateTimeFormat(ctx.locale, {
                        dateStyle: "medium",
                        timeStyle: "long",
                        timeZone: "UTC",
                      }).format(new Date(o.recordedAt))}{" "}
                      · {o.author.subject}
                    </p>
                    <p>
                      {t("orderNumber")} · {o.id}
                    </p>
                    <ul>
                      {o.lines.map((l) => (
                        <li key={l.itemId}>
                          <strong>{l.itemName}</strong>
                          <p>
                            {t("ordered")} · {stockQuantity(l.quantity, ctx.locale)} {l.unit}
                          </p>
                          <p>
                            {t("received")} · {stockQuantity(l.receivedQuantity, ctx.locale)}{" "}
                            {l.unit}
                          </p>
                        </li>
                      ))}
                    </ul>
                    {w.data && (
                      <>
                        {o.status !== "RECEIVED" && (
                          <ReceiptForm ctx={ctx} order={o} locations={w.data} />
                        )}
                        <History ctx={ctx} order={o} kind="receipts" locations={w.data} />
                        <History ctx={ctx} order={o} kind="returns" locations={w.data} />
                      </>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t("empty")}</p>
            )}
            <Paging path={href(view)} page={page} next={r.data.hasNextPage} locale={ctx.locale} />
          </>
        )}
      </>
    );
  }
  return (
    <>
      <nav className="directory-paging" aria-label={t("views")}>
        {(["orders", "suppliers", ...(admin ? ["permissions" as const] : [])] as const).map((v) => (
          <Button key={v} asChild variant={v === view ? "selected" : "ghost"}>
            <Link aria-current={v === view ? "page" : undefined} href={href(v)}>
              {t(v)}
            </Link>
          </Button>
        ))}
      </nav>
      <section aria-labelledby="trade-heading" className="directory-section">
        <h2 id="trade-heading">{t(view)}</h2>
        {content}
      </section>
    </>
  );
}
