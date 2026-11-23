import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadOrthancConfig } from "@vetx/config";
import { OrthancArchive } from "../dist/imaging/orthanc.js";
import { dicomFixture } from "../../../packages/testing/fixtures/dicom.mjs";

test("Orthanc indexes a synthetic DICOM, returns a PNG first frame and rejects changed bytes under the same instance", async () => {
  const config = loadOrthancConfig();
  assert.ok(
    config && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.endpoint).hostname),
    "Use an isolated local Orthanc",
  );
  const archive = new OrthancArchive(config);
  const bytes = dicomFixture();
  const digest = (body) => createHash("sha256").update(body).digest("hex");
  const result = await archive.ingest(bytes, digest(bytes));
  assert.equal(result.metadata.modality, "OT");
  assert.equal(result.metadata.frames, 1);
  assert.match(result.metadata.studyInstanceUid, /^2\.25\./);
  assert.deepEqual(result.preview.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
  assert.equal(result.preview.readUInt32BE(16), 2);
  assert.deepEqual(await archive.ingest(bytes, digest(bytes)), result);
  const name = Buffer.from("Synthetic^VetX");
  const offset = bytes.indexOf(name);
  assert.ok(offset > 132);
  function withName(text) {
    const value = Buffer.from(text);
    const header = Buffer.from(bytes.subarray(0, offset));
    header.writeUInt16LE(value.length, header.length - 2);
    return Buffer.concat([header, value, bytes.subarray(offset + name.length)]);
  }
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] = 32;
  for (const candidate of [changed, withName("Test"), withName("Synthetic^DifferentName ")]) {
    await assert.rejects(
      archive.ingest(candidate, digest(candidate)),
      (e) => e.getStatus() === 409,
    );
  }
});
