import { AccessTokenRejectedError, SessionRejectedError } from "./session.ts";

export function authorizationCode(
  url: string,
  redirectUri: string,
  state: string,
  issuerUrl: string,
): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1 || url.slice(0, queryStart) !== redirectUri || url.includes("#")) {
    throw new SessionRejectedError();
  }
  const params = new URLSearchParams(url.slice(queryStart + 1));
  const states = params.getAll("state");
  const codes = params.getAll("code");
  const issuers = params.getAll("iss");
  const code = codes[0];
  if (
    states.length !== 1 ||
    states[0] !== state ||
    codes.length !== 1 ||
    !code ||
    params.has("error") ||
    issuers.length > 1 ||
    (issuers[0] !== undefined && issuers[0] !== issuerUrl)
  ) {
    throw new SessionRejectedError();
  }
  return code;
}

export function readProviderDocument(payload: unknown, issuer: string) {
  if (!isRecord(payload) || payload.issuer !== issuer)
    throw new Error("Invalid identity provider discovery document");
  const endpoint = (value: unknown) => {
    if (
      typeof value !== "string" ||
      !value.startsWith(issuer + "/") ||
      /[?#\\\s]/.test(value) ||
      /(?:\/\.{1,2}|\/%2e)(?:[/%.]|$)/i.test(value.slice(issuer.length))
    ) {
      throw new Error("Invalid identity provider discovery document");
    }
    return value;
  };

  return {
    authorizationEndpoint: endpoint(payload.authorization_endpoint),
    tokenEndpoint: endpoint(payload.token_endpoint),
    revocationEndpoint: endpoint(payload.revocation_endpoint),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readTokenResponse(status: number, payload: unknown, previousRefreshToken?: string) {
  if (status === 400 && isRecord(payload) && payload.error === "invalid_grant") {
    throw new SessionRejectedError();
  }
  if (status < 200 || status >= 300) throw new Error("Identity provider token request failed");
  if (!isRecord(payload)) throw new Error("Invalid identity provider token response");
  const accessToken = payload.access_token;
  const refreshToken = payload.refresh_token ?? previousRefreshToken;
  const expiresIn = payload.expires_in;
  if (
    typeof payload.token_type !== "string" ||
    payload.token_type.toLowerCase() !== "bearer" ||
    typeof accessToken !== "string" ||
    !/^[a-z0-9._~+/-]+=*$/i.test(accessToken) ||
    typeof refreshToken !== "string" ||
    !refreshToken ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error("Invalid identity provider token response");
  }
  return { accessToken, refreshToken, expiresIn };
}

export function requireAccountResponse(status: number) {
  if (status === 401) throw new AccessTokenRejectedError();
  if (status === 403) throw new SessionRejectedError();
  if (status < 200 || status >= 300) throw new Error("Account verification failed");
}
