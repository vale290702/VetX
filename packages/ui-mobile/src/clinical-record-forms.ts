import type { components } from "@vetx/api-client";
import {
  editableEpisodeFields,
  episodeData,
  episodeFields,
  isEpisode,
  releasedEpisodeStatus,
  type EpisodeAction,
} from "./inpatient-forms.ts";
import { sharingChange } from "./care-forms.ts";
import type { Guardian } from "./patients.ts";
type S = components["schemas"];
export type StaffRecord = S["StaffClinicalDto"];
export type ReleasedRecord = S["OwnerClinicalDto"];
export type ClinicalWrite = S["ClinicalWriteDto"];
export type ClinicalShare = S["ClinicalSharingDto"];
export type Kind = StaffRecord["kind"];
export type Operation = "new" | "correct" | "result" | "review" | EpisodeAction;
export const kinds = [
  "diagnosis",
  "treatment",
  "vaccination",
  "lab",
  "hospitalization",
  "surgery",
] as const;
const fieldGroups = {
  ...episodeFields,
  diagnosis: ["diagnosis", "code"],
  treatment: ["treatment", "notes"],
  vaccination: ["vaccine", "lotNumber", "nextDueDate"],
  lab: ["test", "specimen", "result", "unit", "referenceRange"],
} as const;
export type ClinicalField = (typeof fieldGroups)[Kind][number];
export type Values = Partial<Record<ClinicalField, string>>;
export const limits: Record<ClinicalField, number> = {
  ward: 120,
  location: 120,
  note: 8000,
  summary: 8000,
  procedure: 250,
  scheduledAt: 16,
  performedProcedure: 250,
  recoveryNotes: 8000,
  diagnosis: 8000,
  code: 128,
  treatment: 8000,
  notes: 8000,
  vaccine: 250,
  lotNumber: 128,
  nextDueDate: 10,
  test: 250,
  specimen: 250,
  result: 8000,
  unit: 128,
  referenceRange: 250,
};
export function clinicalFields(
  kind: Kind,
  op: Operation | "show",
  current?: StaffRecord,
): readonly ClinicalField[] {
  if (isEpisode(kind)) return editableEpisodeFields(kind, op, current);
  if (kind !== "lab" || op === "review" || op === "show") return fieldGroups[kind];
  return op === "result" ? ["result", "unit", "referenceRange"] : ["test", "specimen"];
}
export function labData(record: StaffRecord | ReleasedRecord) {
  return record.kind === "lab" && "test" in record.data ? record.data : undefined;
}
export const canRelease = (record: StaffRecord | ReleasedRecord) =>
  isEpisode(record.kind)
    ? Boolean(
        releasedEpisodeStatus(
          record.kind,
          "status" in record.data ? record.data.status : undefined,
        ),
      )
    : record.kind !== "lab" || labData(record)?.status === "REVIEWED";
export function clinicalSharing(
  record: StaffRecord,
  guardians: Guardian[],
  selected: string[],
): ClinicalShare | undefined {
  if (!canRelease(record)) return;
  const next = sharingChange(record.sharing, guardians, selected);
  if (next) return { ...next, recordRevision: record.revision };
}
export function buildClinical(
  kind: Kind,
  op: Operation,
  encounter: string,
  time: string | undefined,
  values: Values,
  reason: string,
  current?: StaffRecord,
): ClinicalWrite | undefined {
  if ((op === "new") !== !current || (current && current.kind !== kind)) return;
  const encounterId = current?.encounterId ?? encounter,
    occurredAt = op === "review" || op === "amend" ? current?.occurredAt : time;
  if (
    !encounterId ||
    !occurredAt ||
    !/(?:Z|[+-]\d\d:\d\d)$/.test(occurredAt) ||
    !Number.isFinite(Date.parse(occurredAt))
  )
    return;
  if (current && isEpisode(kind) && Date.parse(occurredAt) < Date.parse(current.occurredAt)) return;
  if (!isEpisode(kind) && !(["new", "correct", "result", "review"] as Operation[]).includes(op))
    return;
  const changeReason = reason.trim();
  if (current && (!changeReason || changeReason.length > 500 || /\p{Cc}/u.test(changeReason)))
    return;
  const base = {
    kind,
    encounterId,
    occurredAt,
    revision: current?.revision ?? 0,
    ...(current ? { changeReason } : {}),
  };
  const previous = current && labData(current);
  if (op === "review")
    return previous?.status === "RESULTED" && previous.result
      ? { ...base, data: { ...previous, status: "REVIEWED" } }
      : undefined;
  if (op === "result" && !previous) return;
  if (op === "correct" && kind === "lab" && previous?.status !== "ORDERED") return;
  const data: Values = {};
  for (const k of clinicalFields(kind, op, current)) {
    const v = values[k]?.trim();
    if (!v) continue;
    const text = limits[k] === 8000 ? v.replace(/[\r\n\t]/g, "") : v;
    if (v.length > limits[k] || /\p{Cc}/u.test(text)) return;
    if (k === "nextDueDate") {
      const d = new Date(v + "T12:00:00Z");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        v.startsWith("0000") ||
        !Number.isFinite(d.valueOf()) ||
        d.toISOString().slice(0, 10) !== v
      )
        return;
    }
    data[k] = v;
  }
  if (isEpisode(kind)) {
    const episode = episodeData(kind, op, data, current);
    return episode ? { ...base, data: episode } : undefined;
  }
  switch (kind) {
    case "diagnosis":
      return data.diagnosis ? { ...base, data: { ...data, diagnosis: data.diagnosis } } : undefined;
    case "treatment":
      return data.treatment ? { ...base, data: { ...data, treatment: data.treatment } } : undefined;
    case "vaccination":
      return data.vaccine ? { ...base, data: { ...data, vaccine: data.vaccine } } : undefined;
    case "lab":
      if (op === "result" && previous)
        return data.result
          ? {
              ...base,
              data: {
                ...data,
                test: previous.test,
                ...(previous.specimen ? { specimen: previous.specimen } : {}),
                status: "RESULTED",
              },
            }
          : undefined;
      return data.test
        ? { ...base, data: { ...data, test: data.test, status: "ORDERED" } }
        : undefined;
  }
}
