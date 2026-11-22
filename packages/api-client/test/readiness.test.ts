import assert from "node:assert/strict";
import { test } from "node:test";
import { checkVetxReadiness } from "../src/index.ts";

test("checks database readiness through the generated API path", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (request: Request) => {
    assert.ok(request instanceof Request);
    return Response.json({ status: "ok" });
  });
  assert.equal(await checkVetxReadiness("https://vetx.example"), "available");
  assert.equal(fetch.mock.callCount(), 1);
  const request = fetch.mock.calls[0]?.arguments[0];
  assert.ok(request instanceof Request);
  assert.equal(request.url, "https://vetx.example/health/ready");
  assert.equal(request.method, "GET");
});

test("reports an unhealthy response or a failed connection as unavailable", async (t) => {
  const origin = "https://vetx.example";
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  assert.equal(await checkVetxReadiness(origin), "unavailable");

  fetch.mock.mockImplementation(async () => {
    throw new Error("connection failed");
  });
  assert.equal(await checkVetxReadiness(origin), "unavailable");
});
