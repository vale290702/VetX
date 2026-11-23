import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApplication } from "../dist/application.js";
import { inspectDocument } from "../dist/documents/content.js";

const org = randomUUID(),
  clinic = randomUUID(),
  patient = randomUUID(),
  id = randomUUID();
const path = `/organizations/${org}/clinics/${clinic}/patients/${patient}/documents/${id}`;
const bytes = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const integrity = inspectDocument(bytes, "application/pdf", 512);
const conf = {
  endpoint: "http://127.0.0.1:59000",
  bucket: "test",
  region: "us-east-1",
  maxBytes: 512,
};
const record = {
  organizationId: org,
  clinicId: clinic,
  patientId: patient,
  id,
  assetId: randomUUID(),
  title: "Resumen",
  ...integrity,
  ready: true,
  sharing: { revision: 0, guardianIds: [] },
  recordedAt: "2026-02-01T00:00:00.000Z",
};
function form(data, type = "application/pdf", title = record.title) {
  const body = new FormData();
  body.set("title", title);
  body.set("file", new Blob([data], { type }), "client.pdf");
  return body;
}
async function withApp(kind, db, storage, run) {
  const app = await createApplication({ async checkReady() {} }, false, {
    tokenVerifier: {
      verify: async () => ({ kind, subject: "actor", issuer: "https://identity.example" }),
    },
    documents: { database: db, storage, config: conf },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    await run((url, method = "GET", body) =>
      fetch(origin + url, { method, headers: { authorization: "Bearer a.b.c" }, body }),
    );
  } finally {
    await app.close();
  }
}
test("validated multipart uploads reserve, store and publish in order, and downloads have attachment headers", async () => {
  const calls = [];
  const db = {
    getPatient: async () => ({}),
    reserveDocument: async (actor, o, c, p, d, input) => {
      assert.equal(actor.kind, "staff");
      assert.deepEqual([o, c, p, d], [org, clinic, patient, id]);
      assert.deepEqual(input, { title: record.title, ...integrity });
      calls.push("reserve");
      return { ...record, ready: false };
    },
    finishDocument: async () => {
      calls.push("finish");
      return record;
    },
    getDocument: async () => record,
  };
  const storage = {
    put: async (key, body, meta) => {
      assert.ok(key.endsWith(integrity.sha256));
      assert.deepEqual(body, bytes);
      assert.deepEqual(meta, integrity);
      calls.push("put");
    },
    read: async () => bytes,
  };
  await withApp("staff", db, storage, async (send) => {
    const uploaded = await send(path, "PUT", form(bytes));
    assert.equal(uploaded.status, 200);
    assert.deepEqual(calls, ["reserve", "put", "finish"]);
    const downloaded = await send(path + "/content");
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-disposition"), /^attachment;/);
    assert.equal(downloaded.headers.get("content-type"), "application/octet-stream");
    assert.equal(downloaded.headers.get("cache-control"), "no-store");
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  });
});
test("uploads reject oversized files, deceptive media types and requests from owner clients", async () => {
  const db = { getPatient: async () => ({}) };
  await withApp("staff", db, {}, async (send) => {
    assert.equal((await send(path, "PUT", form(Buffer.alloc(1200)))).status, 413);
    assert.equal((await send(path, "PUT", form(bytes, "image/png"))).status, 400);
    assert.equal((await send(path, "PUT", form(bytes, "application/pdf", " "))).status, 400);
  });
  await withApp("owner", {}, {}, async (send) => {
    assert.equal((await send(path, "PUT", form(bytes))).status, 403);
  });
});

test("the configured maximum size is inclusive and a missing storage service returns 503", async () => {
  const exact = Buffer.concat([bytes, Buffer.alloc(conf.maxBytes - bytes.length, 32)]);
  const db = { getPatient: async () => ({}), reserveDocument: async () => record };
  await withApp("staff", db, {}, async (send) => {
    assert.equal((await send(path, "PUT", form(exact))).status, 200);
    assert.equal(
      (await send(path, "PUT", form(Buffer.concat([exact, Buffer.from(" ")])))).status,
      413,
    );
  });
  await withApp("staff", db, undefined, async (send) => {
    assert.equal((await send(path, "PUT", form(bytes))).status, 503);
  });
});

test("a grant withdrawn while the bytes are being verified prevents delivery", async () => {
  const { RegistryError } = await import("@vetx/database");
  for (const kind of ["staff", "owner"]) {
    let allowed = true;
    const read = async () => {
      if (!allowed) throw new RegistryError("not_found");
      return record;
    };
    const store = {
      read: async () => {
        allowed = false;
        return bytes;
      },
    };
    const route =
      kind === "staff"
        ? path + "/content"
        : "/owner/pets/" + patient + "/documents/" + record.assetId + "/content";
    await withApp(kind, { getDocument: read, getOwnerDocument: read }, store, async (send) => {
      const response = await send(route);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("content-disposition"), null);
    });
  }
});
