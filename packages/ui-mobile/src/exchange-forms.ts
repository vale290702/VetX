import type { components } from "@vetx/api-client";
export type Source = components["schemas"]["ExportSourceDto"];
export type Destination = Source["destinations"][number];
export type ExportRecord = components["schemas"]["ExportChoiceDto"];
export type RecordKey = Pick<ExportRecord, "kind" | "id">;
export type Preview = components["schemas"]["ExchangePreviewDto"];
export type ImportDecision = components["schemas"]["ImportChoiceDto"];
export type ImportedRecord = components["schemas"]["ImportedRecordDto"];
export type ExportInput = components["schemas"]["ExportRequestDto"];
export function hasRecord(records: RecordKey[], record: RecordKey) {
  return records.some((r) => r.id === record.id && r.kind === record.kind);
}
export function toggleExportRecord(records: RecordKey[], record: RecordKey): RecordKey[] {
  return hasRecord(records, record)
    ? records.filter((r) => r.id !== record.id || r.kind !== record.kind)
    : [...records, { id: record.id, kind: record.kind }];
}
export function exportBody(
  source: Source,
  dest: Pick<Destination, "organizationId" | "clinicId"> | undefined,
  records: RecordKey[],
  includeOwner: boolean,
): ExportInput | undefined {
  if (
    !records.length ||
    !dest ||
    !source.destinations.some(
      (d) => d.clinicId === dest.clinicId && d.organizationId === dest.organizationId,
    )
  )
    return undefined;
  return {
    source: {
      organizationId: source.organizationId,
      clinicId: source.clinicId,
      patientId: source.patientId,
    },
    destination: { organizationId: dest.organizationId, clinicId: dest.clinicId },
    encounterIds: records.filter((r) => r.kind === "encounter").map((r) => r.id),
    documentAssetIds: records.filter((r) => r.kind === "document").map((r) => r.id),
    ...(records.some((r) => r.kind === "clinical")
      ? { clinicalRevisionIds: records.filter((r) => r.kind === "clinical").map((r) => r.id) }
      : {}),
    ...(records.some((r) => r.kind === "prescription")
      ? { prescriptionIds: records.filter((r) => r.kind === "prescription").map((r) => r.id) }
      : {}),
    includeOwner,
  };
}
export function importChoice(
  preview: Pick<Preview, "mappedPatientId" | "committedPatientId">,
  choice: ImportDecision | undefined,
): ImportDecision | undefined {
  if (!choice || preview.committedPatientId) return undefined;
  if (
    preview.mappedPatientId &&
    (choice.mode !== "match" || choice.patientId !== preview.mappedPatientId)
  )
    return undefined;
  if (choice.mode === "create") return { mode: "create" };
  return choice.patientId ? { mode: "match", patientId: choice.patientId } : undefined;
}
export const packageLimit = 64 * 1024 * 1024;
export const packageType = "application/vnd.vetx.vetpkg.v1";
