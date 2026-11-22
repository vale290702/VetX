import { createVetxClient } from "@vetx/api-client";
import type { fetch as expoFetch } from "expo/fetch";

import { nativeRequest } from "./native-request.ts";
import type { DirectoryScope } from "./directory";
import type { MobileSession } from "./session";

export type ClinicScope = DirectoryScope & { clinicId: string };

export class PatientError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, code?: string) {
    super("Patient request failed");
    this.status = status;
    this.code = code;
  }
}

export function dataOf<T>(result: {
  response: Response;
  data?: T;
  error?: { error: { code: string } };
}): T {
  if (!result.response.ok || result.data === undefined)
    throw new PatientError(result.response.status, result.error?.error?.code);
  return result.data;
}

export function createPatientTransport(
  session: Pick<MobileSession, "forOrganization" | "forAccount">,
  origin: string,
  fetcher: typeof expoFetch,
) {
  const api = createVetxClient(origin);
  function staff<T>(
    scope: ClinicScope,
    operation: (
      config: ReturnType<typeof nativeRequest>,
      path: { organizationId: string; clinicId: string },
    ) => Promise<T>,
  ) {
    const { subject, organizationId, clinicId } = scope;
    return session.forOrganization(subject, organizationId, (token, signal) =>
      operation(nativeRequest(token, signal, fetcher), { organizationId, clinicId }),
    );
  }
  function owner<T>(
    subject: string,
    operation: (config: ReturnType<typeof nativeRequest>) => Promise<T>,
  ) {
    return session.forAccount(subject, (token, signal) =>
      operation(nativeRequest(token, signal, fetcher)),
    );
  }
  return { api, staff, owner };
}
export type PatientTransport = ReturnType<typeof createPatientTransport>;
