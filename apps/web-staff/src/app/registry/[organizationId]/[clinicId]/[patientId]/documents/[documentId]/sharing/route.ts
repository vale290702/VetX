import { documentAccess, shareDocument } from "../../../../../../../../documents/api.ts";
import { emptyResponse, type DocumentIds } from "../../../../../../../../documents/transport.ts";
import { readSharingBody } from "../../../../../../../../documents/sharing.ts";

export async function POST(request: Request, { params }: { params: Promise<DocumentIds> }) {
  const ids = await params;
  const access = await documentAccess(request, ids);
  if (access instanceof Response) return access;
  const body = await readSharingBody(request);
  if (!body) return emptyResponse(400);
  try {
    const { response } = await shareDocument(
      access.config.apiOrigin,
      access.session.accessToken,
      ids,
      body,
    );
    return emptyResponse(response.ok ? 204 : response.status);
  } catch {
    return emptyResponse(503);
  }
}
