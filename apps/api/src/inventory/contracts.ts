import { applyDecorators } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
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
} from "class-validator";
import { movementKinds, type StockMovementInput } from "@vetx/database";
import { PageQueryDto } from "../care/contracts.js";

const label = (max: number) =>
  applyDecorators(
    ApiProperty({ maxLength: max }),
    IsString(),
    MaxLength(max),
    Matches(/^(?=.*\S)[^\p{Cc}]+$/u),
  );
const id = () => ApiProperty({ format: "uuid" });
const nullableId = () =>
  applyDecorators(
    ApiProperty({ type: "string", format: "uuid", nullable: true }),
    ValidateIf((_value, field: unknown) => field !== null),
    IsUUID(),
  );
export class WarehouseInputDto {
  @label(120) readonly name!: string;
  @ApiProperty({ type: "integer", minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  readonly revision!: number;
}
export class WarehouseDto extends WarehouseInputDto {
  @id() readonly id!: string;
}
export class StockItemInputDto extends WarehouseInputDto {
  @label(80) readonly sku!: string;
  @label(40) readonly unit!: string;
}
export class StockItemDto extends StockItemInputDto {
  @id() readonly id!: string;
}
export class StockSearchDto extends PageQueryDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly query?: string;
}
export class MovementInputDto {
  @ApiProperty({ enum: [...movementKinds] })
  @IsIn(movementKinds)
  readonly kind!: StockMovementInput["kind"];
  @id() @IsUUID() readonly itemId!: string;
  @nullableId() readonly fromWarehouseId!: string | null;
  @nullableId() readonly toWarehouseId!: string | null;
  @ApiProperty({ type: "string", description: "Positive decimal, up to three fractional places" })
  @IsString()
  @Matches(/^(?!0(?:\.0{1,3})?$)(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/)
  readonly quantity!: string;
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/^[^\p{Cc}]*$/u)
  readonly lot!: string;
  @label(250) readonly reason!: string;
}
class LedgerActorDto {
  @ApiProperty() readonly issuer!: string;
  @ApiProperty() readonly subject!: string;
}
export class MovementDto extends MovementInputDto {
  @id() readonly id!: string;
  @ApiProperty({ type: "string", nullable: true }) readonly fromBalance!: string | null;
  @ApiProperty({ type: "string", nullable: true }) readonly toBalance!: string | null;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
  @ApiProperty({ type: LedgerActorDto }) readonly actor!: LedgerActorDto;
}
class StockBalanceDto {
  @id() readonly warehouseId!: string;
  @ApiProperty() readonly warehouseName!: string;
  @id() readonly itemId!: string;
  @ApiProperty() readonly itemName!: string;
  @ApiProperty() readonly sku!: string;
  @ApiProperty() readonly unit!: string;
  @ApiProperty() readonly lot!: string;
  @ApiProperty({ type: "string" }) readonly quantity!: string;
}
class PageDto {
  @ApiProperty({ type: "integer" }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
export class WarehousePageDto extends PageDto {
  @ApiProperty({ type: [WarehouseDto] }) readonly warehouses!: WarehouseDto[];
}
export class StockItemPageDto extends PageDto {
  @ApiProperty({ type: [StockItemDto] }) readonly items!: StockItemDto[];
}
export class BalancePageDto extends PageDto {
  @ApiProperty({ type: [StockBalanceDto] }) readonly balances!: StockBalanceDto[];
}
export class MovementPageDto extends PageDto {
  @ApiProperty({ type: [MovementDto] }) readonly movements!: MovementDto[];
}
