import type { ExchangeClinic, ExchangePatient, ClinicalRevisionProvenance } from "./exchange.js";
export interface ExportLocation extends ExchangeClinic {
  patientId: string;
}
export interface ExportSource extends ExportLocation {
  clinicName: string;
  organizationName: string;
}
export interface ExportSelection {
  encounterIds: string[];
  documentAssetIds: string[];
  clinicalRevisionIds?: string[];
  prescriptionIds?: string[];
  includeOwner: boolean;
}
export interface ExportChoice {
  id: string;
  kind: "encounter" | "document" | "clinical" | "prescription";
  title: string;
  occurredAt: string;
}
interface Authorship {
  issuer: string;
  subject: string;
}
export interface ExportNote {
  id: string;
  kind: "encounter" | "addendum";
  occurredAt: string;
  recordedAt: string;
  author: Authorship;
  data: {
    reason: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    addendumTo?: string;
  };
}
export interface ExportFile {
  id: string;
  objectId: string;
  title: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg";
  byteLength: number;
  sha256: string;
  recordedAt: string;
  author: Authorship;
}
export interface ExportSnapshot {
  patient: ExchangePatient;
  owner?: { name: string; email?: string };
  notes: ExportNote[];
  files: ExportFile[];
  prescriptions?: {
    id: string;
    kind: "prescription";
    occurredAt: string;
    recordedAt: string;
    author: Authorship;
    data: { medication: string; instructions: string; quantity: string; unit: string };
  }[];
  clinical?: {
    id: string;
    kind: "diagnosis" | "treatment" | "vaccination" | "labResult";
    occurredAt: string;
    recordedAt: string;
    data: Record<string, string>;
    author: Authorship;
    clinicalRevision: ClinicalRevisionProvenance;
  }[];
}
