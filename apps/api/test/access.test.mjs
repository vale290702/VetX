import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplication } from "../dist/application.js";

const organizationId = "4d18d591-2fc7-44c7-9d6b-5611b7f3ca11";
const unavailableId = "4d18d591-2fc7-44c7-9d6b-5611b7f3ca12";
const clinicId = "4d18d591-2fc7-44c7-9d6b-5611b7f3ca13";
const authorization = "Bearer a.b.c";

async function withApi(access, callback) {
  const app = await createApplication({ async checkReady() {} }, false, access);
  try {
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    await callback((path, options) => fetch(origin + path, options));
  } finally {
    await app.close();
  }
}

function accessFor(kind) {
  return {
    tokenVerifier: {
      async verify() {
        return { issuer: "https://id.example/realms/vetx", subject: "person-one", kind };
      },
    },
    database: {
      async listOrganizations(principal) {
        assert.equal(principal.kind, "staff");
        return [{ id: organizationId, name: "Authorized organization" }];
      },
      async listClinics(principal, id) {
        assert.equal(principal.kind, "staff");
        return id === organizationId ? [{ id: clinicId, name: "Authorized clinic" }] : null;
      },
    },
  };
}

test("staff identity sees organization memberships and clinic access without cross-tenant metadata", async () => {
  await withApi(accessFor("staff"), async (get) => {
    const options = { headers: { authorization } };
    const me = await get("/me", options);
    assert.equal(me.status, 200);
    assert.equal(me.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await me.json(), {
      subject: "person-one",
      organizations: [{ id: organizationId, name: "Authorized organization" }],
    });

    const allowed = await get(`/organizations/${organizationId}/clinics`, options);
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), {
      clinics: [{ id: clinicId, name: "Authorized clinic" }],
    });

    const denied = await get(`/organizations/${unavailableId}/clinics`, options);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), {
      error: {
        code: "FORBIDDEN",
        message: "Access denied",
        requestId: denied.headers.get("x-request-id"),
      },
    });
  });
});

test("owner identity does not query staff access even with the same authenticated subject", async () => {
  await withApi(accessFor("owner"), async (get) => {
    const options = { headers: { authorization } };
    const me = await get("/me", options);
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { subject: "person-one", organizations: [] });
    const denied = await get(`/organizations/${organizationId}/clinics`, options);
    assert.equal(denied.status, 403);
  });
});

test("auth routes fail closed while health is available with unconfigured identity", async () => {
  await withApi(undefined, async (get) => {
    assert.equal((await get("/health/live")).status, 200);
    const anonymous = await get("/me");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("WWW-Authenticate"), "Bearer");
    assert.equal((await get("/me", { headers: { authorization } })).status, 503);
  });
});
