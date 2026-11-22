import { createHash } from "node:crypto";
import { z } from "zod";
import { invalid, isBase64url, resolveLimits, type VetpkgLimits } from "./limits.js";

const uuid = z.uuid().regex(/^[a-f0-9-]+$/);
const timestamp = z.iso.datetime({ offset: true });
const label = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^(?=.*\S)[^\p{Cc}]+$/u);
const section = z
  .string()
  .max(8000)
  .regex(/^[^\p{Cc}]*(?:[\t\r\n][^\p{Cc}]*)*$/u);
const narrative = section.refine((value) => /\S/.test(value));
export const clinicSchema = z.strictObject({ organizationId: uuid, clinicId: uuid });
export type ExchangeClinic = z.infer<typeof clinicSchema>;

const metadata = z.strictObject({
  version: z.literal(1),
  packageId: uuid,
  createdAt: timestamp,
  source: clinicSchema,
  destination: clinicSchema,
  patient: z.strictObject({
    id: uuid,
    name: label(120),
    species: label(80),
    birthDate: z.iso.date().nullable().optional(),
  }),
  owner: z.strictObject({ name: label(120), email: z.email().max(254).optional() }).optional(),
});

const common = {
  id: uuid,
  occurredAt: timestamp,
  recordedAt: timestamp,
  author: z.strictObject({ issuer: label(2048), subject: label(512) }),
};
function record<K extends string, S extends z.ZodRawShape>(kind: K, shape: S) {
  return z.strictObject({ ...common, kind: z.literal(kind), data: z.strictObject(shape) });
}

const soap = {
  reason: label(250),
  subjective: section,
  objective: section,
  assessment: section,
  plan: section,
};
const attachment = {
  title: label(250),
  byteLength: z.int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string(),
};
const dicomUid = z
  .string()
  .max(64)
  .regex(/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))+$/);
const recordSchema = z.discriminatedUnion("kind", [
  record("encounter", soap),
  record("addendum", { ...soap, addendumTo: uuid }),
  record("diagnosis", { diagnosis: narrative, code: label(128).optional() }),
  record("treatment", { treatment: narrative, notes: section.optional() }),
  record("prescription", { medication: label(250), instructions: narrative }),
  record("vaccination", {
    vaccine: label(250),
    lotNumber: label(128).optional(),
    nextDueDate: z.iso.date().optional(),
  }),
  record("labResult", {
    test: label(250),
    result: narrative,
    unit: label(128).optional(),
    referenceRange: label(250).optional(),
  }),
  record("document", {
    ...attachment,
    mediaType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  }),
  record("radiograph", { ...attachment, mediaType: z.enum(["image/jpeg", "image/png"]) }),
  record("dicom", {
    ...attachment,
    mediaType: z.literal("application/dicom"),
    studyInstanceUid: dicomUid.optional(),
    seriesInstanceUid: dicomUid.optional(),
    sopInstanceUid: dicomUid.optional(),
  }),
  record("referral", { referredTo: clinicSchema, reason: narrative, summary: section.optional() }),
  record("counterReferral", {
    referralId: uuid,
    referringClinic: clinicSchema,
    summary: narrative,
  }),
]);

export type ExchangeRecord = z.infer<typeof recordSchema>;
export type VetpkgManifest = z.infer<typeof metadata> & { records: ExchangeRecord[] };

export function sameClinic(a: ExchangeClinic, b: ExchangeClinic): boolean {
  return a.organizationId === b.organizationId && a.clinicId === b.clinicId;
}

// A parent can appear later in the file or reside in a separately released package.
function validateAddendumChains(byId: ReadonlyMap<string, ExchangeRecord>): void {
  const checked = new Set<string>();
  for (const record of byId.values()) {
    if (record.kind !== "addendum" || checked.has(record.id)) continue;
    const path = new Set<string>();
    let current: ExchangeRecord | undefined = record;
    while (current?.kind === "addendum" && !checked.has(current.id)) {
      if (path.has(current.id)) return invalid();
      path.add(current.id);
      current = byId.get(current.data.addendumTo);
      if (current && current.kind !== "encounter" && current.kind !== "addendum") return invalid();
    }
    for (const id of path) checked.add(id);
  }
}

export function validateVetpkgManifest(
  input: unknown,
  overrides?: Partial<VetpkgLimits>,
): VetpkgManifest {
  const limits = resolveLimits(overrides);
  if (typeof input !== "object" || input === null || !("records" in input)) return invalid();
  const { records: rawRecords, ...rawMetadata } = input;
  if (!Array.isArray(rawRecords) || rawRecords.length > limits.maxRecords) return invalid();
  const header = metadata.safeParse(rawMetadata);
  if (!header.success) return invalid();
  const records: ExchangeRecord[] = [];
  const byId = new Map<string, ExchangeRecord>();
  let bytes = Buffer.byteLength(JSON.stringify({ ...header.data, records: [] }));
  let attachmentBytes = 0;
  if (bytes > limits.maxManifestBytes) return invalid();
  for (const raw of rawRecords) {
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success) return invalid();
    const item = parsed.data;
    if (byId.has(item.id)) return invalid();
    byId.set(item.id, item);
    if (item.kind === "encounter" || item.kind === "addendum") {
      const { subjective, objective, assessment, plan } = item.data;
      if (![subjective, objective, assessment, plan].some((value) => /\S/.test(value)))
        return invalid();
    }
    if (item.kind === "document" || item.kind === "radiograph" || item.kind === "dicom") {
      const { byteLength, content, sha256 } = item.data;
      attachmentBytes += byteLength;
      if (
        byteLength > limits.maxAttachmentBytes ||
        attachmentBytes > limits.maxTotalAttachmentBytes ||
        content.length !== Math.ceil((byteLength * 4) / 3) ||
        bytes + content.length > limits.maxManifestBytes ||
        !isBase64url(content)
      )
        return invalid();
      if (createHash("sha256").update(Buffer.from(content, "base64url")).digest("hex") !== sha256)
        return invalid();
    }
    bytes += Buffer.byteLength(JSON.stringify(item)) + (records.length === 0 ? 0 : 1);
    if (bytes > limits.maxManifestBytes) return invalid();
    records.push(item);
  }
  validateAddendumChains(byId);
  return { ...header.data, records };
}
