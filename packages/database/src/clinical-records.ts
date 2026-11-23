import type { EncounterSharing } from "./care.js";

type GeneralClinicalData =
  | { kind: "diagnosis"; data: { diagnosis: string; code?: string } }
  | { kind: "treatment"; data: { treatment: string; notes?: string } }
  | { kind: "vaccination"; data: { vaccine: string; lotNumber?: string; nextDueDate?: string } }
  | {
      kind: "lab";
      data: {
        test: string;
        specimen?: string;
        status: "ORDERED" | "RESULTED" | "REVIEWED";
        result?: string;
        unit?: string;
        referenceRange?: string;
      };
    };
export interface HospitalizationData {
  status: "ADMITTED" | "PROGRESS" | "DISCHARGED";
  ward: string;
  location?: string;
  note: string;
  summary?: string;
}
export interface SurgeryData {
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  procedure: string;
  scheduledAt: string;
  notes?: string;
  performedProcedure?: string;
  recoveryNotes?: string;
  summary?: string;
}
export type ClinicalData =
  | GeneralClinicalData
  | { kind: "hospitalization"; data: HospitalizationData }
  | { kind: "surgery"; data: SurgeryData };
export type OwnerClinicalData =
  | GeneralClinicalData
  | { kind: "hospitalization"; data: { status: "DISCHARGED"; summary: string } }
  | { kind: "surgery"; data: { status: "COMPLETED" | "CANCELLED"; summary: string } };
export type ClinicalWrite = ClinicalData & {
  encounterId: string;
  occurredAt: string;
  revision: number;
  changeReason?: string;
};
interface ClinicalVersion {
  id: string;
  revisionId: string;
  revision: number;
  patientId: string;
  occurredAt: string;
  recordedAt: string;
}
export type StaffClinical = ClinicalVersion &
  ClinicalData & {
    encounterId: string;
    changeReason: string | null;
    author: { issuer: string; subject: string };
    sharing: EncounterSharing;
  };
export type OwnerClinical = ClinicalVersion &
  OwnerClinicalData & { clinicId: string; clinicName: string; organizationName: string };
export interface ClinicalPage<T> {
  records: T[];
  page: number;
  hasNextPage: boolean;
}
