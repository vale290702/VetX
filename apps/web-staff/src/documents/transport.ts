import "server-only";
import type { paths } from "@vetx/api-client";
import { isSameOriginPost, secretsMatch } from "../auth/security.ts";

export const patientPath =
  "/organizations/{organizationId}/clinics/{clinicId}/patients/{patientId}";
export const documentsPath = `${patientPath}/documents` as const;
export const documentPath = `${documentsPath}/{documentId}` as const;
export type DocumentIds = paths[typeof documentPath]["put"]["parameters"]["path"];
export type PatientIds = paths[typeof documentsPath]["get"]["parameters"]["path"];

export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

export function emptyResponse(status: number) {
  return new Response(null, { status, headers: privateHeaders });
}

export function validDocumentWrite(request: Request, origin: URL, csrf: string) {
  return (
    isSameOriginPost(request, origin) && secretsMatch(csrf, request.headers.get("X-VetX-CSRF"))
  );
}

// The API accepts files up to 32 MiB. Allow room for the multipart headers and title.
const maxMultipartBytes = 32 * 1024 * 1024 + 64 * 1024;

export async function uploadDocument(
  request: Request,
  origin: string,
  token: string,
  ids: DocumentIds,
) {
  const type = request.headers.get("content-type");
  if (!type || !/^multipart\/form-data\s*;\s*boundary=/i.test(type)) return emptyResponse(415);
  if (Number(request.headers.get("content-length")) > maxMultipartBytes) return emptyResponse(413);
  if (!request.body) return emptyResponse(400);
  let size = 0;
  const body = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maxMultipartBytes) throw new RangeError("Multipart size exceeded");
        controller.enqueue(chunk);
      },
    }),
  );
  const { organizationId, clinicId, patientId, documentId } = ids;
  const url = new URL(
    `/organizations/${organizationId}/clinics/${clinicId}/patients/${patientId}/documents/${documentId}`,
    origin,
  );
  try {
    const options: RequestInit & { duplex: "half" } = {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": type },
      body,
      duplex: "half",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    };
    const upstream = await fetch(url, options);
    // Upload metadata is fetched from the authorized listing after success.
    await upstream.body?.cancel();
    return emptyResponse(upstream.ok ? 204 : upstream.status);
  } catch {
    return emptyResponse(size > maxMultipartBytes ? 413 : 503);
  }
}

export function attachmentResponse(upstream: Response) {
  const headers = new Headers(privateHeaders);
  headers.set("Content-Type", "application/octet-stream");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  const disposition = upstream.headers.get("content-disposition");
  headers.set(
    "Content-Disposition",
    disposition && /^attachment(?:;|$)/i.test(disposition) ? disposition : "attachment",
  );
  const length = upstream.headers.get("content-length");
  if (length && /^\d+$/.test(length)) headers.set("Content-Length", length);
  return new Response(upstream.body, { headers });
}
