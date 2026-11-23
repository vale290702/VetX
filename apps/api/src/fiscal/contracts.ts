import { applyDecorators } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import tariffRates from "@vetx/fiscal-cr/vat-tariffs";
import unitCodes from "@vetx/fiscal-cr/unit-codes";

export enum Environment {
  Sandbox = "sandbox",
  Production = "production",
}
const optional = () => ValidateIf((_obj, value: unknown) => value !== undefined);
const clean = (min: number, max: number) =>
  applyDecorators(IsString(), Length(min, max), Matches(/^(?=.*\S)[^\p{Cc}]+$/u));
const nested = (type: () => new () => object) =>
  applyDecorators(IsDefined(), IsObject(), ValidateNested(), Type(type));
const identityTypes = ["01", "02", "03", "04", "05", "06"] as const;
class RecipientIdentityDto {
  @ApiProperty({ enum: [...identityTypes] }) @IsIn(identityTypes) readonly type!: string;
  @ApiProperty({ pattern: "^[0-9]{1,12}$" }) @Matches(/^\d{1,12}$/) readonly number!: string;
}
class RecipientDto {
  @ApiProperty({ minLength: 3, maxLength: 100 }) @clean(3, 100) readonly name!: string;
  @ApiProperty({ type: RecipientIdentityDto })
  @nested(() => RecipientIdentityDto)
  readonly identity!: RecipientIdentityDto;
  @ApiPropertyOptional({ format: "email", maxLength: 160 })
  @optional()
  @IsEmail()
  @MaxLength(160)
  readonly email?: string;
}
class TermsDto {
  @ApiProperty({ enum: ["01", "02"] }) @IsIn(["01", "02"]) readonly code!: "01" | "02";
  @ApiPropertyOptional({ type: "integer", minimum: 1, maximum: 99999 })
  @ValidateIf((v: TermsDto) => v.code === "02" || v.days !== undefined)
  @IsInt()
  @Min(1)
  @Max(99999)
  readonly days?: number;
}
class MedicineDto {
  @ApiProperty({ maxLength: 100 }) @clean(1, 100) readonly registration!: string;
  @ApiProperty({ maxLength: 3 }) @clean(1, 3) readonly form!: string;
}
class FiscalClassDto {
  @ApiProperty({ enum: unitCodes }) @IsIn(unitCodes) readonly unitCode!: string;
  @ApiProperty({ enum: ["goods", "service"] }) @IsIn(["goods", "service"]) readonly category!:
    "goods" | "service";
  @ApiProperty({ enum: Object.keys(tariffRates) })
  @IsIn(Object.keys(tariffRates))
  readonly vatTariffCode!: string;
  @ApiPropertyOptional({ type: MedicineDto })
  @optional()
  @nested(() => MedicineDto)
  readonly medicine?: MedicineDto;
}
export class FiscalDraftDto {
  @ApiProperty({ type: RecipientDto })
  @nested(() => RecipientDto)
  readonly recipient!: RecipientDto;
  @ApiPropertyOptional({ pattern: "^[0-9]{6}$" })
  @optional()
  @Matches(/^\d{6}$/)
  readonly recipientActivity?: string;
  @ApiProperty({ type: TermsDto }) @nested(() => TermsDto) readonly terms!: TermsDto;
  @ApiProperty()
  @Matches(/^(?!0(?:\.0{1,5})?$)(0|[1-9]\d{0,12})(\.\d{1,5})?$/)
  readonly exchangeRate!: string;
  @ApiProperty({ type: [FiscalClassDto], minItems: 1, maxItems: 1000 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => FiscalClassDto)
  readonly lines!: FiscalClassDto[];
}
export class FiscalRecordDto {
  @ApiProperty({ format: "uuid" }) readonly id!: string;
  @ApiProperty({ format: "uuid" }) readonly saleId!: string;
  @ApiProperty({ enum: Environment }) readonly environment!: Environment;
  @ApiProperty({ pattern: "^[0-9]{50}$" }) readonly key!: string;
  @ApiProperty({
    enum: [
      "pending",
      "signed",
      "sending",
      "submitted",
      "processing",
      "accepted",
      "rejected",
      "invalid",
      "blocked",
    ],
  })
  readonly state!: string;
  @ApiProperty({ type: "string", nullable: true }) readonly issue!: string | null;
  @ApiProperty({ format: "date-time" }) readonly createdAt!: string;
  @ApiProperty() readonly hasSignedXml!: boolean;
  @ApiProperty() readonly hasReceipt!: boolean;
}
export class FiscalStatusDto {
  @ApiProperty() readonly enabled!: boolean;
  @ApiProperty({ type: FiscalRecordDto, nullable: true }) readonly invoice!: FiscalRecordDto | null;
}
