import { createVetxClient, type paths } from "@vetx/api-client";
import type { fetch as expoFetch } from "expo/fetch";

import { nativeRequest } from "./native-request.ts";
import type { DirectoryScope } from "./directory";
import type { MobileSession } from "./session";

const collection = "/organizations/{organizationId}/clinics/{clinicId}/patients";
const record = `${collection}/{patientId}` as const;
const guardian = `${record}/guardians/{guardianId}` as const;
const invitation = `${guardian}/invitations` as const;
const redeemPath = "/owner/pet-links/redeem";
type PatientInput = paths[typeof record]["put"]["requestBody"]["content"]["application/json"];
type GuardianInput = paths[typeof guardian]["put"]["requestBody"]["content"]["application/json"];
type Redemption = paths[typeof redeemPath]["post"]["requestBody"]["content"]["application/json"];
export type ClinicScope = DirectoryScope & { clinicId: string };

class PatientError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, code?: string) {
    super("Patient request failed");
    this.status = status;
    this.code = code;
  }
}

export function patientFailure(error: unknown, action: "read" | "write" | "redeem") {
  if (error instanceof PatientError) {
    if (error.code === "EMAIL_VERIFICATION_REQUIRED") return "verifyEmail";
    if (action === "redeem" && error.status === 404) return "unavailableCode";
    if (error.status === 429) return "tooManyAttempts";
    if (error.status === 400) return "invalid";
    if (error.status === 409) return "conflict";
    if (error.status === 403 || error.status === 404) return "denied";
  }
  return action === "read" ? "loadError" : "writeError";
}

export function validBirthDate(value: string, today = new Date().toISOString().slice(0, 10)) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-") || value > today)
    return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dataOf<T>(result: {
  response: Response;
  data?: T;
  error?: { error: { code: string } };
}): T {
  if (!result.response.ok || result.data === undefined)
    throw new PatientError(result.response.status, result.error?.error?.code);
  return result.data;
}

export function createPatients(
  session: Pick<MobileSession, "forOrganization" | "forAccount">,
  origin: string,
  fetcher: typeof expoFetch,
) {
  const api = createVetxClient(origin);
  function staff<T>(
    scope: ClinicScope,
    operation: (
      config: ReturnType<typeof nativeRequest>,
      path: { organizationId: string; clinicId: string },
    ) => Promise<T>,
  ) {
    const { subject, organizationId, clinicId } = scope;
    return session.forOrganization(subject, organizationId, (token, signal) =>
      operation(nativeRequest(token, signal, fetcher), { organizationId, clinicId }),
    );
  }
  function owner<T>(
    subject: string,
    operation: (config: ReturnType<typeof nativeRequest>) => Promise<T>,
  ) {
    return session.forAccount(subject, (token, signal) =>
      operation(nativeRequest(token, signal, fetcher)),
    );
  }
  return {
    list(scope: ClinicScope, page: number, search: string) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.GET(collection, {
            ...config,
            params: { path, query: { page, search: search || undefined } },
          }),
        ),
      );
    },
    detail(scope: ClinicScope, patientId: string) {
      return staff(scope, async (config, path) =>
        dataOf(await api.GET(record, { ...config, params: { path: { ...path, patientId } } })),
      );
    },
    save(scope: ClinicScope, patientId: string, input: PatientInput) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.PUT(record, {
            ...config,
            params: { path: { ...path, patientId } },
            body: input,
          }),
        ),
      );
    },
    saveGuardian(scope: ClinicScope, patientId: string, guardianId: string, input: GuardianInput) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.PUT(guardian, {
            ...config,
            params: { path: { ...path, patientId, guardianId } },
            body: input,
          }),
        ),
      );
    },
    removeGuardian(scope: ClinicScope, patientId: string, guardianId: string) {
      return staff(scope, async (config, path) => {
        const result = await api.DELETE(guardian, {
          ...config,
          params: { path: { ...path, patientId, guardianId } },
        });
        if (!result.response.ok)
          throw new PatientError(result.response.status, result.error?.error?.code);
      });
    },
    issue(scope: ClinicScope, patientId: string, guardianId: string, requestId: string) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.POST(invitation, {
            ...config,
            params: { path: { ...path, patientId, guardianId } },
            body: { requestId },
          }),
        ),
      );
    },
    pets(subject: string) {
      return owner(subject, async (config) => dataOf(await api.GET("/owner/pets", config)));
    },
    redeem(subject: string, input: Redemption) {
      return owner(subject, async (config) =>
        dataOf(await api.POST(redeemPath, { ...config, body: input })),
      );
    },
  };
}
export type PatientClient = ReturnType<typeof createPatients>;
export type PatientRecord = Awaited<ReturnType<PatientClient["detail"]>>;
export type PatientSummary = PatientRecord["patient"];
export type Guardian = PatientRecord["guardians"][number];
