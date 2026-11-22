import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { FileIntegrity } from "./content.js";

export interface DocumentStorage {
  close?(): void;
  put(key: string, bytes: Buffer, integrity: FileIntegrity): Promise<void>;
  read(key: string, integrity: FileIntegrity): Promise<Buffer>;
}

export class StoredFileIntegrityError extends Error {}
export class StorageUnavailable extends Error {}
export async function readVerified(
  stream: AsyncIterable<Uint8Array>,
  integrity: FileIntegrity,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > integrity.byteLength) throw new StoredFileIntegrityError();
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (total !== integrity.byteLength || hash.digest("hex") !== integrity.sha256)
    throw new StoredFileIntegrityError();
  return Buffer.concat(chunks, total);
}
export class S3DocumentStorage implements DocumentStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}
  async put(key: string, bytes: Buffer, integrity: FileIntegrity): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: integrity.mediaType,
          ContentLength: integrity.byteLength,
          ChecksumSHA256: Buffer.from(integrity.sha256, "hex").toString("base64"),
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412) {
        await this.read(key, integrity);
        return;
      }
      throw new StorageUnavailable();
    }
  }
  async read(key: string, integrity: FileIntegrity): Promise<Buffer> {
    try {
      const { Body, ContentLength } = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!Body || !("pipe" in Body)) throw new StorageUnavailable();
      try {
        if (ContentLength !== integrity.byteLength) throw new StoredFileIntegrityError();
        return await readVerified(Body, integrity);
      } finally {
        Body.destroy();
      }
    } catch (error) {
      if (error instanceof StoredFileIntegrityError) throw error;
      throw new StorageUnavailable();
    }
  }
  close() {
    this.client.destroy();
  }
}
