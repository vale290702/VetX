import { createVetxClient, type paths } from "@vetx/api-client";
import type { fetch as expoFetch } from "expo/fetch";

import type { MobileSession } from "./session";

const administration = "/organizations/{organizationId}/administration";
type DirectoryPage =
  paths[typeof administration]["get"]["responses"][200]["content"]["application/json"];
export type DirectoryMember = DirectoryPage["members"][number];
export type DirectoryClinic = DirectoryPage["clinics"][number];
export type DirectoryScope = { subject: string; organizationId: string };
export type DirectoryView =
  { kind: "admin"; directory: DirectoryPage } | { kind: "staff"; clinics: DirectoryClinic[] };

export class DirectoryError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super("Organization directory request failed");
    this.status = status;
    this.code = code;
  }
}

function readData<Data>(result: {
  response: Response;
  data?: Data;
  error?: { error: { code: string } };
}): Data {
  if (!result.response.ok || result.data === undefined)
    throw new DirectoryError(result.response.status, result.error?.error?.code);
  return result.data;
}

export function createDirectory(
  session: Pick<MobileSession, "forOrganization">,
  apiOrigin: string,
  fetch: typeof expoFetch,
) {
  const client = createVetxClient(apiOrigin);
  function options(organizationId: string, token: string, signal: AbortSignal) {
    return {
      params: { path: { organizationId } },
      headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-store" },
      async fetch(request: Request) {
        return fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.method === "GET" ? undefined : await request.text(),
          credentials: "omit",
          redirect: "error",
          signal,
        });
      },
    };
  }

  function run<Result>(
    scope: DirectoryScope,
    operation: (config: ReturnType<typeof options>) => Promise<Result>,
  ) {
    return session.forOrganization(scope.subject, scope.organizationId, (token, signal) =>
      operation(options(scope.organizationId, token, signal)),
    );
  }

  return {
    load(scope: DirectoryScope, page: number): Promise<DirectoryView> {
      return run(scope, async (config) => {
        const result = await client.GET(administration, {
          ...config,
          params: { ...config.params, query: { page } },
        });
        if (result.response.status !== 403) return { kind: "admin", directory: readData(result) };
        const granted = readData(
          await client.GET("/organizations/{organizationId}/clinics", config),
        );
        return { kind: "staff", clinics: granted.clinics };
      });
    },
    saveClinic(scope: DirectoryScope, clinicId: string, name: string, revision: number) {
      return run(scope, async (config) =>
        readData(
          await client.PUT("/organizations/{organizationId}/administration/clinics/{clinicId}", {
            ...config,
            params: { path: { organizationId: scope.organizationId, clinicId } },
            body: { name, revision },
          }),
        ),
      );
    },
    saveMember(scope: DirectoryScope, member: DirectoryMember, revision: number) {
      return run(scope, async (config) =>
        readData(
          await client.PUT("/organizations/{organizationId}/administration/members", {
            ...config,
            body: {
              subject: member.subject,
              role: member.role,
              clinicIds: member.clinicIds,
              revision,
            },
          }),
        ),
      );
    },
    revokeMember(scope: DirectoryScope, subject: string, revision: number) {
      return run(scope, async (config) =>
        readData(
          await client.POST("/organizations/{organizationId}/administration/members/revoke", {
            ...config,
            body: { subject, revision },
          }),
        ),
      );
    },
  };
}

export type StaffDirectoryClient = ReturnType<typeof createDirectory>;
