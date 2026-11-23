import { applyDecorators } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { PageQueryDto } from "../care/contracts.js";

const id = () => applyDecorators(ApiProperty({ format: "uuid" }), IsUUID());
const nullableId = () =>
  applyDecorators(
    ApiProperty({ type: "string", format: "uuid", nullable: true }),
    ValidateIf((_item, value: unknown) => value !== null),
    IsUUID(),
  );
const text = (max: number) =>
  applyDecorators(
    ApiProperty({ maxLength: max }),
    IsString(),
    MaxLength(max),
    Matches(/^(?=.*\S)[^\p{Cc}]+$/u),
  );
const money = () =>
  applyDecorators(
    ApiProperty({ type: "string" }),
    IsString(),
    Matches(/^(0|[1-9]\d{0,12})(\.\d{1,5})?$/),
  );
const currency = () =>
  applyDecorators(
    ApiProperty({ type: "string", minLength: 3, maxLength: 3 }),
    Matches(/^[A-Z]{3}$/),
  );
export class PriceInputDto {
  @text(40) readonly unit!: string;
  @text(120) readonly name!: string;
  @currency() readonly currency!: string;
  @money() readonly unitPrice!: string;
  @money() readonly taxRate!: string;
  @ApiProperty({ type: "string", minLength: 13, maxLength: 13 })
  @Matches(/^\d{13}$/)
  readonly cabys!: string;
  @nullableId() readonly stockItemId!: string | null;
  @ApiProperty({ type: "integer", minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  readonly revision!: number;
}
export class PriceDto extends PriceInputDto {
  @id() readonly id!: string;
}
export class SaleLineInputDto {
  @id() readonly priceId!: string;
  @ApiProperty({ type: "integer", minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  readonly priceRevision!: number;
  @ApiProperty()
  @IsString()
  @Matches(/^(?!0(?:\.0{1,3})?$)(0|[1-9]\d{0,12})(\.\d{1,3})?$/)
  readonly quantity!: string;
  @nullableId() readonly warehouseId!: string | null;
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\p{Cc}]*$/u)
  readonly lot!: string;
}
export class SaleInputDto {
  @currency() readonly currency!: string;
  @nullableId() readonly patientId!: string | null;
  @ApiProperty({ type: [SaleLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SaleLineInputDto)
  readonly lines!: SaleLineInputDto[];
}
export class SaleLineDto extends SaleLineInputDto {
  @ApiProperty() readonly unit!: string;
  @ApiProperty() readonly name!: string;
  @nullableId() readonly stockItemId!: string | null;
  @nullableId() readonly movementId!: string | null;
  @ApiProperty() readonly cabys!: string;
  @ApiProperty() readonly unitPrice!: string;
  @ApiProperty() readonly taxRate!: string;
  @ApiProperty() readonly subtotal!: string;
  @ApiProperty() readonly tax!: string;
  @ApiProperty() readonly total!: string;
}
class ActorDto {
  @ApiProperty() readonly issuer!: string;
  @ApiProperty() readonly subject!: string;
}
export class SaleDto {
  @id() readonly id!: string;
  @ApiProperty() readonly number!: string;
  @ApiProperty() readonly currency!: string;
  @nullableId() readonly patientId!: string | null;
  @ApiProperty({ type: [SaleLineDto] }) readonly lines!: SaleLineDto[];
  @ApiProperty() readonly subtotal!: string;
  @ApiProperty() readonly tax!: string;
  @ApiProperty() readonly total!: string;
  @ApiProperty() readonly paid!: string;
  @ApiProperty() readonly balance!: string;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
  @ApiProperty({ type: ActorDto }) readonly author!: ActorDto;
}
export class ShiftInputDto {
  @text(120) readonly label!: string;
  @currency() readonly currency!: string;
  @money() readonly openingFloat!: string;
}
export class CloseShiftDto {
  @money() readonly counted!: string;
}
export class CashShiftDto extends ShiftInputDto {
  @id() readonly id!: string;
  @ApiProperty() readonly expected!: string;
  @ApiProperty({ type: "string", nullable: true }) readonly counted!: string | null;
  @ApiProperty({ type: "string", nullable: true }) readonly difference!: string | null;
  @ApiProperty({ format: "date-time" }) readonly openedAt!: string;
  @ApiProperty({ type: "string", format: "date-time", nullable: true }) readonly closedAt!:
    string | null;
  @ApiProperty({ type: ActorDto }) readonly cashier!: ActorDto;
}
export class PaymentInputDto {
  @ApiProperty({ enum: ["CASH", "CARD", "TRANSFER"] })
  @IsIn(["CASH", "CARD", "TRANSFER"])
  readonly method!: "CASH" | "CARD" | "TRANSFER";
  @money() readonly amount!: string;
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\p{Cc}]*$/u)
  readonly reference!: string;
  @nullableId() readonly shiftId!: string | null;
}
export class PaymentDto extends PaymentInputDto {
  @id() readonly id!: string;
  @id() readonly saleId!: string;
  @ApiProperty() readonly currency!: string;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
  @ApiProperty({ type: ActorDto }) readonly author!: ActorDto;
}
export class PriceQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly query?: string;
}
class PageDto {
  @ApiProperty({ type: "integer" }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
export class PricesDto extends PageDto {
  @ApiProperty({ type: [PriceDto] }) readonly prices!: PriceDto[];
}
export class SalesDto extends PageDto {
  @ApiProperty({ type: [SaleDto] }) readonly sales!: SaleDto[];
}
export class ShiftsDto extends PageDto {
  @ApiProperty({ type: [CashShiftDto] }) readonly shifts!: CashShiftDto[];
}
export class PaymentsDto extends PageDto {
  @ApiProperty({ type: [PaymentDto] }) readonly payments!: PaymentDto[];
}
