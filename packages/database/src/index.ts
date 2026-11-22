import { PrismaPg } from "@prisma/adapter-pg";
import type { StaffPrincipal } from "@vetx/permissions";
import { type Prisma, PrismaClient } from "./generated/client.js";

const probeTimeoutMs = 1_000;

export interface ResourceSummary {
  id: string;
  name: string;
}

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

  checkReady(): Promise<void> {
    return this.client.$transaction((transaction) => this.requireRowSecurity(transaction));
  }

  private async requireRowSecurity(transaction: Prisma.TransactionClient): Promise<void> {
    // The empty read also acquires relation locks until the transaction ends.
    await transaction.$queryRaw`
      SELECT 1 FROM public.organizations, public.clinics, public.users,
                    public.organization_memberships, public.clinic_grants
      LIMIT 0
    `;
    const [result] = await transaction.$queryRaw<{ active: boolean }[]>`
      SELECT current_setting('row_security') = 'on' AND bool_and(row_security_active(relation)) AS active
      FROM unnest(ARRAY['public.users', 'public.organization_memberships', 'public.clinic_grants',
                        'public.organizations', 'public.clinics']::regclass[]) AS tables(relation)
    `;
    if (!result?.active) throw new Error("Database row security is inactive");
  }

  listOrganizations(principal: StaffPrincipal): Promise<ResourceSummary[]> {
    return this.withStaffAccess(principal, "", (transaction) =>
      transaction.organization.findMany({
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    );
  }

  listClinics(
    principal: StaffPrincipal,
    organizationId: string,
  ): Promise<ResourceSummary[] | null> {
    return this.withStaffAccess(principal, organizationId, async (transaction) => {
      const rows = await transaction.$queryRaw<(ResourceSummary | { id: null; name: null })[]>`
        SELECT clinic.id, clinic.name
        FROM public.organizations AS organization
        LEFT JOIN public.clinics AS clinic ON clinic.organization_id = organization.id
        WHERE organization.id = ${organizationId}::uuid
        ORDER BY clinic.name, clinic.id
      `;
      // The left join distinguishes a visible organization with no accessible clinics.
      return rows.length === 0 ? null : rows.filter((row) => row.id !== null);
    });
  }

  private withStaffAccess<T>(
    principal: StaffPrincipal,
    organizationId: string,
    use: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (transaction) => {
      await this.requireRowSecurity(transaction);
      await transaction.$queryRaw`
        SELECT
          set_config('vetx.identity_issuer', ${principal.issuer}, true),
          set_config('vetx.identity_subject', ${principal.subject}, true),
          set_config('vetx.client_kind', ${principal.kind}, true),
          set_config('vetx.organization_id', ${organizationId}, true)
      `;
      return use(transaction);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
