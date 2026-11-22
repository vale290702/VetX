import { isDirectoryId } from "../directory/forms.ts";
import { registryPath, type ClinicScope } from "../patients/forms.ts";
import { localInput, localInstant, zoneOptions } from "./time.ts";

export const sections = ["subjective", "objective", "assessment", "plan"] as const;
export const careNotices = [
  "saved",
  "invalid",
  "overlap",
  "conflict",
  "denied",
  "missing",
  "unavailable",
] as const;
export type CareNotice = (typeof careNotices)[number];

export function carePath(
  scope: ClinicScope,
  patientId?: string,
  query: { timeZone?: string; day?: string; page?: number } = {},
) {
  const base = patientId
    ? registryPath(scope) + "/" + patientId
    : `/organizations/${scope.organizationId}/clinics/${scope.clinicId}/appointments`;
  const params = new URLSearchParams();
  if (query.timeZone) params.set("timeZone", query.timeZone);
  if (query.day && !patientId) params.set("day", query.day);
  if (query.page && query.page > 1)
    params.set(patientId ? "historyPage" : "page", String(query.page));
  return params.size ? base + "?" + params : base;
}

function text(form: FormData, key: string, max: number) {
  const value = form.get(key);
  return typeof value === "string" && value.trim().length <= max ? value.trim() : null;
}

function revisionNumber(form: FormData) {
  const raw = form.get("revision");
  return typeof raw === "string" && /^(0|[1-9]\d*)$/.test(raw) && Number(raw) <= 2147483647
    ? Number(raw)
    : null;
}

export type OriginalAppointment = {
  id: string;
  patientId: string;
  revision: number;
  startAt: string;
  endAt: string;
  reason: string;
};

export function sharingOptions<T extends { id: string; linked: boolean }>(
  guardians: readonly T[],
  recipients: readonly string[],
) {
  const linked = guardians.filter((guardian) => guardian.linked);
  return recipients.every((id) => linked.some((guardian) => guardian.id === id)) ? linked : null;
}

export function parseCareChange(form: FormData, original?: OriginalAppointment) {
  const action = form.get("action"),
    patientId = form.get("patientId");
  if (!isDirectoryId(patientId)) return null;
  const encounterId = form.get("encounterId");
  if (action === "sharing") {
    const guardianIds = form.getAll("guardianIds"),
      revision = revisionNumber(form);
    if (!isDirectoryId(encounterId) || !guardianIds.every(isDirectoryId) || revision === null)
      return null;
    return { action, patientId, encounterId, body: { guardianIds, revision } } as const;
  }
  const zone = form.get("timeZone"),
    reason =
      action === "cancel" || action === "complete" ? original?.reason : text(form, "reason", 250);
  if (typeof zone !== "string" || !zoneOptions.includes(zone) || !reason) return null;
  if (action === "encounter") {
    const occurredAt = localInstant(form.get("occurredAt"), zone);
    const addendumTo = form.get("addendumTo") || null;
    const [subjective, objective, assessment, plan] = sections.map((key) => text(form, key, 8000));
    if (
      !isDirectoryId(encounterId) ||
      !occurredAt ||
      (addendumTo !== null && !isDirectoryId(addendumTo)) ||
      subjective == null ||
      objective == null ||
      assessment == null ||
      plan == null ||
      !(subjective || objective || assessment || plan)
    )
      return null;
    return {
      action,
      patientId,
      encounterId,
      body: { occurredAt, reason, subjective, objective, assessment, plan, addendumTo },
    } as const;
  }
  const appointmentId = form.get("appointmentId"),
    revision = revisionNumber(form);
  if (
    !isDirectoryId(appointmentId) ||
    revision === null ||
    (action !== "book" && action !== "cancel" && action !== "complete")
  )
    return null;
  if (original) {
    if (
      original.id !== appointmentId ||
      original.patientId !== patientId ||
      original.revision !== revision
    )
      return null;
  } else if (revision !== 0 || action !== "book") return null;
  const time = (key: "startAt" | "endAt") => {
    const input = form.get(key);
    if (original && (action !== "book" || input === localInput(original[key], zone, true)))
      return original[key];
    return localInstant(input, zone);
  };
  const startAt = time("startAt"),
    endAt = time("endAt");
  if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) return null;
  const status = action === "book" ? "BOOKED" : action === "cancel" ? "CANCELLED" : "COMPLETED";
  return {
    action,
    patientId,
    appointmentId,
    body: { patientId, startAt, endAt, reason, status, revision },
  } as const;
}
