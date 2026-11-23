import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { RegistryError } from "@vetx/database";
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
async function withApp(kind, db, storage, run, imaging) {
  const app = await createApplication({ async checkReady() {} }, false, {
    tokenVerifier: {
      verify: async () => ({ kind, subject: "actor", issuer: "https://identity.example" }),
    },
    documents: { database: db, storage, config: conf, imaging },
  });
  try {
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    await run((url, method = "GET", body, authenticated = true) =>
      fetch(origin + url, {
        method,
        headers: authenticated ? { authorization: "Bearer a.b.c" } : {},
        body,
      }),
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

const invalidDicom = Buffer.alloc(148);
invalidDicom.write("DICM", 128);
const correctedDicom = Buffer.concat([invalidDicom, Buffer.from([1])]);
const scanMetadata = {
  studyInstanceUid: "2.25.1",
  seriesInstanceUid: "2.25.2",
  sopInstanceUid: "2.25.3",
  modality: "DX",
  frames: 1,
};

test("archive rejection leaves no original or reservation and the same request ID can be corrected", async () => {
  for (const rejection of [new BadRequestException(), new ConflictException()]) {
    const writes = new Map();
    const calls = [];
    let reservation;
    let finalized;
    const db = {
      getPatient: async () => ({}),
      preflightDocument: async () => {
        calls.push("preflight");
        return finalized ?? null;
      },
      reserveDocument: async (_actor, _org, _clinic, _patient, _id, input) => {
        calls.push("reserve");
        reservation = { ...record, ...input, ready: false };
        return reservation;
      },
      finishDicomDocument: async (_actor, _org, _clinic, _patient, _id, digest, imaging) => {
        calls.push("publish");
        assert.equal(digest, reservation.sha256);
        finalized = { ...reservation, ready: true, imaging };
        return finalized;
      },
    };
    const storage = {
      put: async (key, body) => {
        calls.push("put");
        writes.set(key, body);
      },
    };
    const archive = {
      ingest: async (data) => {
        calls.push("archive");
        if (data.equals(invalidDicom)) throw rejection;
        assert.deepEqual(data, correctedDicom);
        return { metadata: scanMetadata };
      },
    };
    await withApp(
      "staff",
      db,
      storage,
      async (send) => {
        const rejected = await send(path, "PUT", form(invalidDicom, "application/dicom"));
        assert.equal(rejected.status, rejection.getStatus());
        assert.equal(reservation, undefined);
        assert.equal(writes.size, 0);
        assert.deepEqual(calls, ["preflight", "archive"]);

        const corrected = await send(path, "PUT", form(correctedDicom, "application/dicom"));
        assert.equal(corrected.status, 200);
        assert.deepEqual(await corrected.json(), finalized);
        assert.deepEqual([...writes.values()], [correctedDicom]);
        assert.deepEqual(calls, [
          "preflight",
          "archive",
          "preflight",
          "archive",
          "reserve",
          "put",
          "publish",
        ]);
      },
      archive,
    );

    await withApp("staff", db, storage, async (send) => {
      const replay = await send(path, "PUT", form(correctedDicom, "application/dicom"));
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), finalized);
      assert.equal(calls.at(-1), "preflight");
      assert.equal(writes.size, 1);
    });
  }
});

test("missing identity, cross-clinic access, and mismatched reservation fail before archive work", async () => {
  const calls = [];
  const db = {
    getPatient: async (_actor, _org, selectedClinic) => {
      calls.push("patient");
      if (selectedClinic !== clinic) throw new RegistryError("forbidden");
      return {};
    },
    preflightDocument: async () => {
      calls.push("preflight");
      throw new RegistryError("conflict");
    },
    reserveDocument: async () => {
      calls.push("reserve");
      return record;
    },
  };
  const archive = {
    ingest: async () => {
      calls.push("archive");
    },
  };
  const storage = {
    put: async () => {
      calls.push("put");
    },
  };
  const upload = () => form(correctedDicom, "application/dicom");
  await withApp(
    "staff",
    db,
    storage,
    async (send) => {
      assert.equal((await send(path, "PUT", upload(), false)).status, 401);
      assert.deepEqual(calls, []);
      assert.equal((await send(path.replace(clinic, randomUUID()), "PUT", upload())).status, 403);
      assert.deepEqual(calls, ["patient"]);
      assert.equal((await send(path, "PUT", upload())).status, 409);
      assert.deepEqual(calls, ["patient", "patient", "preflight"]);
    },
    archive,
  );
});
