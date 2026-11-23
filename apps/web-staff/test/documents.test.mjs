import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { readSharingBody } from "../src/documents/sharing.ts";

import {
  uploadDocument,
  attachmentResponse,
  validDocumentWrite,
} from "../src/documents/transport.ts";

const origin = new URL("https://staff.example");
const csrf = "u".repeat(43);
const path = {
  organizationId: crypto.randomUUID(),
  clinicId: crypto.randomUUID(),
  patientId: crypto.randomUUID(),
  documentId: crypto.randomUUID(),
};

function request(body, headers = {}) {
  return new Request(origin, {
    method: "POST",
    headers: { Origin: origin.origin, "X-VetX-CSRF": csrf, ...headers },
    body,
  });
}

test("document writes require the exact origin and session CSRF header without consuming the file", () => {
  for (const headers of [{ Origin: "https://other.example" }, { "X-VetX-CSRF": "" }]) {
    const incoming = request("bytes", headers);
    assert.equal(validDocumentWrite(incoming, origin, csrf), false);
    assert.equal(incoming.bodyUsed, false);
  }
  assert.equal(validDocumentWrite(request("bytes"), origin, csrf), true);
});

test("an upload streams the original multipart file and title with server credentials", async () => {
  let received;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": req.headers["content-type"] },
    }).formData();
    received = {
      method: req.method,
      url: req.url,
      token: req.headers.authorization,
      cookie: req.headers.cookie,
      csrf: req.headers["x-vetx-csrf"],
      title: form.get("title"),
      bytes: await form.get("file").text(),
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const form = new FormData();
    form.set("title", "Examen de Luna");
    form.set("file", new File(["%PDF-1.4\n%%EOF"], "private.pdf", { type: "application/pdf" }));
    const result = await uploadDocument(
      request(form, { Cookie: "vetx-session=private" }),
      `http://127.0.0.1:${server.address().port}`,
      "server-token",
      path,
    );
    assert.equal(result.status, 204);
    assert.deepEqual(received, {
      method: "PUT",
      url: `/organizations/${path.organizationId}/clinics/${path.clinicId}/patients/${path.patientId}/documents/${path.documentId}`,
      token: "Bearer server-token",
      cookie: undefined,
      csrf: undefined,
      title: "Examen de Luna",
      bytes: "%PDF-1.4\n%%EOF",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an excessive announced upload is rejected before reading and a wrong content type fails locally", async () => {
  const tooLarge = request("data", {
    "Content-Type": "multipart/form-data; boundary=abc",
    "Content-Length": String(34 * 1024 * 1024),
  });
  assert.equal((await uploadDocument(tooLarge, "http://127.0.0.1:1", "token", path)).status, 413);
  assert.equal(tooLarge.bodyUsed, false);
  const wrong = request("data");
  assert.equal((await uploadDocument(wrong, "http://127.0.0.1:1", "token", path)).status, 415);
  assert.equal(wrong.bodyUsed, false);
});

test("an attachment carries bytes, a download filename, and private cache controls", async () => {
  const attachment = attachmentResponse(
    new Response("clinical bytes", {
      headers: {
        "content-disposition": 'attachment; filename="luna.pdf"',
        "content-type": "text/html",
        "set-cookie": "other=unsafe",
        "x-storage-url": "private",
      },
    }),
  );
  assert.equal(await attachment.text(), "clinical bytes");
  assert.equal(attachment.headers.get("content-disposition"), 'attachment; filename="luna.pdf"');
  assert.equal(attachment.headers.get("content-type"), "application/octet-stream");
  assert.equal(attachment.headers.get("x-content-type-options"), "nosniff");
  assert.match(attachment.headers.get("cache-control"), /no-store/);
  assert.equal(attachment.headers.has("set-cookie"), false);
  assert.equal(attachment.headers.has("x-storage-url"), false);
});

test("a chunked multipart upload exceeding the byte limit is aborted during streaming", async () => {
  const server = createServer((req, res) => {
    req.on("error", () => {});
    req.resume();
    req.on("end", () => res.end());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const chunk = new Uint8Array(256 * 1024);
    let chunks = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunks++ < 144) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const incoming = new Request(origin, {
      method: "POST",
      duplex: "half",
      body: stream,
      headers: { "content-type": "multipart/form-data; boundary=abc" },
    });
    const result = await uploadDocument(
      incoming,
      `http://127.0.0.1:${server.address().port}`,
      "token",
      path,
    );
    assert.equal(result.status, 413);
    assert.ok(chunks < 144);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("sharing accepts a viewed revision and explicit guardian IDs including an empty revocation", async () => {
  const json = (body) => request(JSON.stringify(body), { "Content-Type": "application/json" });
  for (const guardianIds of [[], [crypto.randomUUID()]]) {
    const body = { revision: 3, guardianIds };
    assert.deepEqual(await readSharingBody(json(body)), body);
  }
  for (const body of [
    { revision: -1, guardianIds: [] },
    { revision: 4, guardianIds: ["invalid"] },
    { revision: "1", guardianIds: [] },
    null,
    { revision: 3, guardianIds: [crypto.randomUUID()], extra: "x".repeat(101 * 1024) },
  ]) {
    assert.equal(await readSharingBody(json(body)), null);
  }
});

test("first-frame proxy permits only scoped PNG bytes with private non-cacheable headers", async () => {
  const { previewResponse } = await import("../src/documents/transport.ts");
  const bytes = Uint8Array.of(137, 80, 78, 71);
  const output = await previewResponse(
    new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "X-Private": "hidden",
        "Content-Disposition": "attachment",
        "Content-Length": "4",
      },
    }),
  );
  assert.deepEqual(new Uint8Array(await output.arrayBuffer()), bytes);
  for (const [key, v] of [
    ["Content-Type", "image/png"],
    ["Cache-Control", "private, no-store"],
    ["Content-Disposition", "inline"],
    ["X-Content-Type-Options", "nosniff"],
    ["Cross-Origin-Resource-Policy", "same-origin"],
    ["X-Private", null],
  ])
    assert.equal(output.headers.get(key), v);
  for (const upstream of [
    new Response("unsafe", { headers: { "Content-Type": "text/html" } }),
    new Response("private failure", { status: 404 }),
  ]) {
    const rejected = await previewResponse(upstream);
    assert.ok(rejected.status >= 400);
    assert.equal(await rejected.text(), "");
  }
});
