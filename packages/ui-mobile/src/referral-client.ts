import {
  dataOf,
  PatientError,
  type ClinicScope,
  type PatientTransport,
} from "./patient-transport.ts";
import type { RequestInput, Decision, CounterReferral } from "./referral-forms.ts";
const clinic = "/organizations/{organizationId}/clinics/{clinicId}" as const;
const ownerPath = "/owner/pets/{petId}/referrals" as const;
function read<T>(result: Parameters<typeof dataOf<T>>[0]) {
  if (result.response.status === 503) throw new PatientError(503, "REFERRALS_UNAVAILABLE");
  return dataOf(result);
}
export function createReferrals({ api, staff, owner }: PatientTransport) {
  return {
    destinations(scope: ClinicScope) {
      return staff(scope, async (config, path) =>
        read(await api.GET(`${clinic}/referrals/destinations`, { ...config, params: { path } })),
      );
    },
    request(scope: ClinicScope, patientId: string, requestId: string, body: RequestInput) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/patients/{patientId}/referrals/{requestId}`, {
            ...config,
            params: { path: { ...path, patientId, requestId } },
            body,
          }),
        ),
      );
    },
    staffList(
      scope: ClinicScope,
      direction: "incoming" | "outgoing",
      page: number,
      patientId?: string,
    ) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${clinic}/referrals`, {
            ...config,
            params: { path, query: { direction, page, patientId } },
          }),
        ),
      );
    },
    respond(scope: ClinicScope, referralId: string, body: CounterReferral) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/referrals/{referralId}/response`, {
            ...config,
            params: { path: { ...path, referralId } },
            body,
          }),
        ),
      );
    },
    ownerList(subject: string, petId: string, page: number) {
      return owner(subject, async (config) =>
        read(await api.GET(ownerPath, { ...config, params: { path: { petId }, query: { page } } })),
      );
    },
    decide(subject: string, petId: string, referralId: string, body: Decision) {
      return owner(subject, async (config) =>
        read(
          await api.PUT(`${ownerPath}/{referralId}/decision`, {
            ...config,
            params: { path: { petId, referralId } },
            body,
          }),
        ),
      );
    },
  };
}
export async function updateReferral(work: () => Promise<unknown>) {
  try {
    await work();
    return "saved" as const;
  } catch (error) {
    if (error instanceof PatientError && [403, 404, 409].includes(error.status))
      return "changed" as const;
    throw error;
  }
}
