import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { DOMParser, DOMImplementation, XMLSerializer } from "@xmldom/xmldom";
import xpath from "xpath";
import { Application, Parse, setNodeDependencies, SignedXml } from "xadesjs";

export interface FiscalSigningMaterial {
  certificate: string;
  privateKey: Buffer;
  passphrase?: string;
  policyUrl: string;
  policyDocument: Uint8Array;
  policyDigest: string;
}
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const invoiceNamespace =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";
const xmlSignatureNamespace = "http://www.w3.org/2000/09/xmldsig#";
setNodeDependencies({ DOMParser, DOMImplementation, XMLSerializer, xpath });
Application.setEngine("Node", globalThis.crypto);

export class FiscalXmlSigner {
  private constructor(
    private readonly key: CryptoKey,
    private readonly certificate: X509Certificate,
    private readonly policyUrl: string,
    private readonly policyDigest: string,
  ) {}
  static async create(material: FiscalSigningMaterial): Promise<FiscalXmlSigner> {
    try {
      const cert = new X509Certificate(material.certificate),
        key = createPrivateKey({
          key: material.privateKey,
          format: "pem",
          passphrase: material.passphrase,
        });
      const policy = URL.parse(material.policyUrl);
      if (
        !policy ||
        policy.protocol !== "https:" ||
        policy.username ||
        policy.password ||
        policy.hash ||
        !material.policyDocument.length ||
        createHash("sha256").update(material.policyDocument).digest("base64") !==
          material.policyDigest ||
        !cert.checkPrivateKey(key) ||
        key.asymmetricKeyType !== "rsa" ||
        (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      )
        throw new Error();
      const bytes = key.export({ type: "pkcs8", format: "der" });
      try {
        const privateKey = await crypto.subtle.importKey(
          "pkcs8",
          new Uint8Array(bytes),
          algorithm,
          false,
          ["sign"],
        );
        return new FiscalXmlSigner(privateKey, cert, material.policyUrl, material.policyDigest);
      } finally {
        bytes.fill(0);
      }
    } catch {
      throw new Error("Invalid fiscal signing configuration");
    }
  }
  async signInvoice(xml: string, expectedKey: string): Promise<Buffer> {
    try {
      const now = new Date();
      if (
        now < this.certificate.validFromDate ||
        now > this.certificate.validToDate ||
        !/^[0-9]{50}$/.test(expectedKey) ||
        /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)
      )
        throw new Error();
      const document = Parse(xml),
        root = document.documentElement;
      const keys = document.getElementsByTagNameNS(invoiceNamespace, "Clave");
      if (
        root.localName !== "FacturaElectronica" ||
        root.namespaceURI !== invoiceNamespace ||
        keys.length !== 1 ||
        keys[0]?.parentNode !== root ||
        keys[0]?.textContent !== expectedKey ||
        document.getElementsByTagNameNS(xmlSignatureNamespace, "Signature").length
      )
        throw new Error();
      const signer = new SignedXml();
      const certificate = this.certificate.raw.toString("base64");
      const signature = await signer.Sign(algorithm, this.key, document, {
        references: [{ uri: "", hash: "SHA-256", transforms: ["enveloped", "exc-c14n"] }],
        signedPropertiesReference: { hash: "SHA-256", transforms: ["exc-c14n"] },
        signingTime: { value: now },
        signingCertificate: { certificate, digestAlgorithm: "SHA-256" },
        x509: [certificate],
        policy: {
          hash: "SHA-256",
          identifier: { value: this.policyUrl },
          digestValue: this.policyDigest,
        },
      });
      const node = signature.GetXml();
      if (!node) throw new Error();
      root.appendChild(node);
      return Buffer.from(document.toString());
    } catch {
      throw new Error("Unable to sign fiscal invoice");
    }
  }
}
