import type { components } from "@vetx/api-client";
import type { Locale } from "@vetx/i18n";
import { isDirectoryId, readDirectoryPage } from "../directory/forms.ts";

export type Schema = components["schemas"];
export type Price = Schema["PriceDto"];
export type Sale = Schema["SaleDto"];
export type Shift = Schema["CashShiftDto"];
export type Payment = Schema["PaymentDto"];
export type StockItem = Schema["StockItemDto"];
export type Warehouse = Schema["WarehouseDto"];
export type Balance = Schema["StockBalanceDto"];
export type Context = {
  locale: Locale;
  endpoint: string;
  pagePath: string;
  csrf: string;
  subject: string;
  issuer: string;
};
export function decimal(value: unknown, places: 3 | 5) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^(0|[1-9]\\d{0,12})(?:[.,]\\d{1,${places}})?$`).test(value.trim())
  )
    return null;
  return value.trim().replace(",", ".");
}
export function scaled(value: string, places: number) {
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole! + frac.padEnd(places, "0"));
}
export function unscale(value: bigint, places: number) {
  const text = value.toString().padStart(places + 1, "0");
  return text.slice(0, -places) + "." + text.slice(-places);
}
export function lineAmounts(price: string, quantity: string, rate: string) {
  const net = (scaled(price, 5) * scaled(quantity, 3) + 500n) / 1000n;
  const tax = (net * scaled(rate, 5) + 5000000n) / 10000000n;
  return { net, tax, total: net + tax };
}
export function formatAmount(value: string, locale: Locale) {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const decimals = fraction.replace(/0+$/, "").padEnd(2, "0");
  const pieces = new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).formatToParts(
    BigInt(whole!),
  );
  return (
    (value.startsWith("-") ? "-" : "") +
    pieces.map((x) => (x.type === "fraction" ? decimals : x.value)).join("")
  );
}
export function billingTarget(method: string, parts: string[], params: URLSearchParams) {
  const [resource, id, sub, other] = parts;
  const validId = isDirectoryId(id);
  let path: string | undefined;
  if (
    resource === "sales" &&
    validId &&
    sub === "fiscal" &&
    (other === "sandbox" || other === "production")
  ) {
    if (
      (parts.length === 4 && (method === "GET" || method === "POST")) ||
      (parts.length === 5 && parts[4] === "retry" && method === "POST")
    )
      return "billing/" + parts.join("/");
    if (
      method === "GET" &&
      parts.length === 6 &&
      parts[4] === "artifacts" &&
      (parts[5] === "invoice" || parts[5] === "receipt")
    )
      return "billing/" + parts.join("/");
    return null;
  }
  if (method === "POST") {
    if (parts.length === 2 && validId && ["prices", "sales", "shifts"].includes(resource!))
      path = parts.join("/");
    if (parts.length === 3 && resource === "shifts" && validId && sub === "close")
      path = parts.join("/");
    if (
      parts.length === 4 &&
      resource === "sales" &&
      validId &&
      sub === "payments" &&
      isDirectoryId(other)
    )
      path = parts.join("/");
    return path ? "billing/" + path : null;
  }
  if (method !== "GET") return null;
  if (parts.length === 1 && ["prices", "sales", "shifts"].includes(resource!))
    path = "billing/" + resource;
  if (resource === "sales" && validId && parts.length === 2) return "billing/sales/" + id;
  if (resource === "sales" && validId && sub === "payments" && parts.length === 3)
    path = "billing/" + parts.join("/");
  if (parts.length === 1 && ["warehouses", "items"].includes(resource!))
    path = "inventory/" + resource;
  if (resource === "balances" && parts.length === 2 && validId)
    path = "inventory/warehouses/" + id + "/balances";
  if (resource === "patients" && parts.length === 1) path = "patients";
  if (!path) return null;
  const query = new URLSearchParams({ page: String(readDirectoryPage(params.get("page"))) });
  const term = params.get("q")?.trim().slice(0, 120);
  if (term && ["patients", "items", "prices"].includes(resource!))
    query.set(resource === "patients" ? "search" : "query", term);
  return path + "?" + query;
}
