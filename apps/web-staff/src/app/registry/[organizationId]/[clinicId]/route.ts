import { NextResponse, type NextRequest } from "next/server";
import { readStaffSession } from "../../../../auth/account.ts";
import { authRedirect, authRejected, formLocale, staffRedirect } from "../../../../auth/http.ts";
import { getWebAuthRuntime } from "../../../../auth/runtime.ts";
import { isSameOriginPost, secretsMatch } from "../../../../auth/security.ts";
import { isDirectoryId } from "../../../../directory/forms.ts";
import { writeRegistry } from "../../../../patients/api.ts";
import {
  registryPath,
  noticeForStatus,
  parsePatientChange,
  type ClinicScope,
  type PatientNotice,
} from "../../../../patients/forms.ts";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest, context: { params: Promise<ClinicScope> }) {
  let runtime;
  try {
    runtime = getWebAuthRuntime();
  } catch {
    return authRejected(503);
  }
  if (!runtime) return authRejected(503);
  const { webOrigin, apiOrigin } = runtime.config;
  if (!isSameOriginPost(request, webOrigin)) return authRejected(403);
  const scope = await context.params;
  if (!isDirectoryId(scope.organizationId) || !isDirectoryId(scope.clinicId))
    return authRejected(400);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return authRejected(400);
  }
  const locale = formLocale(form);
  const invite = form.get("action") === "invite";
  const access = await readStaffSession();
  if (access.kind !== "active")
    return invite
      ? NextResponse.json({}, { status: 401, headers })
      : staffRedirect(webOrigin, locale);
  const csrf = form.get("csrf");
  if (typeof csrf !== "string" || !secretsMatch(access.session.csrf, csrf))
    return authRejected(403);

  const change = parsePatientChange(form);
  let notice: PatientNotice = "invalid";
  let status = 400;
  if (change) {
    try {
      const result = await writeRegistry(apiOrigin, access.session.accessToken, scope, change);
      status = result.response.status;
      if (result.response.ok && invite) {
        const data = result.data;
        if (data && "code" in data)
          return NextResponse.json({ code: data.code, expiresAt: data.expiresAt }, { headers });
        status = 503;
      }
      notice = result.response.ok ? "saved" : noticeForStatus(status);
    } catch {
      status = 503;
      notice = "writeUnavailable";
    }
  }
  if (invite) return NextResponse.json({}, { status, headers });
  const id = form.get("patientId");
  const showDetail =
    form.get("source") === "detail" || (notice === "saved" && change?.action === "patient");
  const suffix = showDetail && isDirectoryId(id) ? `/${id}` : "";
  const destination = new URL(`/${locale}${registryPath(scope)}${suffix}`, webOrigin);
  destination.searchParams.set("notice", notice);
  return authRedirect(destination);
}
