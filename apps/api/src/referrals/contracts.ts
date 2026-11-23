import { applyDecorators } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import type { ReferralStatus } from "@vetx/database";
import { PageQueryDto } from "../care/contracts.js";

const uuid = () => applyDecorators(ApiProperty({ format: "uuid" }), IsUUID());
const revision = () =>
  applyDecorators(ApiProperty({ type: "integer", minimum: 1 }), IsInt(), Min(1), Max(2147483647));
const narrative = () =>
  applyDecorators(
    ApiProperty({ maxLength: 8000 }),
    IsString(),
    MaxLength(8000),
    Matches(/^(?:[^\p{Cc}]|[\t\r\n])*$/u),
  );

export class ReferralClinicIdDto {
  @uuid() readonly organizationId!: string;
  @uuid() readonly clinicId!: string;
}
class ReferralClinicLabelDto extends ReferralClinicIdDto {
  @ApiProperty() readonly organizationName!: string;
  @ApiProperty() readonly clinicName!: string;
}
class ReferralDestinationDto extends ReferralClinicIdDto {
  @ApiProperty() readonly name!: string;
}
export class ReferralDestinationsDto {
  @ApiProperty({ type: [ReferralDestinationDto] }) readonly destinations!: ReferralDestinationDto[];
}
export class RequestReferralDto {
  @uuid() readonly guardianId!: string;
  @ApiProperty({ type: ReferralClinicIdDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ReferralClinicIdDto)
  readonly destination!: ReferralClinicIdDto;
  @ApiProperty({ maxLength: 250 })
  @IsString()
  @MaxLength(250)
  @Matches(/^(?=.*\S)[^\p{Cc}]+$/u)
  readonly reason!: string;
  @narrative() readonly summary!: string;
}
export class ReferralFilterDto extends PageQueryDto {
  @ApiProperty({ enum: ["incoming", "outgoing"] })
  @IsIn(["incoming", "outgoing"])
  readonly direction!: "incoming" | "outgoing";
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() readonly patientId?: string;
}
export class ReferralDecisionDto {
  @revision() readonly revision!: number;
  @ApiProperty({ enum: ["approve", "decline", "withdraw"] })
  @IsIn(["approve", "decline", "withdraw"])
  readonly action!: "approve" | "decline" | "withdraw";
}
export class CounterReferralDto {
  @revision() readonly revision!: number;
  @narrative() @Matches(/\S/) readonly summary!: string;
}
class ReferralPatientDto {
  @uuid() readonly id!: string;
  @ApiProperty() readonly name!: string;
  @ApiProperty() readonly species!: string;
}
class ReferralAuthorDto {
  @ApiProperty() readonly issuer!: string;
  @ApiProperty() readonly subject!: string;
}
class RecordedCounterReferralDto {
  @ApiProperty() readonly summary!: string;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
  @ApiProperty({ type: ReferralAuthorDto }) readonly author!: ReferralAuthorDto;
}
export class ReferralDto {
  @uuid() readonly id!: string;
  @revision() readonly revision!: number;
  @ApiProperty({ enum: ["REQUESTED", "APPROVED", "DECLINED", "WITHDRAWN", "RESPONDED"] })
  readonly status!: ReferralStatus;
  @ApiProperty({ type: ReferralClinicLabelDto }) readonly source!: ReferralClinicLabelDto;
  @ApiProperty({ type: ReferralClinicLabelDto }) readonly destination!: ReferralClinicLabelDto;
  @ApiProperty({ type: ReferralPatientDto }) readonly patient!: ReferralPatientDto;
  @ApiProperty() readonly reason!: string;
  @ApiProperty() readonly summary!: string;
  @ApiProperty({ format: "date-time" }) readonly requestedAt!: string;
  @ApiProperty({ type: ReferralAuthorDto }) readonly requestedBy!: ReferralAuthorDto;
  @ApiProperty({ type: RecordedCounterReferralDto, nullable: true })
  readonly response!: RecordedCounterReferralDto | null;
}
export class ReferralPageDto {
  @ApiProperty({ type: [ReferralDto] }) readonly referrals!: ReferralDto[];
  @ApiProperty({ type: "integer", minimum: 1 }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
