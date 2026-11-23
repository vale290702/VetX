import { readStaffSession } from "../../../../../auth/account.ts";
import { emptyResponse, privateHeaders } from "../../../../../auth/file-proxy.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../directory/forms.ts";
import { warehouses } from "../../../../../inventory/api.ts";
import type { ClinicScope } from "../../../../../patients/forms.ts";
export async function GET(request: Request, { params }: { params: Promise<ClinicScope> }) {
  const scope = await params;
  if (![scope.organizationId, scope.clinicId].every(isDirectoryId)) return emptyResponse(400);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  const result = await warehouses(
    access,
    scope,
    readDirectoryPage(new URL(request.url).searchParams.get("page")),
  );
  return result.data
    ? Response.json(result.data, { headers: privateHeaders })
    : emptyResponse(result.error);
}
