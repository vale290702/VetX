import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, webcrypto, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Parse, SignedXml } from "xadesjs";
import { FiscalXmlSigner } from "../dist/index.js";
const ns = "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";
const key = "50622112600000000000100100001010000000001100000001";
test("the issuer signs the complete invoice and the policy with an ephemeral test certificate", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "vetx-epes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cert = join(dir, "cert.pem"),
    pem = join(dir, "key.pem");
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
      "/CN=VetX integration fixture",
      "-keyout",
      pem,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  const certificate = await readFile(cert, "utf8"),
    policy = Buffer.from("VetX test policy"),
    digest = createHash("sha256").update(policy).digest("base64");
  const options = {
    certificate,
    privateKey: await readFile(pem),
    policyUrl: "https://policy.example.test/testing.pdf",
    policyDocument: policy,
    policyDigest: digest,
  };
  const signer = await FiscalXmlSigner.create(options);
  const xml =
    '<FacturaElectronica xmlns="' +
    ns +
    '"><Clave>' +
    key +
    "</Clave><Emisor><Nombre>Clínica del Sol</Nombre></Emisor></FacturaElectronica>";
  const signed = await signer.signInvoice(xml, key);
  const doc = Parse(signed.toString("utf8"));
  assert.equal(
    doc.getElementsByTagNameNS("http://uri.etsi.org/01903/v1.3.2#", "Identifier")[0].textContent,
    options.policyUrl,
  );
  const certKey = createPublicKey(
    new X509Certificate(certificate).publicKey.export({ type: "spki", format: "pem" }),
  );
  const publicKey = await webcrypto.subtle.importKey(
    "spki",
    certKey.export({ type: "spki", format: "der" }),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"],
  );
  const verify = async (document) => {
    const signature = document.getElementsByTagNameNS(
      "http://www.w3.org/2000/09/xmldsig#",
      "Signature",
    )[0];
    const verifier = new SignedXml(document);
    verifier.LoadXml(signature);
    return verifier.Verify(publicKey);
  };
  assert.equal(await verify(doc), true);
  doc.getElementsByTagNameNS(ns, "Nombre")[0].textContent = "Changed";
  await assert.rejects(verify(doc), (error) => /Invalid digest/.test(error.message));
  await assert.rejects(signer.signInvoice(xml, "0".repeat(50)));
  await assert.rejects(signer.signInvoice(signed.toString("utf8"), key));
  await assert.rejects(
    FiscalXmlSigner.create({ ...options, policyDocument: Buffer.from("other") }),
  );
});
