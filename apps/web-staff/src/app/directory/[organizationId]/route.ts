import type { NextRequest } from "next/server";

import { readStaffSession } from "../../../auth/account.ts";
import { authRedirect, authRejected, formLocale, staffRedirect } from "../../../auth/http.ts";
import { getWebAuthRuntime } from "../../../auth/runtime.ts";
import { isSameOriginPost, secretsMatch } from "../../../auth/security.ts";
import { saveDirectoryChange } from "../../../directory/api.ts";
import {
  isDirectoryId,
  parseDirectoryChange,
  readDirectoryPage,
  type DirectoryNotice,
} from "../../../directory/forms.ts";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ organizationId: string }> },
) {
  let runtime;
  try {
    runtime = getWebAuthRuntime();
  } catch {
    return authRejected(503);
  }
  if (!runtime) return authRejected(503);
  const { webOrigin, apiOrigin } = runtime.config;
  if (!isSameOriginPost(request, webOrigin)) return authRejected(403);
  const { organizationId } = await context.params;
  if (!isDirectoryId(organizationId)) return authRejected(400);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return authRejected(400);
  }
  const locale = formLocale(form);
  const access = await readStaffSession();
  if (access.kind !== "active") return staffRedirect(webOrigin, locale);
  const csrf = form.get("csrf");
  if (typeof csrf !== "string" || !secretsMatch(access.session.csrf, csrf))
    return authRejected(403);
  const change = parseDirectoryChange(form);
  const page = readDirectoryPage(form.get("page"));
  const destination = new URL(`/${locale}/organizations/${organizationId}`, webOrigin);
  if (page !== 1) destination.searchParams.set("page", String(page));
  let notice: DirectoryNotice = "invalid";
  if (change) {
    try {
      notice = await saveDirectoryChange(
        apiOrigin,
        access.session.accessToken,
        organizationId,
        change,
      );
    } catch {
      notice = "writeUnavailable";
    }
  }
  destination.searchParams.set("notice", notice);
  return authRedirect(destination);
}
