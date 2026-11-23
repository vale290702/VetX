import {
  dataOf,
  PatientError,
  type PatientTransport,
  type ClinicScope,
} from "./patient-transport.ts";
import type { Artifact, Draft, Environment } from "./fiscal-forms.ts";
const path =
  "/organizations/{organizationId}/clinics/{clinicId}/billing/sales/{saleId}/fiscal/{environment}" as const;
export function createFiscal({ staff, api }: PatientTransport) {
  return {
    status(scope: ClinicScope, saleId: string, environment: Environment) {
      return staff(scope, async (config, clinic) =>
        dataOf(
          await api.GET(path, { ...config, params: { path: { ...clinic, saleId, environment } } }),
        ),
      );
    },
    issue(scope: ClinicScope, saleId: string, environment: Environment, body: Draft) {
      return staff(scope, async (config, clinic) =>
        dataOf(
          await api.PUT(path, {
            ...config,
            params: { path: { ...clinic, saleId, environment } },
            body,
          }),
        ),
      );
    },
    retry(scope: ClinicScope, saleId: string, environment: Environment) {
      return staff(scope, async (config, clinic) =>
        dataOf(
          await api.PUT(`${path}/retry`, {
            ...config,
            params: { path: { ...clinic, saleId, environment } },
          }),
        ),
      );
    },
    artifact(scope: ClinicScope, saleId: string, environment: Environment, kind: Artifact) {
      return staff(
        scope,
        async (config, clinic) => {
          const result = await api.GET(`${path}/artifacts/{kind}`, {
            ...config,
            params: { path: { ...clinic, saleId, environment, kind } },
            parseAs: "arrayBuffer",
          });
          const bytes = dataOf(result),
            type = result.response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
          const length = result.response.headers.get("Content-Length"),
            encoding = result.response.headers.get("Content-Encoding");
          if (
            type !== "application/xml" ||
            !bytes.byteLength ||
            ((!encoding || encoding === "identity") &&
              length !== null &&
              Number(length) !== bytes.byteLength)
          )
            throw new PatientError(502, "INVALID_FISCAL_XML");
          return new Uint8Array(bytes);
        },
        60000,
      );
    },
  };
}
