import type { components } from "@vetx/api-client";
import { localMinute, minuteInstant } from "./care-time.ts";
import type {
  ClinicalField,
  Operation,
  ReleasedRecord,
  StaffRecord,
  Values,
} from "./clinical-record-forms.ts";

type S = components["schemas"];
type Ward = S["HospitalizationDataDto"];
type Surgery = S["SurgeryDataDto"];
export type EpisodeKind = "hospitalization" | "surgery";
export type EpisodeAction =
  "progress" | "discharge" | "reschedule" | "start" | "complete" | "cancel" | "amend";
export const isEpisode = (kind: string): kind is EpisodeKind =>
  kind === "hospitalization" || kind === "surgery";

export function episodeStatus(r: StaffRecord | ReleasedRecord) {
  if (!isEpisode(r.kind) || !("status" in r.data)) return;
  const s = r.data.status;
  if (r.kind === "hospitalization" && (s === "ADMITTED" || s === "PROGRESS")) return s;
  if (r.kind === "surgery" && (s === "PLANNED" || s === "IN_PROGRESS")) return s;
  return releasedEpisodeStatus(r.kind, s);
}
export function releasedEpisodeStatus(kind: string, status: unknown) {
  if (kind === "hospitalization" && status === "DISCHARGED") return status;
  if (kind === "surgery" && (status === "COMPLETED" || status === "CANCELLED")) return status;
}
export function episodeActions(r: StaffRecord): readonly EpisodeAction[] {
  switch (episodeStatus(r)) {
    case "ADMITTED":
    case "PROGRESS":
      return ["progress", "discharge"];
    case "PLANNED":
      return ["reschedule", "start", "cancel"];
    case "IN_PROGRESS":
      return ["complete", "cancel"];
    case "DISCHARGED":
    case "COMPLETED":
    case "CANCELLED":
      return ["amend"];
    default:
      return [];
  }
}
export const episodeFields = {
  hospitalization: ["ward", "location", "note", "summary"],
  surgery: ["procedure", "scheduledAt", "notes", "performedProcedure", "recoveryNotes", "summary"],
} as const;
export function editableEpisodeFields(
  kind: EpisodeKind,
  op: Operation | "show",
  current?: StaffRecord,
): readonly ClinicalField[] {
  if (op === "show") return episodeFields[kind];
  if (kind === "hospitalization")
    return op === "discharge" || op === "amend"
      ? episodeFields.hospitalization
      : ["ward", "location", "note"];
  if (op === "new" || op === "reschedule") return ["procedure", "scheduledAt", "notes"];
  if (op === "complete" || (op === "amend" && current && episodeStatus(current) === "COMPLETED"))
    return ["notes", "performedProcedure", "recoveryNotes", "summary"];
  if (op === "cancel" || op === "amend") return ["notes", "summary"];
  return ["notes"];
}
export function initialClinicalValues(current: StaffRecord | undefined, op: Operation): Values {
  if (!current) return {};
  if (current.kind === "hospitalization" && "ward" in current.data && op !== "amend")
    return { ward: current.data.ward, location: current.data.location };
  if (current.kind === "surgery" && "scheduledAt" in current.data)
    return { ...current.data, scheduledAt: localMinute(new Date(current.data.scheduledAt)) };
  return current.data;
}
export function episodeData(
  kind: EpisodeKind,
  op: Operation,
  values: Values,
  current?: StaffRecord,
): Ward | Surgery | undefined {
  if (current && !episodeActions(current).some((action) => action === op)) return;
  if (kind === "hospitalization") {
    const { ward, location, note, summary } = values;
    if (!ward || !note) return;
    const details = { ward, ...(location ? { location } : {}), note };
    if (op === "new" || op === "progress")
      return { ...details, status: op === "new" ? "ADMITTED" : "PROGRESS" };
    if ((op === "discharge" || op === "amend") && summary)
      return { ...details, status: "DISCHARGED", summary };
    return;
  }
  const previous = current && "scheduledAt" in current.data ? current.data : undefined;
  const planEditable = op === "new" || op === "reschedule";
  const procedure = planEditable ? values.procedure : previous?.procedure;
  const scheduledAt = planEditable
    ? minuteInstant(values.scheduledAt ?? "", previous?.scheduledAt)
    : previous?.scheduledAt;
  if (!procedure || !scheduledAt) return;
  const details = { procedure, scheduledAt, ...(values.notes ? { notes: values.notes } : {}) };
  if (planEditable) return { ...details, status: "PLANNED" };
  if (op === "start") return { ...details, status: "IN_PROGRESS" };
  const { summary, performedProcedure, recoveryNotes } = values;
  if (!summary) return;
  if (op === "cancel" || (op === "amend" && previous?.status === "CANCELLED"))
    return { ...details, status: "CANCELLED", summary };
  if (
    (op === "complete" || (op === "amend" && previous?.status === "COMPLETED")) &&
    performedProcedure &&
    recoveryNotes
  )
    return { ...details, status: "COMPLETED", summary, performedProcedure, recoveryNotes };
}
export function episodeActionLabel(kind: EpisodeKind, op: Operation) {
  if (op === "new") return kind === "hospitalization" ? "admit" : "planSurgery";
  if (op === "correct" || op === "review" || op === "result") return "correct";
  return op;
}
