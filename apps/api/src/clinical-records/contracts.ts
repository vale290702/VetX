import { applyDecorators, BadRequestException } from "@nestjs/common";
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from "@nestjs/swagger";
import { plainToInstance } from "class-transformer";
import {
  ArrayMaxSize,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  validateSync,
} from "class-validator";
import type { ClinicalWrite } from "@vetx/database";
import { SharingDto, instant, revision } from "../care/contracts.js";
const uuid = () => applyDecorators(ApiProperty({ format: "uuid" }), IsUUID());
const kinds = [
  "diagnosis",
  "treatment",
  "vaccination",
  "lab",
  "hospitalization",
  "surgery",
] as const;
const status = ["ORDERED", "RESULTED", "REVIEWED"] as const;
const label = (max: number, optional = false) =>
  applyDecorators(
    ApiProperty({ maxLength: max, required: !optional }),
    ...(optional ? [ValidateIf((_o, v) => v !== undefined)] : []),
    IsString(),
    MaxLength(max),
    Matches(/^(?=.*\S)[^\p{Cc}]+$/u),
  );
const narrative = (optional = false) =>
  applyDecorators(
    ApiProperty({ maxLength: 8000, required: !optional }),
    ...(optional ? [ValidateIf((_o, v) => v !== undefined)] : [Matches(/\S/)]),
    IsString(),
    MaxLength(8000),
    Matches(/^(?:[^\p{Cc}]|[\t\r\n])*$/u),
  );
class DiagnosisDataDto {
  @narrative() readonly diagnosis!: string;
  @label(128, true) readonly code?: string;
}
class TreatmentDataDto {
  @narrative() readonly treatment!: string;
  @narrative(true) readonly notes?: string;
}
class VaccinationDataDto {
  @label(250) readonly vaccine!: string;
  @label(128, true) readonly lotNumber?: string;
  @ApiPropertyOptional({ format: "date" })
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  readonly nextDueDate?: string;
}
class LabDataDto {
  @label(250) readonly test!: string;
  @label(250, true) readonly specimen?: string;
  @ApiProperty({ enum: status }) @IsIn(status) readonly status!: (typeof status)[number];
  @narrative(true) readonly result?: string;
  @label(128, true) readonly unit?: string;
  @label(250, true) readonly referenceRange?: string;
}
const wardStates = ["ADMITTED", "PROGRESS", "DISCHARGED"] as const;
const surgeryStates = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
class HospitalizationDataDto {
  @ApiProperty({ enum: wardStates })
  @IsIn(wardStates)
  readonly status!: (typeof wardStates)[number];
  @label(120) readonly ward!: string;
  @label(120, true) readonly location?: string;
  @narrative() readonly note!: string;
  @narrative(true) readonly summary?: string;
}
class SurgeryDataDto {
  @ApiProperty({ enum: surgeryStates })
  @IsIn(surgeryStates)
  readonly status!: (typeof surgeryStates)[number];
  @label(250) readonly procedure!: string;
  @instant() readonly scheduledAt!: string;
  @narrative(true) readonly notes?: string;
  @label(250, true) readonly performedProcedure?: string;
  @narrative(true) readonly recoveryNotes?: string;
  @narrative(true) readonly summary?: string;
}
class DischargeSummaryDto {
  @ApiProperty({ enum: ["DISCHARGED"] }) readonly status!: "DISCHARGED";
  @narrative() readonly summary!: string;
}
class SurgerySummaryDto {
  @ApiProperty({ enum: ["COMPLETED", "CANCELLED"] }) readonly status!: "COMPLETED" | "CANCELLED";
  @narrative() readonly summary!: string;
}
const generalModels = [DiagnosisDataDto, TreatmentDataDto, VaccinationDataDto, LabDataDto];
const staffModels = [...generalModels, HospitalizationDataDto, SurgeryDataDto];
const ownerModels = [...generalModels, DischargeSummaryDto, SurgerySummaryDto];
const shape = (models: typeof staffModels | typeof ownerModels) =>
  applyDecorators(
    ApiProperty({ oneOf: models.map((m) => ({ $ref: getSchemaPath(m) })) }),
    IsObject(),
  );
@ApiExtraModels(...staffModels, ...ownerModels)
class ClinicalContentDto {
  @ApiProperty({ enum: kinds }) @IsIn(kinds) readonly kind!: (typeof kinds)[number];
  @instant() readonly occurredAt!: string;
}
export class ClinicalWriteDto extends ClinicalContentDto {
  @shape(staffModels) readonly data!: object;
  @uuid() readonly encounterId!: string;
  @revision() readonly revision!: number;
  @label(500, true) readonly changeReason?: string;
}
function validateData<T extends object>(model: new () => T, data: object) {
  const value = plainToInstance(model, data);
  if (validateSync(value, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw new BadRequestException();
  return value;
}
export function clinicalWrite(input: ClinicalWriteDto): ClinicalWrite {
  if ((input.revision === 0) !== (input.changeReason === undefined))
    throw new BadRequestException();
  const base = {
    encounterId: input.encounterId,
    occurredAt: new Date(input.occurredAt).toISOString(),
    revision: input.revision,
    ...(input.changeReason !== undefined ? { changeReason: input.changeReason } : {}),
  };
  switch (input.kind) {
    case "diagnosis":
      return { ...base, kind: input.kind, data: validateData(DiagnosisDataDto, input.data) };
    case "treatment":
      return { ...base, kind: input.kind, data: validateData(TreatmentDataDto, input.data) };
    case "vaccination":
      return { ...base, kind: input.kind, data: validateData(VaccinationDataDto, input.data) };
    case "hospitalization": {
      const data = validateData(HospitalizationDataDto, input.data);
      if (input.revision === 0 && data.status !== "ADMITTED") throw new BadRequestException();
      if (data.status === "DISCHARGED" ? !data.summary?.trim() : data.summary !== undefined)
        throw new BadRequestException();
      return { ...base, kind: input.kind, data };
    }
    case "surgery": {
      const data = validateData(SurgeryDataDto, input.data);
      const completed = data.status === "COMPLETED",
        terminal = completed || data.status === "CANCELLED";
      if (input.revision === 0 && data.status !== "PLANNED") throw new BadRequestException();
      if (terminal ? !data.summary?.trim() : data.summary !== undefined)
        throw new BadRequestException();
      if (
        completed
          ? !(data.performedProcedure && data.recoveryNotes?.trim())
          : data.performedProcedure !== undefined || data.recoveryNotes !== undefined
      )
        throw new BadRequestException();
      return {
        ...base,
        kind: input.kind,
        data: { ...data, scheduledAt: new Date(data.scheduledAt).toISOString() },
      };
    }
    case "lab": {
      const data = validateData(LabDataDto, input.data);
      if (
        data.status === "ORDERED"
          ? [data.result, data.unit, data.referenceRange].some((v) => v !== undefined)
          : !data.result?.trim()
      )
        throw new BadRequestException();
      if (input.revision === 0 && data.status !== "ORDERED") throw new BadRequestException();
      return { ...base, kind: input.kind, data };
    }
  }
}
export class ClinicalSharingDto extends SharingDto {
  @ApiProperty({ type: "integer", minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  readonly recordRevision!: number;
  @ArrayMaxSize(100) declare readonly guardianIds: string[];
}
class AuthorDto {
  @ApiProperty() readonly issuer!: string;
  @ApiProperty() readonly subject!: string;
}
class ClinicalVersionDto extends ClinicalContentDto {
  @uuid() readonly id!: string;
  @uuid() readonly revisionId!: string;
  @uuid() readonly patientId!: string;
  @ApiProperty({ type: "integer" }) readonly revision!: number;
  @instant() readonly recordedAt!: string;
}
export class StaffClinicalDto extends ClinicalVersionDto {
  @shape(staffModels) readonly data!: object;
  @uuid() readonly encounterId!: string;
  @ApiProperty({ type: "string", nullable: true }) readonly changeReason!: string | null;
  @ApiProperty({ type: AuthorDto }) readonly author!: AuthorDto;
  @ApiProperty({ type: SharingDto }) readonly sharing!: SharingDto;
}
export class OwnerClinicalDto extends ClinicalVersionDto {
  @shape(ownerModels) readonly data!: object;
  @uuid() readonly clinicId!: string;
  @ApiProperty() readonly clinicName!: string;
  @ApiProperty() readonly organizationName!: string;
}
class PageDto {
  @ApiProperty({ type: "integer", minimum: 1 }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
export class StaffClinicalPageDto extends PageDto {
  @ApiProperty({ type: [StaffClinicalDto] }) readonly records!: StaffClinicalDto[];
}
export class OwnerClinicalPageDto extends PageDto {
  @ApiProperty({ type: [OwnerClinicalDto] }) readonly records!: OwnerClinicalDto[];
}
