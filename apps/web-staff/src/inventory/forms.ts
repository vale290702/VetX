import type { Locale } from "@vetx/i18n";
import type { components } from "@vetx/api-client";
import { isDirectoryId } from "../directory/forms.ts";
import type { ClinicScope } from "../patients/forms.ts";

type Schema = components["schemas"];
export type View = "items" | "warehouses" | "journal";
export type Catalog = "items" | "warehouses";
export type Item = Schema["StockItemDto"];
export type Warehouse = Schema["WarehouseDto"];
export type Movement = Schema["MovementInputDto"];
export const kinds = [
  "RECEIPT",
  "ISSUE",
  "TRANSFER",
  "RETURN",
  "ADJUST_IN",
  "ADJUST_OUT",
] as const satisfies readonly Movement["kind"][];
export function direction(kind: Movement["kind"]) {
  return {
    from: kind === "TRANSFER" || kind === "ISSUE" || kind === "ADJUST_OUT",
    to: kind === "TRANSFER" || kind === "RECEIPT" || kind === "RETURN" || kind === "ADJUST_IN",
  };
}
export type Filter = { view: View; query?: string; warehouse?: string; page?: number };
export function inventoryPath(
  scope: ClinicScope,
  { view, query, warehouse, page }: Filter = { view: "items" },
) {
  const params = new URLSearchParams();
  if (view !== "items") params.set("view", view);
  if (view === "items" && query) params.set("q", query);
  if (view === "warehouses" && warehouse) params.set("warehouse", warehouse);
  if (page && page > 1) params.set("page", String(page));
  return (
    `/organizations/${scope.organizationId}/clinics/${scope.clinicId}/inventory` +
    (params.size ? "?" + params : "")
  );
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const label = (v: unknown, limit: number, empty = false): v is string =>
  typeof v === "string" && v.length <= limit && (empty || Boolean(v.trim())) && !/\p{Cc}/u.test(v);
export function parseCatalog(type: "items", input: unknown): Schema["StockItemInputDto"] | null;
export function parseCatalog(
  type: "warehouses",
  input: unknown,
): Schema["WarehouseInputDto"] | null;
export function parseCatalog(type: Catalog, input: unknown) {
  if (
    !object(input) ||
    !label(input.name, 120) ||
    typeof input.revision !== "number" ||
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    input.revision > 2147483647
  )
    return null;
  const base = { name: input.name.trim(), revision: input.revision };
  if (type === "warehouses") return base;
  return label(input.sku, 80) && label(input.unit, 40)
    ? { ...base, sku: input.sku.trim(), unit: input.unit.trim() }
    : null;
}
export function parseMovement(raw: unknown): Movement | null {
  if (
    !object(raw) ||
    !kinds.some((kind) => kind === raw.kind) ||
    !isDirectoryId(raw.itemId) ||
    typeof raw.quantity !== "string" ||
    !/^(?!0(?:\.0{1,3})?$)(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/.test(raw.quantity) ||
    !label(raw.reason, 250) ||
    !label(raw.lot, 120, true)
  )
    return null;
  const kind = raw.kind as Movement["kind"];
  const { from, to } = direction(kind);
  const { fromWarehouseId, toWarehouseId } = raw;
  if (from ? !isDirectoryId(fromWarehouseId) : fromWarehouseId !== null) return null;
  if (to ? !isDirectoryId(toWarehouseId) : toWarehouseId !== null) return null;
  if (from && to && fromWarehouseId === toWarehouseId) return null;
  return {
    kind,
    itemId: raw.itemId,
    quantity: raw.quantity,
    lot: raw.lot.trim(),
    reason: raw.reason.trim(),
    fromWarehouseId: fromWarehouseId as string | null,
    toWarehouseId: toWarehouseId as string | null,
  };
}

export function stockQuantity(value: string, locale: Locale) {
  const [whole, fraction = ""] = value.split(".");
  if (!whole || !/^\d+(?:\.\d{1,3})?$/.test(value)) return value;
  const format = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fraction.length,
    maximumFractionDigits: fraction.length,
  });
  // Format the integer exactly even when its thousandths exceed Number's precision.
  return format
    .formatToParts(BigInt(whole))
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}
