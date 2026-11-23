import type {
  ExportChoice,
  ExportLocation,
  ExportSelection,
  ExportSnapshot,
  ExportSource,
} from "./export-source.js";
export * from "./export-source.js";
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
import {
  type Appointment,
  type AppointmentFilter,
  type AppointmentInput,
  type AppointmentPage,
  CareError,
  type CareErrorCode,
  type EncounterInput,
  type EncounterPage,
  type EncounterSharing,
  type OwnerEncounter,
  type StaffEncounter,
} from "./care.js";
import {
  ReferralError,
  type ReferralErrorCode,
  type ReferralClinic,
  type Referral,
  type ReferralRequestInput,
  type ReferralResponseInput,
  type ReferralDecision,
  type StaffReferralFilter,
  type ReferralPage,
} from "./referrals.js";
import {
  ExchangeError,
  exchangeMetadata,
  type ExchangeErrorCode,
  type StageExchangeInput,
  type ExchangePreview,
  type ExchangeChoice,
  type ExchangeReceipt,
  type ExchangeCommit,
  type ImportedRecordPage,
  type ImportedAttachment,
} from "./exchange.js";
import { Prisma, PrismaClient } from "./generated/client.js";

export {
  type AdministrationDirectory,
  DirectoryError,
  type DirectoryMember,
  type DirectoryRevision,
  type DirectoryRole,
} from "./directory.js";

export * from "./registry.js";
export * from "./care.js";
export * from "./referrals.js";
export * from "./exchange.js";

export * from "./documents.js";
import type {
  DocumentInput,
  DocumentSharing,
  DocumentPage,
  StaffDocument,
  OwnerDocument,
} from "./documents.js";

const probeTimeoutMs = 1_000;
const exchangeTimeoutMs = 30_000;

export interface ResourceSummary {
  id: string;
  name: string;
}

export class PrismaDatabase {
  private readonly client: PrismaClient;
  private readonly importClient: PrismaClient;

  constructor(databaseUrl: string) {
    this.client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        connectionTimeoutMillis: probeTimeoutMs,
        query_timeout: probeTimeoutMs,
        statement_timeout: probeTimeoutMs,
      }),
    });
    // A verified manifest may contain 24 MiB of clinical text. A small separate
    // pool gives archive writes a bounded budget while preserving probe latency.
    this.importClient = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        max: 2,
        connectionTimeoutMillis: exchangeTimeoutMs,
        query_timeout: exchangeTimeoutMs,
        statement_timeout: exchangeTimeoutMs,
      }),
      transactionOptions: { maxWait: exchangeTimeoutMs, timeout: exchangeTimeoutMs },
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
    await transaction.$queryRaw`SELECT public.registry_lock_tables() AS registry_locked, public.care_lock_tables() AS care_locked, public.document_lock_tables() AS documents_locked, public.exchange_lock_tables() AS exchange_locked, public.export_lock_tables() AS exports_locked, public.referral_lock_tables() AS referrals_locked`;
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
                        'public.registry_events', 'public.pet_link_attempts', 'public.clinical_encounters',
                        'public.encounter_sharing', 'public.encounter_recipients', 'public.appointments', 'public.care_events',
                        'public.referral_states','public.referral_requests','public.referral_responses','public.referral_events',
                        'public.exchange_packages','public.exchange_receipts','public.exchange_patients',
                        'public.exchange_imports','public.exchange_records','public.medical_documents','public.document_events','public.exchange_export_events']::regclass[]) AS tables(relation)
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

  ownerExportLocations(
    principal: OwnerPrincipal,
    pet: string,
  ): Promise<{ sources: ExportSource[] }> {
    return this.registryQuery(
      principal,
      "",
      "",
      Prisma.sql`SELECT public.exchange_owner_locations(${pet}::uuid) AS result`,
    );
  }
  ownerExportChoices(
    principal: OwnerPrincipal,
    pet: string,
    scope: ExportLocation,
    page: number,
  ): Promise<{ records: ExportChoice[]; page: number; hasNextPage: boolean }> {
    return this.registryQuery(
      principal,
      "",
      "",
      Prisma.sql`SELECT public.exchange_owner_choices(${pet}::uuid,${scope.organizationId}::uuid,${scope.clinicId}::uuid,${scope.patientId}::uuid,${page}::int) AS result`,
    );
  }
  confirmOwnerExport(
    principal: OwnerPrincipal,
    pet: string,
    scope: ExportLocation,
    selection: ExportSelection,
    destination: { organizationId: string; clinicId: string },
    packageId: string,
  ): Promise<{ ok: true }> {
    return this.registryQuery(
      principal,
      "",
      "",
      Prisma.sql`SELECT public.exchange_confirm_export(${pet}::uuid,${scope.organizationId}::uuid,${scope.clinicId}::uuid,${scope.patientId}::uuid,${selection.encounterIds}::uuid[],${selection.documentAssetIds}::uuid[],${selection.includeOwner}::boolean,${destination.organizationId}::uuid,${destination.clinicId}::uuid,${packageId}::uuid) AS result`,
      "",
      this.importClient,
    );
  }
  ownerExportSource(
    principal: OwnerPrincipal,
    pet: string,
    scope: ExportLocation,
    selection: ExportSelection,
  ): Promise<ExportSnapshot> {
    return this.registryQuery(
      principal,
      "",
      "",
      Prisma.sql`SELECT public.exchange_owner_source(${pet}::uuid,${scope.organizationId}::uuid,${scope.clinicId}::uuid,${scope.patientId}::uuid,${selection.encounterIds}::uuid[],${selection.documentAssetIds}::uuid[],${selection.includeOwner}::boolean) AS result`,
      "",
      this.importClient,
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

  listEncounters(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    page: number,
  ): Promise<EncounterPage<StaffEncounter>> {
    return this.careQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.care_list_encounters(${patient}::uuid, ${page}::int) AS result`,
    );
  }

  saveEncounter(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    id: string,
    input: EncounterInput,
  ): Promise<StaffEncounter> {
    return this.careQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.care_save_encounter(${patient}::uuid, ${id}::uuid,
      ${input.occurredAt}, ${input.reason}, ${input.subjective}, ${input.objective}, ${input.assessment}, ${input.plan},
      ${input.addendumTo ?? null}::uuid) AS result`,
    );
  }

  shareEncounter(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    id: string,
    input: EncounterSharing,
  ): Promise<EncounterSharing> {
    return this.careQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.care_share_encounter(${patient}::uuid, ${id}::uuid,
      ${input.guardianIds}::uuid[], ${input.revision}::int) AS result`,
    );
  }

  listOwnerEncounters(
    owner: OwnerPrincipal,
    petId: string,
    page: number,
  ): Promise<EncounterPage<OwnerEncounter>> {
    return this.careQuery(
      owner,
      "",
      "",
      Prisma.sql`SELECT public.care_owner_encounters(${petId}::uuid, ${page}::int) AS result`,
    );
  }

  listAppointments(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    filter: AppointmentFilter,
  ): Promise<AppointmentPage> {
    return this.careQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.care_list_appointments(
      ${filter.from}, ${filter.to}, ${filter.page}::int, ${filter.patientId ?? null}::uuid) AS result`,
    );
  }

  saveAppointment(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    id: string,
    input: AppointmentInput,
  ): Promise<Appointment> {
    return this.careQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.care_save_appointment(${id}::uuid, ${input.patientId}::uuid,
      ${input.startAt}, ${input.endAt}, ${input.reason}, ${input.status}, ${input.revision}::int) AS result`,
    );
  }

  requestReferral(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    requestId: string,
    input: ReferralRequestInput,
  ): Promise<Referral> {
    return this.referralQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.referral_request(
      ${patient}::uuid,${requestId}::uuid,${input.guardianId}::uuid,${input.destination.organizationId}::uuid,
      ${input.destination.clinicId}::uuid,${input.reason},${input.summary}) AS result`,
    );
  }

  referralClinicContext(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    incoming: boolean,
  ): Promise<{ sources: ReferralClinic[] }> {
    return this.referralQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.referral_clinic_context(${incoming}::boolean) AS result`,
    );
  }

  referralRoute(
    principal: AccessPrincipal,
    org: string,
    clinic: string,
    referral: string,
    pet: string | null,
  ): Promise<{ source: ReferralClinic; destination: ReferralClinic }> {
    return this.referralQuery(
      principal,
      org,
      clinic,
      Prisma.sql`SELECT public.referral_route(${referral}::uuid,${pet}::uuid) AS result`,
    );
  }

  listStaffReferrals(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    filter: StaffReferralFilter,
    permittedSources?: ReferralClinic[],
  ): Promise<ReferralPage> {
    return this.referralQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.referral_list(
      ${filter.direction},${filter.page}::int,${filter.patientId ?? null}::uuid,NULL::uuid,${permittedSources ? JSON.stringify(permittedSources) : null}::jsonb) AS result`,
    );
  }

  listOwnerReferrals(owner: OwnerPrincipal, pet: string, page: number): Promise<ReferralPage> {
    return this.referralQuery(
      owner,
      "",
      "",
      Prisma.sql`SELECT public.referral_list(
      'owner',${page}::int,NULL::uuid,${pet}::uuid) AS result`,
    );
  }

  decideReferral(
    owner: OwnerPrincipal,
    pet: string,
    referral: string,
    input: ReferralDecision,
  ): Promise<Referral> {
    return this.referralQuery(
      owner,
      "",
      "",
      Prisma.sql`SELECT public.referral_decide(
      ${pet}::uuid,${referral}::uuid,${input.action},${input.revision}::int) AS result`,
    );
  }

  respondReferral(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    referral: string,
    input: ReferralResponseInput,
  ): Promise<Referral> {
    return this.referralQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.referral_respond(
      ${referral}::uuid,${input.summary},${input.revision}::int) AS result`,
    );
  }

  private async referralQuery<T>(
    principal: AccessPrincipal,
    org: string,
    clinic: string,
    query: Prisma.Sql,
  ): Promise<T> {
    const [row] = await this.scopedRows<T, ReferralErrorCode>(principal, org, clinic, query, "");
    const result = row?.result;
    if (!result || typeof result !== "object")
      throw new Error("Database returned no referral result");
    if ("error" in result) throw new ReferralError(result.error);
    return result;
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

  stageExchange(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    input: StageExchangeInput,
  ): Promise<ExchangePreview> {
    const metadata = exchangeMetadata(input.manifest);
    return this.exchangeQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.exchange_stage(
      ${JSON.stringify(metadata)}::jsonb, ${input.archiveSha256}, ${input.byteLength}::integer,
      ${JSON.stringify(input.recordDigests)}::jsonb) AS result`,
      this.importClient,
    );
  }

  getExchangeReceipt(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    receiptId: string,
  ): Promise<ExchangeReceipt> {
    return this.exchangeQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.exchange_receipt(${receiptId}::uuid) AS result`,
    );
  }

  commitExchange(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    receiptId: string,
    choice: ExchangeChoice,
  ): Promise<ExchangeCommit> {
    return this.exchangeQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.exchange_commit(
      ${receiptId}::uuid, ${choice.mode}, ${choice.mode === "match" ? choice.patientId : null}::uuid) AS result`,
      this.importClient,
    );
  }

  listImportedRecords(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    patientId: string,
    page: number,
  ): Promise<ImportedRecordPage> {
    return this.exchangeQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.exchange_records_list(
      ${patientId}::uuid, ${page}::integer) AS result`,
    );
  }

  getImportedAttachment(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    patientId: string,
    importedId: string,
  ): Promise<ImportedAttachment> {
    return this.exchangeQuery(
      staff,
      org,
      clinic,
      Prisma.sql`SELECT public.exchange_attachment(
      ${patientId}::uuid, ${importedId}::uuid) AS result`,
    );
  }

  private async exchangeQuery<T>(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    query: Prisma.Sql,
    client = this.client,
  ): Promise<T> {
    const [row] = await this.scopedRows<T, ExchangeErrorCode>(
      staff,
      org,
      clinic,
      query,
      "",
      client,
    );
    const result = row?.result;
    if (!result || typeof result !== "object")
      throw new Error("Database returned no exchange result");
    if ("error" in result) throw new ExchangeError(result.error);
    return result;
  }

  private async careQuery<T>(
    principal: AccessPrincipal,
    org: string,
    clinic: string,
    query: Prisma.Sql,
  ): Promise<T> {
    const [row] = await this.scopedRows<T, CareErrorCode>(principal, org, clinic, query, "");
    const result = row?.result;
    if (!result || typeof result !== "object") throw new Error("Database returned no care result");
    if ("error" in result) throw new CareError(result.error);
    return result;
  }

  private async registryQuery<T>(
    principal: AccessPrincipal,
    org: string,
    clinic: string,
    query: Prisma.Sql,
    verifiedEmail = "",
    client = this.client,
  ): Promise<T> {
    // A rejected redemption still commits its rate-limit counter.
    return registryResult(
      await this.scopedRows<T, RegistryErrorCode>(
        principal,
        org,
        clinic,
        query,
        verifiedEmail,
        client,
      ),
    );
  }

  private scopedRows<T, E extends string>(
    principal: AccessPrincipal,
    org: string,
    clinic: string,
    query: Prisma.Sql,
    verifiedEmail: string,
    client = this.client,
  ) {
    return this.withAccess(
      principal,
      org,
      async (transaction) => {
        await transaction.$queryRaw`SELECT set_config('vetx.clinic_id', ${clinic}, true),
        set_config('vetx.verified_email', ${verifiedEmail}, true)`;
        return transaction.$queryRaw<{ result: T | { error: E } }[]>(query);
      },
      client,
    );
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
    client = this.client,
  ): Promise<T> {
    return client.$transaction(async (transaction) => {
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
    await Promise.all([this.client.$disconnect(), this.importClient.$disconnect()]);
  }
}
