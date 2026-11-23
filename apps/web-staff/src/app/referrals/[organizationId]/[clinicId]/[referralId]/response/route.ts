import { emptyResponse } from "../../../../../../auth/file-proxy.ts";
import {
  respondReferral,
  staffReferralAccess,
  readReferralBody,
} from "../../../../../../referrals/api.ts";
import { parseCounterReferral } from "../../../../../../referrals/forms.ts";
import type { ClinicScope } from "../../../../../../patients/forms.ts";
export async function POST(
  request: Request,
  { params }: { params: Promise<ClinicScope & { referralId: string }> },
) {
  const ids = await params,
    access = await staffReferralAccess(request, ids);
  if (access instanceof Response) return access;
  const body = parseCounterReferral(await readReferralBody(request));
  if (!body) return emptyResponse(400);
  try {
    const { response } = await respondReferral(access, ids, body);
    return emptyResponse(response.ok ? 204 : response.status);
  } catch {
    return emptyResponse(503);
  }
}
