import "server-only";

import * as oidc from "openid-client";

import type { WebAuthConfig } from "./config.ts";
import type { LoginAttempt, WebSession } from "./flows.ts";
import { createSecret, providerTimeoutSeconds, trustedCallback } from "./security.ts";

function validateEndpoints(metadata: oidc.ServerMetadata, issuer: URL) {
  const endpoints = [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.introspection_endpoint,
    metadata.revocation_endpoint,
    metadata.end_session_endpoint,
    metadata.jwks_uri,
  ];
  for (const value of endpoints) {
    if (!value) throw new Error("Keycloak metadata is missing an endpoint");
    const endpoint = new URL(value);
    if (
      endpoint.origin !== issuer.origin ||
      !endpoint.pathname.startsWith(`${issuer.pathname.replace(/\/$/, "")}/`) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error("Keycloak metadata has an untrusted endpoint");
    }
  }
  if (!metadata.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("Keycloak does not advertise S256 PKCE");
  }
}

function expiresAt(tokens: oidc.TokenEndpointResponseHelpers): number {
  const seconds = tokens.expiresIn();
  if (!seconds || seconds <= 0) throw new Error("Keycloak did not supply a token expiration");
  return Date.now() + seconds * 1_000;
}

export function createOidcProvider(settings: WebAuthConfig) {
  let pending: Promise<oidc.Configuration> | undefined;

  function getConfiguration() {
    pending ??= oidc
      .discovery(
        settings.issuer,
        settings.clientId,
        { id_token_signed_response_alg: "RS256" },
        oidc.ClientSecretBasic(settings.clientSecret),
        {
          timeout: providerTimeoutSeconds,
          execute: [
            ...(settings.issuer.protocol === "http:" ? [oidc.allowInsecureRequests] : []),
            oidc.enableNonRepudiationChecks,
          ],
        },
      )
      .then((configuration) => {
        validateEndpoints(configuration.serverMetadata(), settings.issuer);
        return configuration;
      })
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    return pending;
  }

  return {
    async authorizationUrl(attempt: LoginAttempt): Promise<URL> {
      return oidc.buildAuthorizationUrl(await getConfiguration(), {
        redirect_uri: trustedCallback(settings.webOrigin).href,
        scope: "openid profile",
        code_challenge_method: "S256",
        code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier),
        nonce: attempt.nonce,
        state: attempt.state,
        ui_locales: attempt.locale,
      });
    },

    async exchange(url: URL, attempt: LoginAttempt): Promise<WebSession | null> {
      const configuration = await getConfiguration();
      try {
        const tokens = await oidc.authorizationCodeGrant(configuration, url, {
          expectedState: attempt.state,
          expectedNonce: attempt.nonce,
          pkceCodeVerifier: attempt.verifier,
        });
        const claims = tokens.claims();
        if (!claims?.sub || !tokens.id_token || !tokens.refresh_token) return null;
        return {
          subject: claims.sub,
          username:
            typeof claims.preferred_username === "string" ? claims.preferred_username : undefined,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          csrf: createSecret(),
          accessExpiresAt: expiresAt(tokens),
        };
      } catch (error) {
        if (!(
          error instanceof oidc.AuthorizationResponseError && error.error === "access_denied"
        )) {
          console.warn("Staff authorization callback could not validate the provider response.");
        }
        return null;
      }
    },

    async refresh(session: WebSession): Promise<WebSession | null> {
      try {
        const tokens = await oidc.refreshTokenGrant(await getConfiguration(), session.refreshToken);
        if (tokens.id_token && tokens.claims()?.sub !== session.subject) return null;
        return {
          ...session,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? session.refreshToken,
          idToken: tokens.id_token ?? session.idToken,
          accessExpiresAt: expiresAt(tokens),
        };
      } catch (error) {
        if (error instanceof oidc.ResponseBodyError && error.error === "invalid_grant") return null;
        throw error;
      }
    },

    async isActive(accessToken: string, subject: string): Promise<boolean> {
      const token = await oidc.tokenIntrospection(await getConfiguration(), accessToken, {
        token_type_hint: "access_token",
      });
      return (
        token.active === true && token.sub === subject && token.client_id === settings.clientId
      );
    },

    async revoke(session: WebSession) {
      await oidc.tokenRevocation(await getConfiguration(), session.refreshToken, {
        token_type_hint: "refresh_token",
      });
    },

    async logoutUrl(session: WebSession) {
      return oidc.buildEndSessionUrl(await getConfiguration(), {
        id_token_hint: session.idToken,
        post_logout_redirect_uri: new URL("/", settings.webOrigin).href,
      });
    },
  };
}
