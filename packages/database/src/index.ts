import { PrismaPg } from "@prisma/adapter-pg";
import type { AccessPrincipal, OwnerPrincipal, StaffPrincipal } from "@vetx/permissions";
import {
  type AdministrationDirectory,
  directoryResult,
  type DirectoryRevision,
  type DirectoryRole,
} from "./directory.js";
import {
  type Guardian,
  type GuardianInput,
  type IssuePetLinkInput,
  type OwnerPet,
  type PatientDetail,
  type PatientInput,
  type PatientPage,
  type PatientSummary,
  type RedeemPetLinkInput,
  registryResult,
  type RegistryErrorCode,
} from "./registry.js";
import { Prisma, PrismaClient } from "./generated/client.js";

export {
  type AdministrationDirectory,
  DirectoryError,
  type DirectoryMember,
  type DirectoryRevision,
  type DirectoryRole,
} from "./directory.js";

export * from "./registry.js";
export * from "./documents.js";
import type {
  DocumentInput,
  DocumentSharing,
  DocumentPage,
  StaffDocument,
  OwnerDocument,
} from "./documents.js";

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
      SELECT organizations.directory_revision FROM public.organizations, public.clinics, public.users,
                    public.organization_memberships, public.clinic_grants
      LIMIT 0
    `;
    await transaction.$queryRaw`SELECT public.registry_lock_tables() AS locked`;
    await transaction.$queryRaw`SELECT public.document_lock_tables() AS locked`;
    const [result] = await transaction.$queryRaw<{ active: boolean }[]>`
      SELECT current_setting('row_security') = 'on'
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles
          WHERE (rolsuper OR rolbypassrls OR rolname = 'vetx_migration')
            AND pg_has_role(session_user, oid, 'MEMBER')
        )
        AND bool_and(row_security_active(relation) AND pg_class.relforcerowsecurity) AS active
      FROM unnest(ARRAY['public.users', 'public.organization_memberships', 'public.clinic_grants',
                        'public.organizations', 'public.clinics', 'public.directory_events',
                        'public.patients', 'public.owner_contacts', 'public.guardians',
                        'public.registry_events', 'public.pet_link_attempts', 'public.medical_documents', 'public.document_events']::regclass[]) AS tables(relation)
      JOIN pg_catalog.pg_class ON pg_class.oid = relation
    `;
    if (!result?.active) throw new Error("Database row security is inactive");
  }

  listOrganizations(principal: StaffPrincipal): Promise<ResourceSummary[]> {
    return this.withAccess(principal, "", (transaction) =>
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
    return this.withAccess(principal, organizationId, async (transaction) => {
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

  readAdministration(
    principal: StaffPrincipal,
    organizationId: string,
    page: number,
  ): Promise<AdministrationDirectory> {
    return this.directoryQuery(
      principal,
      organizationId,
      Prisma.sql`SELECT public.directory_read(${page}::integer) AS result`,
    );
  }

  saveClinic(
    principal: StaffPrincipal,
    organizationId: string,
    clinicId: string,
    name: string,
    revision: number,
  ): Promise<DirectoryRevision> {
    return this.directoryQuery(
      principal,
      organizationId,
      Prisma.sql`SELECT public.directory_save_clinic(${clinicId}::uuid, ${name}, ${revision}::integer) AS result`,
    );
  }

  saveMember(
    principal: StaffPrincipal,
    organizationId: string,
    subject: string,
    role: DirectoryRole,
    clinicIds: string[],
    revision: number,
  ): Promise<DirectoryRevision> {
    return this.directoryQuery(
      principal,
      organizationId,
      Prisma.sql`SELECT public.directory_set_member(${subject}, ${role}::public.organization_role, ${clinicIds}::uuid[], ${revision}::integer) AS result`,
    );
  }

  removeMember(
    principal: StaffPrincipal,
    organizationId: string,
    subject: string,
    revision: number,
  ): Promise<DirectoryRevision> {
    return this.directoryQuery(
      principal,
      organizationId,
      Prisma.sql`SELECT public.directory_set_member(${subject}, NULL, ARRAY[]::uuid[], ${revision}::integer) AS result`,
    );
  }

  listPatients(
    principal: StaffPrincipal,
    org: string,
    clinic: string,
    page: number,
    search: string,
  ): Promise<PatientPage> {
    return this.registryQuery(
      principal,
      org,
      clinic,
      Prisma.sql`SELECT public.registry_list(${page}::int, ${search}) AS result`,
    );
  }

  getPatient(
    principal: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
  ): Promise<PatientDetail> {
    return this.registryQuery(
      principal,
      org,
      clinic,
      Prisma.sql`SELECT public.registry_detail(${patient}::uuid) AS result`,
    );
  }

  savePatient(
    principal: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    input: PatientInput,
  ): Promise<PatientSummary> {
    return this.registryQuery(
      principal,
      org,
      clinic,
      Prisma.sql`SELECT public.registry_save_patient(
      ${patient}::uuid, ${input.name}, ${input.species}, ${input.birthDate}::text, ${input.revision}::int) AS result`,
    );
  }

  addGuardian(
    principal: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    guardian: string,
    input: GuardianInput,
  ): Promise<Guardian> {
    return this.registryQuery(
      principal,
      org,
      clinic,
      Prisma.sql`SELECT public.registry_add_guardian(
      ${patient}::uuid, ${guardian}::uuid, ${input.name}, ${input.email}) AS result`,
    );
  }

  async removeGuardian(
    principal: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    guardian: string,
  ): Promise<void> {
    await this.registryQuery(
      principal,
      org,
      clinic,
      Prisma.sql`SELECT public.registry_remove_guardian(${patient}::uuid, ${guardian}::uuid) AS result`,
    );
  }

  issuePetLink(
    principal: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    guardian: string,
    input: IssuePetLinkInput,
  ): Promise<{ expiresAt: string }> {
    return this.registryQuery(
      principal,
      org,
      clinic,
      Prisma.sql`SELECT public.registry_issue(
      ${patient}::uuid, ${guardian}::uuid, ${input.requestId}::uuid, ${input.digest}, ${input.lifetimeSeconds}::int) AS result`,
    );
  }

  redeemPetLink(principal: OwnerPrincipal, input: RedeemPetLinkInput): Promise<{ petId: string }> {
    return this.registryQuery(
      principal,
      "",
      "",
      Prisma.sql`SELECT public.registry_redeem(
      ${input.digest}, ${input.requestId}::uuid, ${input.existingPetId ?? null}::uuid,
      ${input.attemptLimit}::int, ${input.windowSeconds}::int) AS result`,
      principal.verifiedEmail,
    );
  }

  listOwnerPets(principal: OwnerPrincipal): Promise<{ pets: OwnerPet[] }> {
    return this.registryQuery(
      principal,
      "",
      "",
      Prisma.sql`SELECT public.registry_owner_pets() AS result`,
    );
  }

  reserveDocument(
    actor: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    id: string,
    input: DocumentInput,
  ): Promise<StaffDocument> {
    return this.registryQuery(
      actor,
      org,
      clinic,
      Prisma.sql`SELECT public.document_reserve(${patient}::uuid,${id}::uuid,${input.title},${input.mediaType},${input.byteLength}::int,${input.sha256}) AS result`,
    );
  }
  finishDocument(
    actor: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    id: string,
    sha256: string,
  ): Promise<StaffDocument> {
    return this.registryQuery(
      actor,
      org,
      clinic,
      Prisma.sql`SELECT public.document_finish(${patient}::uuid,${id}::uuid,${sha256}) AS result`,
    );
  }
  shareDocument(
    actor: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    id: string,
    sharing: DocumentSharing,
  ): Promise<DocumentSharing> {
    return this.registryQuery(
      actor,
      org,
      clinic,
      Prisma.sql`SELECT public.document_share(${patient}::uuid,${id}::uuid,${sharing.guardianIds}::uuid[],${sharing.revision}::int) AS result`,
    );
  }
  getDocument(
    actor: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    id: string,
  ): Promise<StaffDocument> {
    return this.registryQuery(
      actor,
      org,
      clinic,
      Prisma.sql`SELECT public.document_staff_read(${patient}::uuid,${id}::uuid,1) AS result`,
    );
  }
  listDocuments(
    actor: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    page: number,
  ): Promise<DocumentPage<StaffDocument>> {
    return this.registryQuery(
      actor,
      org,
      clinic,
      Prisma.sql`SELECT public.document_staff_read(${patient}::uuid,NULL,${page}::int) AS result`,
    );
  }
  getOwnerDocument(actor: OwnerPrincipal, pet: string, asset: string): Promise<OwnerDocument> {
    return this.registryQuery(
      actor,
      "",
      "",
      Prisma.sql`SELECT public.document_owner_read(${pet}::uuid,${asset}::uuid,1) AS result`,
    );
  }
  listOwnerDocuments(
    actor: OwnerPrincipal,
    pet: string,
    page: number,
  ): Promise<DocumentPage<OwnerDocument>> {
    return this.registryQuery(
      actor,
      "",
      "",
      Prisma.sql`SELECT public.document_owner_read(${pet}::uuid,NULL,${page}::int) AS result`,
    );
  }

  private async registryQuery<T>(
    principal: AccessPrincipal,
    org: string,
    clinic: string,
    query: Prisma.Sql,
    verifiedEmail = "",
  ): Promise<T> {
    const rows = await this.withAccess(principal, org, async (transaction) => {
      await transaction.$queryRaw`SELECT set_config('vetx.clinic_id', ${clinic}, true),
        set_config('vetx.verified_email', ${verifiedEmail}, true)`;
      return transaction.$queryRaw<{ result: T | { error: RegistryErrorCode } }[]>(query);
    });
    // A rejected redemption still commits its rate-limit counter.
    return registryResult(rows);
  }

  private directoryQuery<T extends DirectoryRevision>(
    principal: StaffPrincipal,
    organizationId: string,
    query: Prisma.Sql,
  ): Promise<T> {
    return this.withAccess(principal, organizationId, async (transaction) =>
      directoryResult<T>(await transaction.$queryRaw(query)),
    );
  }

  private withAccess<T>(
    principal: AccessPrincipal,
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
