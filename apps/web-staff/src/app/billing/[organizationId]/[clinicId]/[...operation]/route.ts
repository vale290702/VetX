import { readStaffSession } from "../../../../../auth/account.ts";
import {
  attachmentResponse,
  emptyResponse,
  privateHeaders,
  safeWrite,
  smallJson,
} from "../../../../../auth/file-proxy.ts";
import { isDirectoryId } from "../../../../../directory/forms.ts";
import { billingTarget } from "../../../../../billing/model.ts";
import { billingRequest } from "../../../../../billing/server.ts";
import type { ClinicScope } from "../../../../../patients/forms.ts";

async function handle(
  request: Request,
  { params }: { params: Promise<ClinicScope & { operation: string[] }> },
) {
  const { organizationId, clinicId, operation } = await params;
  if (![organizationId, clinicId].every(isDirectoryId)) return emptyResponse(400);
  const path = billingTarget(request.method, operation, new URL(request.url).searchParams);
  if (!path) return emptyResponse(404);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  let body;
  if (request.method === "POST") {
    if (!safeWrite(request, access.config.webOrigin, access.session.csrf))
      return emptyResponse(403);
    body = await smallJson(
      request,
      operation[0] === "sales" &&
        (operation.length === 2 || (operation[2] === "fiscal" && operation.length === 4))
        ? 768 * 1024
        : 4096,
    );
    if (!body || typeof body !== "object" || Array.isArray(body)) return emptyResponse(400);
  }
  const result = await billingRequest(access, { organizationId, clinicId }, path, body);
  if (!result.ok || request.method === "POST") {
    await result.body?.cancel();
    return emptyResponse(result.ok ? 204 : result.status);
  }
  if (operation[2] === "fiscal" && operation[4] === "artifacts") {
    const attachment = attachmentResponse(result);
    attachment.headers.set("Content-Type", "application/xml");
    return attachment;
  }
  return new Response(result.body, {
    status: 200,
    headers: {
      ...privateHeaders,
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export { handle as GET, handle as POST };
