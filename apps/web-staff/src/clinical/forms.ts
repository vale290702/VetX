import type { components } from "@vetx/api-client";
import { Temporal } from "@js-temporal/polyfill";
import { localInput, localInstant } from "../care/time.ts";
import { isDirectoryId } from "../directory/forms.ts";

export const kinds = ["diagnosis", "treatment", "vaccination", "lab"] as const;
export type Kind = (typeof kinds)[number];
export type Edit = "new" | "correct" | "result" | "review";
const fields = {
  diagnosis: ["diagnosis", "code"],
  treatment: ["treatment", "notes"],
  vaccination: ["vaccine", "lotNumber", "nextDueDate"],
  lab: ["test", "specimen", "result", "unit", "referenceRange"],
} as const;
export type Field = (typeof fields)[Kind][number];
type Schema = components["schemas"];
export type ClinicalData = Partial<
  Schema["DiagnosisDataDto"] &
    Schema["TreatmentDataDto"] &
    Schema["VaccinationDataDto"] &
    Schema["LabDataDto"]
>;
export const limits: Record<Field, number> = {
  diagnosis: 8000,
  treatment: 8000,
  notes: 8000,
  result: 8000,
  code: 128,
  unit: 128,
  lotNumber: 128,
  vaccine: 250,
  test: 250,
  specimen: 250,
  referenceRange: 250,
  nextDueDate: 10,
};
export function recordFields(kind: Kind, edit: Edit): readonly Field[] {
  if (kind !== "lab" || edit === "review") return fields[kind];
  return edit === "result" ? ["result", "unit", "referenceRange"] : ["test", "specimen"];
}
export type RevisionSource = {
  encounterId: string;
  occurredAt: string;
  kind: Kind;
  revision: number;
  data: ClinicalData;
};
function unchangedTime(entry: FormDataEntryValue | null, current: RevisionSource, zone: string) {
  if (typeof entry !== "string") return false;
  try {
    return Temporal.PlainDateTime.from(entry).equals(localInput(current.occurredAt, zone, true));
  } catch {
    return false;
  }
}
export function buildRevision(
  kind: Kind,
  edit: Edit,
  form: FormData,
  zone: string,
  current?: RevisionSource,
): Schema["ClinicalWriteDto"] | null {
  const encounterId = current?.encounterId ?? form.get("encounterId");
  if (
    !isDirectoryId(encounterId) ||
    (edit === "new") !== !current ||
    (current && current.kind !== kind)
  )
    return null;
  const changeReason = String(form.get("changeReason") ?? "").trim();
  if (current && !changeReason) return null;
  const entry = form.get("occurredAt");
  const occurredAt =
    current && (edit === "review" || unchangedTime(entry, current, zone))
      ? current.occurredAt
      : localInstant(entry, zone);
  if (!occurredAt) return null;
  const base = {
    kind,
    encounterId,
    revision: current?.revision ?? 0,
    occurredAt,
    ...(current ? { changeReason } : {}),
  };
  if (edit === "review") {
    if (
      kind !== "lab" ||
      current?.data.status !== "RESULTED" ||
      !current.data.test ||
      !current.data.result
    )
      return null;
    return { ...base, data: { ...current.data, test: current.data.test, status: "REVIEWED" } };
  }
  const data: ClinicalData = {};
  if (kind === "lab" && edit === "result") {
    if (!current?.data.test) return null;
    data.test = current.data.test;
    if (current.data.specimen !== undefined) data.specimen = current.data.specimen;
  }
  for (const key of recordFields(kind, edit)) {
    const raw = form.get(key);
    if (typeof raw === "string" && raw.trim()) data[key] = raw.trim();
  }
  switch (kind) {
    case "diagnosis":
      return data.diagnosis ? { ...base, data: { ...data, diagnosis: data.diagnosis } } : null;
    case "treatment":
      return data.treatment ? { ...base, data: { ...data, treatment: data.treatment } } : null;
    case "vaccination":
      return data.vaccine ? { ...base, data: { ...data, vaccine: data.vaccine } } : null;
    case "lab":
      return data.test && (edit !== "result" || data.result)
        ? {
            ...base,
            data: { ...data, test: data.test, status: edit === "result" ? "RESULTED" : "ORDERED" },
          }
        : null;
  }
}
type Pages = {
  page?: number;
  encounterPage?: number;
  historyPage?: number;
  recordId?: string;
  timeZone: string;
};
export function clinicalPath(patient: string, options: Pages) {
  const query = new URLSearchParams({ timeZone: options.timeZone });
  if ((options.page ?? 1) > 1) query.set("page", String(options.page));
  if ((options.encounterPage ?? 1) > 1) query.set("encounterPage", String(options.encounterPage));
  if (options.recordId) query.set("recordId", options.recordId);
  if (options.recordId && (options.historyPage ?? 1) > 1)
    query.set("historyPage", String(options.historyPage));
  return patient + "/clinical-records?" + query.toString();
}
