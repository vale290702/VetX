import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { HaciendaClient, HaciendaError } from "../dist/index.js";

const clave = "50622112600000000000100100001010000000001100000001";
const envelope = {
  key: clave,
  issuedAt: "2026-11-22T08:30:00-06:00",
  issuer: { type: "02", number: "3101000000" },
  signedXml: Buffer.from("<fixture>Clínica</fixture>"),
};
async function endpoint(t, handler) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      await handler(req, res, Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      res.statusCode = 500;
      res.end();
      throw error;
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  return {
    tokenUrl: base + "/idp/token",
    receptionUrl: base + "/recepcion/v1/recepcion",
    clientId: "sandbox-test",
    timeoutMs: 5000,
    maxResponseBytes: 16384,
  };
}
const creds = { username: "test@invalid", password: "A+&=B" };
function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
test("one tenant authenticates, sends exact XML bytes and polls the same invoice key for its receipt", async (t) => {
  let logins = 0,
    posts = 0;
  const cfg = await endpoint(t, (req, res, body) => {
    if (req.url === "/idp/token") {
      logins++;
      assert.equal(req.method, "POST");
      const fields = new URLSearchParams(body);
      assert.equal(fields.get("password"), creds.password);
      assert.equal(fields.get("grant_type"), "password");
      assert.equal(fields.get("client_id"), "sandbox-test");
      return json(res, { access_token: "sandbox-access", expires_in: 300 });
    }
    assert.equal(req.headers.authorization, "Bearer sandbox-access");
    if (req.method === "POST") {
      posts++;
      const payload = JSON.parse(body);
      assert.equal(payload.clave, clave);
      assert.deepEqual(payload.emisor, {
        tipoIdentificacion: "02",
        numeroIdentificacion: envelope.issuer.number,
      });
      assert.equal(payload.receptor, undefined);
      assert.deepEqual(Buffer.from(payload.comprobanteXml, "base64"), envelope.signedXml);
      res.writeHead(201, { Location: "https://ignored.invalid/" });
      return res.end();
    }
    assert.equal(req.url, "/recepcion/v1/recepcion/" + clave);
    json(res, {
      clave,
      fecha: envelope.issuedAt,
      "ind-estado": "aceptado",
      "respuesta-xml": Buffer.from("<receipt/>").toString("base64"),
    });
  });
  const client = new HaciendaClient(cfg, creds);
  assert.deepEqual(await client.submit(envelope), { key: clave, status: "submitted" });
  const [a, b] = await Promise.all([client.status(clave), client.status(clave)]);
  assert.equal(a.state, "aceptado");
  assert.equal(a.receiptXml.toString(), "<receipt/>");
  assert.deepEqual(a, b);
  assert.equal(logins, 1);
  assert.equal(posts, 1);
});
test("ambiguous submission is reconciled by key and never automatically posted again", async (t) => {
  let posts = 0,
    fail = true;
  const cfg = await endpoint(t, (req, res) => {
    if (req.url === "/idp/token") return json(res, { access_token: "token", expires_in: 300 });
    if (req.method === "POST") {
      posts++;
      res.writeHead(400, { "X-Error-Cause": "sensitive authority detail" });
      return res.end();
    }
    if (fail) return json(res, {}, 404);
    return json(res, { clave, fecha: envelope.issuedAt, "ind-estado": "procesando" });
  });
  const client = new HaciendaClient(cfg, creds);
  await assert.rejects(
    client.submit(envelope),
    (e) =>
      e instanceof HaciendaError && e.kind === "unconfirmed" && !e.message.includes("sensitive"),
  );
  fail = false;
  const found = await client.status(clave);
  assert.equal(found.state, "procesando");
  assert.equal(posts, 1);
});
test("misbound authority responses, untrusted redirects and oversized payloads fail closed", async (t) => {
  let mode = "wrong";
  const cfg = await endpoint(t, (req, res) => {
    if (req.url === "/idp/token") return json(res, { access_token: "token", expires_in: 300 });
    if (mode === "redirect") {
      res.writeHead(302, { Location: "https://invalid.example/private" });
      return res.end();
    }
    if (mode === "large") return json(res, { payload: "a".repeat(17_000) });
    return json(res, { clave: "0".repeat(50), fecha: envelope.issuedAt, "ind-estado": "aceptado" });
  });
  const client = new HaciendaClient(cfg, creds);
  for (const m of ["wrong", "redirect", "large"]) {
    mode = m;
    await assert.rejects(client.status(clave), (e) => e instanceof HaciendaError);
  }
  await assert.rejects(client.status("not-a-key"));
});
test("a 503 after transmission is reconciled without resubmission, with unconfirmed delivery retained", async (t) => {
  let posted = 0,
    known = false;
  const cfg = await endpoint(t, (req, res) => {
    if (req.url === "/idp/token") return json(res, { access_token: "token", expires_in: 300 });
    if (req.method === "POST") {
      posted++;
      return json(res, {}, 503);
    }
    return known
      ? json(res, { clave, fecha: envelope.issuedAt, "ind-estado": "recibido" })
      : json(res, {}, 404);
  });
  const client = new HaciendaClient(cfg, creds);
  await assert.rejects(client.submit(envelope), (e) => e.kind === "unconfirmed");
  assert.equal(posted, 1);
  known = true;
  assert.deepEqual(await client.submit(envelope), {
    status: "known",
    key: clave,
    state: "recibido",
  });
  assert.equal(posted, 2);
});
test("a read refreshes a rejected token once and preserves rate-limit backoff", async (t) => {
  let logins = 0,
    gets = 0;
  const cfg = await endpoint(t, (req, res) => {
    if (req.url === "/idp/token")
      return json(res, { access_token: "token" + ++logins, expires_in: 300 });
    gets++;
    if (req.headers.authorization === "Bearer token1") return json(res, {}, 401);
    res.writeHead(429, { "Retry-After": "17" });
    res.end();
  });
  const client = new HaciendaClient(cfg, creds);
  await assert.rejects(
    client.status(clave),
    (e) => e.kind === "rate_limited" && e.retryAfterSeconds === 17,
  );
  assert.equal(logins, 2);
  assert.equal(gets, 2);
});
test("issuer configuration rejects plaintext remote origins and incomplete settings", async () => {
  const { loadFiscalSettings } = await import("../dist/index.js");
  assert.equal(loadFiscalSettings({}), undefined);
  assert.throws(() => loadFiscalSettings({ HACIENDA_CLIENT_ID: "x" }));
  const cfg = loadFiscalSettings({
    HACIENDA_TOKEN_URL: "http://issuer.invalid/token",
    HACIENDA_RECEPTION_URL: "https://reception.invalid/doc",
    HACIENDA_CLIENT_ID: "test",
    HACIENDA_HTTP_TIMEOUT_MS: "1000",
    HACIENDA_RESPONSE_BYTES: "10000",
  });
  assert.throws(
    () => new HaciendaClient(cfg, creds),
    (e) => e.kind === "configuration",
  );
});
