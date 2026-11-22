import { isDirectoryId } from "../directory/forms.ts";

export type ClinicScope = { organizationId: string; clinicId: string };
type ListQuery = { page?: number; search?: string };
export const patientNotices = [
  "saved",
  "invalid",
  "conflict",
  "denied",
  "missing",
  "writeUnavailable",
] as const;
export type PatientNotice = (typeof patientNotices)[number];

export function registryPath({ organizationId, clinicId }: ClinicScope, query: ListQuery = {}) {
  const path = `/organizations/${organizationId}/clinics/${clinicId}/patients`;
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  return params.size ? `${path}?${params}` : path;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function textField(form: FormData, key: string, max: number) {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length && trimmed.length <= max ? trimmed : null;
}

function validBirthDate(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) || value > today()) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parsePatientChange(form: FormData) {
  const action = form.get("action");
  const patientId = form.get("patientId");
  if (!isDirectoryId(patientId)) return null;
  if (action === "patient") {
    const revision = form.get("revision");
    const name = textField(form, "name", 120);
    const species = textField(form, "species", 80);
    const birthDate = form.get("birthDate");
    if (
      !name ||
      !species ||
      typeof revision !== "string" ||
      !/^(0|[1-9]\d*)$/.test(revision) ||
      Number(revision) > 2_147_483_647 ||
      typeof birthDate !== "string" ||
      (birthDate && !validBirthDate(birthDate))
    )
      return null;
    return {
      action,
      patientId,
      body: { name, species, birthDate: birthDate || null, revision: Number(revision) },
    } as const;
  }
  const guardianId = form.get("guardianId");
  if (!isDirectoryId(guardianId)) return null;
  if (action === "revoke") return { action, patientId, guardianId } as const;
  if (action === "invite") {
    const requestId = form.get("requestId");
    return isDirectoryId(requestId)
      ? ({ action, patientId, guardianId, requestId } as const)
      : null;
  }
  const name = textField(form, "name", 120);
  const email = textField(form, "email", 254);
  if (action !== "guardian" || !name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return null;
  return { action, patientId, guardianId, body: { name, email } } as const;
}

export function noticeForStatus(status: number): Exclude<PatientNotice, "saved"> {
  switch (status) {
    case 400:
      return "invalid";
    case 401:
    case 403:
      return "denied";
    case 404:
      return "missing";
    case 409:
      return "conflict";
    default:
      return "writeUnavailable";
  }
}
