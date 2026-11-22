import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

const probeTimeoutMs = 1_000;

export class PrismaDatabase {
  private readonly client: PrismaClient;

  constructor(databaseUrl: string) {
    this.client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        connectionTimeoutMillis: probeTimeoutMs,
        query_timeout: probeTimeoutMs,
        statement_timeout: probeTimeoutMs,
      }),
    });
  }

  async checkReady(): Promise<void> {
    // PostgreSQL checks permissions on each relation even when no rows are returned.
    await this.client.$queryRaw`
      SELECT 1
      FROM public.organizations
      CROSS JOIN public.clinics
      CROSS JOIN public.users
      LIMIT 0
    `;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
