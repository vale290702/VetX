import "server-only";
import { createVetxClient } from "@vetx/api-client";
import { type readStaffSession, staffRequestOptions } from "../auth/account.ts";
import type { ClinicScope } from "../patients/forms.ts";
import { parseMovement, parseCatalog } from "./forms.ts";

export type Access = Extract<Awaited<ReturnType<typeof readStaffSession>>, { kind: "active" }>;
const root = "/organizations/{organizationId}/clinics/{clinicId}/inventory";
function api(access: Access) {
  return createVetxClient(access.config.apiOrigin);
}
function options(access: Access) {
  return staffRequestOptions(access.session.accessToken);
}
type Read<T> = { data: T; error?: never } | { data?: never; error: number };
async function read<T>(call: Promise<{ data?: T; response: Response }>): Promise<Read<T>> {
  try {
    const { response, data } = await call;
    return data === undefined ? { error: response.status } : { data };
  } catch {
    return { error: 503 };
  }
}
export function warehouses(access: Access, scope: ClinicScope, page: number) {
  return read(
    api(access).GET(`${root}/warehouses`, {
      ...options(access),
      params: { path: scope, query: { page } },
    }),
  );
}
export function items(access: Access, scope: ClinicScope, page: number, query: string) {
  return read(
    api(access).GET(`${root}/items`, {
      ...options(access),
      params: { path: scope, query: { page, query } },
    }),
  );
}
export function balances(access: Access, scope: ClinicScope, warehouseId: string, page: number) {
  return read(
    api(access).GET(`${root}/warehouses/{warehouseId}/balances`, {
      ...options(access),
      params: { path: { ...scope, warehouseId }, query: { page } },
    }),
  );
}
export function journal(access: Access, scope: ClinicScope, page: number) {
  return read(
    api(access).GET(`${root}/movements`, {
      ...options(access),
      params: { path: scope, query: { page } },
    }),
  );
}
export async function saveInventory(
  access: Access,
  scope: ClinicScope,
  resource: string,
  id: string,
  raw: unknown,
) {
  const client = api(access),
    opts = options(access);
  switch (resource) {
    case "items": {
      const body = parseCatalog("items", raw);
      if (!body) return 400;
      return (
        await client.PUT(`${root}/items/{itemId}`, {
          ...opts,
          params: { path: { ...scope, itemId: id } },
          body,
        })
      ).response.status;
    }
    case "warehouses": {
      const body = parseCatalog("warehouses", raw);
      if (!body) return 400;
      return (
        await client.PUT(`${root}/warehouses/{warehouseId}`, {
          ...opts,
          params: { path: { ...scope, warehouseId: id } },
          body,
        })
      ).response.status;
    }
    case "movements": {
      const body = parseMovement(raw);
      if (!body) return 400;
      return (
        await client.PUT(`${root}/movements/{movementId}`, {
          ...opts,
          params: { path: { ...scope, movementId: id } },
          body,
        })
      ).response.status;
    }
    default:
      return 404;
  }
}
