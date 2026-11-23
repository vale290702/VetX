import type { components } from "@vetx/api-client";
import { resolveLocalInstant } from "../care/time.ts";

type Schema = components["schemas"];
type Stay = Schema["HospitalizationDataDto"];
type Surgery = Schema["SurgeryDataDto"];
export type WorkflowStatus = Stay["status"] | Surgery["status"];
export type WorkflowKind = "hospitalization" | "surgery";
export type WorkflowData = Partial<Omit<Stay, "status"> & Omit<Surgery, "status">>;
export const workflowFields = {
  hospitalization: ["ward", "location", "note", "summary"],
  surgery: ["procedure", "scheduledAt", "notes", "performedProcedure", "recoveryNotes", "summary"],
} as const;
export type WorkflowField = (typeof workflowFields)[WorkflowKind][number];
export type WorkflowAction =
  | "progress"
  | "discharge"
  | "reschedule"
  | "startSurgery"
  | "completeSurgery"
  | "cancelSurgery"
  | "amend";
type Current = { data: WorkflowData & { status?: string } };
export function isWorkflow(kind: string): kind is WorkflowKind {
  return kind === "hospitalization" || kind === "surgery";
}
export function terminalStatus(status?: string) {
  return status === "DISCHARGED" || status === "COMPLETED" || status === "CANCELLED";
}
export function workflowActions(kind: WorkflowKind, status?: string): readonly WorkflowAction[] {
  if (kind === "hospitalization") {
    if (status === "ADMITTED" || status === "PROGRESS") return ["progress", "discharge"];
    return status === "DISCHARGED" ? ["amend"] : [];
  }
  if (status === "PLANNED") return ["reschedule", "startSurgery", "cancelSurgery"];
  if (status === "IN_PROGRESS") return ["completeSurgery", "cancelSurgery"];
  return status === "CANCELLED" || status === "COMPLETED" ? ["amend"] : [];
}
export function workflowInputs(
  kind: WorkflowKind,
  action: string,
  currentStatus?: string,
): readonly WorkflowField[] {
  if (kind === "hospitalization")
    return action === "discharge" || action === "amend"
      ? workflowFields.hospitalization
      : ["ward", "location", "note"];
  if (action === "new" || action === "reschedule") return ["procedure", "scheduledAt", "notes"];
  if (action === "completeSurgery" || (action === "amend" && currentStatus === "COMPLETED"))
    return ["notes", "performedProcedure", "recoveryNotes", "summary"];
  if (action === "cancelSurgery" || action === "amend") return ["notes", "summary"];
  return ["notes"];
}
function text(form: FormData, key: WorkflowField) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}
export function workflowData(
  kind: WorkflowKind,
  action: string,
  form: FormData,
  zone: string,
  current?: Current,
): Stay | Surgery | null {
  if (current && !workflowActions(kind, current.data.status).some((a) => a === action)) return null;
  if (!current && action !== "new") return null;
  const summary = text(form, "summary");
  if (kind === "hospitalization") {
    const ward = text(form, "ward"),
      location = text(form, "location"),
      note = text(form, "note");
    if (!ward || !note) return null;
    const data = { ward, ...(location ? { location } : {}), note };
    if (action === "discharge" || action === "amend")
      return summary ? { ...data, status: "DISCHARGED", summary } : null;
    return { ...data, status: current ? "PROGRESS" : "ADMITTED" };
  }
  const editablePlan = action === "new" || action === "reschedule";
  const procedure = editablePlan ? text(form, "procedure") : current?.data.procedure;
  const scheduledAt = editablePlan
    ? resolveLocalInstant(form.get("scheduledAt"), zone, current?.data.scheduledAt)
    : current?.data.scheduledAt;
  if (!procedure || !scheduledAt) return null;
  const notes = text(form, "notes");
  const data = { procedure, scheduledAt, ...(notes ? { notes } : {}) };
  if (editablePlan) return { ...data, status: "PLANNED" };
  if (action === "startSurgery") return { ...data, status: "IN_PROGRESS" };
  if (!summary) return null;
  if (action === "cancelSurgery" || current?.data.status === "CANCELLED")
    return { ...data, status: "CANCELLED", summary };
  const performedProcedure = text(form, "performedProcedure"),
    recoveryNotes = text(form, "recoveryNotes");
  return performedProcedure && recoveryNotes
    ? { ...data, status: "COMPLETED", performedProcedure, recoveryNotes, summary }
    : null;
}
