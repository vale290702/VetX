import {
  dataOf,
  PatientError,
  type ClinicScope,
  type PatientTransport,
} from "./patient-transport.ts";
import type { PriceInput, SaleInput, ShiftInput, PaymentInput } from "./billing-forms.ts";
const prefix = "/organizations/{organizationId}/clinics/{clinicId}/billing" as const;
function read<T>(result: Parameters<typeof dataOf<T>>[0]) {
  if (result.response.status === 503) throw new PatientError(503, "BILLING_UNAVAILABLE");
  return dataOf(result);
}
export function createBilling({ api, staff }: PatientTransport) {
  return {
    prices(scope: ClinicScope, page: number, query: string) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${prefix}/prices`, {
            ...config,
            params: { path, query: { page, query: query || undefined } },
          }),
        ),
      );
    },
    price(scope: ClinicScope, priceId: string, body: PriceInput) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${prefix}/prices/{priceId}`, {
            ...config,
            params: { path: { ...path, priceId } },
            body,
          }),
        ),
      );
    },
    sales(scope: ClinicScope, page: number) {
      return staff(scope, async (config, path) =>
        read(await api.GET(`${prefix}/sales`, { ...config, params: { path, query: { page } } })),
      );
    },
    sale(scope: ClinicScope, saleId: string) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${prefix}/sales/{saleId}`, {
            ...config,
            params: { path: { ...path, saleId } },
          }),
        ),
      );
    },
    checkout(scope: ClinicScope, saleId: string, body: SaleInput) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${prefix}/sales/{saleId}`, {
            ...config,
            params: { path: { ...path, saleId } },
            body,
          }),
        ),
      );
    },
    payments(scope: ClinicScope, saleId: string, page: number) {
      return staff(scope, async (config, path) =>
        read(
          await api.GET(`${prefix}/sales/{saleId}/payments`, {
            ...config,
            params: { path: { ...path, saleId }, query: { page } },
          }),
        ),
      );
    },
    pay(scope: ClinicScope, saleId: string, paymentId: string, body: PaymentInput) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${prefix}/sales/{saleId}/payments/{paymentId}`, {
            ...config,
            params: { path: { ...path, saleId, paymentId } },
            body,
          }),
        ),
      );
    },
    shifts(scope: ClinicScope, page: number) {
      return staff(scope, async (config, path) =>
        read(await api.GET(`${prefix}/shifts`, { ...config, params: { path, query: { page } } })),
      );
    },
    open(scope: ClinicScope, shiftId: string, body: ShiftInput) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${prefix}/shifts/{shiftId}`, {
            ...config,
            params: { path: { ...path, shiftId } },
            body,
          }),
        ),
      );
    },
    close(scope: ClinicScope, shiftId: string, body: { counted: string }) {
      return staff(scope, async (config, path) =>
        read(
          await api.PUT(`${prefix}/shifts/{shiftId}/close`, {
            ...config,
            params: { path: { ...path, shiftId } },
            body,
          }),
        ),
      );
    },
  };
}
