import {
  BadRequestException,
  Body,
  Controller,
  type DynamicModule,
  Get,
  Inject,
  Module,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  ServiceUnavailableException,
  StreamableFile,
  Header,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FiscalDraft, PrismaDatabase } from "@vetx/database";
import type { StaffPrincipal } from "@vetx/permissions";
import { ApiErrorDto } from "../http.js";
import { BearerAuthGuard, StaffIdentity } from "../identity-context.js";
import { Environment, FiscalDraftDto, FiscalRecordDto, FiscalStatusDto } from "./contracts.js";

export type FiscalStore = Pick<
  PrismaDatabase,
  "fiscalStatus" | "issueFiscalInvoice" | "retryFiscalInvoice" | "fiscalArtifact"
>;
enum Artifact {
  Invoice = "invoice",
  Receipt = "receipt",
}
const storeKey = Symbol("fiscal outbox");
@UseGuards(BearerAuthGuard)
@ApiTags("clinic fiscal invoices")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
@ApiParam({ name: "organizationId", format: "uuid" })
@ApiParam({ name: "clinicId", format: "uuid" })
@ApiParam({ name: "saleId", format: "uuid" })
@ApiParam({ name: "environment", enum: Environment })
@Controller(
  "organizations/:organizationId/clinics/:clinicId/billing/sales/:saleId/fiscal/:environment",
)
class FiscalController {
  constructor(@Inject(storeKey) private readonly database: FiscalStore | null) {}
  private get db() {
    if (!this.database) throw new ServiceUnavailableException();
    return this.database;
  }
  @Get()
  @ApiOperation({ operationId: "getFiscalInvoiceStatus" })
  @ApiOkResponse({ type: FiscalStatusDto })
  status(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("saleId", ParseUUIDPipe) sale: string,
    @Param("environment", new ParseEnumPipe(Environment)) env: Environment,
  ) {
    return this.db.fiscalStatus(actor, org, clinic, sale, env);
  }
  @Put()
  @ApiOperation({ operationId: "issueFiscalInvoice" })
  @ApiOkResponse({ type: FiscalRecordDto })
  issue(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("saleId", ParseUUIDPipe) sale: string,
    @Param("environment", new ParseEnumPipe(Environment)) env: Environment,
    @Body() input: FiscalDraftDto,
  ) {
    if (input.terms.code === "01" && input.terms.days !== undefined)
      throw new BadRequestException();
    const draft: FiscalDraft = {
      ...input,
      terms: input.terms.code === "02" ? { code: "02", days: input.terms.days! } : { code: "01" },
    };
    return this.db.issueFiscalInvoice(actor, org, clinic, sale, env, draft);
  }
  @Get("artifacts/:kind")
  @ApiOperation({ operationId: "downloadFiscalArtifact" })
  @ApiParam({ name: "kind", enum: Artifact })
  @ApiProduces("application/xml")
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Content-Security-Policy", "sandbox; default-src 'none'")
  async download(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("saleId", ParseUUIDPipe) sale: string,
    @Param("environment", new ParseEnumPipe(Environment)) env: Environment,
    @Param("kind", new ParseEnumPipe(Artifact)) kind: Artifact,
  ) {
    const { key, xml } = await this.db.fiscalArtifact(actor, org, clinic, sale, env, kind);
    return new StreamableFile(xml, {
      type: "application/xml",
      length: xml.length,
      disposition: `attachment; filename="${/^\d{50}$/.test(key) ? key : sale}-${kind}.xml"`,
    });
  }
  @Put("retry")
  @ApiOperation({ operationId: "retryFiscalInvoice" })
  @ApiOkResponse({ type: FiscalRecordDto })
  retry(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("saleId", ParseUUIDPipe) sale: string,
    @Param("environment", new ParseEnumPipe(Environment)) env: Environment,
    @Body() data: unknown,
  ) {
    if (
      data !== undefined &&
      (data === null ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        Object.keys(data).length > 0)
    )
      throw new BadRequestException();
    return this.db.retryFiscalInvoice(actor, org, clinic, sale, env);
  }
}
@Module({ controllers: [FiscalController] })
export class FiscalModule {
  static register(store?: FiscalStore): DynamicModule {
    return { module: FiscalModule, providers: [{ provide: storeKey, useValue: store ?? null }] };
  }
}
