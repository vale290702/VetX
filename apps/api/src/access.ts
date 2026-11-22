import {
  Controller,
  type DynamicModule,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { TokenVerifier } from "@vetx/auth";
import type { ResourceSummary } from "@vetx/database";
import { type AccessPrincipal, isStaffPrincipal, type StaffPrincipal } from "@vetx/permissions";
import {
  AdministrationController,
  directoryProvider,
  type DirectoryStore,
} from "./administration.js";
import { BearerAuthGuard, Principal } from "./identity-context.js";
import { ApiErrorDto, ResourceSummaryDto } from "./http.js";

export interface AccessDependencies {
  tokenVerifier?: TokenVerifier;
  directory?: DirectoryStore;
  database?: {
    listOrganizations(principal: StaffPrincipal): Promise<ResourceSummary[]>;
    listClinics(
      principal: StaffPrincipal,
      organizationId: string,
    ): Promise<ResourceSummary[] | null>;
  };
}

const accessDatabaseProvider = Symbol("accessDatabase");

class MeDto {
  @ApiProperty()
  readonly subject!: string;

  @ApiProperty({ type: [ResourceSummaryDto] })
  readonly organizations!: ResourceSummaryDto[];
}

class ClinicListDto {
  @ApiProperty({ type: [ResourceSummaryDto] })
  readonly clinics!: ResourceSummaryDto[];
}

@ApiTags("access")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
@UseGuards(BearerAuthGuard)
@Controller()
class AccessController {
  constructor(
    @Inject(accessDatabaseProvider)
    private readonly database: NonNullable<AccessDependencies["database"]> | null,
  ) {}

  @Get("me")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    operationId: "getMe",
    summary: "Read the identity and visible organization memberships",
  })
  @ApiOkResponse({ type: MeDto })
  async me(@Principal() principal: AccessPrincipal): Promise<MeDto> {
    if (!isStaffPrincipal(principal)) {
      return { subject: principal.subject, organizations: [] };
    }
    if (!this.database) {
      throw new ServiceUnavailableException();
    }
    const organizations = await this.database.listOrganizations(principal);
    return { subject: principal.subject, organizations };
  }

  @Get("organizations/:organizationId/clinics")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    operationId: "listOrganizationClinics",
    summary: "List visible clinics in a staff organization",
  })
  @ApiParam({ name: "organizationId", format: "uuid" })
  @ApiOkResponse({ type: ClinicListDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  async clinics(
    @Principal() principal: AccessPrincipal,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ): Promise<ClinicListDto> {
    if (!isStaffPrincipal(principal)) {
      throw new ForbiddenException();
    }
    if (!this.database) {
      throw new ServiceUnavailableException();
    }
    const clinics = await this.database.listClinics(principal, organizationId);
    if (!clinics) {
      throw new ForbiddenException();
    }
    return { clinics };
  }
}

@Module({ controllers: [AccessController, AdministrationController], providers: [] })
export class AccessModule {
  static register(dependencies: AccessDependencies): DynamicModule {
    return {
      module: AccessModule,
      providers: [
        { provide: directoryProvider, useValue: dependencies.directory ?? null },
        { provide: accessDatabaseProvider, useValue: dependencies.database ?? null },
      ],
    };
  }
}
