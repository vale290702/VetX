import {
  applyDecorators,
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
import { PageQueryDto, SharingDto } from "../care/contracts.js";
import {
  ClinicalWriteDto,
  ClinicalSharingDto,
  StaffClinicalDto,
  StaffClinicalPageDto,
  OwnerClinicalPageDto,
  clinicalWrite,
} from "./contracts.js";
export type ClinicalStore = Pick<
  PrismaDatabase,
  | "saveClinicalRevision"
  | "shareClinicalRecord"
  | "listClinicalRecords"
  | "clinicalHistory"
  | "listOwnerClinicalRecords"
>;
const storeKey = Symbol("typed clinical records");
@Injectable()
class ClinicalService {
  constructor(@Inject(storeKey) private readonly db: ClinicalStore | null) {}
  get store() {
    if (!this.db) throw new ServiceUnavailableException();
    return this.db;
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

@secured("clinical records")
@clinicScope()
@routeId("patientId")
@Controller(scope + "/patients/:patientId/clinical-records")
class ClinicalController {
  constructor(@Inject(ClinicalService) private readonly clinical: ClinicalService) {}
  @Get()
  @ApiOperation({ operationId: "listClinicalRecords" })
  @ApiOkResponse({ type: StaffClinicalPageDto })
  list(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Query() q: PageQueryDto,
  ) {
    return this.clinical.store.listClinicalRecords(actor, org, clinic, patient, q.page);
  }
  @Get(":recordId/revisions")
  @routeId("recordId")
  @ApiOperation({ operationId: "clinicalHistory" })
  @ApiOkResponse({ type: StaffClinicalPageDto })
  history(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("recordId", ParseUUIDPipe) record: string,
    @Query() q: PageQueryDto,
  ) {
    return this.clinical.store.clinicalHistory(actor, org, clinic, patient, record, q.page);
  }
  @Put(":recordId/revisions/:requestId")
  @routeId("recordId")
  @routeId("requestId")
  @ApiOperation({ operationId: "saveClinicalRevision" })
  @ApiOkResponse({ type: StaffClinicalDto })
  save(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("recordId", ParseUUIDPipe) record: string,
    @Param("requestId", ParseUUIDPipe) request: string,
    @Body() input: ClinicalWriteDto,
  ) {
    return this.clinical.store.saveClinicalRevision(
      actor,
      org,
      clinic,
      patient,
      record,
      request,
      clinicalWrite(input),
    );
  }
  @Put(":recordId/sharing")
  @routeId("recordId")
  @ApiOperation({ operationId: "shareClinicalRecord" })
  @ApiOkResponse({ type: SharingDto })
  share(
    @StaffIdentity() actor: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("recordId", ParseUUIDPipe) record: string,
    @Body() input: ClinicalSharingDto,
  ) {
    return this.clinical.store.shareClinicalRecord(actor, org, clinic, patient, record, input);
  }
}
@secured("owner clinical records")
@routeId("petId")
@Controller("owner/pets/:petId/clinical-records")
class OwnerClinicalController {
  constructor(@Inject(ClinicalService) private readonly clinical: ClinicalService) {}
  @Get()
  @ApiOperation({ operationId: "listOwnerClinicalRecords" })
  @ApiOkResponse({ type: OwnerClinicalPageDto })
  list(
    @OwnerIdentity() owner: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Query() q: PageQueryDto,
  ) {
    return this.clinical.store.listOwnerClinicalRecords(owner, pet, q.page);
  }
}
@Module({
  controllers: [ClinicalController, OwnerClinicalController],
  providers: [ClinicalService],
})
export class ClinicalRecordsModule {
  static register(database?: ClinicalStore): DynamicModule {
    return {
      module: ClinicalRecordsModule,
      providers: [{ provide: storeKey, useValue: database ?? null }],
    };
  }
}
