import { isLocale } from "@vetx/i18n";
import {
  exchangeAccess,
  importedContent,
  type RecordIds,
} from "../../../../../../../../exchange/api.ts";
import { attachmentResponse, emptyResponse } from "../../../../../../../../auth/file-proxy.ts";
import { authRedirect } from "../../../../../../../../auth/http.ts";
import { readDirectoryPage } from "../../../../../../../../directory/forms.ts";
import { registryPath } from "../../../../../../../../patients/forms.ts";
export async function GET(request: Request, { params }: { params: Promise<RecordIds> }) {
  const ids = await params,
    access = await exchangeAccess(request, ids);
  if (access instanceof Response) return access;
  let status;
  try {
    const { response } = await importedContent(
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
  const query = new URL(request.url).searchParams,
    locale = query.get("locale");
  if (!isLocale(locale)) return emptyResponse(status);
  const target = new URL(
    `/${locale}${registryPath(ids)}/${ids.patientId}/imported-records`,
    access.config.webOrigin,
  );
  target.searchParams.set("download", "failed");
  const page = readDirectoryPage(query.get("page"));
  if (page > 1) target.searchParams.set("page", String(page));
  return authRedirect(target);
}
