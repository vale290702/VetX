import { createHash, createHmac } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  type DynamicModule,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { PetLinkConfig } from "@vetx/config";
import type { PrismaDatabase } from "@vetx/database";
import type { OwnerPrincipal, StaffPrincipal } from "@vetx/permissions";
import { ApiErrorDto, EmailVerificationRequired } from "../http.js";
import { BearerAuthGuard, OwnerIdentity, StaffIdentity } from "../identity-context.js";
import {
  GuardianDto,
  GuardianInputDto,
  IssueLinkDto,
  LinkedPetDto,
  LinkResultDto,
  OwnerPetsDto,
  PatientDetailDto,
  PatientInputDto,
  PatientPageDto,
  PatientSummaryDto,
  RedeemLinkDto,
} from "./contracts.js";

export type RegistryStore = Pick<
  PrismaDatabase,
  | "listPatients"
  | "getPatient"
  | "savePatient"
  | "addGuardian"
  | "removeGuardian"
  | "issuePetLink"
  | "redeemPetLink"
  | "listOwnerPets"
>;
const storeKey = Symbol("registry store"),
  configKey = Symbol("pet linking config");
const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");
@Injectable()
class RegistryService {
  constructor(
    @Inject(storeKey) private readonly database: RegistryStore | null,
    @Inject(configKey) private readonly config: PetLinkConfig | null,
  ) {}
  get store() {
    if (!this.database) throw new ServiceUnavailableException();
    return this.database;
  }
  private get settings() {
    if (!this.config) throw new ServiceUnavailableException();
    return this.config;
  }
  async issue(
    actor: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    guardian: string,
    requestId: string,
  ) {
    const settings = this.settings;
    const scope = [
      "vetx.link.v1",
      actor.issuer,
      actor.subject,
      ...[org, clinic, patient, guardian, requestId].map((id) => id.toLowerCase()),
    ];
    // A retry can recover its original code without storing the credential on the server.
    const raw = createHmac("sha256", Buffer.from(settings.keyHex, "hex"))
      .update(JSON.stringify(scope))
      .digest("hex")
      .slice(0, 32);
    const { expiresAt } = await this.store.issuePetLink(actor, org, clinic, patient, guardian, {
      requestId,
      digest: digest(raw),
      lifetimeSeconds: settings.lifetimeSeconds,
    });
    return { code: raw.toUpperCase().match(/.{4}/g)!.join("-"), expiresAt };
  }
  redeem(actor: OwnerPrincipal, input: RedeemLinkDto) {
    if (!actor.verifiedEmail) throw new EmailVerificationRequired();
    const raw = input.code.replace(/[ -]/g, "").toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(raw)) throw new BadRequestException();
    const settings = this.settings;
    return this.store.redeemPetLink(actor, {
      digest: digest(raw),
      requestId: input.requestId,
      existingPetId: input.existingPetId,
      attemptLimit: settings.attemptLimit,
      windowSeconds: settings.windowSeconds,
    });
  }
}

@ApiTags("patient registry")
@ApiBearerAuth()
@UseGuards(BearerAuthGuard)
@ApiParam({ name: "organizationId", format: "uuid" })
@ApiParam({ name: "clinicId", format: "uuid" })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
@Controller("organizations/:organizationId/clinics/:clinicId/patients")
class PatientController {
  constructor(@Inject(RegistryService) private readonly registry: RegistryService) {}
  @Get()
  @ApiOperation({ operationId: "listClinicPatients" })
  @ApiOkResponse({ type: PatientPageDto })
  @ApiQuery({ name: "page", required: false, schema: { type: "integer", minimum: 1, default: 1 } })
  @ApiQuery({ name: "search", required: false, schema: { type: "string", maxLength: 120 } })
  list(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("search", new DefaultValuePipe("")) search: string,
  ) {
    if (page < 1 || page > 2_147_483_647 || typeof search !== "string" || search.length > 120)
      throw new BadRequestException();
    return this.registry.store.listPatients(actor, org, clinic, page, search.trim());
  }
  @Get(":patientId")
  @ApiParam({ name: "patientId", format: "uuid" })
  @ApiOperation({ operationId: "getClinicPatient" })
  @ApiOkResponse({ type: PatientDetailDto })
  detail(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
  ) {
    return this.registry.store.getPatient(actor, org, clinic, patient);
  }
  @Put(":patientId")
  @ApiParam({ name: "patientId", format: "uuid" })
  @ApiOperation({ operationId: "saveClinicPatient" })
  @ApiOkResponse({ type: PatientSummaryDto })
  save(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Body() input: PatientInputDto,
  ) {
    if (input.birthDate && input.birthDate > new Date().toISOString().slice(0, 10))
      throw new BadRequestException();
    return this.registry.store.savePatient(actor, org, clinic, patient, {
      name: input.name.trim(),
      species: input.species.trim(),
      birthDate: input.birthDate ?? null,
      revision: input.revision,
    });
  }
  @Put(":patientId/guardians/:guardianId")
  @ApiParam({ name: "patientId", format: "uuid" })
  @ApiParam({ name: "guardianId", format: "uuid" })
  @ApiOperation({ operationId: "addPatientGuardian" })
  @ApiOkResponse({ type: GuardianDto })
  add(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("guardianId", ParseUUIDPipe) guardian: string,
    @Body() input: GuardianInputDto,
  ) {
    return this.registry.store.addGuardian(actor, org, clinic, patient, guardian, {
      name: input.name.trim(),
      email: input.email.toLowerCase(),
    });
  }
  @Delete(":patientId/guardians/:guardianId")
  @HttpCode(204)
  @ApiParam({ name: "patientId", format: "uuid" })
  @ApiParam({ name: "guardianId", format: "uuid" })
  @ApiOperation({ operationId: "removePatientGuardian" })
  @ApiNoContentResponse()
  remove(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("guardianId", ParseUUIDPipe) guardian: string,
  ) {
    return this.registry.store.removeGuardian(actor, org, clinic, patient, guardian);
  }
  @Post(":patientId/guardians/:guardianId/invitations")
  @ApiParam({ name: "patientId", format: "uuid" })
  @ApiParam({ name: "guardianId", format: "uuid" })
  @ApiOperation({ operationId: "issueGuardianPetLink" })
  @ApiCreatedResponse({ type: LinkResultDto })
  issue(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("guardianId", ParseUUIDPipe) guardian: string,
    @Body() input: IssueLinkDto,
  ) {
    return this.registry.issue(actor, org, clinic, patient, guardian, input.requestId);
  }
}
@ApiTags("owner pets")
@ApiBearerAuth()
@UseGuards(BearerAuthGuard)
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
@Controller("owner")
class OwnerPetsController {
  constructor(@Inject(RegistryService) private readonly registry: RegistryService) {}
  @Get("pets")
  @ApiOperation({ operationId: "listOwnerPets" })
  @ApiOkResponse({ type: OwnerPetsDto })
  list(@OwnerIdentity() actor: OwnerPrincipal) {
    return this.registry.store.listOwnerPets(actor);
  }
  @Post("pet-links/redeem")
  @HttpCode(200)
  @ApiOperation({ operationId: "redeemPetLink" })
  @ApiOkResponse({ type: LinkedPetDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  redeem(@OwnerIdentity() actor: OwnerPrincipal, @Body() input: RedeemLinkDto) {
    return this.registry.redeem(actor, input);
  }
}
@Module({ controllers: [PatientController, OwnerPetsController], providers: [RegistryService] })
export class RegistryModule {
  static register(store?: RegistryStore, config?: PetLinkConfig): DynamicModule {
    return {
      module: RegistryModule,
      providers: [
        { provide: storeKey, useValue: store ?? null },
        { provide: configKey, useValue: config ?? null },
      ],
    };
  }
}
