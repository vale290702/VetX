import { PatientError, type ClinicScope } from "./patient-transport.ts";
import type { PatientClient } from "./patients";
import { allowedActions } from "./trade-forms.ts";

export async function readRxRecipients(
  client: PatientClient,
  scope: ClinicScope,
  patientId: string,
  rxId: string,
  startingPage: number,
) {
  const grant = await client.trade.me(scope);
  if (!allowedActions(grant, scope.subject).prescribe) throw new PatientError(403);
  async function findPrescription() {
    const first = await client.trade.prescriptions(scope, patientId, startingPage);
    const existing = first.prescriptions.find((rx) => rx.id === rxId);
    if (existing) return existing;
    for (let page = 1; ; page++) {
      const current =
        page === startingPage ? first : await client.trade.prescriptions(scope, patientId, page);
      const rx = current.prescriptions.find((r) => r.id === rxId);
      if (rx) return rx;
      if (!current.hasNextPage) throw new PatientError(404);
    }
  }
  const [rx, record] = await Promise.all([findPrescription(), client.detail(scope, patientId)]);
  return { rx, guardians: record.guardians };
}
