import type { components } from "@vetx/api-client";
export type Warehouse = components["schemas"]["WarehouseDto"];
export type Item = components["schemas"]["StockItemDto"];
export type Balance = components["schemas"]["StockBalanceDto"];
export type Movement = components["schemas"]["MovementDto"];
export type MovementBody = components["schemas"]["MovementInputDto"];
export type ItemInput = components["schemas"]["StockItemInputDto"];
export type WarehouseInput = components["schemas"]["WarehouseInputDto"];
export type Kind = MovementBody["kind"];
export const kinds = [
  "RECEIPT",
  "ISSUE",
  "RETURN",
  "TRANSFER",
  "ADJUST_IN",
  "ADJUST_OUT",
] as const satisfies readonly Kind[];
export const needsFrom = (kind: Kind) =>
  kind === "ISSUE" || kind === "ADJUST_OUT" || kind === "TRANSFER";
export const needsTo = (kind: Kind) => kind !== "ISSUE" && kind !== "ADJUST_OUT";
export function stockQuantity(text: string) {
  const value = text.trim().replace(",", ".");
  return /^(?!0(?:\.0{1,3})?$)(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/.test(value) ? value : undefined;
}
export function displayQuantity(value: string, locale: string) {
  const [integer, decimal] = value.split(".");
  if (!integer || !/^\d+$/.test(integer) || (decimal && !/^\d{1,3}$/.test(decimal))) return value;
  const formatter = new Intl.NumberFormat(locale);
  const whole = formatter.format(BigInt(integer));
  if (!decimal) return whole;
  const point = formatter.formatToParts(1.1).find((p) => p.type === "decimal")?.value ?? ".";
  return whole + point + decimal;
}
export function stockThousandths(value: string) {
  const [integer, decimal = ""] = value.split(".");
  return BigInt(integer! + decimal.padEnd(3, "0"));
}
export function canDebit(balance: string, quantity: string) {
  return stockThousandths(balance) >= stockThousandths(quantity);
}
const label = (s: string, max: number) =>
  !!s.trim() && s.trim().length <= max && !/\p{Cc}/u.test(s.trim());
export function movementInput(draft: MovementBody): MovementBody | undefined {
  const { itemId, kind, unit } = draft,
    quantity = stockQuantity(draft.quantity),
    reason = draft.reason.trim(),
    lot = draft.lot.trim();
  if (
    !itemId ||
    !unit ||
    !label(unit, 40) ||
    !quantity ||
    !label(reason, 250) ||
    lot.length > 120 ||
    /\p{Cc}/u.test(lot)
  )
    return;
  const fromWarehouseId = needsFrom(kind) ? draft.fromWarehouseId : null,
    toWarehouseId = needsTo(kind) ? draft.toWarehouseId : null;
  if (
    (needsFrom(kind) && !fromWarehouseId) ||
    (needsTo(kind) && !toWarehouseId) ||
    fromWarehouseId === toWarehouseId
  )
    return;
  return { itemId, unit, kind, fromWarehouseId, toWarehouseId, quantity, reason, lot };
}
type Fields = { name: string; sku?: string; unit?: string; revision: number };
export function catalogInput(kind: "item", fields: Fields): ItemInput | undefined;
export function catalogInput(kind: "warehouse", fields: Fields): WarehouseInput | undefined;
export function catalogInput(kind: "item" | "warehouse", fields: Fields) {
  const name = fields.name.trim(),
    revision = fields.revision;
  if (!label(name, 120)) return;
  if (kind === "warehouse") return { name, revision };
  const sku = fields.sku?.trim() ?? "",
    unit = fields.unit?.trim() ?? "";
  return label(sku, 80) && label(unit, 40) ? { name, sku, unit, revision } : undefined;
}
export type Attempt<T> = { id: string; body: T };
export function preserveAttempt<T>(
  previous: Attempt<T> | undefined,
  id: string,
  body: T,
): Attempt<T> {
  return previous ?? { id, body };
}
