import {
  Controller,
  type DynamicModule,
  Get,
  Header,
  Inject,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ApiErrorDto, requestIdHeader } from "./http.js";

export interface ReadinessCheck {
  checkReady(): Promise<void>;
}

const readinessToken = Symbol("ReadinessCheck");
const headers = {
  [requestIdHeader]: {
    description: "Identifier assigned to this request",
    schema: { type: "string", format: "uuid" },
  },
};

class HealthDto {
  @ApiProperty({ enum: ["ok"] })
  readonly status!: "ok";
}

@ApiTags("health")
@Controller("health")
class HealthController {
  constructor(@Inject(readinessToken) private readonly readiness: ReadinessCheck) {}

  @Get("live")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ operationId: "getLiveness", summary: "Check whether the API is running" })
  @ApiOkResponse({ type: HealthDto, headers })
  live(): HealthDto {
    return { status: "ok" };
  }

  @Get("ready")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    operationId: "getReadiness",
    summary: "Check whether the API can access the identity schema",
  })
  @ApiOkResponse({ type: HealthDto, headers })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, headers })
  async ready(): Promise<HealthDto> {
    try {
      await this.readiness.checkReady();
    } catch {
      // The HTTP filter reports diagnostic metadata without logging raw database errors.
      throw new ServiceUnavailableException();
    }
    return { status: "ok" };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {
  static register(readiness: ReadinessCheck): DynamicModule {
    return {
      module: HealthModule,
      providers: [{ provide: readinessToken, useValue: readiness }],
    };
  }
}
