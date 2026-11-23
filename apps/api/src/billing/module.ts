import {
  Body,
  Controller,
  type DynamicModule,
  Get,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { PrismaDatabase } from "@vetx/database";
import type { StaffPrincipal } from "@vetx/permissions";
import { BearerAuthGuard, StaffIdentity } from "../identity-context.js";
import { ApiErrorDto } from "../http.js";
import { PageQueryDto } from "../care/contracts.js";
import {
  CashShiftDto,
  CloseShiftDto,
  PaymentDto,
  PaymentInputDto,
  PaymentsDto,
  PriceDto,
  PriceInputDto,
  PriceQueryDto,
  PricesDto,
  SaleDto,
  SaleInputDto,
  SalesDto,
  ShiftInputDto,
  ShiftsDto,
} from "./contracts.js";
export type BillingStore = Pick<
  PrismaDatabase,
  | "listBillingPrices"
  | "saveBillingPrice"
  | "listSales"
  | "createSale"
  | "getSale"
  | "listPayments"
  | "takePayment"
  | "listShifts"
  | "openShift"
  | "closeShift"
>;
const storeKey = Symbol("clinical billing store");
const id = (name: string) => ApiParam({ name, format: "uuid" });
@UseGuards(BearerAuthGuard)
@ApiTags("clinic billing")
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
@id("organizationId")
@id("clinicId")
@Controller("organizations/:organizationId/clinics/:clinicId/billing")
class BillingController {
  constructor(@Inject(storeKey) private readonly db: BillingStore | null) {}
  private get store() {
    if (!this.db) throw new ServiceUnavailableException();
    return this.db;
  }
  @Get("prices")
  @ApiOperation({ operationId: "listBillingPrices" })
  @ApiOkResponse({ type: PricesDto })
  listBillingPrices(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() filter: PriceQueryDto,
  ) {
    return this.store.listBillingPrices(actor, org, clinic, filter.query ?? "", filter.page);
  }
  @Put("prices/:priceId")
  @ApiOperation({ operationId: "saveBillingPrice" })
  @ApiOkResponse({ type: PriceDto })
  @id("priceId")
  saveBillingPrice(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("priceId", ParseUUIDPipe) priceId: string,
    @Body() input: PriceInputDto,
  ) {
    return this.store.saveBillingPrice(actor, org, clinic, priceId, input);
  }
  @Get("sales")
  @ApiOperation({ operationId: "listSales" })
  @ApiOkResponse({ type: SalesDto })
  listSales(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() filter: PageQueryDto,
  ) {
    return this.store.listSales(actor, org, clinic, filter.page);
  }
  @Put("sales/:saleId")
  @ApiOperation({ operationId: "createSale" })
  @ApiOkResponse({ type: SaleDto })
  @id("saleId")
  createSale(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("saleId", ParseUUIDPipe) saleId: string,
    @Body() input: SaleInputDto,
  ) {
    return this.store.createSale(actor, org, clinic, saleId, input);
  }
  @Get("sales/:saleId")
  @ApiOperation({ operationId: "getSale" })
  @ApiOkResponse({ type: SaleDto })
  @id("saleId")
  getSale(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("saleId", ParseUUIDPipe) saleId: string,
  ) {
    return this.store.getSale(actor, org, clinic, saleId);
  }
  @Get("sales/:saleId/payments")
  @ApiOperation({ operationId: "listPayments" })
  @ApiOkResponse({ type: PaymentsDto })
  @id("saleId")
  listPayments(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("saleId", ParseUUIDPipe) saleId: string,
    @Query() filter: PageQueryDto,
  ) {
    return this.store.listPayments(actor, org, clinic, saleId, filter.page);
  }
  @Put("sales/:saleId/payments/:paymentId")
  @ApiOperation({ operationId: "takePayment" })
  @ApiOkResponse({ type: PaymentDto })
  @id("saleId")
  @id("paymentId")
  takePayment(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("saleId", ParseUUIDPipe) saleId: string,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Body() input: PaymentInputDto,
  ) {
    return this.store.takePayment(actor, org, clinic, saleId, paymentId, input);
  }
  @Get("shifts")
  @ApiOperation({ operationId: "listShifts" })
  @ApiOkResponse({ type: ShiftsDto })
  listShifts(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() filter: PageQueryDto,
  ) {
    return this.store.listShifts(actor, org, clinic, filter.page);
  }
  @Put("shifts/:shiftId")
  @ApiOperation({ operationId: "openShift" })
  @ApiOkResponse({ type: CashShiftDto })
  @id("shiftId")
  openShift(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Body() input: ShiftInputDto,
  ) {
    return this.store.openShift(actor, org, clinic, shiftId, input);
  }
  @Put("shifts/:shiftId/close")
  @ApiOperation({ operationId: "closeShift" })
  @ApiOkResponse({ type: CashShiftDto })
  @id("shiftId")
  closeShift(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Body() input: CloseShiftDto,
  ) {
    return this.store.closeShift(actor, org, clinic, shiftId, input.counted);
  }
}
@Module({ controllers: [BillingController] })
export class BillingModule {
  static register(db?: BillingStore): DynamicModule {
    return { module: BillingModule, providers: [{ provide: storeKey, useValue: db ?? null }] };
  }
}
