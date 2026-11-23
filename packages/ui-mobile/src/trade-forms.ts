import type { components } from "@vetx/api-client";
import { canDebit, stockQuantity, stockThousandths } from "./inventory-forms.ts";
type Schemas = components["schemas"];
export type Supplier = Schemas["SupplierDto"];
export type Order = Schemas["PurchaseOrderDto"];
export type Receipt = Schemas["PurchaseReceiptDto"];
export type ReturnEntry = Schemas["SupplierReturnDto"];
export type Capability = Schemas["CapabilityDto"];
export type Rx = Schemas["PrescriptionDto"];
export type Dispensing = Schemas["DispensingDto"];
export type PurchaseBody = Schemas["PurchaseInputDto"];
export type ReceiptBody = Schemas["ReceiptInputDto"];
export type ReturnBody = Schemas["SupplierReturnInputDto"];
export type RxBody = Schemas["PrescriptionInputDto"];
export type DispenseBody = Schemas["DispensingInputDto"];
export type GrantBody = Schemas["CapabilityInputDto"];
export type Sharing = Schemas["RxSharingDto"];
export type SupplierBody = Schemas["SupplierInputDto"];
export type OrderLine = Order["lines"][number];
export type ReceivedLine = Receipt["lines"][number];
export function remaining(total: string, used: string[]) {
  const n = used.reduce((left, s) => left - stockThousandths(s), stockThousandths(total));
  return n <= 0n ? "0.000" : String(n / 1000n) + "." + String(n % 1000n).padStart(3, "0");
}
const label = (s: string, max: number) =>
  !!s.trim() && s.trim().length <= max && !/\p{Cc}/u.test(s.trim());
export function orderBody(
  supplierId: string | undefined,
  draft: PurchaseBody["lines"],
): PurchaseBody | undefined {
  if (
    !supplierId ||
    !draft.length ||
    draft.length > 100 ||
    new Set(draft.map((l) => l.itemId)).size !== draft.length
  )
    return;
  const lines: PurchaseBody["lines"] = [];
  for (const l of draft) {
    const quantity = stockQuantity(l.quantity);
    if (!quantity || !l.itemId || !l.expectedUnit || !label(l.expectedUnit, 40)) return;
    lines.push({ itemId: l.itemId, expectedUnit: l.expectedUnit, quantity });
  }
  return { supplierId, lines };
}
export function receiptBody(
  ordered: OrderLine[],
  draft: ReceiptBody["lines"],
): ReceiptBody | undefined {
  if (!draft.length || draft.length > 100) return;
  const lines: ReceiptBody["lines"] = [],
    left = new Map(ordered.map((l) => [l.itemId, remaining(l.quantity, [l.receivedQuantity])]));
  for (const l of draft) {
    const n = stockQuantity(l.quantity),
      available = left.get(l.itemId),
      lot = l.lot.trim();
    if (
      !l.warehouseId ||
      !n ||
      !available ||
      !canDebit(available, n) ||
      lot.length > 120 ||
      /\p{Cc}/u.test(lot)
    )
      return;
    left.set(l.itemId, remaining(available, [n]));
    lines.push({ itemId: l.itemId, warehouseId: l.warehouseId, quantity: n, lot });
  }
  return { lines };
}
export function returnBody(
  id: string,
  amount: string,
  unreturned: string,
  onHand: string,
  reason: string,
): ReturnBody | undefined {
  const quantity = stockQuantity(amount);
  if (
    quantity &&
    id &&
    canDebit(unreturned, quantity) &&
    canDebit(onHand, quantity) &&
    label(reason, 250)
  )
    return { receiptMovementId: id, quantity, reason: reason.trim() };
}
export function prescriptionBody(
  item: { id: string; unit: string } | undefined,
  medication: string,
  instructions: string,
  amount: string,
): RxBody | undefined {
  const quantity = stockQuantity(amount),
    note = instructions.trim();
  if (
    !item?.id ||
    !item.unit ||
    !label(item.unit, 40) ||
    !quantity ||
    !label(medication, 250) ||
    !note ||
    note.length > 8000 ||
    /\p{Cc}/u.test(note.replace(/[\t\r\n]/g, ""))
  )
    return;
  return {
    itemId: item.id,
    expectedUnit: item.unit,
    medication: medication.trim(),
    instructions: note,
    quantity,
  };
}
export function dispenseBody(
  warehouseId: string | undefined,
  lot: string,
  amount: string,
  prescribed: string,
  onHand: string,
): DispenseBody | undefined {
  const quantity = stockQuantity(amount);
  if (quantity && warehouseId && canDebit(onHand, quantity) && canDebit(prescribed, quantity))
    return { warehouseId, lot, quantity };
}
export function allowedActions(g: Capability, subject: string) {
  const verified = g.subject === subject && g.clinicAccess;
  return { prescribe: verified && g.canPrescribe, dispense: verified && g.canDispense };
}
export function capabilityBody(
  g: Capability,
  canPrescribe: boolean,
  canDispense: boolean,
): GrantBody | undefined {
  if (
    (!g.clinicAccess && ((canPrescribe && !g.canPrescribe) || (canDispense && !g.canDispense))) ||
    (g.canPrescribe === canPrescribe && g.canDispense === canDispense)
  )
    return;
  return { revision: g.revision, canPrescribe, canDispense };
}
