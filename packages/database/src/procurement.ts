import type { InventoryPage, Warehouse, WarehouseInput } from "./inventory.js";

export type Supplier = Warehouse;
export type SupplierInput = WarehouseInput;
export interface TradeAuthor {
  issuer: string;
  subject: string;
}
export interface TradeEvent {
  id: string;
  author: TradeAuthor;
  recordedAt: string;
}
interface ItemQuantity {
  itemId: string;
  quantity: string;
}
export interface OrderLineInput extends ItemQuantity {
  expectedUnit: string;
}
export interface PurchaseInput {
  supplierId: string;
  lines: OrderLineInput[];
}
export interface PurchaseOrder extends TradeEvent {
  supplierId: string;
  supplierName: string;
  status: "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED";
  lines: (ItemQuantity & { itemName: string; unit: string; receivedQuantity: string })[];
}
export interface DispensingInput {
  warehouseId: string;
  lot: string;
  quantity: string;
}
export interface ReceiptLineInput extends DispensingInput {
  itemId: string;
}
export interface ReceiptInput {
  lines: ReceiptLineInput[];
}
export interface PurchaseReceipt extends TradeEvent {
  orderId: string;
  lines: (ReceiptLineInput & { movementId: string })[];
}
export interface SupplierReturnInput {
  receiptMovementId: string;
  quantity: string;
  reason: string;
}
export interface SupplierReturn extends TradeEvent, SupplierReturnInput {
  orderId: string;
  movementId: string;
}
interface MedicationOrder extends ItemQuantity {
  medication: string;
  instructions: string;
}
export interface PrescriptionInput extends MedicationOrder {
  expectedUnit: string;
}
export interface PrescriptionSharing {
  guardianIds: string[];
  revision: number;
}
export interface Prescription extends MedicationOrder, TradeEvent {
  patientId: string;
  itemName: string;
  unit: string;
  dispensedQuantity: string;
  sharing: PrescriptionSharing;
}
export interface Dispensing extends TradeEvent, DispensingInput {
  prescriptionId: string;
  movementId: string;
}
export interface PharmacyCapabilityInput {
  canPrescribe: boolean;
  canDispense: boolean;
  revision: number;
}
export interface PharmacyCapability extends PharmacyCapabilityInput {
  issuer: string;
  subject: string;
  clinicAccess: boolean;
}
export interface OwnerPrescription {
  id: string;
  patientId: string;
  clinicId: string;
  clinicName: string;
  organizationName: string;
  medication: string;
  instructions: string;
  quantity: string;
  unit: string;
  recordedAt: string;
}
export type TradePage<K extends string, T> = InventoryPage & Record<K, T[]>;
