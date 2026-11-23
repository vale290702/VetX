import { readStaffSession } from "../../../../../../auth/account.ts";
import { emptyResponse, safeWrite, smallJson } from "../../../../../../auth/file-proxy.ts";
import { isDirectoryId } from "../../../../../../directory/forms.ts";
import { saveTrade } from "../../../../../../trade/api.ts";
import { parseTrade } from "../../../../../../trade/forms.ts";
import type { ClinicScope } from "../../../../../../patients/forms.ts";
export async function POST(
  request: Request,
  { params }: { params: Promise<ClinicScope & { action: string; id: string }> },
) {
  const { organizationId, clinicId, action, id } = await params;
  if (![organizationId, clinicId, id].every(isDirectoryId)) return emptyResponse(400);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  if (!safeWrite(request, access.config.webOrigin, access.session.csrf)) return emptyResponse(403);
  const change = parseTrade(action, await smallJson(request, 96 * 1024));
  if (!change) return emptyResponse(400);
  try {
    const status = await saveTrade(access, { organizationId, clinicId }, id, change);
    return emptyResponse(status === 200 ? 204 : status);
  } catch {
    return emptyResponse(503);
  }
}
