import type { components } from "@vetx/api-client";
import type { fetch as expoFetch } from "expo/fetch";
import {
  dataOf,
  PatientError,
  type ClinicScope,
  type PatientTransport,
} from "./patient-transport.ts";
import type { MobileSession } from "./session";

// Expo and Hermes provide the UTF-8 encoder. This workspace uses native-only TypeScript libraries.
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };

const patient = "/organizations/{organizationId}/clinics/{clinicId}/patients/{patientId}";
const path = `${patient}/documents` as const;
const record = `${path}/{documentId}` as const;
const ownerPath = "/owner/pets/{petId}/documents";
export type StaffDocument = components["schemas"]["StaffDocumentDto"];
export type OwnerDocument = components["schemas"]["OwnerDocumentDto"];
export type MedicalFile = Pick<
  StaffDocument,
  "id" | "assetId" | "mediaType" | "byteLength" | "ready"
>;
export type DocumentAccess = components["schemas"]["DocumentSharingDto"];
export type PickedDocument = {
  name: string;
  mediaType: MedicalFile["mediaType"];
  bytes: Uint8Array;
};
const transferTimeoutMs = 60_000;
export const absoluteSizeLimit = 32 * 1024 * 1024;
export const extensions = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
} as const;
export function recognizedType(
  mime: string | undefined,
  name: string,
): MedicalFile["mediaType"] | undefined {
  if (mime && Object.hasOwn(extensions, mime)) return mime as MedicalFile["mediaType"];
  if (mime && mime !== "application/octet-stream") return undefined;
  const suffix = name.toLowerCase().split(".").pop();
  if (suffix === "jpg" || suffix === "jpeg") return "image/jpeg";
  if (suffix === "pdf") return "application/pdf";
  if (suffix === "png") return "image/png";
}
function multipart(title: string, file: PickedDocument, boundary: string) {
  // Expo's JSON request adapter reads a Request body as text. Serialize this binary body without that conversion.
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="document.${extensions[file.mediaType]}"\r\nContent-Type: ${file.mediaType}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(prefix.length + file.bytes.length + suffix.length);
  body.set(prefix);
  body.set(file.bytes, prefix.length);
  body.set(suffix, prefix.length + file.bytes.length);
  return body;
}
function validateContent(doc: MedicalFile, data: ArrayBuffer, response: Response) {
  const type = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (
    !doc.ready ||
    doc.byteLength < 1 ||
    data.byteLength !== doc.byteLength ||
    data.byteLength > absoluteSizeLimit ||
    (type !== "application/octet-stream" && type !== doc.mediaType)
  )
    throw new Error("Invalid document content");
  return new Uint8Array(data);
}
export function createDocuments(
  { api, staff, owner }: PatientTransport,
  session: Pick<MobileSession, "forOrganization">,
  origin: string,
  fetcher: typeof expoFetch,
) {
  return {
    list(scope: ClinicScope, patientId: string, page: number) {
      return staff(scope, async (config, clinic) =>
        dataOf(
          await api.GET(path, {
            ...config,
            params: { path: { ...clinic, patientId }, query: { page } },
          }),
        ),
      );
    },
    released(subject: string, petId: string, page: number) {
      return owner(subject, async (config) =>
        dataOf(
          await api.GET(ownerPath, { ...config, params: { path: { petId }, query: { page } } }),
        ),
      );
    },
    sharingDetails(scope: ClinicScope, patientId: string, documentId: string, currentPage = 1) {
      return staff(scope, async (config, clinic) => {
        const params = { ...clinic, patientId };
        const readPage = async (page: number) =>
          dataOf(await api.GET(path, { ...config, params: { path: params, query: { page } } }));
        async function findDocument() {
          if (currentPage > 1) {
            const selected = (await readPage(currentPage)).documents.find(
              (item) => item.id === documentId,
            );
            if (selected) return selected;
          }
          // Concurrent uploads can move the document away from the page where the editor opened.
          for (let page = 1; ; page++) {
            const result = await readPage(page);
            const selected = result.documents.find((item) => item.id === documentId);
            if (selected) return selected;
            if (!result.hasNextPage) throw new PatientError(404);
          }
        }
        const [record, doc] = await Promise.all([
          api.GET(patient, { ...config, params: { path: params } }).then(dataOf),
          findDocument(),
        ]);
        return { doc, guardians: record.guardians };
      });
    },
    share(scope: ClinicScope, patientId: string, documentId: string, body: DocumentAccess) {
      return staff(scope, async (config, clinic) => {
        const result = await api.PUT(`${record}/sharing`, {
          ...config,
          params: { path: { ...clinic, patientId, documentId } },
          body,
        });
        if (result.response.status === 404 || result.response.status === 409)
          return "refresh" as const;
        dataOf(result);
        return "saved" as const;
      });
    },
    upload(
      scope: ClinicScope,
      patientId: string,
      documentId: string,
      title: string,
      file: PickedDocument,
      boundary: string,
    ) {
      if (!file.bytes.length || file.bytes.length > absoluteSizeLimit) throw new PatientError(413);
      return session.forOrganization(
        scope.subject,
        scope.organizationId,
        async (token, signal) => {
          const segments = [
            "organizations",
            scope.organizationId,
            "clinics",
            scope.clinicId,
            "patients",
            patientId,
            "documents",
            documentId,
          ];
          const response = await fetcher(
            new URL("/" + segments.map(encodeURIComponent).join("/"), origin).href,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Cache-Control": "no-store",
                "Content-Type": "multipart/form-data; boundary=" + boundary,
              },
              body: multipart(title, file, boundary),
              signal,
              credentials: "omit",
              redirect: "error",
            },
          );
          if (!response.ok) throw new PatientError(response.status);
        },
        transferTimeoutMs,
      );
    },
    staffContent(scope: ClinicScope, patientId: string, doc: MedicalFile) {
      return staff(
        scope,
        async (config, clinic) => {
          const result = await api.GET(`${record}/content`, {
            ...config,
            params: { path: { ...clinic, patientId, documentId: doc.id } },
            parseAs: "arrayBuffer",
          });
          return validateContent(doc, dataOf(result), result.response);
        },
        transferTimeoutMs,
      );
    },
    ownerContent(subject: string, petId: string, doc: MedicalFile) {
      return owner(
        subject,
        async (config) => {
          const result = await api.GET(`${ownerPath}/{assetId}/content`, {
            ...config,
            params: { path: { petId, assetId: doc.assetId } },
            parseAs: "arrayBuffer",
          });
          return validateContent(doc, dataOf(result), result.response);
        },
        transferTimeoutMs,
      );
    },
  };
}
export function documentSharingChange(
  original: DocumentAccess,
  visible: string[],
  selected: string[],
) {
  const guardianIds = [
    ...original.guardianIds.filter((id) => !visible.includes(id)),
    ...visible.filter((id) => selected.includes(id)),
  ];
  if (
    guardianIds.length === original.guardianIds.length &&
    guardianIds.every((id) => original.guardianIds.includes(id))
  )
    return undefined;
  return { revision: original.revision, guardianIds };
}
