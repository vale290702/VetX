import {
  applyDecorators,
  Body,
  Controller,
  type DynamicModule,
  Get,
  Inject,
  Injectable,
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
import type { StaffPrincipal, OwnerPrincipal } from "@vetx/permissions";
import { ApiErrorDto } from "../http.js";
import { BearerAuthGuard, StaffIdentity, OwnerIdentity } from "../identity-context.js";
import { PageQueryDto } from "../care/contracts.js";
import {
  CapabilityDto,
  CapabilityInputDto,
  CapabilityPageDto,
  DispensingDto,
  DispensingInputDto,
  DispensingPageDto,
  OwnerPrescriptionPageDto,
  PrescriptionDto,
  PrescriptionInputDto,
  PrescriptionPageDto,
  PurchaseInputDto,
  PurchaseOrderDto,
  PurchaseOrderPageDto,
  PurchaseReceiptDto,
  PurchaseReceiptPageDto,
  ReceiptInputDto,
  RxSharingDto,
  SupplierDto,
  SupplierInputDto,
  SupplierPageDto,
  SupplierReturnDto,
  SupplierReturnInputDto,
  SupplierReturnPageDto,
} from "./contracts.js";
export type ProcurementStore = Pick<
  PrismaDatabase,
  | "listSuppliers"
  | "saveSupplier"
  | "listPurchaseOrders"
  | "createPurchaseOrder"
  | "listPurchaseReceipts"
  | "receivePurchaseOrder"
  | "listSupplierReturns"
  | "returnPurchaseStock"
  | "listPharmacyCapabilities"
  | "getPharmacyCapability"
  | "savePharmacyCapability"
  | "listPrescriptions"
  | "prescribe"
  | "sharePrescription"
  | "listDispensings"
  | "dispensePrescription"
  | "listOwnerPrescriptions"
>;
const token = Symbol("purchasing and pharmacy store");
@Injectable()
class ProcurementService {
  constructor(@Inject(token) private readonly database: ProcurementStore | null) {}
  get store() {
    if (!this.database) throw new ServiceUnavailableException();
    return this.database;
  }
}
const secured = () =>
  applyDecorators(
    ApiTags("purchasing and pharmacy"),
    ApiBearerAuth(),
    UseGuards(BearerAuthGuard),
    ApiBadRequestResponse({ type: ApiErrorDto }),
    ApiUnauthorizedResponse({ type: ApiErrorDto }),
    ApiForbiddenResponse({ type: ApiErrorDto }),
    ApiNotFoundResponse({ type: ApiErrorDto }),
    ApiConflictResponse({ type: ApiErrorDto }),
    ApiServiceUnavailableResponse({ type: ApiErrorDto }),
  );
const id = (name: string) => ApiParam({ name, format: "uuid" });
@secured()
@id("organizationId")
@id("clinicId")
@Controller("organizations/:organizationId/clinics/:clinicId")
class ClinicProcurementController {
  constructor(@Inject(ProcurementService) private readonly service: ProcurementService) {}
  @Get("purchasing/suppliers")
  @ApiOperation({ operationId: "listSuppliers" })
  @ApiOkResponse({ type: SupplierPageDto })
  listSuppliers(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() query: PageQueryDto,
  ) {
    return this.service.store.listSuppliers(staff, org, clinic, query.page);
  }
  @Put("purchasing/suppliers/:supplierId")
  @id("supplierId")
  @ApiOperation({ operationId: "saveSupplier" })
  @ApiOkResponse({ type: SupplierDto })
  saveSupplier(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("supplierId", ParseUUIDPipe) supplierId: string,
    @Body() input: SupplierInputDto,
  ) {
    return this.service.store.saveSupplier(staff, org, clinic, supplierId, input);
  }
  @Get("purchasing/orders")
  @ApiOperation({ operationId: "listPurchaseOrders" })
  @ApiOkResponse({ type: PurchaseOrderPageDto })
  listPurchaseOrders(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() query: PageQueryDto,
  ) {
    return this.service.store.listPurchaseOrders(staff, org, clinic, query.page);
  }
  @Put("purchasing/orders/:orderId")
  @id("orderId")
  @ApiOperation({ operationId: "createPurchaseOrder" })
  @ApiOkResponse({ type: PurchaseOrderDto })
  createPurchaseOrder(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: PurchaseInputDto,
  ) {
    return this.service.store.createPurchaseOrder(staff, org, clinic, orderId, input);
  }
  @Get("purchasing/orders/:orderId/receipts")
  @id("orderId")
  @ApiOperation({ operationId: "listPurchaseReceipts" })
  @ApiOkResponse({ type: PurchaseReceiptPageDto })
  listPurchaseReceipts(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.service.store.listPurchaseReceipts(staff, org, clinic, orderId, query.page);
  }
  @Put("purchasing/orders/:orderId/receipts/:receiptId")
  @id("orderId")
  @id("receiptId")
  @ApiOperation({ operationId: "receivePurchaseOrder" })
  @ApiOkResponse({ type: PurchaseReceiptDto })
  receivePurchaseOrder(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("receiptId", ParseUUIDPipe) receiptId: string,
    @Body() input: ReceiptInputDto,
  ) {
    return this.service.store.receivePurchaseOrder(staff, org, clinic, orderId, receiptId, input);
  }
  @Get("purchasing/orders/:orderId/returns")
  @id("orderId")
  @ApiOperation({ operationId: "listSupplierReturns" })
  @ApiOkResponse({ type: SupplierReturnPageDto })
  listSupplierReturns(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.service.store.listSupplierReturns(staff, org, clinic, orderId, query.page);
  }
  @Put("purchasing/orders/:orderId/returns/:returnId")
  @id("orderId")
  @id("returnId")
  @ApiOperation({ operationId: "returnPurchaseStock" })
  @ApiOkResponse({ type: SupplierReturnDto })
  returnPurchaseStock(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("returnId", ParseUUIDPipe) returnId: string,
    @Body() input: SupplierReturnInputDto,
  ) {
    return this.service.store.returnPurchaseStock(staff, org, clinic, orderId, returnId, input);
  }
  @Get("pharmacy/capabilities")
  @ApiOperation({ operationId: "listPharmacyCapabilities" })
  @ApiOkResponse({ type: CapabilityPageDto })
  listPharmacyCapabilities(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() query: PageQueryDto,
  ) {
    return this.service.store.listPharmacyCapabilities(staff, org, clinic, query.page);
  }
  @Get("pharmacy/me")
  @ApiOperation({ operationId: "getPharmacyCapability" })
  @ApiOkResponse({ type: CapabilityDto })
  getPharmacyCapability(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
  ) {
    return this.service.store.getPharmacyCapability(staff, org, clinic);
  }
  @Put("pharmacy/capabilities/:subject")
  @ApiParam({ name: "subject" })
  @ApiOperation({ operationId: "savePharmacyCapability" })
  @ApiOkResponse({ type: CapabilityDto })
  savePharmacyCapability(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("subject") subject: string,
    @Body() input: CapabilityInputDto,
  ) {
    return this.service.store.savePharmacyCapability(staff, org, clinic, subject, input);
  }
  @Get("patients/:patientId/prescriptions")
  @id("patientId")
  @ApiOperation({ operationId: "listPrescriptions" })
  @ApiOkResponse({ type: PrescriptionPageDto })
  listPrescriptions(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.service.store.listPrescriptions(staff, org, clinic, patientId, query.page);
  }
  @Put("patients/:patientId/prescriptions/:rxId")
  @id("patientId")
  @id("rxId")
  @ApiOperation({ operationId: "prescribe" })
  @ApiOkResponse({ type: PrescriptionDto })
  prescribe(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("rxId", ParseUUIDPipe) rxId: string,
    @Body() input: PrescriptionInputDto,
  ) {
    return this.service.store.prescribe(staff, org, clinic, patientId, rxId, input);
  }
  @Put("patients/:patientId/prescriptions/:rxId/sharing")
  @id("patientId")
  @id("rxId")
  @ApiOperation({ operationId: "sharePrescription" })
  @ApiOkResponse({ type: RxSharingDto })
  sharePrescription(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("rxId", ParseUUIDPipe) rxId: string,
    @Body() input: RxSharingDto,
  ) {
    return this.service.store.sharePrescription(staff, org, clinic, patientId, rxId, input);
  }
  @Get("patients/:patientId/prescriptions/:rxId/dispensings")
  @id("patientId")
  @id("rxId")
  @ApiOperation({ operationId: "listDispensings" })
  @ApiOkResponse({ type: DispensingPageDto })
  listDispensings(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("rxId", ParseUUIDPipe) rxId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.service.store.listDispensings(staff, org, clinic, patientId, rxId, query.page);
  }
  @Put("patients/:patientId/prescriptions/:rxId/dispensings/:dispenseId")
  @id("patientId")
  @id("rxId")
  @id("dispenseId")
  @ApiOperation({ operationId: "dispensePrescription" })
  @ApiOkResponse({ type: DispensingDto })
  dispensePrescription(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("rxId", ParseUUIDPipe) rxId: string,
    @Param("dispenseId", ParseUUIDPipe) dispenseId: string,
    @Body() input: DispensingInputDto,
  ) {
    return this.service.store.dispensePrescription(
      staff,
      org,
      clinic,
      patientId,
      rxId,
      dispenseId,
      input,
    );
  }
}
@secured()
@id("petId")
@Controller("owner/pets/:petId/prescriptions")
class OwnerPrescriptionsController {
  constructor(@Inject(ProcurementService) private readonly service: ProcurementService) {}
  @Get()
  @ApiOperation({ operationId: "listOwnerPrescriptions" })
  @ApiOkResponse({ type: OwnerPrescriptionPageDto })
  list(
    @OwnerIdentity() owner: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Query() query: PageQueryDto,
  ) {
    return this.service.store.listOwnerPrescriptions(owner, pet, query.page);
  }
}
@Module({})
export class ProcurementModule {
  static register(store?: ProcurementStore): DynamicModule {
    return {
      module: ProcurementModule,
      controllers: [ClinicProcurementController, OwnerPrescriptionsController],
      providers: [{ provide: token, useValue: store ?? null }, ProcurementService],
    };
  }
}
