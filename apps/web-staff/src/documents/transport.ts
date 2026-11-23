import "server-only";
import type { paths } from "@vetx/api-client";
import { forwardMultipart, emptyResponse } from "../auth/file-proxy.ts";
export {
  attachmentResponse,
  privateHeaders,
  emptyResponse,
  safeWrite as validDocumentWrite,
} from "../auth/file-proxy.ts";

export const patientPath =
  "/organizations/{organizationId}/clinics/{clinicId}/patients/{patientId}";
export const documentsPath = `${patientPath}/documents` as const;
export const documentPath = `${documentsPath}/{documentId}` as const;
export type DocumentIds = paths[typeof documentPath]["put"]["parameters"]["path"];
export type PatientIds = paths[typeof documentsPath]["get"]["parameters"]["path"];

// The API accepts files up to 32 MiB. Allow room for the multipart headers and title.
const maxMultipartBytes = 32 * 1024 * 1024 + 64 * 1024;

export async function uploadDocument(
  request: Request,
  origin: string,
  token: string,
  ids: DocumentIds,
) {
  const { organizationId, clinicId, patientId, documentId } = ids;
  const url = new URL(
    `/organizations/${organizationId}/clinics/${clinicId}/patients/${patientId}/documents/${documentId}`,
    origin,
  );
  const upstream = await forwardMultipart(request, url, token, "PUT", maxMultipartBytes);
  await upstream.body?.cancel();
  return emptyResponse(upstream.ok ? 204 : upstream.status);
}
