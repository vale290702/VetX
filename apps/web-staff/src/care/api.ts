import "server-only";
import { createVetxClient, type components } from "@vetx/api-client";
import { staffRequestOptions } from "../auth/account.ts";
import type { ClinicScope } from "../patients/forms.ts";
import type { CareNotice, parseCareChange } from "./forms.ts";

const clinic = "/organizations/{organizationId}/clinics/{clinicId}";
const encounters = `${clinic}/patients/{patientId}/encounters` as const;
const encounter = `${encounters}/{encounterId}` as const;
const appointments = `${clinic}/appointments` as const;
export type Encounter = components["schemas"]["StaffEncounterDto"];
export type Appointment = components["schemas"]["AppointmentDto"];
export type Credentials = { origin: string; token: string };
export function careError(
  status: number,
  error?: components["schemas"]["ApiErrorDto"],
): Exclude<CareNotice, "saved"> {
  if (status === 409 && error?.error.code === "APPOINTMENT_OVERLAP") return "overlap";
  if (status === 409) return "conflict";
  if (status === 400) return "invalid";
  if (status === 401 || status === 403) return "denied";
  if (status === 404) return "missing";
  return "unavailable";
}
export async function readEncounters(
  { origin, token }: Credentials,
  scope: ClinicScope,
  patientId: string,
  page: number,
) {
  try {
    const result = await createVetxClient(origin).GET(encounters, {
      ...staffRequestOptions(token),
      params: { path: { ...scope, patientId }, query: { page } },
    });
    return result.data ? { data: result.data } : { error: careError(result.response.status) };
  } catch {
    return { error: "unavailable" as const };
  }
}

export async function readAgenda(
  { origin, token }: Credentials,
  scope: ClinicScope,
  query: { from: string; to: string; page: number },
) {
  const client = createVetxClient(origin),
    options = staffRequestOptions(token);
  try {
    const [clinics, result] = await Promise.all([
      client.GET("/organizations/{organizationId}/clinics", {
        ...options,
        params: { path: { organizationId: scope.organizationId } },
      }),
      client.GET(appointments, { ...options, params: { path: scope, query } }),
    ]);
    if (!clinics.data) return { error: careError(clinics.response.status) };
    const activeClinic = clinics.data.clinics.find((row) => row.id === scope.clinicId);
    if (!activeClinic) return { error: "denied" as const };
    return result.data
      ? { data: result.data, clinic: activeClinic }
      : { clinic: activeClinic, error: careError(result.response.status) };
  } catch {
    return { error: "unavailable" as const };
  }
}

export function writeCare(
  { origin, token }: Credentials,
  scope: ClinicScope,
  change: NonNullable<ReturnType<typeof parseCareChange>>,
) {
  const client = createVetxClient(origin),
    options = staffRequestOptions(token);
  if (change.action === "encounter" || change.action === "sharing") {
    const path = { ...scope, patientId: change.patientId, encounterId: change.encounterId };
    return change.action === "encounter"
      ? client.PUT(encounter, { ...options, params: { path }, body: change.body })
      : client.PUT(`${encounter}/sharing`, { ...options, params: { path }, body: change.body });
  }
  return client.PUT(`${appointments}/{appointmentId}`, {
    ...options,
    params: { path: { ...scope, appointmentId: change.appointmentId } },
    body: change.body,
  });
}
