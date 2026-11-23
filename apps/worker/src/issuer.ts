import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FiscalXmlSigner,
  HaciendaClient,
  HaciendaError,
  FiscalSnapshotError,
  FiscalXmlValidationError,
  prepareFiscalInvoice,
  type HaciendaSettings,
} from "@vetx/fiscal-cr";
import type { LoadIssuer } from "./delivery.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function mountedIssuers(
  root: string,
  environment: string,
  settings: HaciendaSettings,
): LoadIssuer {
  return async (job) => {
    if (!uuid.test(job.organizationId) || !uuid.test(job.clinicId))
      throw new HaciendaError("configuration");
    // Only the deployment can write to the mount. Clinic-supplied paths are never used.
    const folder = join(root, environment, job.organizationId, job.clinicId);
    async function text(name: string) {
      const value = (await readFile(join(folder, name), "utf8")).trim();
      if (!value) throw new HaciendaError("configuration");
      return value;
    }
    try {
      const [issuerNumber, username, password] = await Promise.all([
        text("issuer-number"),
        text("username"),
        text("password"),
      ]);
      if (issuerNumber !== job.snapshot.issuer.identity.number)
        throw new HaciendaError("configuration");
      return {
        reception: new HaciendaClient(settings, { username, password }),
        async prepare(snapshot) {
          let key: Buffer | undefined;
          try {
            const [certificate, policyUrl, digest, document] = await Promise.all([
              text("certificate.pem"),
              text("policy-url"),
              text("policy-sha256"),
              readFile(join(folder, "policy.pdf")),
            ]);
            key = await readFile(join(folder, "private.pem"));
            let passphrase: string | undefined;
            try {
              passphrase = await text("passphrase");
            } catch (error) {
              if (!(
                error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "ENOENT"
              ))
                throw error;
            }
            const signer = await FiscalXmlSigner.create({
              certificate,
              privateKey: key,
              policyDocument: document,
              policyUrl,
              policyDigest: digest,
              ...(passphrase ? { passphrase } : {}),
            });
            return await prepareFiscalInvoice(snapshot, signer, settings.timeoutMs);
          } catch (error) {
            if (error instanceof FiscalXmlValidationError)
              throw new HaciendaError(
                error.kind === "unavailable" ? "unavailable" : "invalid_submission",
              );
            if (error instanceof FiscalSnapshotError) throw new HaciendaError("invalid_submission");
            throw new HaciendaError("configuration");
          } finally {
            key?.fill(0);
          }
        },
      };
    } catch {
      throw new HaciendaError("configuration");
    }
  };
}
