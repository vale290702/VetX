import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  parseCommitChoice,
  readSearch,
  fileKinds,
  visibleRecordFields,
} from "../src/exchange/forms.ts";
import { forwardMultipart, safeWrite, attachmentResponse } from "../src/auth/file-proxy.ts";

const id = crypto.randomUUID();
test("committing requires an explicit create or a single valid patient match", () => {
  for (const invalid of [
    null,
    {},
    { mode: "match" },
    { mode: "match", patientId: "untrusted/path" },
    { mode: "create", patientId: id },
    { mode: "automatic", patientId: id },
  ])
    assert.equal(parseCommitChoice(invalid), null);
  assert.deepEqual(parseCommitChoice({ mode: "create" }), { mode: "create" });
  assert.deepEqual(parseCommitChoice({ mode: "match", patientId: id }), {
    mode: "match",
    patientId: id,
  });
});
test("a patient search uses a bounded nonempty search and a positive page", () => {
  assert.deepEqual(readSearch({ search: " Núbe ", page: 2 }), { search: "Núbe", page: 2 });
  for (const invalid of [
    { search: "", page: 1 },
    { search: "x".repeat(121), page: 1 },
    { search: "Núbe", page: 0 },
  ])
    assert.equal(readSearch(invalid), null);
});
test("history renders clinical metadata, with file bytes kept behind authorized downloads", () => {
  assert.deepEqual(
    visibleRecordFields({ title: "Study", content: "private-archive-bytes", byteLength: 12 }),
    [
      ["title", "Study"],
      ["byteLength", 12],
    ],
  );
  assert.deepEqual(fileKinds, ["document", "radiograph", "dicom"]);
});
test("multipart forwarding preserves the archive and authenticates only the API", async () => {
  let observed;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const b of req) chunks.push(b);
    const data = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": req.headers["content-type"] },
    }).formData();
    observed = {
      method: req.method,
      auth: req.headers.authorization,
      cookie: req.headers.cookie,
      csrf: req.headers["x-vetx-csrf"],
      file: await data.get("file").text(),
    };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ receiptId: id }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const form = new FormData();
    form.set("file", new File(["encrypted bytes"], "exchange.vetpkg"));
    const request = new Request("https://staff.example", {
      method: "POST",
      headers: {
        Origin: "https://staff.example",
        "X-VetX-CSRF": "a".repeat(43),
        Cookie: "private=1",
      },
      body: form,
    });
    assert.equal(safeWrite(request, new URL("https://staff.example"), "b".repeat(43)), false);
    assert.equal(request.bodyUsed, false);
    assert.equal(safeWrite(request, new URL("https://staff.example"), "a".repeat(43)), true);
    const result = await forwardMultipart(
      request,
      new URL(`http://127.0.0.1:${server.address().port}/preview`),
      "staff-token",
      "POST",
      3000,
    );
    assert.deepEqual(await result.json(), { receiptId: id });
    assert.deepEqual(observed, {
      method: "POST",
      auth: "Bearer staff-token",
      cookie: undefined,
      csrf: undefined,
      file: "encrypted bytes",
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test("excessive declared multipart size is rejected before reading, and downloads force attachment", async () => {
  const request = new Request("https://staff.example", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=abcd", "content-length": "4000" },
    body: "data",
  });
  assert.equal(
    (await forwardMultipart(request, new URL("http://127.0.0.1:1"), "staff-token", "POST", 20))
      .status,
    413,
  );
  assert.equal(request.bodyUsed, false);
  const download = attachmentResponse(
    new Response("file", {
      headers: { "content-type": "text/html", "content-disposition": "inline", "x-private": "a" },
    }),
  );
  assert.equal(download.headers.get("content-disposition"), "attachment");
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.equal(download.headers.get("x-private"), null);
});
