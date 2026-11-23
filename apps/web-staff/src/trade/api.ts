import "server-only";
import { createVetxClient } from "@vetx/api-client";
import { staffRequestOptions } from "../auth/account.ts";
import { warehouses, items, type Access } from "../inventory/api.ts";
import type { ClinicScope } from "../patients/forms.ts";
import type { Change, ChoiceKind, Choices } from "./forms.ts";
const clinic = "/organizations/{organizationId}/clinics/{clinicId}";
type Read<T> = { data: T; error?: never } | { data?: never; error: number };
async function read<T>(request: Promise<{ response: Response; data?: T }>): Promise<Read<T>> {
  try {
    const { response, data } = await request;
    return data === undefined ? { error: response.status } : { data };
  } catch {
    return { error: 503 };
  }
}
export function suppliers(access: Access, scope: ClinicScope, page: number) {
  return read(
    createVetxClient(access.config.apiOrigin).GET(`${clinic}/purchasing/suppliers`, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: { ...scope }, query: { page } },
    }),
  );
}
export function orders(access: Access, scope: ClinicScope, page: number) {
  return read(
    createVetxClient(access.config.apiOrigin).GET(`${clinic}/purchasing/orders`, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: { ...scope }, query: { page } },
    }),
  );
}
export function receipts(access: Access, scope: ClinicScope, orderId: string, page: number) {
  return read(
    createVetxClient(access.config.apiOrigin).GET(
      `${clinic}/purchasing/orders/{orderId}/receipts`,
      {
        ...staffRequestOptions(access.session.accessToken),
        params: { path: { ...scope, orderId }, query: { page } },
      },
    ),
  );
}
export function returns(access: Access, scope: ClinicScope, orderId: string, page: number) {
  return read(
    createVetxClient(access.config.apiOrigin).GET(`${clinic}/purchasing/orders/{orderId}/returns`, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: { ...scope, orderId }, query: { page } },
    }),
  );
}
export function grants(access: Access, scope: ClinicScope, page: number) {
  return read(
    createVetxClient(access.config.apiOrigin).GET(`${clinic}/pharmacy/capabilities`, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: { ...scope }, query: { page } },
    }),
  );
}
export function myGrant(access: Access, scope: ClinicScope) {
  return read(
    createVetxClient(access.config.apiOrigin).GET(`${clinic}/pharmacy/me`, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: { ...scope } },
    }),
  );
}
export function prescriptions(access: Access, scope: ClinicScope, patientId: string, page: number) {
  return read(
    createVetxClient(access.config.apiOrigin).GET(`${clinic}/patients/{patientId}/prescriptions`, {
      ...staffRequestOptions(access.session.accessToken),
      params: { path: { ...scope, patientId }, query: { page } },
    }),
  );
}
export function dispensings(
  access: Access,
  scope: ClinicScope,
  patientId: string,
  rxId: string,
  page: number,
) {
  return read(
    createVetxClient(access.config.apiOrigin).GET(
      `${clinic}/patients/{patientId}/prescriptions/{rxId}/dispensings`,
      {
        ...staffRequestOptions(access.session.accessToken),
        params: { path: { ...scope, patientId, rxId }, query: { page } },
      },
    ),
  );
}
export async function options(
  access: Access,
  scope: ClinicScope,
  kind: ChoiceKind,
  page: number,
): Promise<Read<Choices>> {
  if (kind === "items") {
    const r = await items(access, scope, page, "");
    return r.data
      ? {
          data: {
            page,
            hasNextPage: r.data.hasNextPage,
            options: r.data.items.map((i) => ({
              id: i.id,
              label: i.name + " · " + i.sku + " · " + i.unit,
              unit: i.unit,
            })),
          },
        }
      : { error: r.error };
  }
  if (kind === "warehouses") {
    const r = await warehouses(access, scope, page);
    return r.data
      ? {
          data: {
            page,
            hasNextPage: r.data.hasNextPage,
            options: r.data.warehouses.map((i) => ({ id: i.id, label: i.name })),
          },
        }
      : { error: r.error };
  }
  const r = await suppliers(access, scope, page);
  return r.data
    ? {
        data: {
          page,
          hasNextPage: r.data.hasNextPage,
          options: r.data.suppliers.map((i) => ({ id: i.id, label: i.name })),
        },
      }
    : { error: r.error };
}
export async function saveTrade(access: Access, scope: ClinicScope, id: string, change: Change) {
  const client = createVetxClient(access.config.apiOrigin),
    opts = staffRequestOptions(access.session.accessToken);
  switch (change.action) {
    case "supplier":
      return (
        await client.PUT(`${clinic}/purchasing/suppliers/{supplierId}`, {
          ...opts,
          params: { path: { ...scope, supplierId: id } },
          body: change.body,
        })
      ).response.status;
    case "order":
      return (
        await client.PUT(`${clinic}/purchasing/orders/{orderId}`, {
          ...opts,
          params: { path: { ...scope, orderId: id } },
          body: change.body,
        })
      ).response.status;
    case "receipt":
      return (
        await client.PUT(`${clinic}/purchasing/orders/{orderId}/receipts/{receiptId}`, {
          ...opts,
          params: { path: { ...scope, orderId: change.orderId, receiptId: id } },
          body: change.body,
        })
      ).response.status;
    case "return":
      return (
        await client.PUT(`${clinic}/purchasing/orders/{orderId}/returns/{returnId}`, {
          ...opts,
          params: { path: { ...scope, orderId: change.orderId, returnId: id } },
          body: change.body,
        })
      ).response.status;
    case "grant":
      return (
        await client.PUT(`${clinic}/pharmacy/capabilities/{subject}`, {
          ...opts,
          params: { path: { ...scope, subject: change.subject } },
          body: change.body,
        })
      ).response.status;
    case "prescribe":
      return (
        await client.PUT(`${clinic}/patients/{patientId}/prescriptions/{rxId}`, {
          ...opts,
          params: { path: { ...scope, patientId: change.patientId, rxId: id } },
          body: change.body,
        })
      ).response.status;
    case "share":
      return (
        await client.PUT(`${clinic}/patients/{patientId}/prescriptions/{rxId}/sharing`, {
          ...opts,
          params: { path: { ...scope, patientId: change.patientId, rxId: change.rxId } },
          body: change.body,
        })
      ).response.status;
    case "dispense":
      return (
        await client.PUT(
          `${clinic}/patients/{patientId}/prescriptions/{rxId}/dispensings/{dispenseId}`,
          {
            ...opts,
            params: {
              path: { ...scope, patientId: change.patientId, rxId: change.rxId, dispenseId: id },
            },
            body: change.body,
          },
        )
      ).response.status;
  }
}
