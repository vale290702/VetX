import {
  applyDecorators,
  Body,
  Controller,
  type DynamicModule,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
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
import type { PrismaDatabase, ReferralClinic } from "@vetx/database";
import type { OwnerPrincipal, StaffPrincipal } from "@vetx/permissions";
import { PageQueryDto } from "../care/contracts.js";
import { ApiErrorDto } from "../http.js";
import { BearerAuthGuard, OwnerIdentity, StaffIdentity } from "../identity-context.js";
import {
  CounterReferralDto,
  ReferralDecisionDto,
  ReferralDestinationsDto,
  ReferralDto,
  ReferralFilterDto,
  ReferralPageDto,
  RequestReferralDto,
} from "./contracts.js";

export type ReferralStore = Pick<
  PrismaDatabase,
  | "requestReferral"
  | "listStaffReferrals"
  | "listOwnerReferrals"
  | "respondReferral"
  | "decideReferral"
  | "referralClinicContext"
  | "referralRoute"
>;
export interface ReferralDirectory {
  destinations(source: ReferralClinic): (ReferralClinic & { name: string })[];
  allows(source: ReferralClinic, destination: ReferralClinic): boolean;
}

const directoryToken = Symbol("referral directory"),
  storeToken = Symbol("referral store");
@Injectable()
class ReferralService {
  constructor(
    @Inject(storeToken) private readonly database: ReferralStore | null,
    @Inject(directoryToken) private readonly directory: ReferralDirectory | null,
  ) {}
  get store() {
    if (!this.database) throw new ServiceUnavailableException();
    return this.database;
  }
  get routes() {
    if (!this.directory) throw new ServiceUnavailableException();
    return this.directory;
  }
  async destinations(staff: StaffPrincipal, org: string, clinic: string) {
    await this.store.referralClinicContext(staff, org, clinic, false);
    const source = { organizationId: org, clinicId: clinic };
    const routes = this.routes;
    return {
      destinations: routes
        .destinations(source)
        .filter((candidate) => routes.allows(source, candidate))
        .map(({ organizationId, clinicId, name }) => ({ organizationId, clinicId, name })),
    };
  }
  async request(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    patient: string,
    id: string,
    input: RequestReferralDto,
  ) {
    await this.store.referralClinicContext(staff, org, clinic, false);
    if (!this.routes.allows({ organizationId: org, clinicId: clinic }, input.destination))
      throw new ForbiddenException();
    return this.store.requestReferral(staff, org, clinic, patient, id, {
      ...input,
      reason: input.reason.trim(),
      summary: input.summary.trim(),
    });
  }
  async list(staff: StaffPrincipal, org: string, clinic: string, query: ReferralFilterDto) {
    if (query.direction === "outgoing")
      return this.store.listStaffReferrals(staff, org, clinic, query);
    const { sources } = await this.store.referralClinicContext(staff, org, clinic, true);
    const destination = { organizationId: org, clinicId: clinic };
    const routes = this.routes;
    return this.store.listStaffReferrals(
      staff,
      org,
      clinic,
      query,
      sources.filter((source) => routes.allows(source, destination)),
    );
  }
  async respond(
    staff: StaffPrincipal,
    org: string,
    clinic: string,
    id: string,
    input: CounterReferralDto,
  ) {
    const { source, destination } = await this.store.referralRoute(staff, org, clinic, id, null);
    if (!this.routes.allows(source, destination)) throw new NotFoundException();
    return this.store.respondReferral(staff, org, clinic, id, {
      revision: input.revision,
      summary: input.summary.trim(),
    });
  }
  async decide(owner: OwnerPrincipal, pet: string, id: string, input: ReferralDecisionDto) {
    if (input.action === "approve") {
      const { source, destination } = await this.store.referralRoute(owner, "", "", id, pet);
      if (!this.routes.allows(source, destination)) throw new ForbiddenException();
    }
    return this.store.decideReferral(owner, pet, id, input);
  }
}

const secured = () =>
  applyDecorators(
    ApiTags("clinic referrals"),
    ApiBearerAuth(),
    UseGuards(BearerAuthGuard),
    ApiUnauthorizedResponse({ type: ApiErrorDto }),
    ApiForbiddenResponse({ type: ApiErrorDto }),
    ApiNotFoundResponse({ type: ApiErrorDto }),
    ApiBadRequestResponse({ type: ApiErrorDto }),
    ApiConflictResponse({ type: ApiErrorDto }),
    ApiServiceUnavailableResponse({ type: ApiErrorDto }),
  );
const routeId = (name: string) => ApiParam({ name, format: "uuid" });

@secured()
@routeId("organizationId")
@routeId("clinicId")
@Controller("organizations/:organizationId/clinics/:clinicId")
class StaffReferralsController {
  constructor(@Inject(ReferralService) private readonly referrals: ReferralService) {}
  @Get("referrals/destinations")
  @ApiOperation({ operationId: "listReferralDestinations" })
  @ApiOkResponse({ type: ReferralDestinationsDto })
  destinations(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
  ) {
    return this.referrals.destinations(staff, org, clinic);
  }
  @Put("patients/:patientId/referrals/:requestId")
  @routeId("patientId")
  @routeId("requestId")
  @ApiOperation({ operationId: "requestClinicReferral" })
  @ApiOkResponse({ type: ReferralDto })
  request(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("patientId", ParseUUIDPipe) patient: string,
    @Param("requestId", ParseUUIDPipe) id: string,
    @Body() input: RequestReferralDto,
  ) {
    return this.referrals.request(staff, org, clinic, patient, id, input);
  }
  @Get("referrals")
  @ApiOperation({ operationId: "listStaffReferrals" })
  @ApiOkResponse({ type: ReferralPageDto })
  list(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Query() query: ReferralFilterDto,
  ) {
    return this.referrals.list(staff, org, clinic, query);
  }
  @Put("referrals/:referralId/response")
  @routeId("referralId")
  @ApiOperation({ operationId: "respondToClinicReferral" })
  @ApiOkResponse({ type: ReferralDto })
  respond(
    @StaffIdentity() staff: StaffPrincipal,
    @Param("organizationId", ParseUUIDPipe) org: string,
    @Param("clinicId", ParseUUIDPipe) clinic: string,
    @Param("referralId", ParseUUIDPipe) id: string,
    @Body() input: CounterReferralDto,
  ) {
    return this.referrals.respond(staff, org, clinic, id, input);
  }
}

@secured()
@routeId("petId")
@Controller("owner/pets/:petId/referrals")
class OwnerReferralsController {
  constructor(@Inject(ReferralService) private readonly referrals: ReferralService) {}
  @Get()
  @ApiOperation({ operationId: "listOwnerReferrals" })
  @ApiOkResponse({ type: ReferralPageDto })
  list(
    @OwnerIdentity() owner: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Query() query: PageQueryDto,
  ) {
    return this.referrals.store.listOwnerReferrals(owner, pet, query.page);
  }
  @Put(":referralId/decision")
  @routeId("referralId")
  @ApiOperation({ operationId: "decideClinicReferral" })
  @ApiOkResponse({ type: ReferralDto })
  decide(
    @OwnerIdentity() owner: OwnerPrincipal,
    @Param("petId", ParseUUIDPipe) pet: string,
    @Param("referralId", ParseUUIDPipe) id: string,
    @Body() input: ReferralDecisionDto,
  ) {
    return this.referrals.decide(owner, pet, id, input);
  }
}

@Module({})
export class ReferralModule {
  static register(store?: ReferralStore, directory?: ReferralDirectory): DynamicModule {
    return {
      module: ReferralModule,
      controllers: [StaffReferralsController, OwnerReferralsController],
      providers: [
        { provide: storeToken, useValue: store ?? null },
        { provide: directoryToken, useValue: directory ?? null },
        ReferralService,
      ],
    };
  }
}
