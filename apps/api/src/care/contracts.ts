import { Type } from "class-transformer";
import { applyDecorators } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export const instant = () =>
  applyDecorators(
    ApiProperty({ format: "date-time" }),
    IsDateString({ strict: true, strictSeparator: true }),
    Matches(timestampPattern),
  );
const section = () =>
  applyDecorators(
    ApiProperty({ maxLength: 8000 }),
    IsString(),
    MaxLength(8000),
    Matches(/^(?:[^\p{Cc}]|[\t\r\n])*$/u),
  );
const reason = () =>
  applyDecorators(
    ApiProperty({ maxLength: 250 }),
    IsString(),
    MaxLength(250),
    Matches(/^(?=.*\S)[^\p{Cc}]+$/u),
  );
export const revision = () =>
  applyDecorators(ApiProperty({ type: "integer", minimum: 0 }), IsInt(), Min(0), Max(2147483647));
const statuses = ["BOOKED", "CANCELLED", "COMPLETED"] as const;

class NoteTextDto {
  @instant() readonly occurredAt!: string;
  @reason() readonly reason!: string;
  @section() readonly subjective!: string;
  @section() readonly objective!: string;
  @section() readonly assessment!: string;
  @section() readonly plan!: string;
}
export class EncounterInputDto extends NoteTextDto {
  @ApiPropertyOptional({ type: "string", format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  readonly addendumTo?: string | null;
}
export class SharingDto {
  @ApiProperty({ type: "array", items: { type: "string", format: "uuid" }, uniqueItems: true })
  @IsArray()
  @ArrayUnique((id: unknown) => (typeof id === "string" ? id.toLowerCase() : id))
  @IsUUID(undefined, { each: true })
  readonly guardianIds!: string[];
  @revision() readonly revision!: number;
}
class RecordedNoteDto extends NoteTextDto {
  @ApiProperty({ format: "uuid" }) readonly id!: string;
  @ApiProperty({ format: "date-time" }) readonly recordedAt!: string;
  @ApiProperty({ type: "string", format: "uuid", nullable: true }) readonly addendumTo!:
    string | null;
}
export class StaffEncounterDto extends RecordedNoteDto {
  @ApiProperty() readonly authorIssuer!: string;
  @ApiProperty() readonly authorSubject!: string;
  @ApiProperty({ type: SharingDto }) readonly sharing!: SharingDto;
}
export class OwnerEncounterDto extends RecordedNoteDto {
  @ApiProperty({ format: "uuid" }) readonly clinicId!: string;
  @ApiProperty({ format: "uuid" }) readonly patientId!: string;
  @ApiProperty() readonly clinicName!: string;
  @ApiProperty() readonly organizationName!: string;
}
class PageDto {
  @ApiProperty({ type: "integer", minimum: 1 }) readonly page!: number;
  @ApiProperty() readonly hasNextPage!: boolean;
}
export class EncountersDto extends PageDto {
  @ApiProperty({ type: [StaffEncounterDto] }) readonly encounters!: StaffEncounterDto[];
}
export class OwnerEncountersDto extends PageDto {
  @ApiProperty({ type: [OwnerEncounterDto] }) readonly encounters!: OwnerEncounterDto[];
}
export class AppointmentInputDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() readonly patientId!: string;
  @instant() readonly startAt!: string;
  @instant() readonly endAt!: string;
  @reason() readonly reason!: string;
  @ApiProperty({ enum: [...statuses] }) @IsIn(statuses) readonly status!: (typeof statuses)[number];
  @revision() readonly revision!: number;
}
export class AppointmentDto extends AppointmentInputDto {
  @ApiProperty({ format: "uuid" }) readonly id!: string;
  @ApiProperty() readonly patientName!: string;
}
export class AppointmentsDto extends PageDto {
  @ApiProperty({ type: [AppointmentDto] }) readonly appointments!: AppointmentDto[];
}
export class PageQueryDto {
  @ApiPropertyOptional({ type: "integer", minimum: 1, default: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @Type(() => Number)
  readonly page: number = 1;
}
export class ScheduleQueryDto extends PageQueryDto {
  @instant() readonly from!: string;
  @instant() readonly to!: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() readonly patientId?: string;
}
