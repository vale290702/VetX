import "server-only";
import { createVetxClient, type components } from "@vetx/api-client";
import { staffRequestOptions } from "../auth/account.ts";
import type { ClinicScope } from "../patients/forms.ts";
import type { ClinicalData } from "./forms.ts";
export type PatientScope = ClinicScope & { patientId: string };
export type ClinicalRecord = Omit<components["schemas"]["StaffClinicalDto"], "data"> & {
  data: ClinicalData;
};
type Page = { records: ClinicalRecord[]; page: number; hasNextPage: boolean };
const collection =
  "/organizations/{organizationId}/clinics/{clinicId}/patients/{patientId}/clinical-records";
export async function readClinical(
  origin: string,
  token: string,
  ids: PatientScope,
  page: number,
  recordId?: string,
): Promise<{ data: Page; error?: never } | { error: number; data?: never }> {
  const api = createVetxClient(origin),
    options = staffRequestOptions(token);
  try {
    const response = recordId
      ? await api.GET(`${collection}/{recordId}/revisions`, {
          ...options,
          params: { path: { ...ids, recordId }, query: { page } },
        })
      : await api.GET(collection, { ...options, params: { path: ids, query: { page } } });
    return response.data ? { data: response.data } : { error: response.response.status };
  } catch {
    return { error: 503 };
  }
}
