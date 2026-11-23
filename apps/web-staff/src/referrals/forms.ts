import type { components } from "@vetx/api-client";
import { isDirectoryId } from "../directory/forms.ts";
import { registryPath, type ClinicScope } from "../patients/forms.ts";

export type Direction = "incoming" | "outgoing";
export function referralPath(
  ids: ClinicScope,
  patientId?: string,
  direction: Direction = "incoming",
  page = 1,
) {
  const path = patientId
    ? `${registryPath(ids)}/${patientId}/referrals`
    : `/organizations/${ids.organizationId}/clinics/${ids.clinicId}/referrals`;
  const query = new URLSearchParams();
  if (!patientId && direction === "outgoing") query.set("direction", direction);
  if (page > 1) query.set("page", String(page));
  return query.size ? path + "?" + query : path;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summaryText(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 8000 || /\p{Cc}/u.test(raw.replace(/[\t\r\n]/g, "")))
    return null;
  return raw.trim();
}

export function parseReferralRequest(
  raw: unknown,
): components["schemas"]["RequestReferralDto"] | null {
  if (
    !object(raw) ||
    !isDirectoryId(raw.guardianId) ||
    !object(raw.destination) ||
    !isDirectoryId(raw.destination.organizationId) ||
    !isDirectoryId(raw.destination.clinicId) ||
    typeof raw.reason !== "string" ||
    raw.reason.length > 250 ||
    !raw.reason.trim() ||
    /\p{Cc}/u.test(raw.reason)
  )
    return null;
  const summary = summaryText(raw.summary);
  if (summary === null) return null;
  return {
    guardianId: raw.guardianId,
    destination: {
      organizationId: raw.destination.organizationId,
      clinicId: raw.destination.clinicId,
    },
    reason: raw.reason.trim(),
    summary,
  };
}
export function parseCounterReferral(
  raw: unknown,
): components["schemas"]["CounterReferralDto"] | null {
  if (
    !object(raw) ||
    typeof raw.revision !== "number" ||
    !Number.isInteger(raw.revision) ||
    raw.revision < 1 ||
    raw.revision > 2147483647
  )
    return null;
  const summary = summaryText(raw.summary);
  return summary ? { revision: raw.revision, summary } : null;
}
