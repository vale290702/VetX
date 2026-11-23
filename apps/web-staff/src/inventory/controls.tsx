"use client";
import { Button } from "@vetx/ui-web";
import type { components } from "@vetx/api-client";
import type { Locale } from "@vetx/i18n";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  direction,
  kinds,
  parseCatalog,
  parseMovement,
  type Item,
  type Warehouse,
  type Movement,
  type Catalog,
} from "./forms.ts";
import { inventoryMessages, inventoryNotice } from "./messages.ts";

export type Context = { locale: Locale; endpoint: string; csrf: string };
type WarehousePage = components["schemas"]["WarehousePageDto"];
export function RefreshInventory({ locale }: { locale: Locale }) {
  const router = useRouter(),
    [pending, start] = useTransition();
  return (
    <Button type="button" disabled={pending} onClick={() => start(() => router.refresh())}>
      {inventoryMessages(locale)("refresh")}
    </Button>
  );
}
type WriteProps = Context & {
  resource: Catalog | "movements";
  id?: string;
  label: string;
  children: ReactNode;
  normalize: (data: FormData) => object | null;
  onSaved?: () => void;
};
function InventoryForm({
  locale,
  endpoint,
  csrf,
  resource,
  id,
  label,
  children,
  normalize,
  onSaved,
}: WriteProps) {
  const t = inventoryMessages(locale),
    router = useRouter(),
    movement = resource === "movements";
  const requestId = useRef<string | null>(null);
  const [uncertain, setUncertain] = useState<string | null>(null),
    [status, setStatus] = useState<number>(),
    [pending, start] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    let body = uncertain;
    if (body === null) {
      const payload = normalize(new FormData(form));
      if (!payload) {
        setStatus(400);
        return;
      }
      body = JSON.stringify(payload);
    }
    const serialized = body,
      key = id ?? (requestId.current ??= crypto.randomUUID());
    setStatus(undefined);
    start(async () => {
      let result = 503;
      try {
        result = (
          await fetch(endpoint + "/" + resource + "/" + key, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-VetX-CSRF": csrf },
            body: serialized,
            cache: "no-store",
            redirect: "error",
          })
        ).status;
      } catch {
        /* The original submission can be retried exactly. */
      }
      setStatus(result);
      if (result === 204) {
        requestId.current = null;
        setUncertain(null);
        if (!id) {
          form.reset();
          onSaved?.();
        }
        router.refresh();
      } else {
        setUncertain(result >= 500 || result === 408 || result === 429 ? serialized : null);
      }
    });
  }
  return (
    <form
      className="directory-form"
      method="post"
      onSubmit={submit}
      aria-label={label}
      onChange={() => {
        if (!uncertain) setStatus(undefined);
      }}
    >
      <fieldset className="directory-form" disabled={pending || uncertain !== null}>
        {children}
      </fieldset>
      <Button type="submit" disabled={pending} variant="selected">
        {t(pending ? "saving" : uncertain ? "retry" : movement ? "submit" : "save")}
      </Button>
      {status !== undefined && (
        <p className="directory-notice" role={status === 204 ? "status" : "alert"}>
          {t(
            status === 204
              ? movement
                ? "recorded"
                : "saved"
              : uncertain
                ? "uncertain"
                : inventoryNotice(status, movement),
          )}
        </p>
      )}
    </form>
  );
}
export function CatalogForm({
  context,
  type,
  row,
}: {
  context: Context;
  type: Catalog;
  row?: Item | Warehouse;
}) {
  const t = inventoryMessages(context.locale),
    editing = Boolean(row),
    item = row && "sku" in row ? row : undefined;
  const label = t(
    type === "items"
      ? editing
        ? "editItem"
        : "createItem"
      : editing
        ? "rename"
        : "createWarehouse",
  );
  function normalize(data: FormData) {
    const fields = { name: data.get("name"), revision: row?.revision ?? 0 };
    return type === "items"
      ? parseCatalog("items", { ...fields, sku: data.get("sku"), unit: data.get("unit") })
      : parseCatalog("warehouses", fields);
  }
  return (
    <details className="directory-disclosure">
      <summary>{label}</summary>
      <InventoryForm {...context} resource={type} id={row?.id} label={label} normalize={normalize}>
        <label>
          {t(type === "items" ? "itemName" : "warehouseName")}
          <input name="name" required maxLength={120} defaultValue={row?.name} />
        </label>
        {type === "items" && (
          <>
            <label>
              {t("sku")}
              <input name="sku" required maxLength={80} defaultValue={item?.sku} />
            </label>
            <label>
              {t("unit")}
              <input
                name="unit"
                required
                maxLength={40}
                readOnly={item?.unitLocked}
                defaultValue={item?.unit}
              />
            </label>
            <small>{t(item?.unitLocked ? "unitLocked" : "unitHelp")}</small>
          </>
        )}
      </InventoryForm>
    </details>
  );
}
export function MovementForm({
  context,
  item,
  locations,
}: {
  context: Context;
  item: Item;
  locations: WarehousePage;
}) {
  const t = inventoryMessages(context.locale);
  const [kind, setKind] = useState<Movement["kind"]>("RECEIPT"),
    [extra, setExtra] = useState<{ firstPage: WarehousePage; combined: WarehousePage }>(),
    [fetching, start] = useTransition(),
    [loadError, setLoadError] = useState<number>();
  const loaded = extra?.firstPage === locations ? extra.combined : locations;
  const { from, to } = direction(kind);
  function nextWarehouses() {
    if (fetching || !loaded.hasNextPage) return;
    setLoadError(undefined);
    start(async () => {
      try {
        const response = await fetch(context.endpoint + "/warehouses?page=" + (loaded.page + 1), {
          cache: "no-store",
          redirect: "error",
        });
        if (!response.ok) {
          setLoadError(response.status);
          return;
        }
        const next: WarehousePage = await response.json();
        const warehouses = new Map(
          [...loaded.warehouses, ...next.warehouses].map((w) => [w.id, w]),
        );
        setExtra({
          firstPage: locations,
          combined: { ...next, warehouses: [...warehouses.values()] },
        });
      } catch {
        setLoadError(503);
      }
    });
  }
  function picker(name: "fromWarehouseId" | "toWarehouseId") {
    return (
      <label>
        {t(name === "fromWarehouseId" ? "from" : "to")}
        <select name={name} required defaultValue="">
          <option disabled value="">
            {t("chooseWarehouse")}
          </option>
          {loaded.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function normalize(data: FormData) {
    const quantity = data.get("quantity");
    return parseMovement({
      kind,
      itemId: item.id,
      unit: item.unit,
      quantity: typeof quantity === "string" ? quantity.trim().replace(",", ".") : quantity,
      reason: data.get("reason"),
      lot: data.get("lot"),
      fromWarehouseId: from ? data.get("fromWarehouseId") : null,
      toWarehouseId: to ? data.get("toWarehouseId") : null,
    });
  }
  return (
    <details className="directory-disclosure">
      <summary>{t("record")}</summary>
      {locations.warehouses.length ? (
        <InventoryForm
          {...context}
          label={t("record")}
          resource="movements"
          normalize={normalize}
          onSaved={() => setKind("RECEIPT")}
        >
          <label>
            {t("kind")}
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.currentTarget.value as Movement["kind"])}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </label>
          {from && picker("fromWarehouseId")}
          {to && picker("toWarehouseId")}
          {loaded.hasNextPage && (
            <Button type="button" onClick={nextWarehouses} disabled={fetching}>
              {t("moreWarehouses")}
            </Button>
          )}
          {loadError !== undefined && <p role="alert">{t(inventoryNotice(loadError))}</p>}
          <label>
            {t("qty", { unit: item.unit })}
            <input inputMode="decimal" name="quantity" required maxLength={19} />
          </label>
          <label>
            {t("lot")}
            <input name="lot" maxLength={120} />
          </label>
          <label>
            {t("reason")}
            <input name="reason" required maxLength={250} />
          </label>
        </InventoryForm>
      ) : (
        <p>{t("movementNeedsWarehouse")}</p>
      )}
    </details>
  );
}
