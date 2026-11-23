import { exchangeAccess } from "../../../../../exchange/api.ts";
import { forwardMultipart, privateHeaders, emptyResponse } from "../../../../../auth/file-proxy.ts";
import type { ClinicScope } from "../../../../../patients/forms.ts";

export async function POST(request: Request, { params }: { params: Promise<ClinicScope> }) {
  const ids = await params,
    access = await exchangeAccess(request, ids);
  if (access instanceof Response) return access;
  const { organizationId, clinicId } = ids;
  const url = new URL(
    `/organizations/${organizationId}/clinics/${clinicId}/exchange/imports/preview`,
    access.config.apiOrigin,
  );
  // Package size limit plus multipart headers. The API also enforces its configured limit.
  const response = await forwardMultipart(
    request,
    url,
    access.session.accessToken,
    "POST",
    64 * 1024 * 1024 + 64 * 1024,
  );
  if (!response.ok) {
    await response.body?.cancel();
    return emptyResponse(response.status);
  }
  return new Response(response.body, {
    headers: {
      ...privateHeaders,
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
