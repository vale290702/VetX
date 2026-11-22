import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import { inspectDocument, documentKey, InvalidDocument } from "../dist/documents/content.js";
import { readVerified } from "../dist/documents/storage.js";
const pdf = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const digest = createHash("sha256").update(pdf).digest("hex");
test("document metadata is derived from the bytes, with bounded content and matched media type", () => {
  assert.deepEqual(inspectDocument(pdf, "application/pdf", pdf.length), {
    mediaType: "application/pdf",
    byteLength: pdf.length,
    sha256: digest,
  });
  for (const [bytes, mime, limit] of [
    [pdf, "image/jpeg", 500],
    [pdf, "application/pdf", pdf.length - 1],
    [Buffer.from("%PDF-"), "application/pdf", 500],
    [Buffer.from("<html/>"), "text/html", 500],
    [Buffer.alloc(0), "image/png", 500],
  ]) {
    assert.throws(() => inspectDocument(bytes, mime, limit), InvalidDocument);
  }
});
test("storage paths include clinic, patient, document and digest and refuse malformed identifiers", () => {
  const ids = Array.from({ length: 4 }, () => randomUUID());
  assert.equal(documentKey(...ids, digest), ["clinical", "v1", ...ids, digest].join("/"));
  assert.throws(
    () => documentKey(...[ids[0], "../patient", ...ids.slice(2)], digest),
    InvalidDocument,
  );
});
test("stream verification rejects truncated or substituted stored bytes, including undeclared oversized chunks", async () => {
  async function* chunks(bytes) {
    yield bytes;
  }
  const expected = inspectDocument(pdf, "application/pdf", pdf.length);
  assert.deepEqual(await readVerified(chunks(pdf), expected), pdf);
  for (const bytes of [pdf.subarray(1), Buffer.concat([pdf, pdf]), Buffer.alloc(pdf.length, 97)]) {
    await assert.rejects(readVerified(chunks(bytes), expected));
  }
});
