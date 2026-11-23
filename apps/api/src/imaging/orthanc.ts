import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { OrthancConfig } from "@vetx/config";
import type { DicomMetadata } from "@vetx/database";
import { inspectDocument } from "../documents/content.js";

export interface ClinicalImagingArchive {
  ingest(bytes: Buffer, sha256: string): Promise<{ metadata: DicomMetadata; preview?: Buffer }>;
}
async function bounded(response: Response, max: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new ServiceUnavailableException();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new ServiceUnavailableException();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}
const uid = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))+$/;
function readUid(v: unknown) {
  if (typeof v !== "string" || v.length > 64 || !uid.test(v)) throw new BadRequestException();
  return v;
}
function object(bytes: Buffer): Record<string, unknown> {
  try {
    const json: unknown = JSON.parse(bytes.toString());
    if (json && typeof json === "object" && !Array.isArray(json))
      return json as Record<string, unknown>;
  } catch {
    /* Reject malformed archive replies below. */
  }
  throw new ServiceUnavailableException();
}
export class OrthancArchive implements ClinicalImagingArchive {
  private readonly authorization: string;
  constructor(private readonly config: OrthancConfig) {
    this.authorization =
      "Basic " + Buffer.from(config.username + ":" + config.password).toString("base64");
  }
  private async request(
    route: string,
    method: "GET" | "POST",
    max: number,
    data?: Buffer,
  ): Promise<{ code: number; bytes: Buffer; type: string }> {
    try {
      const response = await fetch(this.config.endpoint + route, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          Authorization: this.authorization,
          ...(data ? { "Content-Type": "application/dicom" } : {}),
          ...(route.endsWith("/preview") ? { Accept: "image/png" } : {}),
        },
        ...(data ? { body: new Uint8Array(data) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { code: response.status, bytes: Buffer.alloc(0), type: "" };
      }
      return {
        code: response.status,
        type: response.headers.get("content-type")?.split(";")[0]?.trim() ?? "",
        bytes: await bounded(response, max),
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async ingest(bytes: Buffer, sha256: string) {
    const stored = await this.request("/instances", "POST", this.config.metadataBytes, bytes);
    if (stored.code === 400 || stored.code === 415) throw new BadRequestException();
    if (stored.code !== 200) throw new ServiceUnavailableException();
    const item = object(stored.bytes),
      id = item.ID;
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{8}){4}$/.test(id) ||
      !["Success", "AlreadyStored"].includes(String(item.Status))
    )
      throw new ServiceUnavailableException();
    const instance = "/instances/" + id;
    const checkOriginal = async () => {
      const original = await this.request(instance + "/file", "GET", bytes.length);
      if (original.code !== 200) throw new ServiceUnavailableException();
      if (createHash("sha256").update(original.bytes).digest("hex") !== sha256)
        throw new ConflictException();
    };
    await checkOriginal();
    const fields = await this.request(
      instance + "/simplified-tags",
      "GET",
      this.config.metadataBytes,
    );
    if (fields.code !== 200) throw new ServiceUnavailableException();
    const tags = object(fields.bytes);
    const frames = tags.NumberOfFrames === undefined ? 1 : Number(tags.NumberOfFrames);
    if (!Number.isSafeInteger(frames) || frames < 1 || frames > 2147483647)
      throw new BadRequestException();
    const modality = tags.Modality;
    if (typeof modality !== "string" || !/^[A-Z0-9_ ]{1,16}$/.test(modality))
      throw new BadRequestException();
    const metadata = {
      studyInstanceUid: readUid(tags.StudyInstanceUID),
      seriesInstanceUid: readUid(tags.SeriesInstanceUID),
      sopInstanceUid: readUid(tags.SOPInstanceUID),
      modality,
      frames,
    };
    const preview = await this.request(
      instance + "/frames/0/preview",
      "GET",
      this.config.previewBytes,
    );
    if (preview.code !== 200 && preview.code !== 415) throw new ServiceUnavailableException();
    if (preview.code === 200) {
      if (preview.type !== "image/png") throw new ServiceUnavailableException();
      try {
        inspectDocument(preview.bytes, "image/png", this.config.previewBytes);
      } catch {
        throw new ServiceUnavailableException();
      }
    }
    // Never associate another instance's decoded preview with an immutable source file.
    await checkOriginal();
    return { metadata, ...(preview.code === 200 ? { preview: preview.bytes } : {}) };
  }
}
