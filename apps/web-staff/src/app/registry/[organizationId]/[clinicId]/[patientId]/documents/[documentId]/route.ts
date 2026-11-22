import { isLocale } from "@vetx/i18n";
import { authRedirect } from "../../../../../../../auth/http.ts";
import { readDirectoryPage } from "../../../../../../../directory/forms.ts";
import { documentAccess, downloadDocument } from "../../../../../../../documents/api.ts";
import {
  attachmentResponse,
  emptyResponse,
  uploadDocument,
  type DocumentIds,
} from "../../../../../../../documents/transport.ts";
import { registryPath } from "../../../../../../../patients/forms.ts";

type Context = { params: Promise<DocumentIds> };

export async function POST(request: Request, { params }: Context) {
  const ids = await params;
  const access = await documentAccess(request, ids);
  if (access instanceof Response) return access;
  return uploadDocument(request, access.config.apiOrigin, access.session.accessToken, ids);
}

export async function GET(request: Request, { params }: Context) {
  const ids = await params;
  const access = await documentAccess(request, ids);
  if (access instanceof Response) return access;
  let status;
  try {
    const { response } = await downloadDocument(
      access.config.apiOrigin,
      access.session.accessToken,
      ids,
      request.signal,
    );
    if (response.ok) return attachmentResponse(response);
    status = response.status;
  } catch {
    status = 503;
  }
  const query = new URL(request.url).searchParams;
  const locale = query.get("locale");
  if (!isLocale(locale)) return emptyResponse(status);
  const destination = new URL(
    `/${locale}${registryPath(ids)}/${ids.patientId}/documents`,
    access.config.webOrigin,
  );
  destination.searchParams.set("download", "failed");
  const page = readDirectoryPage(query.get("page"));
  if (page > 1) destination.searchParams.set("page", String(page));
  return authRedirect(destination);
}
