import { DirectoryError, RegistryError } from "@vetx/database";
import { randomUUID } from "node:crypto";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  ValidationPipe,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ApiProperty } from "@nestjs/swagger";
import type { Request, Response, NextFunction } from "express";

export const requestIdHeader = "x-request-id";

const errors = {
  BAD_REQUEST: "Invalid request",
  UNAUTHORIZED: "Authentication required",
  FORBIDDEN: "Access denied",
  EMAIL_VERIFICATION_REQUIRED: "A verified email address is required",
  NOT_FOUND: "Resource not found",
  CONFLICT: "Request conflict",
  LAST_ORGANIZATION_ADMIN: "The organization must retain an administrator",
  TOO_MANY_REQUESTS: "Too many requests",
  SERVICE_UNAVAILABLE: "Service unavailable",
  INTERNAL_ERROR: "Internal server error",
  HTTP_ERROR: "Request failed",
} as const;

type ErrorCode = keyof typeof errors;

const codesByStatus: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.TOO_MANY_REQUESTS]: "TOO_MANY_REQUESTS",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
};

class ErrorDetailDto {
  @ApiProperty({ enum: Object.keys(errors) })
  readonly code!: ErrorCode;

  @ApiProperty()
  readonly message!: string;

  @ApiProperty({ format: "uuid" })
  readonly requestId!: string;
}

export class ResourceSummaryDto {
  @ApiProperty({ format: "uuid" })
  readonly id!: string;

  @ApiProperty()
  readonly name!: string;
}

export class ApiErrorDto {
  @ApiProperty({ type: ErrorDetailDto })
  readonly error!: ErrorDetailDto;
}

export class EmailVerificationRequired extends ForbiddenException {}
const registryStatus = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
} as const;
function statusOf(exception: unknown): number {
  if (exception instanceof RegistryError) return registryStatus[exception.code];
  if (exception instanceof DirectoryError) {
    if (exception.code === "forbidden") return HttpStatus.FORBIDDEN;
    if (exception.code === "invalid") return HttpStatus.BAD_REQUEST;
    return HttpStatus.CONFLICT;
  }
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (exception instanceof Error && "statusCode" in exception) {
    const status = exception.statusCode;
    if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

@Catch()
class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = statusOf(exception);
    const code =
      exception instanceof EmailVerificationRequired
        ? "EMAIL_VERIFICATION_REQUIRED"
        : exception instanceof DirectoryError && exception.code === "last_admin"
          ? "LAST_ORGANIZATION_ADMIN"
          : (codesByStatus[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "HTTP_ERROR"));
    const currentId = response.getHeader(requestIdHeader);
    const requestId = typeof currentId === "string" ? currentId : randomUUID();

    if (status >= 500) {
      const event = { event: "http.request.failed", status, code, requestId };
      if (status === HttpStatus.SERVICE_UNAVAILABLE) {
        this.logger.warn(event);
      } else {
        this.logger.error(event);
      }
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    const body: ApiErrorDto = { error: { code, message: errors[code], requestId } };
    response.setHeader(requestIdHeader, requestId);
    response.setHeader("Cache-Control", "no-store");
    if (status === HttpStatus.UNAUTHORIZED) {
      response.setHeader("WWW-Authenticate", "Bearer");
    }
    response.status(status).json(body);
  }
}

export function configureHttp(app: NestExpressApplication): void {
  app.disable("x-powered-by");
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader(requestIdHeader, randomUUID());
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      disableErrorMessages: true,
    }),
  );
  app.useGlobalFilters(new HttpErrorFilter());
}
