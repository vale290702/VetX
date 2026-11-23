import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildFiscalInvoice,
  FiscalXmlSigner,
  prepareFiscalInvoice,
  validateSignedInvoice,
} from "../dist/index.js";
const base = {
  consecutive: "00100001010000000001",
  securityCode: "00000001",
  issuedAt: "2026-11-22T09:10:11-06:00",
  providerId: "3101000000",
  issuerActivity: "750000",
  issuer: {
    name: "Clínica de prueba",
    identity: { type: "02", number: "3101000001" },
    email: "clinic@example.test",
    address: { province: "1", canton: "01", district: "01", details: "Dirección de prueba" },
  },
  recipient: { name: "Persona de prueba", identity: { type: "01", number: "100000001" } },
  terms: { code: "01" },
  currency: "CRC",
  exchangeRate: "1",
  lines: [
    {
      cabys: "8352000000000",
      category: "service",
      unitCode: "Sp",
      name: "Consulta & control",
      quantity: "1.250",
      unitPrice: "100.00000",
      vatTariffCode: "08",
      taxRate: "13.00000",
      subtotal: "125.00000",
      tax: "16.25000",
      total: "141.25000",
    },
  ],
  subtotal: "125.00000",
  tax: "16.25000",
  total: "141.25000",
  payments: [
    { code: "01", amount: "40" },
    { code: "01", amount: "40" },
    { code: "02", amount: "61.25" },
  ],
};
test("an ordinary invoice preserves the fiscal key, rounded line, split tenders and XML text", () => {
  const built = buildFiscalInvoice(base);
  assert.equal(built.key, "50622112600310100000100100001010000000001100000001");
  assert.match(built.xml, /Consulta &amp; control/);
  assert.match(built.xml, /<TotalMedioPago>80.00000<\/TotalMedioPago>/);
  assert.equal((built.xml.match(/<MedioPago>/g) || []).length, 2);
  for (const other of [
    { total: "140" },
    { payments: [] },
    { issuedAt: "2026-02-31T09:10:11-06:00" },
    { consecutive: "00100001020000000001" },
    { lines: [{ ...base.lines[0], tax: "16.24999" }] },
  ])
    assert.throws(() => buildFiscalInvoice({ ...base, ...other }), /Invalid fiscal invoice/);
});
test("ordinary VAT invoices match the reviewed Hacienda tariff code and rate", () => {
  for (const vatTariffCode of ["01", "02", "05", "10", "11", "99"]) {
    assert.throws(
      () => buildFiscalInvoice({ ...base, lines: [{ ...base.lines[0], vatTariffCode }] }),
      /Invalid fiscal invoice/,
    );
  }
  const half = {
    ...base.lines[0],
    vatTariffCode: "09",
    taxRate: "0.50000",
    tax: "0.62500",
    total: "125.62500",
  };
  const invoice = {
    ...base,
    lines: [half],
    tax: half.tax,
    total: half.total,
    payments: [{ code: "01", amount: half.total }],
  };
  assert.match(buildFiscalInvoice(invoice).xml, /<Tarifa>0.5<\/Tarifa>/);
});
test("signed client fixture validates offline against the pinned Hacienda XSD and W3C signature schema", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "vetx-fiscal-schema-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = join(dir, "key.pem"),
    cert = join(dir, "cert.pem"),
    policy = Buffer.from("Local test signing policy");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=Test only",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  const signer = await FiscalXmlSigner.create({
    privateKey: await readFile(key),
    certificate: await readFile(cert, "utf8"),
    policyUrl: "https://example.test/policy",
    policyDocument: policy,
    policyDigest: createHash("sha256").update(policy).digest("base64"),
  });
  const signed = await prepareFiscalInvoice(base, signer, 5000);
  assert.equal(signed.issuer.number, base.issuer.identity.number);
  await assert.rejects(
    validateSignedInvoice(Buffer.from(buildFiscalInvoice(base).xml), 5000),
    /validation failed/,
  );
  await assert.rejects(
    prepareFiscalInvoice(
      { ...base, lines: [{ ...base.lines[0], unitCode: "unknown-unit" }] },
      signer,
      5000,
    ),
    /Invalid fiscal invoice/,
  );
});

test("schema preflight validates unsigned invoice content and distinguishes validator execution failures", async (t) => {
  const { preflightFiscalInvoice } = await import("../dist/index.js");
  assert.equal(await preflightFiscalInvoice(base, 5000), buildFiscalInvoice(base).key);
  for (const variant of [
    { ...base, issuer: { ...base.issuer, name: "ABC" } },
    { ...base, issuer: { ...base.issuer, address: { ...base.issuer.address, details: "XYZ" } } },
    { ...base, lines: [{ ...base.lines[0], name: "IV" }] },
  ])
    await assert.rejects(preflightFiscalInvoice(variant, 5000), {
      name: "FiscalXmlValidationError",
      kind: "invalid",
    });
  const dir = await mkdtemp(join(tmpdir(), "vetx-schema-runner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  process.env.PATH = dir;
  const failed = { name: "FiscalXmlValidationError", kind: "unavailable" };
  await assert.rejects(validateSignedInvoice(Buffer.from("<invoice/>"), 5000), failed);
  const check = async (script, timeout) => {
    await writeFile(join(dir, "xmllint"), "#!/bin/sh\n" + script + "\n", { mode: 0o700 });
    await assert.rejects(validateSignedInvoice(Buffer.from("<invoice/>"), timeout), failed);
  };
  await check("exec /bin/sleep 3", 75);
  await check('kill -TERM "$$"', 2000);
  await check("exit 5", 2000);
});
