export type MobileAccount = {
  issuer: string;
  subject: string;
  organizations: { id: string; name: string }[];
};

export type MobileTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type SessionIssue = "rejected" | "operationFailed" | "revocationFailed";

export type SessionState =
  | { status: "checking"; canSignOut: boolean }
  | { status: "signingIn" | "signingOut" | "verificationFailed" | "logoutFailed" }
  | { status: "signedOut"; issue?: SessionIssue }
  | { status: "signedIn"; account: MobileAccount; checkAt: number };

export class SessionRejectedError extends Error {}

export class AccessTokenRejectedError extends SessionRejectedError {}

type SessionDependencies = {
  now: () => number;
  authorize: (locale: string) => Promise<MobileTokens | null>;
  refresh: (token: string) => Promise<MobileTokens>;
  verify: (token: string) => Promise<MobileAccount>;
  revoke: (token: string) => Promise<void>;
  storage: {
    read: () => Promise<string | undefined>;
    write: (token: string) => Promise<void>;
    clear: () => Promise<void>;
  };
};

type AccessToken = {
  value: string;
  expiresAt: number;
  refreshAt: number;
};

const recheckIntervalMs = 60_000;
const maxRefreshLeadMs = 30_000;

export class MobileSession {
  private readonly dependencies: SessionDependencies;
  private readonly listeners = new Set<() => void>();
  private state: SessionState = { status: "checking", canSignOut: false };
  private generation = 0;
  private pending?: Promise<void>;
  private storageQueue: Promise<void> = Promise.resolve();
  private access?: AccessToken;
  private refreshToken?: string;
  private persistedRefreshToken?: string;

  constructor(dependencies: SessionDependencies) {
    this.dependencies = dependencies;
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async forOrganization<Result>(
    subject: string,
    organizationId: string,
    operation: (token: string, signal: AbortSignal) => Promise<Result>,
    timeoutMs = 10_000,
  ): Promise<Result> {
    const verified = this.state;
    if (
      verified.status !== "signedIn" ||
      !verified.account.organizations.some((organization) => organization.id === organizationId)
    ) {
      throw new Error("Organization session unavailable");
    }
    return this.forAccount(subject, operation, timeoutMs);
  }

  async forAccount<Result>(
    subject: string,
    operation: (token: string, signal: AbortSignal) => Promise<Result>,
    timeoutMs = 10_000,
  ): Promise<Result> {
    const verified = this.state;
    const access = this.access;
    if (
      verified.status !== "signedIn" ||
      verified.account.subject !== subject ||
      !access ||
      this.dependencies.now() >= verified.checkAt
    ) {
      throw new Error("Account session unavailable");
    }
    const controller = new AbortController();
    const unsubscribe = this.subscribe(() => controller.abort());
    const deadline = Math.min(timeoutMs, verified.checkAt - this.dependencies.now());
    const timer = setTimeout(() => controller.abort(), deadline);
    try {
      const result = await operation(access.value, controller.signal);
      if (controller.signal.aborted || this.dependencies.now() >= verified.checkAt) {
        throw new Error("Account request expired");
      }
      return result;
    } finally {
      clearTimeout(timer);
      unsubscribe();
    }
  }

  restore(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state.status !== "checking") return Promise.resolve();
    return this.run((generation) => this.resume(generation));
  }

  signIn(locale: string): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state.status !== "signedOut") return Promise.resolve();
    this.publish({ status: "signingIn" });
    return this.run(async (generation) => {
      const tokens = await this.dependencies.authorize(locale);
      if (tokens) {
        await this.accept(tokens, generation);
      } else {
        this.publish({ status: "signedOut" });
      }
    }, false);
  }

  revalidate(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state.status !== "signedIn" && this.state.status !== "verificationFailed") {
      return Promise.resolve();
    }
    this.publish({ status: "checking", canSignOut: true });
    return this.run((generation) => this.resume(generation));
  }

  async signOut(): Promise<void> {
    if (
      this.state.status !== "signedIn" &&
      this.state.status !== "verificationFailed" &&
      this.state.status !== "logoutFailed" &&
      !(this.state.status === "checking" && this.state.canSignOut)
    ) {
      return;
    }
    const active = this.pending;
    ++this.generation;
    this.access = undefined;
    this.publish({ status: "signingOut" });
    const earlyErase = this.refreshToken ? this.clearStorage() : undefined;

    // A refresh already in flight can still rotate the credential used for revocation.
    await active;
    let recovered = true;
    if (!earlyErase && !this.refreshToken) {
      try {
        this.refreshToken = await this.dependencies.storage.read();
      } catch {
        recovered = false;
      }
    }
    const erased = earlyErase ?? this.clearStorage();
    const revoked = recovered && (await this.revokeCurrent());
    if (await erased) {
      this.refreshToken = undefined;
      this.publish(
        revoked ? { status: "signedOut" } : { status: "signedOut", issue: "revocationFailed" },
      );
    } else {
      this.publish({ status: "logoutFailed" });
    }
  }

  private publish(state: SessionState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private publishAccount(account: MobileAccount, access: AccessToken) {
    this.publish({
      status: "signedIn",
      account,
      checkAt: Math.min(access.refreshAt, this.dependencies.now() + recheckIntervalMs),
    });
  }

  private run(operation: (generation: number) => Promise<void>, retryOnFailure = true) {
    const generation = this.generation;
    const pending = operation(generation)
      .catch(async (error: unknown) => {
        if (generation !== this.generation) return;
        if (!(error instanceof SessionRejectedError)) {
          this.publish(
            retryOnFailure || this.refreshToken
              ? { status: "verificationFailed" }
              : { status: "signedOut", issue: "operationFailed" },
          );
          return;
        }

        this.access = undefined;
        const erased = !this.refreshToken || (await this.clearStorage());
        if (generation !== this.generation) return;
        if (erased) {
          this.refreshToken = undefined;
          this.publish({ status: "signedOut", issue: "rejected" });
        } else {
          this.publish({ status: "logoutFailed" });
        }
      })
      .finally(() => {
        this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  }

  private async resume(generation: number) {
    let refreshToken = this.refreshToken;
    if (!refreshToken) {
      refreshToken = await this.dependencies.storage.read();
      this.refreshToken = refreshToken;
      this.persistedRefreshToken = refreshToken;
    }
    if (generation !== this.generation) return;
    if (!refreshToken) {
      this.publish({ status: "signedOut" });
      return;
    }
    if (this.state.status === "checking" && !this.state.canSignOut) {
      this.publish({ status: "checking", canSignOut: true });
    }

    if (refreshToken !== this.persistedRefreshToken) {
      await this.persist(refreshToken);
      if (generation !== this.generation) return;
    }
    const access = this.access;
    if (access && this.dependencies.now() < access.refreshAt) {
      const account = await this.verify(access);
      if (generation !== this.generation) return;
      if (account && this.dependencies.now() < access.refreshAt) {
        this.publishAccount(account, access);
        return;
      }
    }
    await this.accept(await this.dependencies.refresh(refreshToken), generation);
  }

  private async accept(tokens: MobileTokens, generation: number) {
    this.refreshToken = tokens.refreshToken;
    if (generation !== this.generation) return;

    const issued = this.dependencies.now();
    const lifetime = tokens.expiresIn * 1_000;
    if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error("Invalid token lifetime");
    const access = {
      value: tokens.accessToken,
      expiresAt: issued + lifetime,
      refreshAt: issued + lifetime - Math.min(maxRefreshLeadMs, lifetime / 5),
    };
    this.access = access;

    // Once Keycloak rotates, the old refresh token can no longer restore the session.
    if (tokens.refreshToken !== this.persistedRefreshToken) await this.persist(tokens.refreshToken);
    if (generation !== this.generation) return;
    const account = await this.verify(access);
    if (generation !== this.generation) return;
    if (!account) throw new Error("Access token expired during account verification");

    this.publishAccount(account, access);
  }

  private async verify(access: AccessToken) {
    if (this.dependencies.now() >= access.expiresAt) return undefined;
    try {
      const account = await this.dependencies.verify(access.value);
      return this.dependencies.now() < access.expiresAt ? account : undefined;
    } catch (error) {
      if (
        error instanceof AccessTokenRejectedError &&
        this.dependencies.now() >= access.expiresAt
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private persist(token: string) {
    return this.queueStorage(async () => {
      await this.dependencies.storage.write(token);
      this.persistedRefreshToken = token;
    });
  }

  private queueStorage(operation: () => Promise<void>) {
    const next = this.storageQueue.then(operation);
    // The caller handles this failure. Later storage operations must still be able to run.
    this.storageQueue = next.catch(() => {});
    return next;
  }

  private clearStorage() {
    return this.queueStorage(async () => {
      await this.dependencies.storage.clear();
      this.persistedRefreshToken = undefined;
    }).then(
      () => true,
      () => false,
    );
  }

  private async revokeCurrent() {
    if (!this.refreshToken) return true;
    try {
      await this.dependencies.revoke(this.refreshToken);
      this.refreshToken = undefined;
      return true;
    } catch {
      return false;
    }
  }
}
