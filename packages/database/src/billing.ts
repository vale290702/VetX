export interface PriceInput {
  unit: string;
  name: string;
  currency: string;
  unitPrice: string;
  taxRate: string;
  cabys: string;
  stockItemId: string | null;
  revision: number;
}
export interface PriceEntry extends PriceInput {
  id: string;
}
export interface SaleLineInput {
  priceId: string;
  priceRevision: number;
  quantity: string;
  warehouseId: string | null;
  lot: string;
}
export interface SaleInput {
  currency: string;
  patientId: string | null;
  lines: SaleLineInput[];
}
export interface BillingActor {
  issuer: string;
  subject: string;
}
export interface SaleLine extends SaleLineInput {
  unit: string;
  name: string;
  stockItemId: string | null;
  cabys: string;
  unitPrice: string;
  taxRate: string;
  subtotal: string;
  tax: string;
  total: string;
  movementId: string | null;
}
export interface Sale {
  id: string;
  number: string;
  currency: string;
  patientId: string | null;
  lines: SaleLine[];
  subtotal: string;
  tax: string;
  total: string;
  paid: string;
  balance: string;
  recordedAt: string;
  author: BillingActor;
}
export interface ShiftInput {
  label: string;
  currency: string;
  openingFloat: string;
}
export interface CashShift extends ShiftInput {
  id: string;
  expected: string;
  counted: string | null;
  difference: string | null;
  openedAt: string;
  closedAt: string | null;
  cashier: BillingActor;
}
export interface PaymentInput {
  method: "CASH" | "CARD" | "TRANSFER";
  amount: string;
  reference: string;
  shiftId: string | null;
}
export interface Payment extends PaymentInput {
  id: string;
  saleId: string;
  currency: string;
  recordedAt: string;
  author: BillingActor;
}
export interface BillingPage {
  page: number;
  hasNextPage: boolean;
}
