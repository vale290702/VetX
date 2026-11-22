import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClinicScope } from "../patients/forms.ts";
import type { OriginalAppointment } from "./forms.ts";

function signature(encoded: string, scope: ClinicScope, csrf: string, secret: string) {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify(["vetx.appointment.v1", scope.organizationId, scope.clinicId, csrf, encoded]),
    )
    .digest();
}
// Replaying the viewed revision must also work after the appointment moves off its original day.
export function signAppointment(
  appointment: OriginalAppointment,
  scope: ClinicScope,
  csrf: string,
  secret: string,
) {
  const { id, patientId, revision, startAt, endAt, reason } = appointment;
  const encoded = Buffer.from(
    JSON.stringify({ id, patientId, revision, startAt, endAt, reason }),
  ).toString("base64url");
  return encoded + "." + signature(encoded, scope, csrf, secret).toString("base64url");
}
export function verifyAppointment(
  value: FormDataEntryValue | null,
  scope: ClinicScope,
  csrf: string,
  secret: string,
): OriginalAppointment | undefined {
  if (typeof value !== "string" || value.length > 8192) return undefined;
  const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!parts?.[1] || !parts[2]) return undefined;
  const expected = signature(parts[1], scope, csrf, secret).toString("base64url");
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return undefined;
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as OriginalAppointment;
}
