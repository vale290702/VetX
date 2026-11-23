import { staffRequestOptions } from "../../../../../../../auth/account.ts";
import { emptyResponse, smallJson } from "../../../../../../../auth/file-proxy.ts";
import { isDirectoryId } from "../../../../../../../directory/forms.ts";
import { exchangeAccess } from "../../../../../../../exchange/api.ts";
import type { PatientScope } from "../../../../../../../clinical/api.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<PatientScope & { recordId: string; operation: string }> },
) {
  const { operation, ...ids } = await params;
  if (operation !== "sharing" && !isDirectoryId(operation)) return emptyResponse(400);
  const access = await exchangeAccess(request, ids);
  if (access instanceof Response) return access;
  const body = await smallJson(request, 100_000);
  if (!body || typeof body !== "object" || Array.isArray(body)) return emptyResponse(400);
  const { organizationId, clinicId, patientId, recordId } = ids;
  const path =
    `/organizations/${organizationId}/clinics/${clinicId}/patients/${patientId}/clinical-records/${recordId}/` +
    (operation === "sharing" ? "sharing" : "revisions/" + operation);
  try {
    const options = staffRequestOptions(access.session.accessToken);
    const result = await fetch(new URL(path, access.config.apiOrigin), {
      ...options,
      method: "PUT",
      headers: { ...options.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return emptyResponse(result.ok ? 204 : result.status);
  } catch {
    return emptyResponse(503);
  }
}
