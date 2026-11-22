import type { components } from "@vetx/api-client";

import { dataOf, type ClinicScope, type PatientTransport } from "./patient-transport.ts";

const clinic = "/organizations/{organizationId}/clinics/{clinicId}" as const;
const notes = `${clinic}/patients/{patientId}/encounters` as const;
const item = `${notes}/{encounterId}` as const;
const calendar = `${clinic}/appointments` as const;

export type NoteInput = components["schemas"]["EncounterInputDto"];
export type StaffNote = components["schemas"]["StaffEncounterDto"];
export type OwnerNote = components["schemas"]["OwnerEncounterDto"];
export type VisitInput = components["schemas"]["AppointmentInputDto"];
export type Visit = components["schemas"]["AppointmentDto"];
export type Sharing = components["schemas"]["SharingDto"];

export function createCare({ api, staff, owner }: PatientTransport) {
  return {
    encounters(scope: ClinicScope, patientId: string, page: number) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.GET(notes, {
            ...config,
            params: { path: { ...path, patientId }, query: { page } },
          }),
        ),
      );
    },
    append(scope: ClinicScope, patientId: string, encounterId: string, body: NoteInput) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.PUT(item, {
            ...config,
            params: { path: { ...path, patientId, encounterId } },
            body,
          }),
        ),
      );
    },
    share(scope: ClinicScope, patientId: string, encounterId: string, body: Sharing) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.PUT(`${item}/sharing`, {
            ...config,
            params: { path: { ...path, patientId, encounterId } },
            body,
          }),
        ),
      );
    },
    released(subject: string, petId: string, page: number) {
      return owner(subject, async (config) =>
        dataOf(
          await api.GET("/owner/pets/{petId}/encounters", {
            ...config,
            params: { path: { petId }, query: { page } },
          }),
        ),
      );
    },
    appointments(
      scope: ClinicScope,
      range: { from: string; to: string },
      page: number,
      patientId?: string,
    ) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.GET(calendar, {
            ...config,
            params: { path, query: { ...range, page, patientId } },
          }),
        ),
      );
    },
    book(scope: ClinicScope, appointmentId: string, body: VisitInput) {
      return staff(scope, async (config, path) =>
        dataOf(
          await api.PUT(`${calendar}/{appointmentId}`, {
            ...config,
            params: { path: { ...path, appointmentId } },
            body,
          }),
        ),
      );
    },
  };
}
