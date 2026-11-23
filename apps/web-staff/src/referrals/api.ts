import "server-only";
import { createVetxClient, type components } from "@vetx/api-client";
import { readStaffSession, staffRequestOptions } from "../auth/account.ts";
import { emptyResponse, safeWrite, smallJson } from "../auth/file-proxy.ts";
import { isDirectoryId } from "../directory/forms.ts";
import type { ClinicScope } from "../patients/forms.ts";
import type { Direction } from "./forms.ts";

const clinicPath = "/organizations/{organizationId}/clinics/{clinicId}";
const queue = `${clinicPath}/referrals` as const;
const patient = `${clinicPath}/patients/{patientId}` as const;
type StaffAccess = Extract<Awaited<ReturnType<typeof readStaffSession>>, { kind: "active" }>;
type PatientScope = ClinicScope & { patientId: string };

export async function staffReferralAccess(request: Request, ids: ClinicScope) {
  if (!Object.values(ids).every(isDirectoryId)) return emptyResponse(400);
  const access = await readStaffSession();
  if (access.kind !== "active") return emptyResponse(access.kind === "anonymous" ? 401 : 503);
  if (!safeWrite(request, access.config.webOrigin, access.session.csrf)) return emptyResponse(403);
  return access;
}

type ReadResult<T> = { data: T; error?: never } | { error: number; data?: never };
async function call<T>(result: Promise<{ data?: T; response: Response }>): Promise<ReadResult<T>> {
  try {
    const { data, response } = await result;
    return data === undefined ? { error: response.status } : { data };
  } catch {
    return { error: 503 };
  }
}

export function referralList(
  access: StaffAccess,
  scope: ClinicScope,
  direction: Direction,
  page: number,
  patientId?: string,
) {
  return call(
    createVetxClient(access.config.apiOrigin).GET(queue, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: scope, query: { direction, page, patientId } },
    }),
  );
}
export function destinationList(access: StaffAccess, scope: ClinicScope) {
  return call(
    createVetxClient(access.config.apiOrigin).GET(`${queue}/destinations`, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: scope },
    }),
  );
}
export function patientInfo(access: StaffAccess, scope: PatientScope) {
  return call(
    createVetxClient(access.config.apiOrigin).GET(patient, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: scope },
    }),
  );
}
export function clinics(access: StaffAccess, organizationId: string) {
  return call(
    createVetxClient(access.config.apiOrigin).GET("/organizations/{organizationId}/clinics", {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: { organizationId } },
    }),
  );
}
export function requestReferral(
  access: StaffAccess,
  path: PatientScope & { requestId: string },
  body: components["schemas"]["RequestReferralDto"],
) {
  return createVetxClient(access.config.apiOrigin).PUT(`${patient}/referrals/{requestId}`, {
    ...staffRequestOptions(access.session.accessToken),
    params: { path },
    body,
  });
}
export function respondReferral(
  access: StaffAccess,
  path: ClinicScope & { referralId: string },
  body: components["schemas"]["CounterReferralDto"],
) {
  return createVetxClient(access.config.apiOrigin).PUT(`${queue}/{referralId}/response`, {
    ...staffRequestOptions(access.session.accessToken),
    params: { path },
    body,
  });
}

export function readReferralBody(request: Request) {
  return smallJson(request, 64 * 1024);
}
