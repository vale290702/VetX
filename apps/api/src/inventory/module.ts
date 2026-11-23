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
  BalancePageDto,
  MovementDto,
  MovementInputDto,
  MovementPageDto,
  StockItemDto,
  StockItemInputDto,
  StockItemPageDto,
  StockSearchDto,
  WarehouseDto,
  WarehouseInputDto,
  WarehousePageDto,
} from "./contracts.js";

export type InventoryStore = Pick<
  PrismaDatabase,
  | "saveWarehouse"
  | "listWarehouses"
  | "saveStockItem"
  | "listStockItems"
  | "recordStockMovement"
  | "listStockBalances"
  | "listStockMovements"
>;
const storeKey = Symbol("inventory store");
const uuidParam = (name: string) => ApiParam({ name, format: "uuid" });
@UseGuards(BearerAuthGuard)
@ApiTags("clinic inventory")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
@uuidParam("organizationId")
@uuidParam("clinicId")
@Controller("organizations/:organizationId/clinics/:clinicId/inventory")
class InventoryController {
  constructor(@Inject(storeKey) private readonly db: InventoryStore | null) {}
  private get store() {
    if (!this.db) throw new ServiceUnavailableException();
    return this.db;
  }
  @Get("warehouses")
  @ApiOperation({ operationId: "listWarehouses" })
  @ApiOkResponse({ type: WarehousePageDto })
  warehouses(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() filter: PageQueryDto,
  ) {
    return this.store.listWarehouses(actor, org, clinic, filter.page);
  }
  @Put("warehouses/:warehouseId")
  @uuidParam("warehouseId")
  @ApiOperation({ operationId: "saveWarehouse" })
  @ApiOkResponse({ type: WarehouseDto })
  saveWarehouse(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("warehouseId", ParseUUIDPipe) id: string,
    @Body() input: WarehouseInputDto,
  ) {
    return this.store.saveWarehouse(actor, org, clinic, id, input);
  }
  @Get("items")
  @ApiOperation({ operationId: "listStockItems" })
  @ApiOkResponse({ type: StockItemPageDto })
  items(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() filter: StockSearchDto,
  ) {
    return this.store.listStockItems(actor, org, clinic, filter.query ?? "", filter.page);
  }
  @Put("items/:itemId")
  @uuidParam("itemId")
  @ApiOperation({ operationId: "saveStockItem" })
  @ApiOkResponse({ type: StockItemDto })
  saveItem(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("itemId", ParseUUIDPipe) id: string,
    @Body() input: StockItemInputDto,
  ) {
    return this.store.saveStockItem(actor, org, clinic, id, input);
  }
  @Get("warehouses/:warehouseId/balances")
  @uuidParam("warehouseId")
  @ApiOperation({ operationId: "listStockBalances" })
  @ApiOkResponse({ type: BalancePageDto })
  balances(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("warehouseId", ParseUUIDPipe) id: string,
    @Query() filter: PageQueryDto,
  ) {
    return this.store.listStockBalances(actor, org, clinic, id, filter.page);
  }
  @Get("movements")
  @ApiOperation({ operationId: "listStockMovements" })
  @ApiOkResponse({ type: MovementPageDto })
  movements(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() filter: PageQueryDto,
  ) {
    return this.store.listStockMovements(actor, org, clinic, filter.page);
  }
  @Put("movements/:movementId")
  @uuidParam("movementId")
  @ApiOperation({ operationId: "recordStockMovement" })
  @ApiOkResponse({ type: MovementDto })
  transact(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("movementId", ParseUUIDPipe) id: string,
    @Body() input: MovementInputDto,
  ) {
    return this.store.recordStockMovement(actor, org, clinic, id, input);
  }
}
@Module({ controllers: [InventoryController] })
export class InventoryModule {
  static register(db?: InventoryStore): DynamicModule {
    return { module: InventoryModule, providers: [{ provide: storeKey, useValue: db ?? null }] };
  }
}
