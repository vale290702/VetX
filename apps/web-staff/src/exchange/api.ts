import "server-only";
import { createVetxClient, type paths } from "@vetx/api-client";
import { readStaffSession, staffRequestOptions } from "../auth/account.ts";
import { privateHeaders, emptyResponse, safeWrite } from "../auth/file-proxy.ts";
import { isDirectoryId } from "../directory/forms.ts";
import type { ClinicScope } from "../patients/forms.ts";

export const clinic = "/organizations/{organizationId}/clinics/{clinicId}";
export const patients = `${clinic}/patients` as const;
export const patient = `${patients}/{patientId}` as const;
const history = `${patient}/imported-records` as const;
export const commitPath = `${clinic}/exchange/imports/{receiptId}/commit` as const;
export type Preview =
  paths[`${typeof clinic}/exchange/imports/preview`]["post"]["responses"][200]["content"]["application/json"];
export type Commit =
  paths[typeof commitPath]["put"]["responses"][200]["content"]["application/json"];
export type CandidatePage =
  paths[typeof patients]["get"]["responses"][200]["content"]["application/json"];
export type History = paths[typeof history]["get"]["responses"][200]["content"]["application/json"];
export type RecordIds = ClinicScope & { patientId: string; importedId: string };

export async function exchangeAccess(request: Request, ids: ClinicScope) {
  if (!Object.values(ids).every(isDirectoryId)) return emptyResponse(400);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  if (
    request.method === "POST" &&
    !safeWrite(request, access.config.webOrigin, access.session.csrf)
  )
    return emptyResponse(403);
  return access;
}

export function jsonResult<T>(result: { data?: T; response: Response }) {
  return result.data && result.response.ok
    ? Response.json(result.data, { headers: privateHeaders })
    : emptyResponse(result.response.status);
}

export async function readImportedHistory(
  origin: string,
  token: string,
  ids: ClinicScope & { patientId: string },
  page: number,
) {
  const api = createVetxClient(origin),
    options = staffRequestOptions(token);
  try {
    const [record, result] = await Promise.all([
      api.GET(patient, { ...options, params: { path: ids } }),
      api.GET(history, { ...options, params: { path: ids, query: { page } } }),
    ]);
    if (!record.data || !result.data)
      return { error: !record.data ? record.response.status : result.response.status } as const;
    return { name: record.data.patient.name, history: result.data } as const;
  } catch {
    return { error: 503 } as const;
  }
}
export function importedContent(
  origin: string,
  token: string,
  ids: RecordIds,
  signal: AbortSignal,
) {
  return createVetxClient(origin).GET(`${history}/{importedId}/content`, {
    ...staffRequestOptions(token),
    params: { path: ids },
    parseAs: "stream",
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  });
}
