import {
  dataOf,
  PatientError,
  type ClinicScope,
  type PatientTransport,
} from "./patient-transport.ts";
import type {
  SupplierBody,
  PurchaseBody,
  ReceiptBody,
  ReturnBody,
  GrantBody,
  RxBody,
  DispenseBody,
  Sharing,
} from "./trade-forms.ts";
const clinic = "/organizations/{organizationId}/clinics/{clinicId}" as const;
function read<T>(r: Parameters<typeof dataOf<T>>[0]) {
  if (r.response.status === 503) throw new PatientError(503, "TRADE_UNAVAILABLE");
  return dataOf(r);
}
export function createTrade({ api, staff, owner }: PatientTransport) {
  return {
    suppliers(scope: ClinicScope, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${clinic}/purchasing/suppliers`, {
            ...config,
            params: { path: path, query: { page } },
          }),
        ),
      );
    },
    saveSupplier(scope: ClinicScope, supplierId: string, body: SupplierBody) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/purchasing/suppliers/{supplierId}`, {
            ...config,
            params: { path: { ...path, supplierId } },
            body,
          }),
        ),
      );
    },
    orders(scope: ClinicScope, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${clinic}/purchasing/orders`, {
            ...config,
            params: { path: path, query: { page } },
          }),
        ),
      );
    },
    order(scope: ClinicScope, orderId: string, body: PurchaseBody) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/purchasing/orders/{orderId}`, {
            ...config,
            params: { path: { ...path, orderId } },
            body,
          }),
        ),
      );
    },
    receipts(scope: ClinicScope, orderId: string, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${clinic}/purchasing/orders/{orderId}/receipts`, {
            ...config,
            params: { path: { ...path, orderId }, query: { page } },
          }),
        ),
      );
    },
    receive(scope: ClinicScope, orderId: string, receiptId: string, body: ReceiptBody) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/purchasing/orders/{orderId}/receipts/{receiptId}`, {
            ...config,
            params: { path: { ...path, orderId, receiptId } },
            body,
          }),
        ),
      );
    },
    returns(scope: ClinicScope, orderId: string, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${clinic}/purchasing/orders/{orderId}/returns`, {
            ...config,
            params: { path: { ...path, orderId }, query: { page } },
          }),
        ),
      );
    },
    returnStock(scope: ClinicScope, orderId: string, returnId: string, body: ReturnBody) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/purchasing/orders/{orderId}/returns/{returnId}`, {
            ...config,
            params: { path: { ...path, orderId, returnId } },
            body,
          }),
        ),
      );
    },
    me(scope: ClinicScope) {
      return staff(scope, async (config, path) =>
        read(await api.GET(`${clinic}/pharmacy/me`, { ...config, params: { path: path } })),
      );
    },
    grants(scope: ClinicScope, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${clinic}/pharmacy/capabilities`, {
            ...config,
            params: { path: path, query: { page } },
          }),
        ),
      );
    },
    grant(scope: ClinicScope, subject: string, body: GrantBody) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/pharmacy/capabilities/{subject}`, {
            ...config,
            params: { path: { ...path, subject } },
            body,
          }),
        ),
      );
    },
    prescriptions(scope: ClinicScope, patientId: string, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${clinic}/patients/{patientId}/prescriptions`, {
            ...config,
            params: { path: { ...path, patientId }, query: { page } },
          }),
        ),
      );
    },
    prescribe(scope: ClinicScope, patientId: string, rxId: string, body: RxBody) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/patients/{patientId}/prescriptions/{rxId}`, {
            ...config,
            params: { path: { ...path, patientId, rxId } },
            body,
          }),
        ),
      );
    },
    dispensings(scope: ClinicScope, patientId: string, rxId: string, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${clinic}/patients/{patientId}/prescriptions/{rxId}/dispensings`, {
            ...config,
            params: { path: { ...path, patientId, rxId }, query: { page } },
          }),
        ),
      );
    },
    dispense(
      scope: ClinicScope,
      patientId: string,
      rxId: string,
      dispenseId: string,
      body: DispenseBody,
    ) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(
            `${clinic}/patients/{patientId}/prescriptions/{rxId}/dispensings/{dispenseId}`,
            { ...config, params: { path: { ...path, patientId, rxId, dispenseId } }, body },
          ),
        ),
      );
    },
    share(scope: ClinicScope, patientId: string, rxId: string, body: Sharing) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${clinic}/patients/{patientId}/prescriptions/{rxId}/sharing`, {
            ...config,
            params: { path: { ...path, patientId, rxId } },
            body,
          }),
        ),
      );
    },
    owner(subject: string, petId: string, page: number) {
      return owner(subject, async (config) =>
        read(
          await api.GET("/owner/pets/{petId}/prescriptions", {
            ...config,
            params: { path: { petId }, query: { page } },
          }),
        ),
      );
    },
  };
}
