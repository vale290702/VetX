import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  StreamableFile,
} from "@nestjs/common";
import type { ExchangeConfig } from "@vetx/config";
import type {
  ExchangeChoice,
  ExportLocation,
  ExportSelection,
  PrismaDatabase,
} from "@vetx/database";
import type { OwnerPrincipal, StaffPrincipal } from "@vetx/permissions";
import {
  defaultVetpkgLimits,
  VetpkgSizeError,
  openVetpkg,
  sealVetpkg,
  validateVetpkgManifest,
  vetpkgRecipientKid,
  type VetpkgManifest,
} from "@vetx/exchange";
import { documentKey, inspectDocument } from "../documents/content.js";
import {
  ExchangeKeyDirectory,
  publicBinding,
  sameClinic,
  type ExchangeClinicId,
} from "./keyring.js";

interface Integrity {
  mediaType: string;
  sha256: string;
  byteLength: number;
}
export interface ExchangeStorage {
  put(key: string, bytes: Buffer, meta: Integrity): Promise<void>;
  read(key: string, meta: Integrity): Promise<Buffer>;
}
export type ExchangeStore = Pick<
  PrismaDatabase,
  | "listClinics"
  | "stageExchange"
  | "commitExchange"
  | "getExchangeReceipt"
  | "listImportedRecords"
  | "getImportedAttachment"
  | "ownerExportLocations"
  | "ownerExportChoices"
  | "ownerExportSource"
  | "confirmOwnerExport"
>;
export interface ExchangeDependencies {
  documentMaxBytes?: number;
  database?: ExchangeStore;
  storage?: ExchangeStorage;
  settings?: ExchangeConfig;
  keys?: ExchangeKeyDirectory;
}
const packageMediaType = "application/vnd.vetx.vetpkg.v1";
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function archiveKey(scope: ExchangeClinicId, sha256: string) {
  return [
    "exchange",
    "v1",
    scope.organizationId.toLowerCase(),
    scope.clinicId.toLowerCase(),
    sha256,
  ].join("/");
}
// A source-scoped exchange ID lets an addendum refer to a withheld parent
// without exposing the parent's internal clinic record identifier.
function portableEncounterId(scope: ExportLocation, id: string): string {
  const bytes = createHash("sha256")
    .update(
      ["VetX/encounter/v1", scope.organizationId, scope.clinicId, scope.patientId, id]
        .map((value) => value.toLowerCase())
        .join("\0"),
    )
    .digest();
  bytes[6] = (bytes[6]! & 15) | 128;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
export function attachment(bytes: Buffer, filename: string) {
  return new StreamableFile(bytes, {
    type: "application/octet-stream",
    length: bytes.length,
    disposition: `attachment; filename="${filename}"`,
  });
}
export class ExchangeService {
  constructor(private readonly deps: ExchangeDependencies) {}
  get db() {
    if (!this.deps.database) throw new ServiceUnavailableException();
    return this.deps.database;
  }
  get settings() {
    if (!this.deps.settings) throw new ServiceUnavailableException();
    return this.deps.settings;
  }
  get keys() {
    if (!this.deps.keys) throw new ServiceUnavailableException();
    return this.deps.keys;
  }
  get storage() {
    if (!this.deps.storage) throw new ServiceUnavailableException();
    return this.deps.storage;
  }
  get limits() {
    const { maxPackageBytes, maxRecords } = this.settings;
    const maxAttachmentBytes = this.deps.documentMaxBytes ?? defaultVetpkgLimits.maxAttachmentBytes;
    return {
      ...defaultVetpkgLimits,
      maxPackageBytes,
      maxRecords,
      maxAttachmentBytes,
      maxTotalAttachmentBytes: Math.max(
        defaultVetpkgLimits.maxTotalAttachmentBytes,
        maxAttachmentBytes,
      ),
    };
  }
  async checkStaff(staff: StaffPrincipal, scope: ExchangeClinicId) {
    const visible = await this.db.listClinics(staff, scope.organizationId);
    if (!visible?.some((c) => c.id.toLowerCase() === scope.clinicId.toLowerCase()))
      throw new ForbiddenException();
  }
  private async unseal(bytes: Buffer, destination: ExchangeClinicId) {
    const destinationKeys = this.keys.clinic(destination),
      sources = this.keys.trustedSources(destination),
      limits = this.limits;
    if (!destinationKeys?.encryption.some((key) => key.jwk.d))
      throw new ServiceUnavailableException();
    try {
      const kid = vetpkgRecipientKid(bytes, limits);
      const recipient = destinationKeys.encryption.find((k) => k.kid === kid && k.jwk.d);
      if (!recipient) throw new BadRequestException();
      return await openVetpkg(bytes, { recipient, trustedSources: sources, limits });
    } catch {
      throw new BadRequestException();
    }
  }
  async preview(actor: StaffPrincipal, destination: ExchangeClinicId, bytes: Buffer) {
    const manifest = await this.unseal(bytes, destination);
    const archiveSha256 = hash(bytes),
      meta = { sha256: archiveSha256, byteLength: bytes.length, mediaType: packageMediaType };
    const recordDigests: Record<string, string> = {},
      counts = new Map<string, number>();
    for (const record of manifest.records) {
      if ("content" in record.data) {
        const file = Buffer.from(record.data.content, "base64url");
        if (record.kind === "dicom") {
          if (file.length <= 132 || file.toString("ascii", 128, 132) !== "DICM")
            throw new BadRequestException();
        } else {
          try {
            inspectDocument(file, record.data.mediaType, this.limits.maxAttachmentBytes);
          } catch {
            throw new BadRequestException();
          }
        }
      }
      recordDigests[record.id] = hash(JSON.stringify(record));
      counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
    }
    const verified = await this.db.stageExchange(
      actor,
      destination.organizationId,
      destination.clinicId,
      { manifest, archiveSha256, byteLength: bytes.length, recordDigests },
    );
    await this.storage.put(archiveKey(destination, archiveSha256), bytes, meta);
    await this.checkStaff(actor, destination);
    return { ...verified, counts: Array.from(counts, ([kind, count]) => ({ kind, count })) };
  }
  async commit(
    actor: StaffPrincipal,
    destination: ExchangeClinicId,
    receiptId: string,
    choice: ExchangeChoice,
  ) {
    const receipt = await this.db.getExchangeReceipt(
      actor,
      destination.organizationId,
      destination.clinicId,
      receiptId,
    );
    const bytes = await this.storage.read(archiveKey(destination, receipt.archiveSha256), {
      mediaType: packageMediaType,
      sha256: receipt.archiveSha256,
      byteLength: receipt.byteLength,
    });
    const manifest = await this.unseal(bytes, destination);
    if (manifest.packageId !== receipt.packageId) throw new BadRequestException();
    return this.db.commitExchange(
      actor,
      destination.organizationId,
      destination.clinicId,
      receiptId,
      choice,
    );
  }
  async importedFile(actor: StaffPrincipal, scope: ExportLocation, importedId: string) {
    const load = () =>
      this.db.getImportedAttachment(
        actor,
        scope.organizationId,
        scope.clinicId,
        scope.patientId,
        importedId,
      );
    const record = await load();
    const bytes = await this.storage.read(archiveKey(scope, record.archiveSha256), {
      sha256: record.archiveSha256,
      byteLength: record.byteLength,
      mediaType: packageMediaType,
    });
    const manifest = await this.unseal(bytes, scope);
    if (
      manifest.packageId !== record.packageId ||
      !sameClinic(manifest.source, record.source) ||
      manifest.patient.id !== record.source.patientId
    )
      throw new NotFoundException();
    const file = manifest.records.find((r) => r.id === record.recordId && r.kind === record.kind);
    if (!file || !("content" in file.data)) throw new NotFoundException();
    await load();
    const extensions = {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
      "application/dicom": "dcm",
    } as const;
    return attachment(
      Buffer.from(file.data.content, "base64url"),
      "record-" + importedId + "." + extensions[file.data.mediaType],
    );
  }
  async locations(owner: OwnerPrincipal, pet: string) {
    const { sources } = await this.db.ownerExportLocations(owner, pet);
    return {
      sources: sources.map((source) => ({
        ...source,
        destinations: this.keys.clinic(source)?.signing[0]?.jwk.d
          ? this.keys.destinations(source)
          : [],
      })),
    };
  }
  async export(
    owner: OwnerPrincipal,
    pet: string,
    source: ExportLocation,
    destination: ExchangeClinicId,
    selection: ExportSelection,
  ) {
    const { limits } = this;
    if (selection.encounterIds.length + selection.documentAssetIds.length > limits.maxRecords)
      throw new PayloadTooLargeException();
    const snapshot = await this.db.ownerExportSource(owner, pet, source, selection);
    if (!this.keys.allows(source, destination)) throw new ForbiddenException();
    const signer = this.keys.clinic(source)?.signing[0],
      key = this.keys.clinic(destination)?.encryption[0];
    if (!signer?.jwk.d || !key) throw new ServiceUnavailableException();
    const expectedBytes = snapshot.files.reduce((sum, file) => sum + file.byteLength, 0);
    if (
      expectedBytes > limits.maxTotalAttachmentBytes ||
      snapshot.files.some((f) => f.byteLength > limits.maxAttachmentBytes)
    )
      throw new PayloadTooLargeException();
    const files = [];
    for (const file of snapshot.files) {
      const bytes = await this.storage.read(
        documentKey(
          source.organizationId,
          source.clinicId,
          source.patientId,
          file.objectId,
          file.sha256,
        ),
        file,
      );
      files.push({
        id: file.id,
        kind: "document",
        occurredAt: file.recordedAt,
        recordedAt: file.recordedAt,
        author: file.author,
        data: {
          title: file.title,
          mediaType: file.mediaType,
          sha256: file.sha256,
          byteLength: file.byteLength,
          content: bytes.toString("base64url"),
        },
      });
    }
    const notes = snapshot.notes.map((note) => ({
      ...note,
      id: portableEncounterId(source, note.id),
      data: {
        ...note.data,
        ...(note.data.addendumTo
          ? { addendumTo: portableEncounterId(source, note.data.addendumTo) }
          : {}),
      },
    }));
    const packageId = randomUUID();
    let sealed: Uint8Array;
    try {
      const manifest: VetpkgManifest = validateVetpkgManifest(
        {
          version: 1,
          packageId,
          createdAt: new Date().toISOString(),
          source: { organizationId: signer.organizationId, clinicId: signer.clinicId },
          destination: { organizationId: key.organizationId, clinicId: key.clinicId },
          patient: snapshot.patient,
          ...(snapshot.owner ? { owner: snapshot.owner } : {}),
          records: [...notes, ...files],
        },
        limits,
      );
      sealed = await sealVetpkg(manifest, { signer, recipient: publicBinding(key), limits });
    } catch (error) {
      if (error instanceof VetpkgSizeError) throw new PayloadTooLargeException();
      throw new BadRequestException();
    }
    await this.db.confirmOwnerExport(owner, pet, source, selection, destination, packageId);
    return attachment(Buffer.from(sealed), "record-" + packageId + ".vetpkg");
  }
}
