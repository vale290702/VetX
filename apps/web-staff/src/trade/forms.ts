import { isDirectoryId } from "../directory/forms.ts";
import type { components } from "@vetx/api-client";
export type Schema = components["schemas"];
export type Choice = { id: string; label: string; unit?: string };
export type Choices = { options: Choice[]; page: number; hasNextPage: boolean };
export type ChoiceKind = "items" | "warehouses" | "suppliers";
const object = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);
function text(raw: unknown, limit: number, empty = false): raw is string {
  return (
    typeof raw === "string" &&
    raw.length <= limit &&
    (empty || !!raw.trim()) &&
    !/\p{Cc}/u.test(raw)
  );
}
export function allowedSubject(raw: unknown): raw is string {
  // Generated API paths percent-encode subject values. Dot-only segments normalize as paths.
  return text(raw, 255) && raw !== "." && raw !== "..";
}
const revision = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 2147483647;
export function amount(value: unknown) {
  if (typeof value !== "string") return null;
  const n = value.trim().replace(",", ".");
  return /^(?!0(?:\.0{1,3})?$)(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/.test(n) ? n : null;
}
const scale = (s: string) => {
  const [whole, fraction = ""] = s.split(".");
  return BigInt(whole ?? "0") * 1000n + BigInt(fraction.padEnd(3, "0"));
};
export function remaining(total: string, used: string) {
  const n = scale(total) - scale(used);
  return n <= 0n ? "0.000" : String(n / 1000n) + "." + String(n % 1000n).padStart(3, "0");
}
function orderLine(raw: unknown) {
  if (!object(raw) || !isDirectoryId(raw.itemId) || !text(raw.expectedUnit, 40)) return null;
  const quantity = amount(raw.quantity);
  return quantity ? { itemId: raw.itemId, expectedUnit: raw.expectedUnit, quantity } : null;
}
function stockLine(raw: unknown) {
  if (!object(raw) || !isDirectoryId(raw.warehouseId) || !text(raw.lot, 120, true)) return null;
  const quantity = amount(raw.quantity);
  return quantity ? { warehouseId: raw.warehouseId, lot: raw.lot.trim(), quantity } : null;
}
function lines<T>(raw: unknown, parse: (r: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) return null;
  const result: T[] = [];
  for (const line of raw) {
    const parsed = parse(line);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}
export function parseTrade(action: string, raw: unknown) {
  if (!object(raw)) return null;
  switch (action) {
    case "supplier":
      return text(raw.name, 120) && revision(raw.revision)
        ? ({ action, body: { name: raw.name.trim(), revision: raw.revision } } as const)
        : null;
    case "order": {
      const result = lines(raw.lines, orderLine);
      return result &&
        isDirectoryId(raw.supplierId) &&
        new Set(result.map((l) => l.itemId.toLowerCase())).size === result.length
        ? ({ action, body: { supplierId: raw.supplierId, lines: result } } as const)
        : null;
    }
    case "receipt": {
      const result = lines(raw.lines, (r) => {
        const stock = stockLine(r);
        return stock && object(r) && isDirectoryId(r.itemId)
          ? { itemId: r.itemId, ...stock }
          : null;
      });
      return result && isDirectoryId(raw.orderId)
        ? ({ action, orderId: raw.orderId, body: { lines: result } } as const)
        : null;
    }
    case "return": {
      const quantity = amount(raw.quantity);
      return quantity &&
        isDirectoryId(raw.orderId) &&
        isDirectoryId(raw.receiptMovementId) &&
        text(raw.reason, 250)
        ? ({
            action,
            orderId: raw.orderId,
            body: { receiptMovementId: raw.receiptMovementId, quantity, reason: raw.reason.trim() },
          } as const)
        : null;
    }
    case "grant":
      return allowedSubject(raw.subject) &&
        revision(raw.revision) &&
        typeof raw.canPrescribe === "boolean" &&
        typeof raw.canDispense === "boolean"
        ? ({
            action,
            subject: raw.subject,
            body: {
              revision: raw.revision,
              canPrescribe: raw.canPrescribe,
              canDispense: raw.canDispense,
            },
          } as const)
        : null;
    case "prescribe": {
      const item = orderLine(raw);
      return item &&
        isDirectoryId(raw.patientId) &&
        text(raw.medication, 250) &&
        typeof raw.instructions === "string" &&
        raw.instructions.trim() &&
        raw.instructions.length <= 8000 &&
        !/\p{Cc}/u.test(raw.instructions.replace(/[\r\n\t]/g, ""))
        ? ({
            action,
            patientId: raw.patientId,
            body: {
              ...item,
              medication: raw.medication.trim(),
              instructions: raw.instructions.trim(),
            },
          } as const)
        : null;
    }
    case "share":
      return isDirectoryId(raw.patientId) &&
        isDirectoryId(raw.rxId) &&
        revision(raw.revision) &&
        Array.isArray(raw.guardianIds) &&
        raw.guardianIds.length <= 100 &&
        raw.guardianIds.every(isDirectoryId) &&
        new Set(raw.guardianIds.map((s) => s.toLowerCase())).size === raw.guardianIds.length
        ? ({
            action,
            patientId: raw.patientId,
            rxId: raw.rxId,
            body: { revision: raw.revision, guardianIds: raw.guardianIds },
          } as const)
        : null;
    case "dispense": {
      const stock = stockLine(raw);
      return stock && isDirectoryId(raw.patientId) && isDirectoryId(raw.rxId)
        ? ({ action, patientId: raw.patientId, rxId: raw.rxId, body: stock } as const)
        : null;
    }
    default:
      return null;
  }
}
export type Change = NonNullable<ReturnType<typeof parseTrade>>;
