import type { EncounterSharing } from "./care.js";

export type ClinicalData =
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
  ClinicalData & { clinicId: string; clinicName: string; organizationName: string };
export interface ClinicalPage<T> {
  records: T[];
  page: number;
  hasNextPage: boolean;
}
