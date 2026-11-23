import { createVetxClient } from "@vetx/api-client";
import { exchangeAccess, jsonResult, patients } from "../../../../../exchange/api.ts";
import { readSearch } from "../../../../../exchange/forms.ts";
import { staffRequestOptions } from "../../../../../auth/account.ts";
import { smallJson, emptyResponse } from "../../../../../auth/file-proxy.ts";
import type { ClinicScope } from "../../../../../patients/forms.ts";

export async function POST(request: Request, { params }: { params: Promise<ClinicScope> }) {
  const ids = await params,
    access = await exchangeAccess(request, ids);
  if (access instanceof Response) return access;
  const query = readSearch(await smallJson(request));
  if (!query) return emptyResponse(400);
  try {
    return jsonResult(
      await createVetxClient(access.config.apiOrigin).GET(patients, {
        ...staffRequestOptions(access.session.accessToken),
        params: { path: ids, query },
      }),
    );
  } catch {
    return emptyResponse(503);
  }
}
