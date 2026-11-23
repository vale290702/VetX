import { isDirectoryId } from "../directory/forms.ts";
import type { ClinicScope } from "../patients/forms.ts";
export const fileKinds = ["document", "radiograph", "dicom"];
export function visibleRecordFields(data: Record<string, unknown>) {
  return Object.entries(data).filter(([key, v]) => key !== "content" && v !== null && v !== "");
}
export function parseCommitChoice(input: unknown) {
  if (!input || typeof input !== "object" || !("mode" in input)) return null;
  if (input.mode === "create" && !("patientId" in input)) return { mode: "create" } as const;
  if (input.mode === "match" && "patientId" in input && isDirectoryId(input.patientId))
    return { mode: "match", patientId: input.patientId } as const;
  return null;
}
export function readSearch(input: unknown) {
  if (
    !input ||
    typeof input !== "object" ||
    !("search" in input) ||
    typeof input.search !== "string" ||
    !("page" in input)
  )
    return null;
  const search = input.search.trim(),
    page = input.page;
  return search &&
    search.length <= 120 &&
    typeof page === "number" &&
    Number.isInteger(page) &&
    page >= 1 &&
    page <= 2147483647
    ? { search, page }
    : null;
}
export function importPath({ organizationId, clinicId }: ClinicScope) {
  return `/organizations/${organizationId}/clinics/${clinicId}/exchange/import`;
}
