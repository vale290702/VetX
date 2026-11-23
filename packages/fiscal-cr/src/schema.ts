import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const invoiceSchema = fileURLToPath(
  new URL("../schemas/2026/4.4/FacturaElectronica.xsd", import.meta.url),
);

export class FiscalXmlValidationError extends Error {
  constructor(readonly kind: "invalid" | "unavailable") {
    super(kind === "invalid" ? "Fiscal XML validation failed" : "Fiscal XML validator unavailable");
    this.name = "FiscalXmlValidationError";
  }
}

function startValidator(timeoutMs: number) {
  try {
    return spawn("xmllint", ["--nonet", "--noout", "--schema", invoiceSchema, "-"], {
      stdio: ["pipe", "ignore", "ignore"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: { PATH: process.env.PATH, XML_CATALOG_FILES: "" },
    });
  } catch {
    throw new FiscalXmlValidationError("unavailable");
  }
}

/** Validate locally. Diagnostic output may include confidential invoice values. */
export async function validateSignedInvoice(xml: Uint8Array, timeoutMs: number): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647)
    throw new FiscalXmlValidationError("unavailable");
  if (!xml.byteLength || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(Buffer.from(xml).toString("utf8")))
    throw new FiscalXmlValidationError("invalid");
  await new Promise<void>((resolve, reject) => {
    const child = startValidator(timeoutMs);
    let inputFailed = false;
    child.once("error", () => reject(new FiscalXmlValidationError("unavailable")));
    // A validator can reject the document before it consumes the whole pipe.
    // Wait for the exit status so an EPIPE cannot mask a timeout or schema failure.
    child.stdin.once("error", () => {
      inputFailed = true;
    });
    child.once("close", (code, signal) => {
      if (signal === null && code === 0 && !inputFailed) return resolve();
      // libxml2 reports schema/DTD validation failures with 3 or 4. Code 1 is
      // generic; failures to compile the schema, OOM and signals are operational.
      const invalid = signal === null && (code === 3 || code === 4);
      reject(new FiscalXmlValidationError(invalid ? "invalid" : "unavailable"));
    });
    child.stdin.end(xml);
  });
}
