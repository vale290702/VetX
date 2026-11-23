import { documentAccess, fetchDocumentPreview } from "../../../../../../../../documents/api.ts";
import {
  emptyResponse,
  previewResponse,
  type DocumentIds,
} from "../../../../../../../../documents/transport.ts";

export async function GET(request: Request, { params }: { params: Promise<DocumentIds> }) {
  const ids = await params;
  const access = await documentAccess(request, ids);
  if (access instanceof Response) return access;
  try {
    const { response } = await fetchDocumentPreview(
      access.config.apiOrigin,
      access.session.accessToken,
      ids,
      request.signal,
    );
    return previewResponse(response);
  } catch {
    return emptyResponse(503);
  }
}
