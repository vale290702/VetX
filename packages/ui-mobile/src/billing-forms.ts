import type { components } from "@vetx/api-client";
import type { Balance } from "./inventory-forms.ts";
type Schema = components["schemas"];
export type Price = Schema["PriceDto"];
export type PriceInput = Schema["PriceInputDto"];
export type Sale = Schema["SaleDto"];
export type SaleInput = Schema["SaleInputDto"];
export type Shift = Schema["CashShiftDto"];
export type ShiftInput = Schema["ShiftInputDto"];
export type PaymentInput = Schema["PaymentInputDto"];
export type CartLine = {
  key: string;
  price: Price;
  quantity: string;
  balance?: Balance;
  unavailable?: boolean;
};
type Actor = { issuer: string; subject: string };

export function money(text: string) {
  const value = text.trim().replace(",", ".");
  return /^(?:0|[1-9]\d{0,12})(?:\.\d{1,5})?$/.test(value) ? value : undefined;
}
function quantity(text: string) {
  const value = text.trim().replace(",", ".");
  return /^(?!0(?:\.0{1,3})?$)(?:0|[1-9]\d{0,12})(?:\.\d{1,3})?$/.test(value) ? value : undefined;
}
function scaled(value: string, places: number) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole! + fraction.padEnd(places, "0"));
}
function amount(value: bigint) {
  const abs = (value < 0n ? -value : value).toString().padStart(6, "0");
  return (value < 0n ? "-" : "") + abs.slice(0, -5) + "." + abs.slice(-5);
}
export function difference(counted: string, expected: string) {
  const parsed = money(counted);
  return parsed === undefined ? undefined : amount(scaled(parsed, 5) - scaled(expected, 5));
}
export function formatDecimal(value: string, locale: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const formatter = new Intl.NumberFormat(locale);
  const whole = formatter.format(BigInt(match[2]!));
  const point = formatter.formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
  return match[1] + whole + (match[3] ? point + match[3] : "");
}
export function quoteCart(lines: CartLine[]) {
  let subtotal = 0n,
    tax = 0n;
  for (const line of lines) {
    const qty = quantity(line.quantity);
    if (
      line.unavailable ||
      line.price.currency !== lines[0]?.price.currency ||
      !qty ||
      !money(line.price.unitPrice) ||
      !money(line.price.taxRate)
    )
      return;
    const net = (scaled(line.price.unitPrice, 5) * scaled(qty, 3) + 500n) / 1000n;
    subtotal += net;
    tax += (net * scaled(line.price.taxRate, 5) + 5000000n) / 10000000n;
  }
  if (subtotal + tax > 999999999999999999n) return;
  return { subtotal: amount(subtotal), tax: amount(tax), total: amount(subtotal + tax) };
}
const lotKey = (b: Balance) => JSON.stringify([b.itemId, b.warehouseId, b.lot]);
export function stockAvailable(lines: CartLine[]) {
  const lots = new Map<string, { used: bigint; available: bigint }>();
  for (const { price, balance, quantity: text } of lines) {
    if (!price.stockItemId) continue;
    const qty = quantity(text);
    if (!qty || !balance || balance.itemId !== price.stockItemId || balance.unit !== price.unit)
      return false;
    const key = lotKey(balance),
      available = scaled(balance.quantity, 3);
    const lot = lots.get(key) ?? { used: 0n, available };
    lot.used += scaled(qty, 3);
    if (available < lot.available) lot.available = available;
    if (lot.used > lot.available) return false;
    lots.set(key, lot);
  }
  return true;
}
export function lineFitsStock(line: CartLine, others: CartLine[]) {
  const { balance } = line;
  if (!line.price.stockItemId) return true;
  if (!balance) return false;
  const key = lotKey(balance);
  return stockAvailable([
    ...others.filter((other) => other.balance && lotKey(other.balance) === key),
    line,
  ]);
}
export function saleBody(patientId: string | null, lines: CartLine[]): SaleInput | undefined {
  const currency = lines[0]?.price.currency;
  if (!currency || lines.length > 1000 || !quoteCart(lines) || !stockAvailable(lines)) return;
  return {
    currency,
    patientId,
    lines: lines.map(({ price, balance, quantity: text }) => ({
      priceId: price.id,
      priceRevision: price.revision,
      quantity: quantity(text)!,
      warehouseId: price.stockItemId ? balance!.warehouseId : null,
      lot: price.stockItemId ? balance!.lot : "",
    })),
  };
}
export function refreshLines(
  lines: CartLine[],
  prices: Map<string, Price>,
  balances: Balance[],
): CartLine[] {
  const lots = new Map(balances.map((b) => [lotKey(b), b]));
  return lines.map((line) => {
    const price = prices.get(line.price.id);
    if (!price) return { ...line, unavailable: true };
    const changed = price.unit !== line.price.unit || price.stockItemId !== line.price.stockItemId;
    const balance = !changed && line.balance ? lots.get(lotKey(line.balance)) : undefined;
    return {
      ...line,
      price,
      unavailable: false,
      quantity: changed ? "" : line.quantity,
      balance: balance?.unit === price.unit ? balance : undefined,
    };
  });
}
const label = (s: string, max: number) => !!s && s.length <= max && !/\p{Cc}/u.test(s);
export function priceBody(draft: PriceInput): PriceInput | undefined {
  const { revision, stockItemId } = draft,
    name = draft.name.trim(),
    unit = draft.unit.trim(),
    currency = draft.currency.trim().toUpperCase(),
    cabys = draft.cabys.trim(),
    unitPrice = money(draft.unitPrice),
    taxRate = money(draft.taxRate);
  if (
    !label(name, 120) ||
    !label(unit, 40) ||
    !/^\d{13}$/.test(cabys) ||
    !/^([A-Z]{3})$/.test(currency) ||
    !unitPrice ||
    !taxRate ||
    scaled(taxRate, 5) > 10000000n
  )
    return;
  return { revision, stockItemId, name, unit, currency, cabys, unitPrice, taxRate };
}
export function myShift(shift: Shift, account: Actor) {
  return shift.cashier.issuer === account.issuer && shift.cashier.subject === account.subject;
}
export function paymentBody(
  sale: Pick<Sale, "currency" | "balance">,
  account: Actor,
  method: PaymentInput["method"],
  text: string,
  ref: string,
  shift?: Shift,
): PaymentInput | undefined {
  const amount = money(text),
    reference = ref.trim();
  if (
    !amount ||
    scaled(amount, 5) === 0n ||
    scaled(amount, 5) > scaled(sale.balance, 5) ||
    reference.length > 120 ||
    /\p{Cc}/u.test(reference)
  )
    return;
  if (method === "CASH") {
    if (!shift || shift.closedAt || !myShift(shift, account) || shift.currency !== sale.currency)
      return;
    return { method, amount, reference: "", shiftId: shift.id };
  }
  return reference ? { method, amount, reference, shiftId: null } : undefined;
}
export function shiftBody(title: string, code: string, text: string): ShiftInput | undefined {
  const labelText = title.trim(),
    currency = code.trim().toUpperCase(),
    openingFloat = money(text);
  return label(labelText, 120) && /^[A-Z]{3}$/.test(currency) && openingFloat
    ? { label: labelText, currency, openingFloat }
    : undefined;
}
