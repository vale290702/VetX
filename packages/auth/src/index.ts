import { Buffer } from "node:buffer";
import type { OidcConfig } from "@vetx/config";
import type { AccessPrincipal } from "@vetx/permissions";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface TokenVerifier {
  verify(token: string): Promise<AccessPrincipal>;
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super("Access token is invalid or inactive");
  }
}

export class IdentityProviderUnavailableError extends Error {
  constructor() {
    super("Identity verification is unavailable");
  }
}

const timeoutMs = 2_000;

function formComponent(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

function validIdentityClaim(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,255}$/.test(value);
}

function hasAudience(value: unknown, audience: string): boolean {
  return (
    value === audience ||
    (Array.isArray(value) &&
      value.every((item: unknown) => typeof item === "string") &&
      value.includes(audience))
  );
}

export class KeycloakTokenVerifier implements TokenVerifier {
  private readonly getSigningKey: JWTVerifyGetKey;
  private readonly introspectionUrl: URL;
  private readonly authorization: string;

  constructor(private readonly config: OidcConfig) {
    const protocol = config.issuer + "/protocol/openid-connect";
    this.introspectionUrl = new URL(protocol + "/token/introspect");
    const jwks = createRemoteJWKSet(new URL(protocol + "/certs"), {
      timeoutDuration: timeoutMs,
      cooldownDuration: 5_000,
    });
    this.getSigningKey = async (header, token) => {
      try {
        return await jwks(header, token);
      } catch (error) {
        if (error instanceof errors.JWKSNoMatchingKey) {
          throw new InvalidAccessTokenError();
        }
        throw new IdentityProviderUnavailableError();
      }
    };
    const credentials =
      formComponent(config.apiClientId) + ":" + formComponent(config.apiClientSecret);
    this.authorization = "Basic " + Buffer.from(credentials).toString("base64");
  }

  async verify(token: string): Promise<AccessPrincipal> {
    const payload = await this.verifyClaims(token);
    const { sub, azp, sid, exp } = payload;
    const { issuer, apiClientId, ownerClientId, staffClientId, webClientId } = this.config;
    if (
      !validIdentityClaim(sub) ||
      !validIdentityClaim(sid) ||
      typeof azp !== "string" ||
      ![ownerClientId, staffClientId, webClientId].includes(azp) ||
      !hasAudience(payload.aud, apiClientId) ||
      payload.typ !== "Bearer" ||
      payload.cnf !== undefined
    ) {
      throw new InvalidAccessTokenError();
    }

    const state = await this.introspect(token);
    if (
      state.active !== true ||
      state.sub !== sub ||
      state.sid !== sid ||
      state.client_id !== azp ||
      state.iss !== issuer ||
      !hasAudience(state.aud, apiClientId) ||
      exp === undefined ||
      exp <= Math.floor(Date.now() / 1_000)
    ) {
      throw new InvalidAccessTokenError();
    }

    return { issuer, subject: sub, kind: azp === ownerClientId ? "owner" : "staff" };
  }

  private async verifyClaims(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.getSigningKey, {
        issuer: this.config.issuer,
        audience: this.config.apiClientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "azp", "sid", "typ"],
      });
      return payload;
    } catch (error) {
      if (error instanceof IdentityProviderUnavailableError) {
        throw error;
      }
      throw new InvalidAccessTokenError();
    }
  }

  private async introspect(token: string): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(this.introspectionUrl, {
        method: "POST",
        headers: {
          Authorization: this.authorization,
          Accept: "application/json",
        },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        const result: unknown = await response.json();
        if (
          result &&
          typeof result === "object" &&
          "active" in result &&
          typeof result.active === "boolean"
        ) {
          return result as Record<string, unknown>;
        }
      }
    } catch {
      throw new IdentityProviderUnavailableError();
    }
    throw new IdentityProviderUnavailableError();
  }
}
