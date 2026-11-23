import { createVetxClient } from "@vetx/api-client";
import { exchangeAccess, jsonResult, commitPath } from "../../../../../../exchange/api.ts";
import { parseCommitChoice } from "../../../../../../exchange/forms.ts";
import { staffRequestOptions } from "../../../../../../auth/account.ts";
import { smallJson, emptyResponse } from "../../../../../../auth/file-proxy.ts";
import type { ClinicScope } from "../../../../../../patients/forms.ts";
export async function POST(
  request: Request,
  { params }: { params: Promise<ClinicScope & { receiptId: string }> },
) {
  const ids = await params,
    access = await exchangeAccess(request, ids);
  if (access instanceof Response) return access;
  const body = parseCommitChoice(await smallJson(request));
  if (!body) return emptyResponse(400);
  try {
    return jsonResult(
      await createVetxClient(access.config.apiOrigin).PUT(commitPath, {
        ...staffRequestOptions(access.session.accessToken),
        params: { path: ids },
        body,
      }),
    );
  } catch {
    return emptyResponse(503);
  }
}
