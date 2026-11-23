import assert from "node:assert/strict";
import { test } from "node:test";
import { recognizedType, documentSharingChange } from "../src/documents.ts";
import { createPatients, patientFailure } from "../src/patients.ts";
const scope = { subject: "staff", organizationId: "org", clinicId: "one" };
const doc = {
  id: "doc",
  assetId: "asset",
  mediaType: "application/pdf",
  byteLength: 4,
  ready: true,
};
const bytes = Uint8Array.of(37, 80, 0, 255);

function fixture(responder) {
  const requests = [];
  const signal = new AbortController().signal;
  const client = createPatients(
    {
      forOrganization(subject, org, work) {
        assert.equal(subject, "staff");
        assert.equal(org, "org");
        return work("staff-token", signal);
      },
      forAccount(subject, work) {
        assert.equal(subject, "owner");
        return work("owner-token", signal);
      },
    },
    "https://api.test",
    async (url, init) => {
      assert.equal(init.signal, signal);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      const request = new Request(url, init);
      requests.push(request);
      return responder(request);
    },
  ).documents;
  return { client, requests };
}
test("multipart PUT preserves binary bytes and title with a stable document ID", async () => {
  const { client, requests } = fixture(() => Response.json({}));
  const item = { name: "private name.pdf", mediaType: doc.mediaType, bytes };
  await client.upload(scope, "patient", doc.id, "Résumé", item, "BOUNDARY-1");
  const req = requests[0],
    form = await req.formData();
  assert.equal(req.method, "PUT");
  assert.equal(req.headers.get("Authorization"), "Bearer staff-token");
  assert.equal(
    req.url,
    "https://api.test/organizations/org/clinics/one/patients/patient/documents/doc",
  );
  assert.equal(form.get("title"), "Résumé");
  assert.equal(form.get("file").type, item.mediaType);
  assert.deepEqual(new Uint8Array(await form.get("file").arrayBuffer()), bytes);
});
test("owner and staff downloads use distinct scoped content routes; inconsistent content is never handed off", async () => {
  const { client, requests } = fixture(
    () =>
      new Response(bytes, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": "4" },
      }),
  );
  assert.deepEqual(await client.staffContent(scope, "patient", doc), bytes);
  assert.deepEqual(await client.ownerContent("owner", "pet", doc), bytes);
  assert.deepEqual(
    requests.map((r) => [new URL(r.url).pathname, r.headers.get("Authorization")]),
    [
      [
        "/organizations/org/clinics/one/patients/patient/documents/doc/content",
        "Bearer staff-token",
      ],
      ["/owner/pets/pet/documents/asset/content", "Bearer owner-token"],
    ],
  );
  const bad = fixture(
    () => new Response(bytes.slice(0, 2), { headers: { "Content-Type": doc.mediaType } }),
  );
  await assert.rejects(bad.client.ownerContent("owner", "pet", doc));
  const revoked = fixture(() => new Response("denied", { status: 403 }));
  await assert.rejects(revoked.client.staffContent(scope, "patient", doc));
});
test("document index pages and guardian releases are issued against the selected patient and pet", async () => {
  const { client, requests } = fixture(() => Response.json({}));
  await client.list(scope, "patient", 3);
  await client.released("owner", "pet", 2);
  await client.share(scope, "patient", "doc", { revision: 2, guardianIds: [] });
  assert.deepEqual(
    requests.map((r) => r.url.replace("https://api.test", "")),
    [
      "/organizations/org/clinics/one/patients/patient/documents?page=3",
      "/owner/pets/pet/documents?page=2",
      "/organizations/org/clinics/one/patients/patient/documents/doc/sharing",
    ],
  );
  assert.deepEqual(await requests[2].json(), { revision: 2, guardianIds: [] });
});

test("attachment media and clinic-specific server size limits have actionable native errors", async () => {
  assert.equal(recognizedType(undefined, "scan.PDF"), "application/pdf");
  assert.equal(recognizedType("application/octet-stream", "scan.JPEG"), "image/jpeg");
  assert.equal(recognizedType("image/svg+xml", "scan.png"), undefined);
  const { client } = fixture(() => new Response(null, { status: 413 }));
  await assert.rejects(
    client.upload(
      scope,
      "patient",
      "doc",
      "Image",
      { mediaType: "image/png", name: "scan.png", bytes },
      "boundary",
    ),
    (err) => patientFailure(err, "write") === "documentTooLarge",
  );
});
test("a release updates only the guardians shown to staff; an empty selection revokes their access", () => {
  const current = { revision: 3, guardianIds: ["active", "missing"] };
  assert.equal(documentSharingChange(current, ["active", "new"], current.guardianIds), undefined);
  assert.deepEqual(documentSharingChange(current, ["active", "new"], ["new", "forged"]), {
    revision: 3,
    guardianIds: ["missing", "new"],
  });
  assert.deepEqual(documentSharingChange(current, ["active", "missing"], []), {
    revision: 3,
    guardianIds: [],
  });
});

test("refreshing sharing resolves the live document revision beyond its old page and the patient's currently linked guardians", async () => {
  const guardians = [
    { id: "new", linked: true },
    { id: "unlinked", linked: false },
  ];
  const latest = { ...doc, title: "Scan", sharing: { revision: 5, guardianIds: ["new"] } };
  const { client, requests } = fixture((req) => {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/patients/patient"))
      return Response.json({ patient: { id: "patient" }, guardians });
    return Response.json(
      url.searchParams.get("page") === "1"
        ? { documents: [{ ...doc, id: "newer" }], page: 1, hasNextPage: true }
        : { documents: [latest], page: 2, hasNextPage: false },
    );
  });
  const state = await client.sharingDetails(scope, "patient", "doc");
  assert.deepEqual(state, { doc: latest, guardians });
  assert.equal(
    documentSharingChange(
      state.doc.sharing,
      state.guardians.filter((g) => g.linked).map((g) => g.id),
      state.doc.sharing.guardianIds,
    ),
    undefined,
  );
  assert.deepEqual(
    requests.map((req) => new URL(req.url).pathname + new URL(req.url).search).sort(),
    [
      "/organizations/org/clinics/one/patients/patient",
      "/organizations/org/clinics/one/patients/patient/documents?page=1",
      "/organizations/org/clinics/one/patients/patient/documents?page=2",
    ],
  );
});
test("stale revisions and removed recipients return the editor to its refresh flow; permission denial remains an error", async () => {
  for (const status of [404, 409]) {
    const { client } = fixture(() => Response.json({ error: { code: "stale" } }, { status }));
    assert.equal(
      await client.share(scope, "patient", "doc", { revision: 3, guardianIds: ["old"] }),
      "refresh",
    );
  }
  const { client } = fixture(() => Response.json({ error: { code: "denied" } }, { status: 403 }));
  await assert.rejects(client.share(scope, "patient", "doc", { revision: 3, guardianIds: [] }));
});

test("a document on a later page opens directly at its latest revision", async () => {
  const latest = { ...doc, sharing: { revision: 12, guardianIds: [] } };
  const { client, requests } = fixture((req) =>
    Response.json(
      req.url.endsWith("/patients/patient")
        ? { guardians: [] }
        : { page: 5, hasNextPage: true, documents: [latest] },
    ),
  );
  const result = await client.sharingDetails(scope, "patient", "doc", 5);
  assert.equal(result.doc.sharing.revision, 12);
  assert.equal(requests.length, 2);
  assert.ok(requests.some((r) => new URL(r.url).searchParams.get("page") === "5"));
});
