import { applyDecorators } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { WarehouseInputDto } from "../inventory/contracts.js";

const uuid = () => applyDecorators(ApiProperty({ format: "uuid" }), IsUUID());
const quantity = () =>
  applyDecorators(
    ApiProperty({
      type: "string",
      description: "Positive quantity with up to three decimal places",
    }),
    IsString(),
    Matches(/^(?!0(?:\.0{1,3})?$)(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/),
  );
const label = (max: number) =>
  applyDecorators(
    ApiProperty({ maxLength: max }),
    IsString(),
    MaxLength(max),
    Matches(/^(?=.*\S)[^\p{Cc}]+$/u),
  );
const revision = () =>
  applyDecorators(ApiProperty({ type: "integer", minimum: 0 }), IsInt(), Min(0), Max(2147483647));
const array = (type: () => new () => object) =>
  applyDecorators(
    ApiProperty({ type: () => [type()], minItems: 1, maxItems: 100 }),
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(100),
    ValidateNested({ each: true }),
    Type(type),
  );

export class SupplierInputDto extends WarehouseInputDto {}
export class SupplierDto extends SupplierInputDto {
  @uuid() readonly id!: string;
}
class TradeAuthorDto {
  @ApiProperty() readonly issuer!: string;
  @ApiProperty() readonly subject!: string;
}
class TradeEventDto {
  @uuid() readonly id!: string;
  @ApiProperty({ type: TradeAuthorDto }) readonly author!: TradeAuthorDto;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
}
export class OrderLineInputDto {
  @uuid() readonly itemId!: string;
  @quantity() readonly quantity!: string;
}
export class PurchaseInputDto {
  @uuid() readonly supplierId!: string;
  @array(() => OrderLineInputDto)
  @ArrayUnique((value: unknown) =>
    value && typeof value === "object" && "itemId" in value && typeof value.itemId === "string"
      ? value.itemId.toLowerCase()
      : value,
  )
  readonly lines!: OrderLineInputDto[];
}
class OrderLineDto extends OrderLineInputDto {
  @ApiProperty() readonly itemName!: string;
  @ApiProperty() readonly unit!: string;
  @ApiProperty() readonly receivedQuantity!: string;
}
export class PurchaseOrderDto extends TradeEventDto {
  @uuid() readonly supplierId!: string;
  @ApiProperty() readonly supplierName!: string;
  @ApiProperty({ enum: ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED"] }) readonly status!:
    "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED";
  @ApiProperty({ type: [OrderLineDto] }) readonly lines!: OrderLineDto[];
}
export class DispensingInputDto {
  @uuid() readonly warehouseId!: string;
  @quantity() readonly quantity!: string;
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\p{Cc}]*$/u)
  readonly lot!: string;
}
class ReceiptLineInputDto extends DispensingInputDto {
  @uuid() readonly itemId!: string;
}
export class ReceiptInputDto {
  @array(() => ReceiptLineInputDto) readonly lines!: ReceiptLineInputDto[];
}
class ReceiptLineDto extends ReceiptLineInputDto {
  @uuid() readonly movementId!: string;
}
export class PurchaseReceiptDto extends TradeEventDto {
  @uuid() readonly orderId!: string;
  @ApiProperty({ type: [ReceiptLineDto] }) readonly lines!: ReceiptLineDto[];
}
export class SupplierReturnInputDto {
  @uuid() readonly receiptMovementId!: string;
  @quantity() readonly quantity!: string;
  @label(250) readonly reason!: string;
}
export class SupplierReturnDto extends TradeEventDto {
  @uuid() readonly orderId!: string;
  @uuid() readonly receiptMovementId!: string;
  @uuid() readonly movementId!: string;
  @ApiProperty() readonly quantity!: string;
  @ApiProperty() readonly reason!: string;
}
export class CapabilityInputDto {
  @ApiProperty() @IsBoolean() readonly canPrescribe!: boolean;
  @ApiProperty() @IsBoolean() readonly canDispense!: boolean;
  @revision() readonly revision!: number;
}
export class CapabilityDto extends CapabilityInputDto {
  @ApiProperty() readonly issuer!: string;
  @ApiProperty() readonly subject!: string;
  @ApiProperty() readonly clinicAccess!: boolean;
}
export class RxSharingDto {
  @ApiProperty({
    type: "array",
    items: { type: "string", format: "uuid" },
    uniqueItems: true,
    maxItems: 100,
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((id: unknown) => (typeof id === "string" ? id.toLowerCase() : id))
  @IsUUID(undefined, { each: true })
  readonly guardianIds!: string[];
  @revision() readonly revision!: number;
}
export class PrescriptionInputDto {
  @uuid() readonly itemId!: string;
  @label(250) readonly medication!: string;
  @ApiProperty({ maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  @Matches(/\S/)
  @Matches(/^(?:[^\p{Cc}]|[\t\r\n])*$/u)
  readonly instructions!: string;
  @quantity() readonly quantity!: string;
}
export class PrescriptionDto extends TradeEventDto {
  @uuid() readonly patientId!: string;
  @uuid() readonly itemId!: string;
  @ApiProperty() readonly itemName!: string;
  @ApiProperty() readonly unit!: string;
  @ApiProperty() readonly medication!: string;
  @ApiProperty() readonly instructions!: string;
  @ApiProperty() readonly quantity!: string;
  @ApiProperty() readonly dispensedQuantity!: string;
  @ApiProperty({ type: RxSharingDto }) readonly sharing!: RxSharingDto;
}
export class OwnerPrescriptionDto {
  @uuid() readonly id!: string;
  @uuid() readonly patientId!: string;
  @uuid() readonly clinicId!: string;
  @ApiProperty() readonly clinicName!: string;
  @ApiProperty() readonly organizationName!: string;
  @ApiProperty() readonly medication!: string;
  @ApiProperty() readonly instructions!: string;
  @ApiProperty() readonly quantity!: string;
  @ApiProperty() readonly unit!: string;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
}
export class DispensingDto extends TradeEventDto {
  @uuid() readonly prescriptionId!: string;
  @uuid() readonly movementId!: string;
  @uuid() readonly warehouseId!: string;
  @ApiProperty() readonly lot!: string;
  @ApiProperty() readonly quantity!: string;
}
class TradePageDto {
  @ApiProperty({ type: "integer", minimum: 1 }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
export class SupplierPageDto extends TradePageDto {
  @ApiProperty({ type: [SupplierDto] }) readonly suppliers!: SupplierDto[];
}
export class PurchaseOrderPageDto extends TradePageDto {
  @ApiProperty({ type: [PurchaseOrderDto] }) readonly orders!: PurchaseOrderDto[];
}
export class PurchaseReceiptPageDto extends TradePageDto {
  @ApiProperty({ type: [PurchaseReceiptDto] }) readonly receipts!: PurchaseReceiptDto[];
}
export class SupplierReturnPageDto extends TradePageDto {
  @ApiProperty({ type: [SupplierReturnDto] }) readonly returns!: SupplierReturnDto[];
}
export class CapabilityPageDto extends TradePageDto {
  @ApiProperty({ type: [CapabilityDto] }) readonly capabilities!: CapabilityDto[];
}
export class PrescriptionPageDto extends TradePageDto {
  @ApiProperty({ type: [PrescriptionDto] }) readonly prescriptions!: PrescriptionDto[];
}
export class DispensingPageDto extends TradePageDto {
  @ApiProperty({ type: [DispensingDto] }) readonly dispensings!: DispensingDto[];
}
export class OwnerPrescriptionPageDto extends TradePageDto {
  @ApiProperty({ type: [OwnerPrescriptionDto] }) readonly prescriptions!: OwnerPrescriptionDto[];
}
