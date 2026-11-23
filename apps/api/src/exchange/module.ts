import {
  applyDecorators,
  BadRequestException,
  Body,
  type CanActivate,
  Controller,
  DefaultValuePipe,
  type DynamicModule,
  type ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, MulterModule } from "@nestjs/platform-express";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { isUUID } from "class-validator";
import type { Request } from "express";
import type { AccessPrincipal, OwnerPrincipal, StaffPrincipal } from "@vetx/permissions";
import { ApiErrorDto } from "../http.js";
import { BearerAuthGuard, OwnerIdentity, StaffIdentity } from "../identity-context.js";
import {
  ExchangeCommitDto,
  ExchangeOptionsDto,
  ExchangePreviewDto,
  ExportChoicesDto,
  ExportRequestDto,
  ImportChoiceDto,
  ImportedRecordsDto,
} from "./contracts.js";
import { ExchangeService, type ExchangeDependencies } from "./service.js";

const idParam = (name: string) => ApiParam({ name, format: "uuid" });
const secured = () =>
  applyDecorators(
    ApiTags("clinical exchange"),
    ApiBearerAuth(),
    UseGuards(BearerAuthGuard),
    ApiUnauthorizedResponse({ type: ApiErrorDto }),
    ApiForbiddenResponse({ type: ApiErrorDto }),
    ApiNotFoundResponse({ type: ApiErrorDto }),
    ApiBadRequestResponse({ type: ApiErrorDto }),
    ApiConflictResponse({ type: ApiErrorDto }),
    ApiServiceUnavailableResponse({ type: ApiErrorDto }),
  );
const pages = () =>
  ApiQuery({ name: "page", required: false, schema: { type: "integer", minimum: 1, default: 1 } });
const binary = () =>
  applyDecorators(
    ApiProduces("application/octet-stream"),
    ApiOkResponse({ schema: { type: "string", format: "binary" } }),
    Header("X-Content-Type-Options", "nosniff"),
    Header("Content-Security-Policy", "sandbox; default-src 'none'"),
  );
const pagePipe = new DefaultValuePipe(1);
function pageNumber(page: number) {
  if (page < 1 || page > 2147483647) throw new BadRequestException();
  return page;
}
@Injectable()
class ImportUploadGuard implements CanActivate {
  constructor(@Inject(ExchangeService) private readonly exchange: ExchangeService) {}
  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { vetxPrincipal?: AccessPrincipal }>();
    const actor = request.vetxPrincipal;
    if (!actor || actor.kind !== "staff") throw new ForbiddenException();
    const { organizationId, clinicId } = request.params;
    if (
      typeof organizationId !== "string" ||
      typeof clinicId !== "string" ||
      !isUUID(organizationId) ||
      !isUUID(clinicId)
    )
      throw new BadRequestException();
    await this.exchange.checkStaff({ ...actor, kind: "staff" }, { organizationId, clinicId });
    // Reject an unconfigured receiver before the multipart parser allocates its buffer.
    if (
      !this.exchange.keys.clinic({ organizationId, clinicId })?.encryption.some((key) => key.jwk.d)
    )
      throw new ForbiddenException();
    return true;
  }
}
@secured()
@idParam("organizationId")
@idParam("clinicId")
@Controller("organizations/:organizationId/clinics/:clinicId")
class StaffExchange {
  constructor(@Inject(ExchangeService) private readonly service: ExchangeService) {}
  @Post("exchange/imports/preview")
  @HttpCode(200)
  @ApiOperation({ operationId: "previewClinicalImport" })
  @ApiOkResponse({ type: ExchangePreviewDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @UseGuards(ImportUploadGuard)
  @UseInterceptors(FileInterceptor("file"))
  preview(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("clinicId", ParseUUIDPipe) clinicId: string,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file?.buffer.length) throw new BadRequestException();
    if (file.buffer.length > this.service.settings.maxPackageBytes)
      throw new PayloadTooLargeException();
    return this.service.preview(actor, { organizationId, clinicId }, file.buffer);
  }
  @Put("exchange/imports/:receiptId/commit")
  @idParam("receiptId")
  @ApiOperation({ operationId: "commitClinicalImport" })
  @ApiOkResponse({ type: ExchangeCommitDto })
  commit(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("clinicId", ParseUUIDPipe) clinicId: string,
    @Param("receiptId", ParseUUIDPipe) receipt: string,
    @Body() input: ImportChoiceDto,
  ) {
    if (input.mode === "match" && input.patientId)
      return this.service.commit(actor, { organizationId, clinicId }, receipt, {
        mode: "match",
        patientId: input.patientId,
      });
    if (input.mode === "create" && input.patientId === undefined)
      return this.service.commit(actor, { organizationId, clinicId }, receipt, { mode: "create" });
    throw new BadRequestException();
  }
  @Get("patients/:patientId/imported-records")
  @idParam("patientId")
  @pages()
  @ApiOperation({ operationId: "listImportedRecords" })
  @ApiOkResponse({ type: ImportedRecordsDto })
  history(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Query("page", pagePipe, ParseIntPipe) page: number,
  ) {
    return this.service.db.listImportedRecords(actor, org, clinic, patient, pageNumber(page));
  }
  @Get("patients/:patientId/imported-records/:importedId/content")
  @idParam("patientId")
  @idParam("importedId")
  @binary()
  @ApiOperation({ operationId: "downloadImportedAttachment" })
  content(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("clinicId", ParseUUIDPipe) clinicId: string,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("importedId", ParseUUIDPipe) id: string,
  ) {
    return this.service.importedFile(actor, { organizationId, clinicId, patientId }, id);
  }
}
@secured()
@idParam("petId")
@Controller("owner/pets/:petId")
class OwnerExchange {
  constructor(@Inject(ExchangeService) private readonly service: ExchangeService) {}
  @Get("exchange-options")
  @ApiOperation({ operationId: "listPetExchangeOptions" })
  @ApiOkResponse({ type: ExchangeOptionsDto })
  options(@OwnerIdentity() owner: OwnerPrincipal, @Param("petId", ParseUUIDPipe) pet: string) {
    return this.service.locations(owner, pet);
  }
  @Get("exchange-options/:organizationId/:clinicId/:patientId/records")
  @idParam("organizationId")
  @idParam("clinicId")
  @idParam("patientId")
  @pages()
  @ApiOperation({ operationId: "listPetExportRecords" })
  @ApiOkResponse({ type: ExportChoicesDto })
  list(
    @OwnerIdentity() owner: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("clinicId", ParseUUIDPipe) clinicId: string,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Query("page", pagePipe, ParseIntPipe) page: number,
  ) {
    return this.service.db.ownerExportChoices(
      owner,
      pet,
      { organizationId, clinicId, patientId },
      pageNumber(page),
    );
  }
  @Post("exports")
  @HttpCode(200)
  @binary()
  @ApiOperation({ operationId: "exportReleasedRecords" })
  export(
    @OwnerIdentity() owner: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Body() input: ExportRequestDto,
  ) {
    return this.service.export(owner, pet, input.source, input.destination, input);
  }
}
@Module({ controllers: [StaffExchange, OwnerExchange], providers: [ImportUploadGuard] })
export class ClinicalExchangeModule {
  static register(deps: ExchangeDependencies = {}): DynamicModule {
    return {
      module: ClinicalExchangeModule,
      providers: [{ provide: ExchangeService, useFactory: () => new ExchangeService(deps) }],
      imports: [
        MulterModule.register({
          limits: {
            fileSize: (deps.settings?.maxPackageBytes ?? 0) + 1,
            files: 1,
            fields: 0,
            parts: 2,
          },
        }),
      ],
    };
  }
}
