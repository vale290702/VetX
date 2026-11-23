import type { components } from "@vetx/api-client";
import {
  isWorkflow,
  workflowFields,
  workflowData,
  workflowInputs,
  type WorkflowAction,
  type WorkflowData,
  type WorkflowStatus,
} from "./workflows.ts";
import { resolveLocalInstant } from "../care/time.ts";
import { isDirectoryId } from "../directory/forms.ts";

export const kinds = [
  "diagnosis",
  "treatment",
  "vaccination",
  "lab",
  "hospitalization",
  "surgery",
] as const;
export type Kind = (typeof kinds)[number];
export type Edit = "new" | "correct" | "result" | "review" | WorkflowAction;
const fields = {
  ...workflowFields,
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
    Omit<Schema["LabDataDto"], "status"> &
    WorkflowData
> & { status?: Schema["LabDataDto"]["status"] | WorkflowStatus };
export const limits: Record<Field, number> = {
  ward: 120,
  location: 120,
  note: 8000,
  summary: 8000,
  procedure: 250,
  scheduledAt: 40,
  performedProcedure: 250,
  recoveryNotes: 8000,
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
export function chartFields(kind: Kind): readonly Field[] {
  return fields[kind];
}
export function recordFields(kind: Kind, edit: Edit, currentStatus?: string): readonly Field[] {
  if (isWorkflow(kind)) return workflowInputs(kind, edit, currentStatus);
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
    current && (edit === "review" || edit === "amend")
      ? current.occurredAt
      : resolveLocalInstant(entry, zone, current?.occurredAt);
  if (!occurredAt) return null;
  const base = {
    kind,
    encounterId,
    revision: current?.revision ?? 0,
    occurredAt,
    ...(current ? { changeReason } : {}),
  };
  if (isWorkflow(kind)) {
    if (current && Date.parse(occurredAt) < Date.parse(current.occurredAt)) return null;
    const data = workflowData(kind, edit, form, zone, current);
    return data ? { ...base, data } : null;
  }
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
