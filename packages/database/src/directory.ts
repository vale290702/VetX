import type { ResourceSummary } from "./index.js";

export type DirectoryRole = "ADMIN" | "STAFF";

export interface DirectoryMember {
  subject: string;
  role: DirectoryRole;
  clinicIds: string[];
}

export interface DirectoryRevision {
  revision: number;
}

export interface AdministrationDirectory extends DirectoryRevision {
  clinics: ResourceSummary[];
  members: DirectoryMember[];
  page: number;
  hasNextPage: boolean;
}

type DirectoryErrorCode = "forbidden" | "invalid" | "conflict" | "last_admin";

export class DirectoryError extends Error {
  constructor(readonly code: DirectoryErrorCode) {
    super(code);
    this.name = "DirectoryError";
  }
}

export function directoryResult<T extends DirectoryRevision>(
  rows: { result: T | { error: DirectoryErrorCode } }[],
): T {
  const result = rows[0]?.result;
  if (!result) throw new Error("Database returned no directory result");
  if ("error" in result) throw new DirectoryError(result.error);
  return result;
}
