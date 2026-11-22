import {
  type CanActivate,
  Controller,
  createParamDecorator,
  type DynamicModule,
  type ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  ServiceUnavailableException,
  UnauthorizedException,
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
import {
  IdentityProviderUnavailableError,
  InvalidAccessTokenError,
  type TokenVerifier,
} from "@vetx/auth";
import type { ResourceSummary } from "@vetx/database";
import { type AccessPrincipal, isStaffPrincipal, type StaffPrincipal } from "@vetx/permissions";
import type { Request } from "express";
import { ApiErrorDto } from "./http.js";

export interface AccessDependencies {
  tokenVerifier?: TokenVerifier;
  database?: {
    listOrganizations(principal: StaffPrincipal): Promise<ResourceSummary[]>;
    listClinics(
      principal: StaffPrincipal,
      organizationId: string,
    ): Promise<ResourceSummary[] | null>;
  };
}

const tokenVerifierProvider = Symbol("tokenVerifier");
const accessDatabaseProvider = Symbol("accessDatabase");

interface AuthenticatedRequest extends Request {
  vetxPrincipal?: AccessPrincipal;
}

@Injectable()
class BearerAuthGuard implements CanActivate {
  constructor(
    @Inject(tokenVerifierProvider) private readonly tokenVerifier: TokenVerifier | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [header, duplicate] = request.headersDistinct.authorization ?? [];
    const token = header?.match(/^Bearer +([\w-]+\.[\w-]+\.[\w-]+)$/i)?.[1];
    if (!token || duplicate !== undefined) {
      throw new UnauthorizedException();
    }
    if (!this.tokenVerifier) {
      throw new ServiceUnavailableException();
    }

    try {
      request.vetxPrincipal = await this.tokenVerifier.verify(token);
      return true;
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw new UnauthorizedException();
      }
      if (error instanceof IdentityProviderUnavailableError) {
        throw new ServiceUnavailableException();
      }
      throw error;
    }
  }
}

const Principal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessPrincipal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().vetxPrincipal;
    if (!principal) {
      throw new UnauthorizedException();
    }
    return principal;
  },
);

class ResourceSummaryDto {
  @ApiProperty({ format: "uuid" })
  readonly id!: string;

  @ApiProperty()
  readonly name!: string;
}

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

@Module({ controllers: [AccessController], providers: [BearerAuthGuard] })
export class AccessModule {
  static register(dependencies: AccessDependencies): DynamicModule {
    return {
      module: AccessModule,
      providers: [
        { provide: tokenVerifierProvider, useValue: dependencies.tokenVerifier ?? null },
        { provide: accessDatabaseProvider, useValue: dependencies.database ?? null },
      ],
    };
  }
}
