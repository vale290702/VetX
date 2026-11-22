import "server-only";
import { createVetxClient, type components } from "@vetx/api-client";
import { readStaffSession, staffRequestOptions } from "../auth/account.ts";
import { isDirectoryId } from "../directory/forms.ts";
import {
  documentPath,
  documentsPath,
  emptyResponse,
  patientPath,
  validDocumentWrite,
  type DocumentIds,
  type PatientIds,
} from "./transport.ts";

export async function readDocuments(origin: string, token: string, ids: PatientIds, page: number) {
  try {
    const api = createVetxClient(origin);
    const options = staffRequestOptions(token);
    const [patient, list] = await Promise.all([
      api.GET(patientPath, { ...options, params: { path: ids } }),
      api.GET(documentsPath, { ...options, params: { path: ids, query: { page } } }),
    ]);
    if (!patient.data || !list.data)
      return { error: !patient.data ? patient.response.status : list.response.status } as const;
    return { record: patient.data, list: list.data } as const;
  } catch {
    return { error: 503 } as const;
  }
}

export async function documentAccess(request: Request, ids: DocumentIds) {
  if (![ids.organizationId, ids.clinicId, ids.patientId, ids.documentId].every(isDirectoryId))
    return emptyResponse(400);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  if (
    request.method === "POST" &&
    !validDocumentWrite(request, access.config.webOrigin, access.session.csrf)
  )
    return emptyResponse(403);
  return access;
}

export async function downloadDocument(
  origin: string,
  token: string,
  ids: DocumentIds,
  signal: AbortSignal,
) {
  return createVetxClient(origin).GET(`${documentPath}/content`, {
    ...staffRequestOptions(token),
    params: { path: ids },
    parseAs: "stream",
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  });
}

export async function shareDocument(
  origin: string,
  token: string,
  ids: DocumentIds,
  body: components["schemas"]["DocumentSharingDto"],
) {
  return createVetxClient(origin).PUT(`${documentPath}/sharing`, {
    ...staffRequestOptions(token),
    params: { path: ids },
    body,
  });
}
