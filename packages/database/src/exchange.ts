import type { PatientSummary } from "./registry.js";

export interface ExchangeClinic {
  organizationId: string;
  clinicId: string;
}

export interface ExchangePatient {
  id: string;
  name: string;
  species: string;
  birthDate?: string | null;
}

export type ExchangeRecordKind =
  | "encounter"
  | "addendum"
  | "diagnosis"
  | "treatment"
  | "prescription"
  | "vaccination"
  | "labResult"
  | "document"
  | "radiograph"
  | "dicom"
  | "referral"
  | "counterReferral";

export type ExchangeJson =
  string | number | boolean | null | ExchangeJson[] | { [key: string]: ExchangeJson };

export interface ExchangeRecord {
  id: string;
  kind: ExchangeRecordKind;
  occurredAt: string;
  recordedAt: string;
  author: { issuer: string; subject: string };
  data: Record<string, ExchangeJson>;
}

export interface ExchangeManifest {
  version: 1;
  packageId: string;
  createdAt: string;
  source: ExchangeClinic;
  destination: ExchangeClinic;
  patient: ExchangePatient;
  owner?: { name: string; email?: string };
  records: ExchangeRecord[];
}

export interface StageExchangeInput {
  manifest: ExchangeManifest;
  archiveSha256: string;
  byteLength: number;
  recordDigests: Record<string, string>;
}

export interface ExchangePreview {
  receiptId: string;
  packageId: string;
  source: ExchangeClinic;
  patient: ExchangePatient;
  owner?: { name: string; email?: string };
  recordCount: number;
  candidates: PatientSummary[];
  mappedPatientId: string | null;
  committedPatientId: string | null;
}

export type ExchangeChoice = { mode: "match"; patientId: string } | { mode: "create" };

export interface ExchangeReceipt {
  archiveSha256: string;
  byteLength: number;
  packageId: string;
}

export interface ExchangeCommit {
  packageId: string;
  patientId: string;
  inserted: number;
  skipped: number;
}

export interface ImportedRecord extends ExchangeRecord {
  importedId: string;
  source: ExchangeClinic & { patientId: string };
  packageId: string;
  importedAt: string;
}

export interface ImportedRecordPage {
  records: ImportedRecord[];
  page: number;
  hasNextPage: boolean;
}

export interface ImportedAttachment {
  packageId: string;
  source: ExchangeClinic & { patientId: string };
  recordId: string;
  kind: "document" | "radiograph" | "dicom";
  archiveSha256: string;
  byteLength: number;
}

export type ExchangeErrorCode = "invalid" | "forbidden" | "not_found" | "conflict";

export class ExchangeError extends Error {
  constructor(readonly code: ExchangeErrorCode) {
    super(code);
    this.name = "ExchangeError";
  }
}

// Attachments live in the verified, encrypted archive. The database receives
// only the metadata (including byte length and the validated content digest).
export function exchangeMetadata(manifest: ExchangeManifest): ExchangeManifest {
  return {
    ...manifest,
    records: manifest.records.map((record) => {
      if (!["document", "radiograph", "dicom"].includes(record.kind)) return record;
      const data = { ...record.data };
      delete data.content;
      return { ...record, data };
    }),
  };
}
