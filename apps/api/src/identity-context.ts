import {
  Global,
  Module,
  type DynamicModule,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  IdentityProviderUnavailableError,
  InvalidAccessTokenError,
  type TokenVerifier,
} from "@vetx/auth";
import {
  type AccessPrincipal,
  isStaffPrincipal,
  type StaffPrincipal,
  type OwnerPrincipal,
} from "@vetx/permissions";
import type { Request, Response } from "express";

export const tokenVerifierProvider = Symbol("tokenVerifier");
interface AuthenticatedRequest extends Request {
  vetxPrincipal?: AccessPrincipal;
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    @Inject(tokenVerifierProvider) private readonly tokenVerifier: TokenVerifier | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    context.switchToHttp().getResponse<Response>().setHeader("Cache-Control", "no-store");
    const [header, duplicate] = request.headersDistinct.authorization ?? [];
    const token = header?.match(/^Bearer +([\w-]+\.[\w-]+\.[\w-]+)$/i)?.[1];
    if (!token || duplicate !== undefined) {
      throw new UnauthorizedException();
    }
    if (!this.tokenVerifier) {
      throw new ServiceUnavailableException();
    }

    try {
      request.vetxPrincipal = await this.tokenVerifier.verify(token);
      return true;
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw new UnauthorizedException();
      }
      if (error instanceof IdentityProviderUnavailableError) {
        throw new ServiceUnavailableException();
      }
      throw error;
    }
  }
}

export const Principal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessPrincipal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().vetxPrincipal;
    if (!principal) {
      throw new UnauthorizedException();
    }
    return principal;
  },
);

export const StaffIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffPrincipal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().vetxPrincipal;
    if (!principal) throw new UnauthorizedException();
    if (!isStaffPrincipal(principal)) throw new ForbiddenException();
    return principal;
  },
);

export const OwnerIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OwnerPrincipal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().vetxPrincipal;
    if (!principal) throw new UnauthorizedException();
    if (principal.kind !== "owner") throw new ForbiddenException();
    return { ...principal, kind: "owner" };
  },
);

@Global()
@Module({})
export class IdentityModule {
  static register(verifier?: TokenVerifier): DynamicModule {
    return {
      module: IdentityModule,
      providers: [{ provide: tokenVerifierProvider, useValue: verifier ?? null }, BearerAuthGuard],
      exports: [tokenVerifierProvider, BearerAuthGuard],
    };
  }
}
