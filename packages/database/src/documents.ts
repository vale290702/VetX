export interface DicomMetadata {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  modality: string;
  frames: number;
  preview?: { sha256: string; byteLength: number };
}
export interface DocumentInput {
  title: string;
  mediaType: "application/pdf" | "image/jpeg" | "image/png" | "application/dicom";
  byteLength: number;
  sha256: string;
}
export interface MedicalDocument extends DocumentInput {
  id: string;
  assetId: string;
  imaging?: DicomMetadata;
  organizationId: string;
  clinicId: string;
  patientId: string;
  recordedAt: string;
  ready: boolean;
}
export interface DocumentSharing {
  revision: number;
  guardianIds: string[];
}
export interface StaffDocument extends MedicalDocument {
  sharing: DocumentSharing;
}
export interface OwnerDocument extends MedicalDocument {
  clinicName: string;
  organizationName: string;
}
export interface DocumentPage<T> {
  documents: T[];
  page: number;
  hasNextPage: boolean;
}
