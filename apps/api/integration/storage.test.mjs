import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadDocumentConfig } from "@vetx/config";
import { S3DocumentStorage, StoredFileIntegrityError } from "../dist/documents/storage.js";
import { documentKey, inspectDocument } from "../dist/documents/content.js";

test("private object storage verifies uploaded bytes, tolerates replay and denies anonymous access", async () => {
  const config = loadDocumentConfig();
  assert.ok(
    config && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.endpoint).hostname),
    "Use a local test object store",
  );
  const client = new S3Client({ ...config, forcePathStyle: true });
  const bucket = "vetx-test-" + randomUUID();
  const storage = new S3DocumentStorage(client, bucket);
  const bytes = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
  const meta = inspectDocument(bytes, "application/pdf", config.maxBytes);
  const key = documentKey(randomUUID(), randomUUID(), randomUUID(), randomUUID(), meta.sha256);
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  try {
    await storage.put(key, bytes, meta);
    await storage.put(key, bytes, meta);
    const different = Buffer.from("%PDF-1.7\nother valid data\n%%EOF\n");
    await assert.rejects(
      storage.put(key, different, inspectDocument(different, "application/pdf", config.maxBytes)),
      StoredFileIntegrityError,
    );
    assert.deepEqual(await storage.read(key, meta), bytes);
    await assert.rejects(
      storage.read(key, { ...meta, sha256: "0".repeat(64) }),
      StoredFileIntegrityError,
    );
    const anonymous = await fetch(config.endpoint + "/" + bucket + "/" + key);
    await anonymous.body?.cancel();
    assert.equal(anonymous.status, 403);
  } finally {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    } finally {
      client.destroy();
    }
  }
});
