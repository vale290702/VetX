import type { Pool } from "pg";
import type { FiscalJob, FiscalJobs } from "./delivery.js";
export class PostgresFiscalJobs implements FiscalJobs {
  constructor(
    private readonly pool: Pool,
    private readonly environment: string,
    private readonly leaseSeconds: number,
  ) {}
  async claim(): Promise<FiscalJob | null> {
    const result = await this.pool.query<{ job: FiscalJob | null }>(
      "SELECT public.fiscal_claim($1,$2) AS job",
      [this.environment, this.leaseSeconds],
    );
    return result.rows[0]!.job;
  }
  private async changed(sql: string, params: unknown[]) {
    const result = await this.pool.query<{ ok: boolean }>(sql, params);
    return result.rows[0]!.ok;
  }
  save(job: FiscalJob, bytes: Uint8Array) {
    return this.changed("SELECT public.fiscal_save_signature($1,$2,$3) AS ok", [
      job.id,
      job.lease,
      Buffer.from(bytes),
    ]);
  }
  startDelivery(job: FiscalJob) {
    return this.changed("SELECT public.fiscal_start_delivery($1,$2) AS ok", [job.id, job.lease]);
  }
  finish(
    job: FiscalJob,
    outcome: Parameters<FiscalJobs["finish"]>[1],
    issue: string | null,
    delay: number,
    receipt?: Buffer,
  ) {
    return this.changed("SELECT public.fiscal_finish($1,$2,$3,$4,$5,$6) AS ok", [
      job.id,
      job.lease,
      outcome,
      issue,
      delay,
      receipt ?? null,
    ]);
  }
}
