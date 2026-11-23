import "server-only";
import { isSameOriginPost, secretsMatch } from "./security.ts";

export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
export function emptyResponse(status: number) {
  return new Response(null, { status, headers: privateHeaders });
}

export function safeWrite(request: Request, origin: URL, csrf: string) {
  return (
    isSameOriginPost(request, origin) && secretsMatch(csrf, request.headers.get("X-VetX-CSRF"))
  );
}

function limitedBody(body: ReadableStream<Uint8Array>, limit: number) {
  let size = 0;
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > limit) throw new RangeError("Request exceeds byte limit");
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream, tooLarge: () => size > limit };
}

export async function smallJson(request: Request, maxBytes = 4096) {
  if (!request.body || request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return null;
  try {
    return (await new Response(limitedBody(request.body, maxBytes).stream).json()) as unknown;
  } catch {
    return null;
  }
}

export async function forwardMultipart(
  request: Request,
  url: URL,
  token: string,
  method: "POST" | "PUT",
  maxBytes: number,
) {
  const type = request.headers.get("content-type");
  if (!type || !/^multipart\/form-data\s*;\s*boundary=/i.test(type)) return emptyResponse(415);
  if (Number(request.headers.get("content-length")) > maxBytes) return emptyResponse(413);
  if (!request.body) return emptyResponse(400);
  const { stream, tooLarge } = limitedBody(request.body, maxBytes);
  try {
    const init: RequestInit & { duplex: "half" } = {
      method,
      body: stream,
      duplex: "half",
      cache: "no-store",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": type },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    };
    return await fetch(url, init);
  } catch {
    return emptyResponse(tooLarge() ? 413 : 503);
  }
}

export function attachmentResponse(upstream: Response) {
  const headers = new Headers(privateHeaders);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Type", "application/octet-stream");
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
