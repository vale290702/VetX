import type { components } from "@vetx/api-client";
import { Button } from "@vetx/ui-web";
import { Link } from "../i18n/routing";
import type { ClinicScope } from "../patients/forms.ts";
import { CatalogForm, MovementForm, type Context } from "./controls";
import { balances, items, journal, warehouses, type Access } from "./api.ts";
import { inventoryPath, stockQuantity, type Filter } from "./forms.ts";
import { inventoryMessages, inventoryNotice } from "./messages.ts";
type ContentProps = {
  scope: ClinicScope;
  filter: Filter;
  context: Context;
  access: Access;
  admin: boolean;
};
type Page = Pick<components["schemas"]["WarehousePageDto"], "page" | "hasNextPage">;
function Paging({
  scope,
  filter,
  context,
  page,
}: {
  scope: ClinicScope;
  filter: Filter;
  context: Context;
  page: Page;
}) {
  if (page.page === 1 && !page.hasNextPage) return null;
  const t = inventoryMessages(context.locale);
  return (
    <nav className="directory-paging" aria-label={t("pages")}>
      {page.page > 1 && (
        <Link
          className="directory-back"
          href={inventoryPath(scope, { ...filter, page: page.page - 1 })}
        >
          {t("previous")}
        </Link>
      )}
      <span>{t("page", { page: page.page })}</span>
      {page.hasNextPage && (
        <Link
          className="directory-back"
          href={inventoryPath(scope, { ...filter, page: page.page + 1 })}
        >
          {t("next")}
        </Link>
      )}
    </nav>
  );
}
function Notice({ status, context }: { status: number; context: Context }) {
  return (
    <p className="directory-notice" role="alert">
      {inventoryMessages(context.locale)(inventoryNotice(status))}
    </p>
  );
}
export async function Items(props: ContentProps) {
  const { scope, filter, context, admin, access } = props,
    t = inventoryMessages(context.locale);
  const [list, locations] = await Promise.all([
    items(access, scope, filter.page ?? 1, filter.query ?? ""),
    warehouses(access, scope, 1),
  ]);
  if (!list.data) return <Notice status={list.error} context={context} />;
  return (
    <>
      <form
        className="directory-form registry-search"
        action={`/${context.locale}${inventoryPath(scope)}`}
        method="get"
      >
        <label>
          {t("search")}
          <input name="q" type="search" maxLength={120} defaultValue={filter.query} />
        </label>
        <Button type="submit">{t("find")}</Button>
      </form>
      {admin && <CatalogForm context={context} type="items" />}
      {!locations.data && <Notice context={context} status={locations.error} />}
      {!list.data.items.length ? (
        <p>{t(filter.query ? "noItems" : "emptyItems")}</p>
      ) : (
        <ul className="directory-list">
          {list.data.items.map((item) => (
            <li key={item.id}>
              <h3>{item.name}</h3>
              <p>
                {t("sku")} · {item.sku}
              </p>
              <p>
                {t("unit")} · {item.unit}
              </p>
              {admin && (
                <CatalogForm key={item.revision} context={context} type="items" row={item} />
              )}
              {locations.data && (
                <MovementForm context={context} item={item} locations={locations.data} />
              )}
            </li>
          ))}
        </ul>
      )}
      <Paging {...props} page={list.data} />
    </>
  );
}
export async function Warehouses(props: ContentProps) {
  const { scope, filter, context, admin, access } = props,
    t = inventoryMessages(context.locale);
  if (filter.warehouse) {
    const result = await balances(access, scope, filter.warehouse, filter.page ?? 1);
    return (
      <>
        <Link className="directory-back" href={inventoryPath(scope, { view: "warehouses" })}>
          {t("allWarehouses")}
        </Link>
        {!result.data ? (
          <Notice context={context} status={result.error} />
        ) : (
          <>
            {result.data.balances.length ? (
              <>
                <h3>{result.data.balances[0]?.warehouseName}</h3>
                <ul className="directory-list">
                  {result.data.balances.map((b) => (
                    <li key={b.itemId + "/" + b.lot}>
                      <strong>{b.itemName}</strong>
                      <p>
                        {b.sku} · {b.lot || t("noLot")}
                      </p>
                      <p>
                        {stockQuantity(b.quantity, context.locale)} {b.unit}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{t("emptyBalance")}</p>
            )}
            <Paging {...props} page={result.data} />
          </>
        )}
      </>
    );
  }
  const result = await warehouses(access, scope, filter.page ?? 1);
  if (!result.data) return <Notice context={context} status={result.error} />;
  return (
    <>
      {admin && <CatalogForm context={context} type="warehouses" />}
      {result.data.warehouses.length ? (
        <ul className="directory-list">
          {result.data.warehouses.map((w) => (
            <li key={w.id}>
              <h3>{w.name}</h3>
              <Link
                className="directory-back"
                href={inventoryPath(scope, { view: "warehouses", warehouse: w.id })}
              >
                {t("viewBalance")}
              </Link>
              {admin && (
                <CatalogForm key={w.revision} context={context} type="warehouses" row={w} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("emptyWarehouses")}</p>
      )}
      <Paging {...props} page={result.data} />
    </>
  );
}
export async function Journal(props: ContentProps) {
  const { scope, filter, context, access } = props,
    t = inventoryMessages(context.locale);
  const result = await journal(access, scope, filter.page ?? 1);
  if (!result.data) return <Notice context={context} status={result.error} />;
  const dates = new Intl.DateTimeFormat(context.locale, {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "UTC",
  });
  return (
    <>
      {result.data.movements.length ? (
        <ol className="directory-list">
          {result.data.movements.map((m) => (
            <li key={m.id}>
              <h3>
                {t(m.kind)} · {m.itemName}
              </h3>
              <p>
                {stockQuantity(m.quantity, context.locale)} {m.unit} · {m.sku} ·{" "}
                {m.lot || t("noLot")}
              </p>
              <p>{m.reason}</p>
              <time dateTime={m.recordedAt}>{dates.format(new Date(m.recordedAt))}</time>
              <dl className="patient-demographics">
                {m.fromWarehouseId && (
                  <div>
                    <dt>{t("from")}</dt>
                    <dd>{m.fromWarehouseName}</dd>
                  </div>
                )}
                {m.toWarehouseId && (
                  <div>
                    <dt>{t("to")}</dt>
                    <dd>{m.toWarehouseName}</dd>
                  </div>
                )}
              </dl>
              <details className="directory-disclosure">
                <summary>{t("details")}</summary>
                <dl className="patient-demographics">
                  {m.fromBalance !== null && (
                    <div>
                      <dt>{t("afterFrom")}</dt>
                      <dd>
                        {stockQuantity(m.fromBalance, context.locale)} {m.unit}
                      </dd>
                    </div>
                  )}
                  {m.toBalance !== null && (
                    <div>
                      <dt>{t("afterTo")}</dt>
                      <dd>
                        {stockQuantity(m.toBalance, context.locale)} {m.unit}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{t("actor")}</dt>
                    <dd>
                      {m.actor.subject} · {m.actor.issuer}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("ids")}</dt>
                    <dd>
                      {[m.itemId, m.fromWarehouseId, m.toWarehouseId].filter(Boolean).join(" · ")}
                    </dd>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p>{t("emptyJournal")}</p>
      )}
      <Paging {...props} page={result.data} />
    </>
  );
}
