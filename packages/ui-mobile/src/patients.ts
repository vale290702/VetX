import type { paths } from "@vetx/api-client";
import type { fetch as expoFetch } from "expo/fetch";

import { createBilling } from "./billing-client.ts";
import { createInventory } from "./inventory-client.ts";
import { createReferrals } from "./referral-client.ts";
import { createExchange } from "./exchange-client.ts";
import { createDocuments } from "./documents.ts";
import { createCare } from "./care-client.ts";
import {
  createPatientTransport,
  dataOf,
  PatientError,
  type ClinicScope,
} from "./patient-transport.ts";
import type { MobileSession } from "./session";

export type { ClinicScope } from "./patient-transport.ts";
const collection = "/organizations/{organizationId}/clinics/{clinicId}/patients";
const record = `${collection}/{patientId}` as const;
const guardian = `${record}/guardians/{guardianId}` as const;
const invitation = `${guardian}/invitations` as const;
const redeemPath = "/owner/pet-links/redeem";
type PatientInput = paths[typeof record]["put"]["requestBody"]["content"]["application/json"];
type GuardianInput = paths[typeof guardian]["put"]["requestBody"]["content"]["application/json"];
type Redemption = paths[typeof redeemPath]["post"]["requestBody"]["content"]["application/json"];
export function patientFailure(error: unknown, action: "read" | "write" | "redeem") {
  if (error instanceof PatientError) {
    if (error.code === "BILLING_UNAVAILABLE") return "billingUnavailable";
    if (error.code === "INVENTORY_UNAVAILABLE") return "inventoryUnavailable";
    if (error.code === "REFERRALS_UNAVAILABLE") return "referralsUnavailable";
    if (error.code === "HANDOFF_UNAVAILABLE") return "handoffUnavailable";
    if (error.code === "EXCHANGE_UNAVAILABLE") return "exchangeUnavailable";
    if (error.code === "INVALID_PACKAGE") return "invalidPackage";
    if (error.code === "EXCHANGE_SIZE") return "exchangeSize";
    if (error.code === "EMAIL_VERIFICATION_REQUIRED") return "verifyEmail";
    if (action === "redeem" && error.status === 404) return "unavailableCode";
    if (error.status === 429) return "tooManyAttempts";
    if (error.status === 400) return "invalid";
    if (error.status === 413) return "documentTooLarge";
    if (error.code === "APPOINTMENT_OVERLAP") return "overlap";
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

export function createPatients(
  session: Pick<MobileSession, "forOrganization" | "forAccount">,
  origin: string,
  fetcher: typeof expoFetch,
) {
  const transport = createPatientTransport(session, origin, fetcher);
  const { api, staff, owner } = transport;
  return {
    billing: createBilling(transport),
    inventory: createInventory(transport),
    referrals: createReferrals(transport),
    exchange: createExchange(transport, session, origin, fetcher),
    documents: createDocuments(transport, session, origin, fetcher),
    care: createCare(transport),
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
