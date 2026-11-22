import { readFileSync } from "node:fs";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadDocumentConfig } from "@vetx/config";
import { documentKey } from "../dist/documents/content.js";

const config = loadDocumentConfig();
if (!config || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(config.endpoint).hostname))
  throw new Error("Document fixtures require a loopback object store");
const { org, rows } = JSON.parse(readFileSync(0, "utf8"));
const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  credentials: config.credentials,
  forcePathStyle: true,
});
try {
  for (const { clinic_id, patient_id, id, sha256 } of rows) {
    const key = documentKey(org, clinic_id, patient_id, id, sha256);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }
} finally {
  client.destroy();
}
