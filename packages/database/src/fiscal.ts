import type { FiscalInvoice, FiscalLine } from "@vetx/fiscal-cr";

export type FiscalEnvironment = "sandbox" | "production";
export type FiscalDraft = Pick<
  FiscalInvoice,
  "recipient" | "recipientActivity" | "terms" | "exchangeRate"
> & {
  lines: Pick<FiscalLine, "unitCode" | "category" | "vatTariffCode" | "medicine">[];
};
export type FiscalState =
  | "pending"
  | "signed"
  | "sending"
  | "submitted"
  | "processing"
  | "accepted"
  | "rejected"
  | "invalid"
  | "blocked";
export interface FiscalRecord {
  id: string;
  saleId: string;
  environment: FiscalEnvironment;
  key: string;
  state: FiscalState;
  issue: string | null;
  createdAt: string;
  hasSignedXml: boolean;
  hasReceipt: boolean;
}
export interface ClinicFiscalStatus {
  enabled: boolean;
  invoice: FiscalRecord | null;
}
