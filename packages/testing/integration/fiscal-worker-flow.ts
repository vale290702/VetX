import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { GenericContainer } from "testcontainers";
import type { TestContext } from "node:test";
import type { FiscalRecord } from "@vetx/database";

export async function exerciseFiscalWorker(
  t: TestContext,
  organization: string,
  clinic: string,
  workerDatabase: string,
  key: string,
  status: () => Promise<FiscalRecord | null>,
) {
  const temp = await mkdtemp(join(tmpdir(), "vetx-tax-delivery-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const dir = join(temp, "sandbox", organization, clinic);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const policy = Buffer.from("VetX integration test policy");
  execFileSync(
    "openssl",
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-x509",
      "-days",
      "1",
      "-subj",
      "/CN=VetX isolated test",
      "-keyout",
      join(dir, "private.pem"),
      "-out",
      join(dir, "certificate.pem"),
    ],
    { stdio: "ignore" },
  );
  const files: Record<string, string | Buffer> = {
    "issuer-number": "3101000001",
    username: "fixture",
    password: randomBytes(18).toString("hex"),
    "policy-url": "https://policy.example.test/fixture",
    "policy.pdf": policy,
    "policy-sha256": createHash("sha256").update(policy).digest("base64"),
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(join(dir, name), value, { mode: 0o600 });
  const receipt = Buffer.from("<receipt>local fixture</receipt>");
  let posts = 0,
    polls = 0,
    xml: Buffer | undefined;
  const server = createServer(async (req, res) => {
    const json = (value: unknown, code = 200) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.url === "/token") return json({ access_token: "fixture-token", expires_in: 60 });
    if (req.headers.authorization !== "Bearer fixture-token") return json({}, 401);
    if (req.url === "/recepcion" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      if (payload.clave !== key) return json({}, 400);
      posts++;
      xml = Buffer.from(payload.comprobanteXml, "base64");
      return json({}, 201);
    }
    if (req.url === "/recepcion/" + key && posts) {
      polls++;
      return json({
        clave: key,
        fecha: new Date().toISOString(),
        "ind-estado": "aceptado",
        ...(polls >= 2 ? { "respuesta-xml": receipt.toString("base64") } : {}),
      });
    }
    json({}, 404);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as AddressInfo).port;
  // Local runs may supply a dedicated disposable loopback Redis. CI creates one here.
  let redisUrl = process.env.VETX_TEST_FISCAL_REDIS_URL;
  if (redisUrl && new URL(redisUrl).hostname !== "127.0.0.1")
    throw new Error("A dedicated loopback Redis is required");
  if (!redisUrl) {
    const password = randomBytes(18).toString("hex");
    const redis = await new GenericContainer("redis:8.6.3-alpine")
      .withCommand(["redis-server", "--requirepass", password])
      .withExposedPorts(6379)
      .start();
    t.after(async () => {
      await redis.stop();
    });
    redisUrl = "redis://:" + password + "@" + redis.getHost() + ":" + redis.getMappedPort(6379);
  }
  const worker = spawn(
    process.execPath,
    [fileURLToPath(new URL("../../../apps/worker/dist/main.js", import.meta.url))],
    {
      env: {
        ...process.env,
        FISCAL_ENVIRONMENT: "sandbox",
        FISCAL_SECRETS_DIR: temp,
        FISCAL_REDIS_URL: redisUrl,
        FISCAL_DATABASE_URL: workerDatabase,
        FISCAL_POLL_SECONDS: "1",
        FISCAL_LEASE_SECONDS: "30",
        FISCAL_BATCH_SIZE: "4",
        HACIENDA_TOKEN_URL: "http://127.0.0.1:" + port + "/token",
        HACIENDA_RECEPTION_URL: "http://127.0.0.1:" + port + "/recepcion",
        HACIENDA_CLIENT_ID: "test",
        HACIENDA_HTTP_TIMEOUT_MS: "2000",
        HACIENDA_RESPONSE_BYTES: "65536",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  // Collect only redacted event codes; no credential values or invoice bytes enter logs.
  let events = "";
  worker.stderr.on("data", (chunk) => {
    events = (events + String(chunk)).slice(-2048);
  });
  const stopped = once(worker, "exit");
  try {
    let record: FiscalRecord | null = null;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && worker.exitCode === null) {
      record = await status();
      if (record?.hasReceipt) break;
      await delay(100);
    }
    assert.equal(record?.state, "accepted", events);
    assert.equal(record.hasReceipt, true, events);
    assert.equal(posts, 1);
    assert.ok(polls >= 2);
    assert.ok(xml?.includes(Buffer.from("SignedProperties")));
    assert.ok(!(await readFile(join(dir, "private.pem"))).equals(xml!));
  } finally {
    if (worker.exitCode === null) worker.kill("SIGTERM");
    await stopped;
  }
  return { xml: xml!, receipt };
}
