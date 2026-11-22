import "server-only";

import { createVetxClient, type paths } from "@vetx/api-client";
import { staffRequestOptions } from "../auth/account.ts";
import { noticeForStatus, type ClinicScope, type parsePatientChange } from "./forms.ts";

const collection = "/organizations/{organizationId}/clinics/{clinicId}/patients";
const detail = `${collection}/{patientId}` as const;
const guardian = `${detail}/guardians/{guardianId}` as const;
export type RecordView =
  paths[typeof detail]["get"]["responses"][200]["content"]["application/json"];
export type Patient = RecordView["patient"];

export async function readRegistry(
  origin: string,
  token: string,
  scope: ClinicScope,
  patientId: string | undefined,
  query: { page: number; search: string },
) {
  const client = createVetxClient(origin);
  const options = staffRequestOptions(token);
  const clinicResponse = client.GET("/organizations/{organizationId}/clinics", {
    ...options,
    params: { path: { organizationId: scope.organizationId } },
  });
  const recordResponse = patientId
    ? client.GET(detail, {
        ...options,
        params: { path: { ...scope, patientId } },
      })
    : client.GET(collection, { ...options, params: { path: scope, query } });
  try {
    const [clinics, result] = await Promise.all([clinicResponse, recordResponse]);
    if (!clinics.data) return { error: noticeForStatus(clinics.response.status) } as const;
    const clinic = clinics.data.clinics.find(({ id }) => id === scope.clinicId);
    if (!clinic) return { error: "denied" } as const;
    if (!result.data) return { clinic, error: noticeForStatus(result.response.status) } as const;
    return { clinic, data: result.data } as const;
  } catch {
    return { error: "writeUnavailable" } as const;
  }
}

export async function writeRegistry(
  origin: string,
  token: string,
  scope: ClinicScope,
  change: NonNullable<ReturnType<typeof parsePatientChange>>,
) {
  const client = createVetxClient(origin);
  const options = staffRequestOptions(token);
  const patientPath = { ...scope, patientId: change.patientId };
  if (change.action === "patient")
    return client.PUT(detail, { ...options, params: { path: patientPath }, body: change.body });
  const path = { ...patientPath, guardianId: change.guardianId };
  if (change.action === "guardian")
    return client.PUT(guardian, { ...options, params: { path }, body: change.body });
  if (change.action === "revoke") return client.DELETE(guardian, { ...options, params: { path } });
  return client.POST(`${guardian}/invitations`, {
    ...options,
    params: { path },
    body: { requestId: change.requestId },
  });
}
