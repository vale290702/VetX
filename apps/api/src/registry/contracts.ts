import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  ValidateIf,
  Min,
} from "class-validator";

const requiredText = /^(?=.*\S)[^\p{Cc}]+$/u;
export class PatientInputDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(requiredText)
  readonly name!: string;
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  @Matches(requiredText)
  readonly species!: string;
  @ApiProperty({ type: "string", format: "date", nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  readonly birthDate!: string | null;
  @ApiProperty({ type: "integer", minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  readonly revision!: number;
}
export class PatientSummaryDto extends PatientInputDto {
  @ApiProperty({ format: "uuid" }) readonly id!: string;
}
export class GuardianInputDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(requiredText)
  readonly name!: string;
  @ApiProperty({ format: "email", maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  readonly email!: string;
}
export class GuardianDto extends GuardianInputDto {
  @ApiProperty({ format: "uuid" }) readonly id!: string;
  @ApiProperty() readonly linked!: boolean;
}
export class PatientDetailDto {
  @ApiProperty({ type: PatientSummaryDto }) readonly patient!: PatientSummaryDto;
  @ApiProperty({ type: [GuardianDto] }) readonly guardians!: GuardianDto[];
}
export class PatientPageDto {
  @ApiProperty({ type: [PatientSummaryDto] }) readonly patients!: PatientSummaryDto[];
  @ApiProperty({ type: "integer", minimum: 1 }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
export class IssueLinkDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() readonly requestId!: string;
}
export class LinkResultDto {
  @ApiProperty() readonly code!: string;
  @ApiProperty({ format: "date-time" }) readonly expiresAt!: string;
}
export class RedeemLinkDto extends IssueLinkDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Fa-f0-9 -]+$/)
  readonly code!: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() readonly existingPetId?: string;
}
export class LinkedPetDto {
  @ApiProperty({ format: "uuid" }) readonly petId!: string;
}
class PetClinicDto {
  @ApiProperty({ format: "uuid" }) readonly clinicId!: string;
  @ApiProperty({ format: "uuid" }) readonly recordId!: string;
  @ApiProperty() readonly clinicName!: string;
  @ApiProperty() readonly organizationName!: string;
}
class OwnerPetDto {
  @ApiProperty({ format: "uuid" }) readonly id!: string;
  @ApiProperty() readonly name!: string;
  @ApiProperty() readonly species!: string;
  @ApiProperty({ type: [PetClinicDto] }) readonly clinics!: PetClinicDto[];
}
export class OwnerPetsDto {
  @ApiProperty({ type: [OwnerPetDto] }) readonly pets!: OwnerPetDto[];
}
