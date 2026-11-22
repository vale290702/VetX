import type { NoteInput, Sharing, Visit, VisitInput } from "./care-client";
import type { Guardian } from "./patients";

type Sections = Pick<NoteInput, "subjective" | "objective" | "assessment" | "plan">;
export function encounterBody(
  occurredAt: string | undefined,
  reason: string,
  fields: Sections,
  parent?: string,
): NoteInput | undefined {
  if (!occurredAt || !reason.trim() || !Object.values(fields).some((s) => s.trim()))
    return undefined;
  return {
    occurredAt,
    reason: reason.trim(),
    subjective: fields.subjective.trim(),
    objective: fields.objective.trim(),
    assessment: fields.assessment.trim(),
    plan: fields.plan.trim(),
    addendumTo: parent ?? null,
  };
}
export function sharingChange(
  original: Sharing,
  guardians: Guardian[],
  selected: string[],
): Sharing | undefined {
  const linked = guardians.filter((g) => g.linked).map((g) => g.id);
  // A recently released guardian can be missing from the older patient roster.
  const guardianIds = [
    ...original.guardianIds.filter((id) => !linked.includes(id)),
    ...linked.filter((id) => selected.includes(id)),
  ];
  if (
    guardianIds.length === original.guardianIds.length &&
    guardianIds.every((id) => original.guardianIds.includes(id))
  )
    return undefined;
  return { guardianIds, revision: original.revision };
}

export type Patient = { id: string; name: string };
export type AppointmentEditorState =
  | { kind: "book"; id: string; patient: Patient; original?: Visit }
  | { kind: "finish"; visit: Visit; status: "CANCELLED" | "COMPLETED" };
export function appointmentBody(
  editor: AppointmentEditorState,
  startAt: string | undefined,
  endAt: string | undefined,
  reason: string,
): VisitInput | undefined {
  if (editor.kind === "finish") {
    const { patientId, startAt, endAt, reason, revision } = editor.visit;
    return { patientId, startAt, endAt, reason, revision, status: editor.status };
  }
  if (!startAt || !endAt || !(Date.parse(startAt) < Date.parse(endAt)) || !reason.trim())
    return undefined;
  return {
    patientId: editor.patient.id,
    startAt,
    endAt,
    reason: reason.trim(),
    revision: editor.original?.revision ?? 0,
    status: "BOOKED",
  };
}
