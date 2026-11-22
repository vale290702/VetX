import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Inject,
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
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { PrismaDatabase } from "@vetx/database";
import type { StaffPrincipal } from "@vetx/permissions";
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiErrorDto, ResourceSummaryDto } from "./http.js";
import { BearerAuthGuard, StaffIdentity } from "./identity-context.js";

const integerMax = 2_147_483_647;
const roles = ["ADMIN", "STAFF"] as const;
type Role = (typeof roles)[number];

class DirectoryRevisionDto {
  @ApiProperty({ type: "integer", minimum: 0, maximum: integerMax })
  @IsInt()
  @Min(0)
  @Max(integerMax)
  readonly revision!: number;
}

class ClinicUpdateDto extends DirectoryRevisionDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/^(?=.*\S)[^\p{Cc}]+$/u)
  readonly name!: string;
}

class MemberIdentityDto extends DirectoryRevisionDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @Matches(/^[\x21-\x7e]{1,255}$/u)
  readonly subject!: string;
}

class MemberAccessDto extends MemberIdentityDto {
  @ApiProperty({ enum: roles })
  @IsIn(roles)
  readonly role!: Role;

  @ApiProperty({ type: "array", items: { type: "string", format: "uuid" }, uniqueItems: true })
  @IsArray()
  @ArrayUnique()
  @IsUUID("all", { each: true })
  readonly clinicIds!: string[];
}

class DirectoryMemberDto {
  @ApiProperty()
  readonly subject!: string;
  @ApiProperty({ enum: roles })
  readonly role!: Role;
  @ApiProperty({ type: "array", items: { type: "string", format: "uuid" } })
  readonly clinicIds!: string[];
}

class AdministrationDto extends DirectoryRevisionDto {
  @ApiProperty({ type: [ResourceSummaryDto] })
  readonly clinics!: ResourceSummaryDto[];
  @ApiProperty({ type: [DirectoryMemberDto] })
  readonly members!: DirectoryMemberDto[];
  @ApiProperty({ type: "integer", minimum: 1 })
  readonly page!: number;
  @ApiProperty()
  readonly hasNextPage!: boolean;
}

export const directoryProvider = Symbol("clinicAdministration");

export type DirectoryStore = Pick<
  PrismaDatabase,
  "readAdministration" | "saveClinic" | "saveMember" | "removeMember"
>;

@ApiTags("clinic administration")
@ApiBearerAuth()
@ApiParam({ name: "organizationId", format: "uuid" })
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
@UseGuards(BearerAuthGuard)
@Controller("organizations/:organizationId/administration")
export class AdministrationController {
  constructor(@Inject(directoryProvider) private readonly store: DirectoryStore | null) {}

  private get directory() {
    if (!this.store) throw new ServiceUnavailableException();
    return this.store;
  }

  @Get()
  @ApiOperation({
    operationId: "readClinicAdministration",
    summary: "Read an organization's clinics and a page of staff memberships",
  })
  @ApiQuery({ name: "page", required: false, schema: { type: "integer", minimum: 1, default: 1 } })
  @ApiOkResponse({ type: AdministrationDto })
  read(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) orgId: string,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    if (page < 1 || page > integerMax) throw new BadRequestException();
    return this.directory.readAdministration(actor, orgId, page);
  }

  @Put("clinics/:clinicId")
  @ApiOperation({
    operationId: "saveClinic",
    summary: "Create or rename a clinic at the supplied directory revision",
  })
  @ApiParam({ name: "clinicId", format: "uuid" })
  @ApiOkResponse({ type: DirectoryRevisionDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  saveClinic(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) orgId: string,
    @Param("clinicId", ParseUUIDPipe) clinicId: string,
    @Body() input: ClinicUpdateDto,
  ) {
    return this.directory.saveClinic(actor, orgId, clinicId, input.name.trim(), input.revision);
  }

  @Put("members")
  @ApiOperation({
    operationId: "saveStaffMembership",
    summary: "Assign the membership and clinic access of one staff identity",
  })
  @ApiOkResponse({ type: DirectoryRevisionDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  saveMember(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) orgId: string,
    @Body() input: MemberAccessDto,
  ) {
    if (input.role === "ADMIN" && input.clinicIds.length) throw new BadRequestException();
    return this.directory.saveMember(
      actor,
      orgId,
      input.subject,
      input.role,
      input.clinicIds,
      input.revision,
    );
  }

  @Post("members/revoke")
  @HttpCode(200)
  @ApiOperation({
    operationId: "revokeStaffMembership",
    summary: "Revoke a staff membership in the selected organization",
  })
  @ApiOkResponse({ type: DirectoryRevisionDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  removeMember(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) orgId: string,
    @Body() input: MemberIdentityDto,
  ) {
    return this.directory.removeMember(actor, orgId, input.subject, input.revision);
  }
}
