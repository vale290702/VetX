import type { fetch as expoFetch } from "expo/fetch";
import {
  dataOf,
  PatientError,
  type ClinicScope,
  type PatientTransport,
} from "./patient-transport.ts";
import {
  packageLimit,
  packageType,
  type Source,
  type ExportInput,
  type Preview,
  type ImportDecision,
} from "./exchange-forms.ts";
import { multipartFile } from "./multipart-file.ts";
import type { MobileSession } from "./session";

const clinic = "/organizations/{organizationId}/clinics/{clinicId}" as const;
const historyPath = `${clinic}/patients/{patientId}/imported-records` as const;
const ownerPath = "/owner/pets/{petId}" as const;
const transferTimeout = 60_000;
function checked<T>(result: Parameters<typeof dataOf<T>>[0]) {
  if (result.response.status === 413) throw new PatientError(413, "EXCHANGE_SIZE");
  if (result.response.status === 503) throw new PatientError(503, "EXCHANGE_UNAVAILABLE");
  return dataOf(result);
}
function binary(
  result: { response: Response; data?: ArrayBuffer; error?: { error: { code: string } } },
  length?: number,
) {
  const data = checked(result);
  const type = result.response.headers.get("Content-Type")?.split(";")[0];
  if (
    type !== "application/octet-stream" ||
    !data.byteLength ||
    data.byteLength > packageLimit ||
    (length !== undefined && data.byteLength !== length)
  )
    throw new Error("Invalid exchange attachment");
  return new Uint8Array(data);
}
export function createExchange(
  { api, staff, owner }: PatientTransport,
  session: Pick<MobileSession, "forOrganization">,
  origin: string,
  fetcher: typeof expoFetch,
) {
  return {
    options(subject: string, petId: string) {
      return owner(subject, async (config) =>
        checked(
          await api.GET(`${ownerPath}/exchange-options`, {
            ...config,
            params: { path: { petId } },
          }),
        ),
      );
    },
    choices(subject: string, petId: string, source: Source, page: number) {
      const { organizationId, clinicId, patientId } = source;
      return owner(subject, async (config) =>
        checked(
          await api.GET(
            `${ownerPath}/exchange-options/{organizationId}/{clinicId}/{patientId}/records`,
            {
              ...config,
              params: { path: { petId, organizationId, clinicId, patientId }, query: { page } },
            },
          ),
        ),
      );
    },
    exportPackage(subject: string, petId: string, body: ExportInput) {
      return owner(
        subject,
        async (config) =>
          binary(
            await api.POST(`${ownerPath}/exports`, {
              ...config,
              params: { path: { petId } },
              body,
              parseAs: "arrayBuffer",
            }),
          ),
        transferTimeout,
      );
    },
    preview(scope: ClinicScope, bytes: Uint8Array, boundary: string): Promise<Preview> {
      if (!bytes.length || bytes.length > packageLimit)
        throw new PatientError(413, "EXCHANGE_SIZE");
      return session.forOrganization(
        scope.subject,
        scope.organizationId,
        async (token, signal) => {
          const url = new URL(
            [
              "/organizations",
              encodeURIComponent(scope.organizationId),
              "clinics",
              encodeURIComponent(scope.clinicId),
              "exchange/imports/preview",
            ].join("/"),
            origin,
          );
          const response = await fetcher(url.href, {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Cache-Control": "no-store",
              "Content-Type": "multipart/form-data; boundary=" + boundary,
            },
            body: multipartFile(bytes, "records.vetpkg", packageType, boundary),
            credentials: "omit",
            redirect: "error",
            signal,
          });
          if (!response.ok)
            throw new PatientError(
              response.status,
              response.status === 503
                ? "EXCHANGE_UNAVAILABLE"
                : response.status === 413
                  ? "EXCHANGE_SIZE"
                  : response.status === 400
                    ? "INVALID_PACKAGE"
                    : undefined,
            );
          return await response.json();
        },
        transferTimeout,
      );
    },
    commit(scope: ClinicScope, receiptId: string, body: ImportDecision) {
      return staff(scope, async (config, path) =>
        checked(
          await api.PUT(`${clinic}/exchange/imports/{receiptId}/commit`, {
            ...config,
            params: { path: { ...path, receiptId } },
            body,
          }),
        ),
      );
    },
    history(scope: ClinicScope, patientId: string, page: number) {
      return staff(scope, async (config, path) =>
        checked(
          await api.GET(historyPath, {
            ...config,
            params: { path: { ...path, patientId }, query: { page } },
          }),
        ),
      );
    },
    content(scope: ClinicScope, patientId: string, importedId: string, size: number) {
      return staff(
        scope,
        async (config, path) =>
          binary(
            await api.GET(`${historyPath}/{importedId}/content`, {
              ...config,
              params: { path: { ...path, patientId, importedId } },
              parseAs: "arrayBuffer",
            }),
            size,
          ),
        transferTimeout,
      );
    },
  };
}
