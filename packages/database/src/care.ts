export interface EncounterInput {
  occurredAt: string;
  reason: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  addendumTo?: string | null;
}

export interface EncounterSharing {
  revision: number;
  guardianIds: string[];
}

interface RecordedEncounter extends EncounterInput {
  id: string;
  addendumTo: string | null;
  recordedAt: string;
}

export interface StaffEncounter extends RecordedEncounter {
  authorIssuer: string;
  authorSubject: string;
  sharing: EncounterSharing;
}

export interface OwnerEncounter extends RecordedEncounter {
  clinicId: string;
  patientId: string;
  clinicName: string;
  organizationName: string;
}

export interface EncounterPage<T> {
  encounters: T[];
  page: number;
  hasNextPage: boolean;
}

export interface AppointmentInput {
  patientId: string;
  startAt: string;
  endAt: string;
  reason: string;
  status: "BOOKED" | "CANCELLED" | "COMPLETED";
  revision: number;
}

export interface Appointment extends AppointmentInput {
  id: string;
  patientName: string;
}

export interface AppointmentFilter {
  from: string;
  to: string;
  page: number;
  patientId?: string;
}

export interface AppointmentPage {
  appointments: Appointment[];
  page: number;
  hasNextPage: boolean;
}

export type CareErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "overlap";

export class CareError extends Error {
  constructor(readonly code: CareErrorCode) {
    super(code);
    this.name = "CareError";
  }
}
