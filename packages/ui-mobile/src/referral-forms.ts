import type { components } from "@vetx/api-client";

export type Referral = components["schemas"]["ReferralDto"];
export type ReferralPage = components["schemas"]["ReferralPageDto"];
export type Destination = components["schemas"]["ReferralDestinationDto"];
export type RequestInput = components["schemas"]["RequestReferralDto"];
export type Decision = components["schemas"]["ReferralDecisionDto"];
export type CounterReferral = components["schemas"]["CounterReferralDto"];

function cleanSummary(value: string) {
  return value.length <= 8000 && !/\p{Cc}/u.test(value.replace(/[\t\r\n]/g, ""));
}
type State = Pick<Referral, "status" | "revision">;
export function requestInput(
  routes: Destination[],
  guardians: { id: string; linked: boolean }[],
  dest: Destination | undefined,
  guardianId: string | undefined,
  reason: string,
  summary: string,
): RequestInput | undefined {
  const title = reason.trim(),
    note = summary.trim();
  if (
    !dest ||
    !guardianId ||
    !guardians.some((g) => g.id === guardianId && g.linked) ||
    !routes.some((d) => d.clinicId === dest.clinicId && d.organizationId === dest.organizationId)
  )
    return undefined;
  if (!title || title.length > 250 || /\p{Cc}/u.test(title) || !cleanSummary(note))
    return undefined;
  return {
    destination: { organizationId: dest.organizationId, clinicId: dest.clinicId },
    guardianId,
    reason: title,
    summary: note,
  };
}
export function decisionInput(
  { status, revision }: State,
  action: Decision["action"],
): Decision | undefined {
  const allowed =
    action === "withdraw"
      ? status === "APPROVED" || status === "RESPONDED"
      : status === "REQUESTED";
  return allowed ? { action, revision } : undefined;
}
export function responseInput(
  { status, revision }: State,
  summary: string,
): CounterReferral | undefined {
  const note = summary.trim();
  return status === "APPROVED" && note && cleanSummary(note)
    ? { summary: note, revision }
    : undefined;
}
function fold(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}
export function recipientMatches(d: Destination, query: string) {
  return fold(d.name).includes(fold(query));
}
export function referralMatches(r: Referral, query: string) {
  const q = fold(query);
  return [
    r.reason,
    r.patient.name,
    r.patient.species,
    r.source.organizationName,
    r.source.clinicName,
    r.destination.organizationName,
    r.destination.clinicName,
  ].some((value) => fold(value).includes(q));
}
