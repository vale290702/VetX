import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const invoiceSchema = fileURLToPath(
  new URL("../schemas/2026/4.4/FacturaElectronica.xsd", import.meta.url),
);

/** Validate locally. Diagnostic output may include confidential invoice values. */
export async function validateSignedInvoice(xml: Uint8Array, timeoutMs: number): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647)
    throw new Error("Invalid XML validation timeout");
  if (!xml.byteLength || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(Buffer.from(xml).toString("utf8")))
    throw new Error("Invalid fiscal XML");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("xmllint", ["--nonet", "--noout", "--schema", invoiceSchema, "-"], {
      stdio: ["pipe", "ignore", "ignore"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: { PATH: process.env.PATH, XML_CATALOG_FILES: "" },
    });
    child.on("error", () => reject(new Error("Fiscal XML validator unavailable")));
    child.stdin.on("error", () => reject(new Error("Fiscal XML validation failed")));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Fiscal XML validation failed"));
    });
    child.stdin.end(xml);
  });
}
