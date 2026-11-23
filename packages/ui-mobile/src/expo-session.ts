import { createVetxClient } from "@vetx/api-client";
import { parseHttpOrigin } from "@vetx/config/public";
import type { EntryAudience } from "@vetx/i18n";
import { AuthRequest, CodeChallengeMethod, Prompt, ResponseType } from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import { fetch } from "expo/fetch";

import {
  authorizationCode,
  isRecord,
  readProviderDocument,
  readTokenResponse,
  requireAccountResponse,
} from "./auth-protocol";
import { MobileSession, SessionRejectedError } from "./session";
import { createDirectory } from "./directory";
import { createPatients } from "./patients";

export type NativeAuthSettings = {
  issuerUrl: string | undefined;
  clientId: string | undefined;
  redirectUri: string;
};

type AuthConfig = {
  apiOrigin: string;
  issuer: string;
  clientId: string;
  redirectUri: string;
};

function readConfig(
  apiUrl: string | undefined,
  settings: NativeAuthSettings,
): AuthConfig | undefined {
  const apiOrigin = parseHttpOrigin(apiUrl);
  const issuer = settings.issuerUrl?.replace(/\/$/, "");
  const clientId = settings.clientId;
  const issuerOrigin = issuer && /^(https?:\/\/[^/\\?#@\s]+)(?:\/[^\\?#\s]*)?$/.exec(issuer)?.[1];

  if (
    !apiOrigin ||
    !issuer ||
    !issuerOrigin ||
    !parseHttpOrigin(issuerOrigin) ||
    !clientId ||
    clientId !== clientId.trim() ||
    (!__DEV__ && (!apiOrigin.startsWith("https://") || !issuer.startsWith("https://")))
  ) {
    return undefined;
  }
  return { apiOrigin, issuer, clientId, redirectUri: settings.redirectUri };
}

const networkTimeoutMs = 10_000;

async function withNetworkDeadline<Result>(work: (signal: AbortSignal) => Promise<Result>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), networkTimeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function secureStorage(audience: EntryAudience, { issuer, clientId }: AuthConfig) {
  const key = `vetx.${audience}.session`;
  const options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  const clear = () => SecureStore.deleteItemAsync(key, options);
  return {
    async read() {
      const saved = await SecureStore.getItemAsync(key, options);
      if (!saved) return undefined;
      let data: unknown;
      try {
        data = JSON.parse(saved);
      } catch {
        // The obsolete or damaged credential is erased below.
      }
      if (
        isRecord(data) &&
        data.issuer === issuer &&
        data.clientId === clientId &&
        typeof data.refreshToken === "string" &&
        data.refreshToken
      ) {
        return data.refreshToken;
      }
      await clear();
      return undefined;
    },
    write: (refreshToken: string) =>
      SecureStore.setItemAsync(key, JSON.stringify({ issuer, clientId, refreshToken }), options),
    clear,
  };
}

export function createExpoAuth(
  audience: EntryAudience,
  apiUrl: string | undefined,
  settings: NativeAuthSettings,
) {
  const config = readConfig(apiUrl, settings);
  if (!config) return undefined;
  const { apiOrigin, issuer, clientId, redirectUri } = config;

  type ProviderDocument = ReturnType<typeof readProviderDocument>;
  let provider: ProviderDocument | undefined;
  async function discovery() {
    provider ??= await withNetworkDeadline(async (signal) => {
      const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
        headers: { Accept: "application/json" },
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error("Identity provider discovery failed");
      return readProviderDocument(await response.json(), issuer);
    });
    return provider;
  }

  function postForm(endpoint: string, fields: Record<string, string>, signal: AbortSignal) {
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: clientId, ...fields }).toString(),
      credentials: "omit",
      redirect: "error",
      signal,
    });
  }

  async function requestToken(fields: Record<string, string>, previousRefreshToken?: string) {
    const { tokenEndpoint } = await discovery();
    return withNetworkDeadline(async (signal) => {
      const response = await postForm(tokenEndpoint, fields, signal);
      return readTokenResponse(response.status, await response.json(), previousRefreshToken);
    });
  }

  const session = new MobileSession({
    now: Date.now,
    storage: secureStorage(audience, config),
    async authorize(locale) {
      const document = await discovery();
      const request = new AuthRequest({
        clientId,
        redirectUri,
        responseType: ResponseType.Code,
        usePKCE: true,
        codeChallengeMethod: CodeChallengeMethod.S256,
        prompt: Prompt.Login,
        scopes: audience === "pets" ? ["openid", "email"] : ["openid"],
        extraParams: { response_mode: "query", ui_locales: locale },
      });
      const result = await request.promptAsync(document);
      if (result.type === "cancel" || result.type === "dismiss") return null;
      if (result.type !== "success" || !request.codeVerifier) throw new SessionRejectedError();
      const code = authorizationCode(result.url, redirectUri, request.state, issuer);
      return requestToken({
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
        code_verifier: request.codeVerifier,
      });
    },
    refresh: (token) => requestToken({ grant_type: "refresh_token", refresh_token: token }, token),
    async verify(accessToken) {
      return withNetworkDeadline(async (signal) => {
        const { data } = await createVetxClient(apiOrigin).GET("/me", {
          headers: { Authorization: `Bearer ${accessToken}`, "Cache-Control": "no-store" },
          async fetch(request) {
            const response = await fetch(request.url, {
              method: request.method,
              headers: request.headers,
              credentials: "omit",
              redirect: "error",
              signal,
            });
            requireAccountResponse(response.status);
            return response;
          },
        });
        if (
          !data ||
          typeof data.subject !== "string" ||
          !data.subject ||
          !Array.isArray(data.organizations) ||
          !data.organizations.every(
            (organization: unknown) =>
              isRecord(organization) &&
              typeof organization.id === "string" &&
              typeof organization.name === "string",
          )
        ) {
          throw new Error("Invalid account verification response");
        }
        return { ...data, issuer };
      });
    },
    async revoke(token) {
      const { revocationEndpoint } = await discovery();
      await withNetworkDeadline(async (signal) => {
        const response = await postForm(
          revocationEndpoint,
          { token, token_type_hint: "refresh_token" },
          signal,
        );
        if (!response.ok) throw new Error("Identity provider revocation failed");
      });
    },
  });
  return {
    session: {
      subscribe: session.subscribe,
      getSnapshot: session.getSnapshot,
      restore: () => session.restore(),
      revalidate: () => session.revalidate(),
      signIn: (locale: string) => session.signIn(locale),
      signOut: () => session.signOut(),
    },
    patients: createPatients(session, apiOrigin, fetch),
    directory: audience === "staff" ? createDirectory(session, apiOrigin, fetch) : undefined,
    accountUrl: `${issuer}/account/`,
  };
}
