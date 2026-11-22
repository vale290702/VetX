import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  type DynamicModule,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { PrismaDatabase } from "@vetx/database";
import type { OwnerPrincipal, StaffPrincipal } from "@vetx/permissions";
import { ApiErrorDto } from "../http.js";
import { BearerAuthGuard, StaffIdentity, OwnerIdentity } from "../identity-context.js";
import {
  AppointmentDto,
  AppointmentInputDto,
  AppointmentsDto,
  EncounterInputDto,
  EncountersDto,
  OwnerEncountersDto,
  PageQueryDto,
  ScheduleQueryDto,
  SharingDto,
  StaffEncounterDto,
} from "./contracts.js";

export type CareStore = Pick<
  PrismaDatabase,
  | "listEncounters"
  | "saveEncounter"
  | "shareEncounter"
  | "listAppointments"
  | "saveAppointment"
  | "listOwnerEncounters"
>;
const storeKey = Symbol("clinical care store");
@Injectable()
class CareService {
  constructor(@Inject(storeKey) private readonly database: CareStore | null) {}
  get store() {
    if (!this.database) throw new ServiceUnavailableException();
    return this.database;
  }
}
const scope = "organizations/:organizationId/clinics/:clinicId";
const routeId = (name: string) => ApiParam({ name, format: "uuid" });
const secured = (tag: string) =>
  applyDecorators(
    ApiTags(tag),
    ApiBearerAuth(),
    UseGuards(BearerAuthGuard),
    ApiUnauthorizedResponse({ type: ApiErrorDto }),
    ApiForbiddenResponse({ type: ApiErrorDto }),
    ApiNotFoundResponse({ type: ApiErrorDto }),
    ApiBadRequestResponse({ type: ApiErrorDto }),
    ApiServiceUnavailableResponse({ type: ApiErrorDto }),
  );
const clinicScope = () =>
  applyDecorators(
    routeId("organizationId"),
    routeId("clinicId"),
    ApiConflictResponse({ type: ApiErrorDto }),
  );
function utc(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new BadRequestException();
  return date.toISOString();
}
function interval(start: string, end: string) {
  const from = utc(start),
    to = utc(end);
  if (Date.parse(from) >= Date.parse(to)) throw new BadRequestException();
  return { from, to };
}
@secured("clinical encounters")
@clinicScope()
@routeId("patientId")
@Controller(scope + "/patients/:patientId/encounters")
class EncounterController {
  constructor(@Inject(CareService) private readonly care: CareService) {}
  @Get()
  @ApiOperation({ operationId: "listClinicEncounters" })
  @ApiOkResponse({ type: EncountersDto })
  list(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Query() filter: PageQueryDto,
  ) {
    return this.care.store.listEncounters(actor, org, clinic, patient, filter.page);
  }
  @Put(":encounterId")
  @routeId("encounterId")
  @ApiOperation({ operationId: "saveClinicEncounter" })
  @ApiOkResponse({ type: StaffEncounterDto })
  save(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("encounterId", ParseUUIDPipe) id: string,
    @Body() input: EncounterInputDto,
  ) {
    const sections = {
      subjective: input.subjective.trim(),
      objective: input.objective.trim(),
      assessment: input.assessment.trim(),
      plan: input.plan.trim(),
    };
    if (!Object.values(sections).some(Boolean)) throw new BadRequestException();
    return this.care.store.saveEncounter(actor, org, clinic, patient, id, {
      ...sections,
      reason: input.reason.trim(),
      occurredAt: utc(input.occurredAt),
      addendumTo: input.addendumTo ?? null,
    });
  }
  @Put(":encounterId/sharing")
  @routeId("encounterId")
  @ApiOperation({ operationId: "shareClinicEncounter" })
  @ApiOkResponse({ type: SharingDto })
  share(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("encounterId", ParseUUIDPipe) id: string,
    @Body() input: SharingDto,
  ) {
    return this.care.store.shareEncounter(actor, org, clinic, patient, id, input);
  }
}
@secured("clinic appointments")
@clinicScope()
@Controller(scope + "/appointments")
class AppointmentController {
  constructor(@Inject(CareService) private readonly care: CareService) {}
  @Get()
  @ApiOperation({ operationId: "listClinicAppointments" })
  @ApiOkResponse({ type: AppointmentsDto })
  list(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() query: ScheduleQueryDto,
  ) {
    const range = interval(query.from, query.to);
    return this.care.store.listAppointments(actor, org, clinic, {
      ...range,
      page: query.page,
      ...(query.patientId ? { patientId: query.patientId } : {}),
    });
  }
  @Put(":appointmentId")
  @routeId("appointmentId")
  @ApiOperation({ operationId: "saveClinicAppointment" })
  @ApiOkResponse({ type: AppointmentDto })
  save(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("appointmentId", ParseUUIDPipe) id: string,
    @Body() input: AppointmentInputDto,
  ) {
    const range = interval(input.startAt, input.endAt);
    return this.care.store.saveAppointment(actor, org, clinic, id, {
      ...input,
      startAt: range.from,
      endAt: range.to,
      reason: input.reason.trim(),
    });
  }
}
@secured("owner clinical records")
@routeId("petId")
@Controller("owner/pets/:petId/encounters")
class OwnerEncountersController {
  constructor(@Inject(CareService) private readonly care: CareService) {}
  @Get()
  @ApiOperation({ operationId: "listOwnerEncounters" })
  @ApiOkResponse({ type: OwnerEncountersDto })
  list(
    @OwnerIdentity() actor: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Query() query: PageQueryDto,
  ) {
    return this.care.store.listOwnerEncounters(actor, pet, query.page);
  }
}
@Module({
  controllers: [EncounterController, AppointmentController, OwnerEncountersController],
  providers: [CareService],
})
export class CareModule {
  static register(store?: CareStore): DynamicModule {
    return { module: CareModule, providers: [{ provide: storeKey, useValue: store ?? null }] };
  }
}
