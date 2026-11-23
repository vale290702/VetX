import {
  dataOf,
  PatientError,
  type ClinicScope,
  type PatientTransport,
} from "./patient-transport.ts";
import type { ItemInput, WarehouseInput, MovementBody } from "./inventory-forms.ts";
const prefix = "/organizations/{organizationId}/clinics/{clinicId}/inventory" as const;
function read<T>(result: Parameters<typeof dataOf<T>>[0]) {
  if (result.response.status === 503) throw new PatientError(503, "INVENTORY_UNAVAILABLE");
  return dataOf(result);
}
export function createInventory({ api, staff }: PatientTransport) {
  return {
    warehouses(scope: ClinicScope, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${prefix}/warehouses`, { ...config, params: { path, query: { page } } }),
        ),
      );
    },
    saveWarehouse(scope: ClinicScope, warehouseId: string, body: WarehouseInput) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${prefix}/warehouses/{warehouseId}`, {
            ...config,
            params: { path: { ...path, warehouseId } },
            body,
          }),
        ),
      );
    },
    items(scope: ClinicScope, page: number, query: string) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${prefix}/items`, {
            ...config,
            params: { path, query: { page, query: query || undefined } },
          }),
        ),
      );
    },
    saveItem(scope: ClinicScope, itemId: string, body: ItemInput) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${prefix}/items/{itemId}`, {
            ...config,
            params: { path: { ...path, itemId } },
            body,
          }),
        ),
      );
    },
    balances(scope: ClinicScope, warehouseId: string, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${prefix}/warehouses/{warehouseId}/balances`, {
            ...config,
            params: { path: { ...path, warehouseId }, query: { page } },
          }),
        ),
      );
    },
    ledger(scope: ClinicScope, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${prefix}/movements`, { ...config, params: { path, query: { page } } }),
        ),
      );
    },
    move(scope: ClinicScope, movementId: string, body: MovementBody) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${prefix}/movements/{movementId}`, {
            ...config,
            params: { path: { ...path, movementId } },
            body,
          }),
        ),
      );
    },
  };
}
export async function inventoryWrite<T>(work: () => Promise<T>) {
  try {
    return { value: await work() } as const;
  } catch (e) {
    if (e instanceof PatientError) {
      if (e.status === 403 || e.status === 404) return { issue: "denied" } as const;
      if (e.status === 409) return { issue: "conflict" } as const;
      if (e.status === 400) return { issue: "invalid" } as const;
    }
    throw e;
  }
}
