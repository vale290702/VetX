import "server-only";

import { loadWebAuthConfig } from "./config.ts";
import { createOidcProvider } from "./oidc.ts";
import { createSessionStore } from "./store.ts";

function createRuntime() {
  const config = loadWebAuthConfig();
  if (!config) return null;
  return {
    config,
    oidc: createOidcProvider(config),
    store: createSessionStore(config.redisUrl),
  };
}

let runtime: ReturnType<typeof createRuntime> | undefined;

export function getWebAuthRuntime() {
  if (runtime === undefined) runtime = createRuntime();
  return runtime;
}
