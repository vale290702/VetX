import {
  HaciendaError,
  type FiscalEnvelope,
  type FiscalInvoice,
  type FiscalReception,
  type FiscalStatus,
} from "@vetx/fiscal-cr";

export interface FiscalJob {
  id: string;
  organizationId: string;
  clinicId: string;
  lease: string;
  key: string;
  state: "pending" | "signed" | "sending" | "submitted" | "processing" | "accepted" | "rejected";
  snapshot: FiscalInvoice;
  signed: string | null;
}
type Outcome =
  "defer" | "submitted" | "processing" | "accepted" | "rejected" | "invalid" | "blocked";
export interface FiscalJobs {
  claim(): Promise<FiscalJob | null>;
  save(job: FiscalJob, bytes: Uint8Array): Promise<boolean>;
  startDelivery(job: FiscalJob): Promise<boolean>;
  finish(
    job: FiscalJob,
    outcome: Outcome,
    issue: string | null,
    delaySeconds: number,
    receipt?: Buffer,
  ): Promise<boolean>;
}
export interface IssuerBinding {
  reception: FiscalReception;
  prepare(snapshot: FiscalInvoice): Promise<FiscalEnvelope>;
}
export type LoadIssuer = (job: FiscalJob) => Promise<IssuerBinding>;

export async function deliverOne(
  jobs: FiscalJobs,
  loadIssuer: LoadIssuer,
  pollSeconds: number,
): Promise<boolean> {
  const job = await jobs.claim();
  if (!job) return false;
  const finish = (
    outcome: Outcome,
    issue: string | null = null,
    delay = pollSeconds,
    receipt?: Buffer,
  ) => jobs.finish(job, outcome, issue, delay, receipt);
  async function record(status: Pick<FiscalStatus, "key" | "state" | "receiptXml">) {
    if (status.key !== job!.key) throw new HaciendaError("unexpected_response");
    if (
      (job!.state === "accepted" && status.state !== "aceptado") ||
      (job!.state === "rejected" && status.state !== "rechazado")
    )
      return finish("defer", "unexpected_response");
    switch (status.state) {
      case "aceptado":
        return finish("accepted", null, status.receiptXml ? 0 : pollSeconds, status.receiptXml);
      case "rechazado":
        return finish("rejected", null, status.receiptXml ? 0 : pollSeconds, status.receiptXml);
      case "error":
        return finish("processing", "authority_error");
      default:
        return finish("processing");
    }
  }
  try {
    const issuer = await loadIssuer(job);
    let bytes = job.signed ? Buffer.from(job.signed, "base64") : undefined;
    if (job.state === "pending") {
      const envelope = await issuer.prepare(job.snapshot);
      if (envelope.key !== job.key || !envelope.signedXml.length)
        throw new HaciendaError("invalid_submission");
      bytes = Buffer.from(envelope.signedXml);
      if (!(await jobs.save(job, bytes))) return true;
    } else if (job.state !== "signed") {
      const status = await issuer.reception.status(job.key);
      if (status) {
        await record(status);
        return true;
      }
      if (job.state !== "sending") {
        // A previously acknowledged intake may temporarily be absent from a status read.
        await finish("defer", "unconfirmed");
        return true;
      }
    }
    if (!bytes) throw new HaciendaError("invalid_submission");
    if (!(await jobs.startDelivery(job))) return true;
    const result = await issuer.reception.submit({
      key: job.key,
      issuer: job.snapshot.issuer.identity,
      recipient: job.snapshot.recipient.identity,
      issuedAt: job.snapshot.issuedAt,
      signedXml: bytes,
    });
    if (result.status === "known") {
      await record(result);
      return true;
    }
    if (result.key !== job.key) throw new HaciendaError("unexpected_response");
    await finish("submitted");
  } catch (error) {
    // Unexpected storage failures preserve the lease and the saved bytes for recovery.
    if (!(error instanceof HaciendaError)) throw error;
    if (["submitted", "processing", "accepted", "rejected"].includes(job.state)) {
      await finish(
        "defer",
        error.kind,
        Math.min(2147483647, Math.max(pollSeconds, error.retryAfterSeconds ?? 0)),
      );
      return true;
    }
    switch (error.kind) {
      case "configuration":
      case "authentication":
        await finish("blocked", error.kind, 0);
        break;
      case "invalid_submission":
        await finish("invalid", error.kind, 0);
        break;
      default:
        await finish(
          "defer",
          error.kind,
          Math.min(2147483647, Math.max(pollSeconds, error.retryAfterSeconds ?? 0)),
        );
    }
  }
  return true;
}
