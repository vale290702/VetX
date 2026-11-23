import {
  dataOf,
  PatientError,
  type ClinicScope,
  type PatientTransport,
} from "./patient-transport.ts";
import type { ClinicalWrite, ClinicalShare } from "./clinical-record-forms.ts";
const collection =
  "/organizations/{organizationId}/clinics/{clinicId}/patients/{patientId}/clinical-records" as const;
const versions = `${collection}/{recordId}/revisions` as const;
function read<T>(r: Parameters<typeof dataOf<T>>[0]) {
  if (r.response.status === 503) throw new PatientError(503, "CLINICAL_UNAVAILABLE");
  return dataOf(r);
}
export function createClinicalRecords({ api, staff, owner }: PatientTransport) {
  return {
    list(scope: ClinicScope, patientId: string, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(collection, {
            ...config,
            params: { path: { ...path, patientId }, query: { page } },
          }),
        ),
      );
    },
    history(scope: ClinicScope, patientId: string, recordId: string, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(versions, {
            ...config,
            params: { path: { ...path, patientId, recordId }, query: { page } },
          }),
        ),
      );
    },
    save(
      scope: ClinicScope,
      patientId: string,
      recordId: string,
      requestId: string,
      body: ClinicalWrite,
    ) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${versions}/{requestId}`, {
            ...config,
            params: { path: { ...path, patientId, recordId, requestId } },
            body,
          }),
        ),
      );
    },
    share(scope: ClinicScope, patientId: string, recordId: string, body: ClinicalShare) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${collection}/{recordId}/sharing`, {
            ...config,
            params: { path: { ...path, patientId, recordId } },
            body,
          }),
        ),
      );
    },
    released(subject: string, petId: string, page: number) {
      return owner(subject, async (config) =>
        read(
          await api.GET("/owner/pets/{petId}/clinical-records", {
            ...config,
            params: { path: { petId }, query: { page } },
          }),
        ),
      );
    },
  };
}
