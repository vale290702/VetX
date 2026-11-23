import { applyDecorators } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsObject,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
  ValidateIf,
} from "class-validator";
import { PatientSummaryDto } from "../registry/contracts.js";

const uuid = () => applyDecorators(ApiProperty({ format: "uuid" }), IsUUID());
const uuids = (optional = false) =>
  applyDecorators(
    ApiProperty({
      type: "array",
      items: { type: "string", format: "uuid" },
      uniqueItems: true,
      required: !optional,
    }),
    IsArray(),
    ArrayUnique((v: unknown) => (typeof v === "string" ? v.toLowerCase() : v)),
    IsUUID(undefined, { each: true }),
  );
export class ExchangeClinicDto {
  @uuid() readonly organizationId!: string;
  @uuid() readonly clinicId!: string;
}
export class ExchangeLocationDto extends ExchangeClinicDto {
  @uuid() readonly patientId!: string;
}
class ExchangeDestinationDto extends ExchangeClinicDto {
  @ApiProperty() readonly name!: string;
}
class ExportSourceDto extends ExchangeLocationDto {
  @ApiProperty() readonly organizationName!: string;
  @ApiProperty() readonly clinicName!: string;
  @ApiProperty({ type: [ExchangeDestinationDto] }) readonly destinations!: ExchangeDestinationDto[];
}
export class ExchangeOptionsDto {
  @ApiProperty({ type: [ExportSourceDto] }) readonly sources!: ExportSourceDto[];
}
export class ExportRequestDto {
  @ApiProperty({ type: ExchangeLocationDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ExchangeLocationDto)
  readonly source!: ExchangeLocationDto;
  @ApiProperty({ type: ExchangeClinicDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ExchangeClinicDto)
  readonly destination!: ExchangeClinicDto;
  @uuids() readonly encounterIds!: string[];
  @uuids() readonly documentAssetIds!: string[];
  @uuids(true) @ValidateIf((_o, v) => v !== undefined) readonly clinicalRevisionIds?: string[];
  @uuids(true) @ValidateIf((_o, v) => v !== undefined) readonly prescriptionIds?: string[];
  @ApiProperty() @IsBoolean() readonly includeOwner!: boolean;
}
class PageDto {
  @ApiProperty({ type: "integer", minimum: 1 }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
class ExportChoiceDto {
  @uuid() readonly id!: string;
  @ApiProperty({ enum: ["encounter", "document", "clinical", "prescription"] }) readonly kind!:
    "encounter" | "document" | "clinical" | "prescription";
  @ApiProperty() readonly title!: string;
  @ApiProperty({ format: "date-time" }) readonly occurredAt!: string;
}
export class ExportChoicesDto extends PageDto {
  @ApiProperty({ type: [ExportChoiceDto] }) readonly records!: ExportChoiceDto[];
}
class ExchangePatientDto {
  @uuid() readonly id!: string;
  @ApiProperty() readonly name!: string;
  @ApiProperty() readonly species!: string;
  @ApiPropertyOptional({ type: "string", format: "date", nullable: true }) readonly birthDate?:
    string | null;
}
class ConsentingOwnerDto {
  @ApiProperty() readonly name!: string;
  @ApiPropertyOptional({ format: "email" }) readonly email?: string;
}
class RecordCountDto {
  @ApiProperty() readonly kind!: string;
  @ApiProperty({ type: "integer" }) readonly count!: number;
}
export class ExchangePreviewDto {
  @uuid() readonly receiptId!: string;
  @uuid() readonly packageId!: string;
  @ApiProperty({ type: ExchangeClinicDto }) readonly source!: ExchangeClinicDto;
  @ApiProperty({ type: ExchangePatientDto }) readonly patient!: ExchangePatientDto;
  @ApiPropertyOptional({ type: ConsentingOwnerDto }) readonly owner?: ConsentingOwnerDto;
  @ApiProperty({ type: "integer" }) readonly recordCount!: number;
  @ApiProperty({ type: [PatientSummaryDto] }) readonly candidates!: PatientSummaryDto[];
  @ApiProperty({ type: "string", format: "uuid", nullable: true }) readonly mappedPatientId!:
    string | null;
  @ApiProperty({ type: "string", format: "uuid", nullable: true }) readonly committedPatientId!:
    string | null;
  @ApiProperty({ type: [RecordCountDto] }) readonly counts!: RecordCountDto[];
}
export class ImportChoiceDto {
  @ApiProperty({ enum: ["match", "create"] }) @IsIn(["match", "create"]) readonly mode!:
    "match" | "create";
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() readonly patientId?: string;
}
export class ExchangeCommitDto {
  @uuid() readonly packageId!: string;
  @uuid() readonly patientId!: string;
  @ApiProperty({ type: "integer" }) readonly inserted!: number;
  @ApiProperty({ type: "integer" }) readonly skipped!: number;
}
class OriginalAuthorDto {
  @ApiProperty() readonly issuer!: string;
  @ApiProperty() readonly subject!: string;
}
class ImportedClinicalRevisionDto {
  @uuid() readonly recordId!: string;
  @ApiProperty({ type: "integer", minimum: 1 }) readonly revision!: number;
  @ApiPropertyOptional({ type: OriginalAuthorDto }) readonly resultAuthor?: OriginalAuthorDto;
  @ApiPropertyOptional({ format: "date-time" }) readonly resultRecordedAt?: string;
}
export class ImportedRecordDto {
  @ApiPropertyOptional({ type: ImportedClinicalRevisionDto })
  readonly clinicalRevision?: ImportedClinicalRevisionDto;
  @uuid() readonly id!: string;
  @uuid() readonly importedId!: string;
  @uuid() readonly packageId!: string;
  @ApiProperty() readonly kind!: string;
  @ApiProperty({ type: "object", additionalProperties: true }) readonly data!: Record<
    string,
    unknown
  >;
  @ApiProperty({ type: ExchangeLocationDto }) readonly source!: ExchangeLocationDto;
  @ApiProperty({ type: OriginalAuthorDto }) readonly author!: OriginalAuthorDto;
  @ApiProperty({ format: "date-time" }) readonly occurredAt!: string;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
  @ApiProperty({ format: "date-time" }) readonly importedAt!: string;
}
export class ImportedRecordsDto extends PageDto {
  @ApiProperty({ type: [ImportedRecordDto] }) readonly records!: ImportedRecordDto[];
}
