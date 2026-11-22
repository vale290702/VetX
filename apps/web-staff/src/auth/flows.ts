import "server-only";

import { setTimeout as delay } from "node:timers/promises";

import type { Locale } from "@vetx/i18n";

import {
  createSecret,
  isSecret,
  providerTimeoutSeconds,
  secretsMatch,
  trustedCallback,
} from "./security.ts";

export type LoginAttempt = {
  locale: Locale;
  state: string;
  nonce: string;
  verifier: string;
};

export type WebSession = {
  subject: string;
  username?: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  csrf: string;
  accessExpiresAt: number;
};

type AuthorizationStore = {
  saveAuthorization(browserId: string, attempt: LoginAttempt): Promise<void>;
  takeAuthorization(browserId: string, state: string): Promise<LoginAttempt | null>;
};

type AuthorizationProvider = {
  authorizationUrl(attempt: LoginAttempt): Promise<URL>;
  exchange(url: URL, attempt: LoginAttempt): Promise<WebSession | null>;
};

export type SessionStore = {
  readSession(id: string): Promise<WebSession | null>;
  replaceSession(id: string, prior: WebSession, next: WebSession): Promise<boolean>;
  removeSessionIfCurrent(id: string, prior: WebSession): Promise<void>;
  refreshLock(id: string, owner: string): Promise<boolean>;
  releaseRefreshLock(id: string, owner: string): Promise<void>;
};

type SessionProvider = {
  refresh(session: WebSession): Promise<WebSession | null>;
  isActive(accessToken: string, subject: string): Promise<boolean>;
};

export async function beginLogin(
  locale: Locale,
  oidc: AuthorizationProvider,
  store: AuthorizationStore,
) {
  const browserId = createSecret();
  const attempt = {
    locale,
    state: createSecret(),
    nonce: createSecret(),
    verifier: createSecret(),
  };
  const authorizationUrl = await oidc.authorizationUrl(attempt);
  await store.saveAuthorization(browserId, attempt);
  return { browserId, authorizationUrl };
}

export async function finishLogin(
  origin: URL,
  requestUrl: URL,
  browserId: string | undefined,
  oidc: AuthorizationProvider,
  store: AuthorizationStore,
) {
  const states = requestUrl.searchParams.getAll("state");
  const state = states[0];
  if (states.length !== 1 || !isSecret(state) || !isSecret(browserId)) return null;
  const attempt = await store.takeAuthorization(browserId, state);
  if (!attempt) return null;
  const session = await oidc.exchange(trustedCallback(origin, requestUrl), attempt);
  return { locale: attempt.locale, session };
}

const refreshWindow = 15_000;
const refreshWait = (providerTimeoutSeconds + 1) * 1_000;

async function freshSession(id: string, oidc: SessionProvider, store: SessionStore) {
  const owner = createSecret();
  const deadline = Date.now() + refreshWait;
  do {
    const existing = await store.readSession(id);
    if (!existing || existing.accessExpiresAt > Date.now() + refreshWindow) return existing;

    if (!(await store.refreshLock(id, owner))) {
      await delay(60);
      continue;
    }

    try {
      const current = await store.readSession(id);
      if (!current || current.accessExpiresAt > Date.now() + refreshWindow) return current;
      const updated = await oidc.refresh(current);
      if (!updated) {
        await store.removeSessionIfCurrent(id, current);
        return null;
      }
      return (await store.replaceSession(id, current, updated)) ? updated : null;
    } finally {
      await store.releaseRefreshLock(id, owner);
    }
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for a session refresh");
}

type SessionAccess =
  | { kind: "anonymous" }
  | { kind: "locked"; csrf: string }
  | { kind: "active"; session: WebSession };

export async function readSessionAccess(
  id: string | undefined,
  oidc: SessionProvider,
  store: SessionStore,
): Promise<SessionAccess> {
  if (!isSecret(id)) return { kind: "anonymous" };
  try {
    const session = await freshSession(id, oidc, store);
    if (!session) return { kind: "anonymous" };
    if (!(await oidc.isActive(session.accessToken, session.subject))) {
      await store.removeSessionIfCurrent(id, session);
      return { kind: "anonymous" };
    }
    return { kind: "active", session };
  } catch {
    const localSession = await store.readSession(id);
    return localSession ? { kind: "locked", csrf: localSession.csrf } : { kind: "anonymous" };
  }
}

type LogoutProvider = {
  revoke(session: WebSession): Promise<void>;
  logoutUrl(session: WebSession): Promise<URL>;
};

type LogoutStore = Pick<SessionStore, "readSession"> & {
  removeSession(id: string): Promise<WebSession | null>;
};

type LogoutResult =
  { kind: "rejected" } | { kind: "local" } | { kind: "provider"; destination: URL };

export async function signOutSession(
  id: string,
  csrf: FormDataEntryValue | null,
  oidc: LogoutProvider,
  store: LogoutStore,
): Promise<LogoutResult> {
  const current = await store.readSession(id);
  if (!current || typeof csrf !== "string" || !secretsMatch(current.csrf, csrf)) {
    return { kind: "rejected" };
  }
  const removed = await store.removeSession(id);
  if (!removed) return { kind: "rejected" };
  try {
    await oidc.revoke(removed);
    return { kind: "provider", destination: await oidc.logoutUrl(removed) };
  } catch {
    return { kind: "local" };
  }
}
