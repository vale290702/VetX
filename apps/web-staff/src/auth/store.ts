import "server-only";

import { createClient } from "@redis/client";
import { isLocale } from "@vetx/i18n";

import type { LoginAttempt, WebSession } from "./flows.ts";
import {
  authorizationKey,
  isSecret,
  loginLifetimeSeconds,
  providerTimeoutSeconds,
  sessionKey,
  sessionLifetimeSeconds,
} from "./security.ts";

const deleteIfEqual = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

const replaceIfEqual = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
    return 1
  end
  return 0
`;

function parseRecord(value: string): Record<string, unknown> {
  const record: unknown = JSON.parse(value);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Invalid session store record");
  }
  return record as Record<string, unknown>;
}

function parseLogin(value: string | null): LoginAttempt | null {
  if (value === null) return null;
  const { locale, nonce, state, verifier } = parseRecord(value);
  if (!isLocale(locale) || !isSecret(nonce) || !isSecret(state) || !isSecret(verifier)) {
    throw new Error("Invalid authorization record");
  }
  return { locale, nonce, state, verifier };
}

function parseSession(value: string | null): WebSession | null {
  if (value === null) return null;
  const record = parseRecord(value);
  const { subject, username, accessToken, refreshToken, idToken, csrf, accessExpiresAt } = record;
  if (
    typeof subject !== "string" ||
    !subject ||
    (username !== undefined && typeof username !== "string") ||
    typeof accessToken !== "string" ||
    !accessToken ||
    typeof refreshToken !== "string" ||
    !refreshToken ||
    typeof idToken !== "string" ||
    !idToken ||
    !isSecret(csrf) ||
    typeof accessExpiresAt !== "number" ||
    !Number.isSafeInteger(accessExpiresAt)
  ) {
    throw new Error("Invalid session record");
  }
  return record as WebSession;
}

function refreshKey(id: string): string {
  return `${sessionKey(id)}:refresh`;
}

export function createSessionStore(url: string) {
  const newClient = () =>
    createClient({
      url,
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
  let client: ReturnType<typeof newClient> | undefined;
  let connecting: Promise<ReturnType<typeof newClient>> | undefined;

  function connection() {
    if (client?.isReady) return Promise.resolve(client);
    if (connecting) return connecting;
    const next = newClient();
    next.on("error", () => console.error("Staff session store connection failed."));
    connecting = next
      .connect()
      .then(() => {
        client = next;
        return next;
      })
      .finally(() => {
        connecting = undefined;
      });
    return connecting;
  }

  async function redis() {
    return (await connection()).withCommandOptions({ abortSignal: AbortSignal.timeout(3_000) });
  }

  return {
    async saveAuthorization(browserId: string, attempt: LoginAttempt): Promise<void> {
      const key = authorizationKey(browserId, attempt.state);
      const result = await (
        await redis()
      ).set(key, JSON.stringify(attempt), {
        expiration: { type: "EX", value: loginLifetimeSeconds },
        condition: "NX",
      });
      if (result !== "OK") throw new Error("Unable to store authorization attempt");
    },

    async takeAuthorization(browserId: string, state: string): Promise<LoginAttempt | null> {
      return parseLogin(await (await redis()).getDel(authorizationKey(browserId, state)));
    },

    async createSession(id: string, session: WebSession): Promise<void> {
      const result = await (
        await redis()
      ).set(sessionKey(id), JSON.stringify(session), {
        expiration: { type: "EX", value: sessionLifetimeSeconds },
        condition: "NX",
      });
      if (result !== "OK") throw new Error("Unable to create a session");
    },

    async readSession(id: string): Promise<WebSession | null> {
      return parseSession(await (await redis()).get(sessionKey(id)));
    },

    async removeSession(id: string): Promise<WebSession | null> {
      return parseSession(await (await redis()).getDel(sessionKey(id)));
    },

    async removeSessionIfCurrent(id: string, prior: WebSession): Promise<void> {
      await (
        await redis()
      ).eval(deleteIfEqual, {
        keys: [sessionKey(id)],
        arguments: [JSON.stringify(prior)],
      });
    },

    async replaceSession(id: string, prior: WebSession, next: WebSession): Promise<boolean> {
      const result = await (
        await redis()
      ).eval(replaceIfEqual, {
        keys: [sessionKey(id)],
        arguments: [JSON.stringify(prior), JSON.stringify(next)],
      });
      return result === 1;
    },

    async refreshLock(id: string, owner: string): Promise<boolean> {
      const result = await (
        await redis()
      ).set(refreshKey(id), owner, {
        expiration: { type: "EX", value: providerTimeoutSeconds * 3 },
        condition: "NX",
      });
      return result === "OK";
    },

    async releaseRefreshLock(id: string, owner: string): Promise<void> {
      await (await redis()).eval(deleteIfEqual, { keys: [refreshKey(id)], arguments: [owner] });
    },
  };
}
