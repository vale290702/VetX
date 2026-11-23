import { emptyResponse } from "../../../../../../../auth/file-proxy.ts";
import {
  requestReferral,
  staffReferralAccess,
  readReferralBody,
} from "../../../../../../../referrals/api.ts";
import { parseReferralRequest } from "../../../../../../../referrals/forms.ts";
import type { ClinicScope } from "../../../../../../../patients/forms.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<ClinicScope & { patientId: string; requestId: string }> },
) {
  const ids = await params,
    access = await staffReferralAccess(request, ids);
  if (access instanceof Response) return access;
  const body = parseReferralRequest(await readReferralBody(request));
  if (!body) return emptyResponse(400);
  try {
    const { response } = await requestReferral(access, ids, body);
    return emptyResponse(response.ok ? 204 : response.status);
  } catch {
    return emptyResponse(503);
  }
}
