import { readStaffSession } from "../../../../../../auth/account.ts";
import { emptyResponse, safeWrite, smallJson } from "../../../../../../auth/file-proxy.ts";
import { isDirectoryId } from "../../../../../../directory/forms.ts";
import { saveInventory } from "../../../../../../inventory/api.ts";
import type { ClinicScope } from "../../../../../../patients/forms.ts";
export async function POST(
  request: Request,
  { params }: { params: Promise<ClinicScope & { resource: string; id: string }> },
) {
  const { organizationId, clinicId, resource, id } = await params;
  if (![organizationId, clinicId, id].every(isDirectoryId)) return emptyResponse(400);
  if (!["items", "warehouses", "movements"].includes(resource)) return emptyResponse(404);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  if (!safeWrite(request, access.config.webOrigin, access.session.csrf)) return emptyResponse(403);
  try {
    const status = await saveInventory(
      access,
      { organizationId, clinicId },
      resource,
      id,
      await smallJson(request),
    );
    return emptyResponse(status === 200 ? 204 : status);
  } catch {
    return emptyResponse(503);
  }
}
