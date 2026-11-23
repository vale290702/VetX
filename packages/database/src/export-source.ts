import type { DicomMetadata } from "./documents.js";
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
  includeOwner: boolean;
}
export interface ExportChoice {
  id: string;
  kind: "encounter" | "document" | "clinical";
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
  imaging?: Pick<DicomMetadata, "studyInstanceUid" | "seriesInstanceUid" | "sopInstanceUid"> | null;
  id: string;
  objectId: string;
  title: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | "application/dicom";
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
  clinical?: {
    id: string;
    kind: "diagnosis" | "treatment" | "vaccination" | "labResult" | "hospitalization" | "surgery";
    occurredAt: string;
    recordedAt: string;
    data: Record<string, string>;
    author: Authorship;
    clinicalRevision: ClinicalRevisionProvenance;
  }[];
}
