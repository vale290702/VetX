export interface PatientInput {
  name: string;
  species: string;
  birthDate: string | null;
  revision: number;
}

export interface PatientSummary extends PatientInput {
  id: string;
}

export interface GuardianInput {
  name: string;
  email: string;
}

export interface Guardian extends GuardianInput {
  id: string;
  linked: boolean;
}

export interface PatientDetail {
  patient: PatientSummary;
  guardians: Guardian[];
}

export interface PatientPage {
  patients: PatientSummary[];
  page: number;
  hasNextPage: boolean;
}

export interface IssuePetLinkInput {
  requestId: string;
  digest: string;
  lifetimeSeconds: number;
}

export interface RedeemPetLinkInput {
  digest: string;
  requestId: string;
  existingPetId?: string;
  attemptLimit: number;
  windowSeconds: number;
}

export interface OwnerPet {
  id: string;
  name: string;
  species: string;
  clinics: { clinicId: string; recordId: string; clinicName: string; organizationName: string }[];
}

export type RegistryErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "rate_limited";

export class RegistryError extends Error {
  constructor(readonly code: RegistryErrorCode) {
    super(code);
    this.name = "RegistryError";
  }
}

export function registryResult<T>(rows: { result: T | { error: RegistryErrorCode } }[]): T {
  const result = rows[0]?.result;
  if (!result || typeof result !== "object")
    throw new Error("Database returned no registry result");
  if ("error" in result) throw new RegistryError(result.error);
  return result;
}
