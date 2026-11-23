import { readStaffSession } from "../../../../../auth/account.ts";
import { emptyResponse, privateHeaders } from "../../../../../auth/file-proxy.ts";
import { isDirectoryId, readDirectoryPage } from "../../../../../directory/forms.ts";
import { options } from "../../../../../trade/api.ts";
import type { ClinicScope } from "../../../../../patients/forms.ts";
export async function GET(request: Request, { params }: { params: Promise<ClinicScope> }) {
  const scope = await params,
    q = new URL(request.url).searchParams,
    kind = q.get("kind");
  if (
    !Object.values(scope).every(isDirectoryId) ||
    (kind !== "items" && kind !== "warehouses" && kind !== "suppliers")
  )
    return emptyResponse(400);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  const r = await options(access, scope, kind, readDirectoryPage(q.get("page")));
  return r.data ? Response.json(r.data, { headers: privateHeaders }) : emptyResponse(r.error);
}
