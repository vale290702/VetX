import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplication } from "../dist/application.js";

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function withApplication(checkReady, testApplication) {
  const app = await createApplication({ checkReady }, false);
  try {
    await app.listen(0, "127.0.0.1");
    await testApplication(await app.getUrl());
  } finally {
    await app.close();
  }
}

test("GET /health/live stays healthy when readiness fails", async () => {
  await withApplication(
    () => {
      throw new Error("unavailable database");
    },
    async (baseUrl) => {
      const response = await fetch(baseUrl + "/health/live", {
        headers: { "x-request-id": "untrusted-client-value" },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("x-request-id"), requestIdPattern);
      assert.deepEqual(await response.json(), { status: "ok" });
    },
  );
});

test("GET /health/ready returns OK when the readiness check passes", async () => {
  await withApplication(
    async () => {},
    async (baseUrl) => {
      const response = await fetch(baseUrl + "/health/ready");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
    },
  );
});

test("GET /health/ready returns a correlated safe error when the readiness check fails", async () => {
  const databaseError = "postgresql://runtime:secret@host/database";
  await withApplication(
    async () => {
      throw new Error(databaseError);
    },
    async (baseUrl) => {
      const response = await fetch(baseUrl + "/health/ready");
      const requestId = response.headers.get("x-request-id");
      assert.equal(response.status, 503);
      assert.match(requestId, requestIdPattern);
      assert.deepEqual(await response.json(), {
        error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable", requestId },
      });
    },
  );
});

test("a missing route returns the stable error envelope without reflecting the path", async () => {
  await withApplication(
    async () => {},
    async (baseUrl) => {
      const response = await fetch(baseUrl + "/unknown-path");
      const requestId = response.headers.get("x-request-id");
      assert.equal(response.status, 404);
      assert.match(requestId, requestIdPattern);
      assert.deepEqual(await response.json(), {
        error: { code: "NOT_FOUND", message: "Resource not found", requestId },
      });
    },
  );
});

test("/openapi.json declares both probes and the readiness error response", async () => {
  await withApplication(
    async () => {},
    async (baseUrl) => {
      const response = await fetch(baseUrl + "/openapi.json");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("x-request-id"), requestIdPattern);
      const document = await response.json();
      assert.ok(document.paths["/health/live"].get.responses["200"]);
      assert.ok(document.paths["/health/ready"].get.responses["200"]);
      assert.ok(document.paths["/health/ready"].get.responses["503"]);
    },
  );
});
