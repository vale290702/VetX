import { readStaffSession } from "../../../../../auth/account.ts";
import { emptyResponse, privateHeaders } from "../../../../../auth/file-proxy.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../directory/forms.ts";
import { receipts, returns, dispensings } from "../../../../../trade/api.ts";
import type { ClinicScope } from "../../../../../patients/forms.ts";
export async function GET(request: Request, { params }: { params: Promise<ClinicScope> }) {
  const scope = await params,
    q = new URL(request.url).searchParams,
    kind = q.get("kind"),
    id = q.get("id"),
    patient = q.get("patientId"),
    page = readDirectoryPage(q.get("page"));
  if (!Object.values(scope).every(isDirectoryId) || !isDirectoryId(id)) return emptyResponse(400);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  const r =
    kind === "receipts"
      ? await receipts(access, scope, id, page)
      : kind === "returns"
        ? await returns(access, scope, id, page)
        : kind === "dispensings" && isDirectoryId(patient)
          ? await dispensings(access, scope, patient, id, page)
          : null;
  return !r
    ? emptyResponse(400)
    : r.data
      ? Response.json(r.data, { headers: privateHeaders })
      : emptyResponse(r.error);
}
