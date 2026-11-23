import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mountedIssuers } from "../dist/issuer.js";

test("the signing worker defers validator process failures and rejects confirmed schema violations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vetx-issuer-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const organizationId = randomUUID(),
    clinicId = randomUUID(),
    folder = join(root, "sandbox", organizationId, clinicId);
  await mkdir(folder, { recursive: true });
  const pem = join(folder, "private.pem"),
    cert = join(folder, "certificate.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=Test validator",
      "-keyout",
      pem,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  const policy = Buffer.from("test-policy"),
    number = "3101000001";
  for (const [key, value] of Object.entries({
    "policy.pdf": policy,
    "policy-url": "https://example.test/policy",
    "policy-sha256": createHash("sha256").update(policy).digest("base64"),
    "issuer-number": number,
    username: "fixture",
    password: randomUUID(),
  }))
    await writeFile(join(folder, key), value, { mode: 0o600 });
  const snapshot = {
    consecutive: "00100001010000000001",
    securityCode: "00000001",
    issuedAt: "2026-11-22T09:10:11-06:00",
    providerId: "3101000000",
    issuerActivity: "750000",
    issuer: {
      name: "Clínica de prueba",
      identity: { type: "02", number },
      address: { province: "1", canton: "01", district: "01", details: "Dirección de prueba" },
      email: "clinic@example.test",
    },
    recipient: { name: "Persona de prueba", identity: { type: "01", number: "100000001" } },
    terms: { code: "02", days: 30 },
    currency: "CRC",
    exchangeRate: "1",
    lines: [
      {
        cabys: "8352000000000",
        category: "service",
        unitCode: "Sp",
        name: "Servicio",
        quantity: "1",
        unitPrice: "100",
        vatTariffCode: "08",
        taxRate: "13",
        subtotal: "100",
        tax: "13",
        total: "113",
      },
    ],
    subtotal: "100",
    tax: "13",
    total: "113",
    payments: [],
  };
  const load = mountedIssuers(root, "sandbox", {
    tokenUrl: "https://login.example.test",
    receptionUrl: "https://reception.example.test",
    clientId: "fixture",
    timeoutMs: 150,
    maxResponseBytes: 10000,
  });
  const issuer = await load({ organizationId, clinicId, snapshot });
  await assert.rejects(
    issuer.prepare({ ...snapshot, issuer: { ...snapshot.issuer, name: "ABC" } }),
    { kind: "invalid_submission" },
  );
  const path = process.env.PATH;
  try {
    process.env.PATH = root;
    await assert.rejects(issuer.prepare(snapshot), { kind: "unavailable" });
    for (const script of ['kill -TERM "$$"', "exec /bin/sleep 3"]) {
      await writeFile(join(root, "xmllint"), "#!/bin/sh\n" + script + "\n", { mode: 0o700 });
      await assert.rejects(issuer.prepare(snapshot), { kind: "unavailable" });
    }
  } finally {
    process.env.PATH = path;
  }
});
