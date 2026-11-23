import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { documentTypes, type DocumentMediaType } from "./content.js";

export class DocumentTitleDto {
  @ApiProperty({ maxLength: 180 })
  @IsString()
  @MaxLength(180)
  @Matches(/^(?=.*\S)[^\p{Cc}]+$/u)
  readonly title!: string;
}
export class DocumentSharingDto {
  @ApiProperty({ type: "array", items: { type: "string", format: "uuid" }, uniqueItems: true })
  @IsArray()
  @ArrayUnique((id: unknown) => (typeof id === "string" ? id.toLowerCase() : id))
  @IsUUID(undefined, { each: true })
  readonly guardianIds!: string[];
  @ApiProperty({ type: "integer", minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  readonly revision!: number;
}
class DicomPreviewDto {
  @ApiProperty({ type: "integer", minimum: 1 }) readonly byteLength!: number;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) readonly sha256!: string;
}
class DicomMetadataDto {
  @ApiProperty({ maxLength: 64 }) readonly studyInstanceUid!: string;
  @ApiProperty({ maxLength: 64 }) readonly seriesInstanceUid!: string;
  @ApiProperty({ maxLength: 64 }) readonly sopInstanceUid!: string;
  @ApiProperty({ maxLength: 16 }) readonly modality!: string;
  @ApiProperty({ type: "integer", minimum: 1 }) readonly frames!: number;
  @ApiPropertyOptional({ type: DicomPreviewDto }) readonly preview?: DicomPreviewDto;
}
class MedicalDocumentDto {
  @ApiPropertyOptional({ type: DicomMetadataDto }) readonly imaging?: DicomMetadataDto;
  @ApiProperty({ format: "uuid" }) readonly id!: string;
  @ApiProperty({ format: "uuid" }) readonly assetId!: string;
  @ApiProperty({ format: "uuid" }) readonly organizationId!: string;
  @ApiProperty({ format: "uuid" }) readonly clinicId!: string;
  @ApiProperty({ format: "uuid" }) readonly patientId!: string;
  @ApiProperty() readonly title!: string;
  @ApiProperty({ type: "string", enum: [...documentTypes] }) readonly mediaType!: DocumentMediaType;
  @ApiProperty({ type: "integer", minimum: 1 }) readonly byteLength!: number;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) readonly sha256!: string;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
  @ApiProperty() readonly ready!: boolean;
}
export class StaffDocumentDto extends MedicalDocumentDto {
  @ApiProperty({ type: DocumentSharingDto }) readonly sharing!: DocumentSharingDto;
}
export class OwnerDocumentDto extends MedicalDocumentDto {
  @ApiProperty() readonly organizationName!: string;
  @ApiProperty() readonly clinicName!: string;
}
class DocumentPageDto {
  @ApiProperty({ type: "integer", minimum: 1 }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
export class StaffDocumentsDto extends DocumentPageDto {
  @ApiProperty({ type: [StaffDocumentDto] }) readonly documents!: StaffDocumentDto[];
}
export class OwnerDocumentsDto extends DocumentPageDto {
  @ApiProperty({ type: [OwnerDocumentDto] }) readonly documents!: OwnerDocumentDto[];
}
