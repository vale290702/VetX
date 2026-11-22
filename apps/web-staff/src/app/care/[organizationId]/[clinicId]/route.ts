import { NextResponse, type NextRequest } from "next/server";
import { readStaffSession } from "../../../../auth/account.ts";
import { authRedirect, authRejected, formLocale, staffRedirect } from "../../../../auth/http.ts";
import { getWebAuthRuntime } from "../../../../auth/runtime.ts";
import { isSameOriginPost, secretsMatch } from "../../../../auth/security.ts";
import { isDirectoryId } from "../../../../directory/forms.ts";
import { carePath, parseCareChange, type CareNotice } from "../../../../care/forms.ts";
import { localInput, operatorZone } from "../../../../care/time.ts";
import { careError, writeCare } from "../../../../care/api.ts";
import { verifyAppointment } from "../../../../care/appointment-snapshot.ts";
import type { ClinicScope } from "../../../../patients/forms.ts";

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
  const json = request.headers.get("accept") === "application/json";
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  const access = await readStaffSession();
  if (access.kind !== "active")
    return json
      ? NextResponse.json({ notice: "denied" }, { status: 401, headers })
      : staffRedirect(webOrigin, locale);
  const csrf = form.get("csrf");
  if (typeof csrf !== "string" || !secretsMatch(access.session.csrf, csrf))
    return authRejected(403);
  const timeZone = operatorZone(form.get("timeZone"));
  let change = parseCareChange(form);
  let notice: CareNotice = "invalid",
    status = 400;
  if (form.get("source") === "calendar") {
    const original = verifyAppointment(
      form.get("viewedAppointment"),
      scope,
      access.session.csrf,
      runtime.config.clientSecret,
    );
    change = original ? parseCareChange(form, original) : null;
  }
  if (change) {
    try {
      const result = await writeCare(
        { origin: apiOrigin, token: access.session.accessToken },
        scope,
        change,
      );
      status = result.response.status;
      notice = result.response.ok ? "saved" : careError(status, result.error);
    } catch {
      notice = "unavailable";
      status = 503;
    }
  }
  const id = form.get("patientId"),
    calendar = form.get("source") === "calendar" || (notice === "saved" && change?.appointmentId);
  let day = form.get("day");
  if (notice === "saved" && change?.appointmentId)
    day = localInput(change.body.startAt, timeZone).slice(0, 10);
  const destination = new URL(
    "/" +
      locale +
      carePath(scope, !calendar && isDirectoryId(id) ? id : undefined, {
        timeZone,
        day: typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined,
      }),
    webOrigin,
  );
  destination.searchParams.set("careNotice", notice);
  return json
    ? NextResponse.json(
        { notice, location: destination.pathname + destination.search },
        { status: notice === "saved" ? 200 : status, headers },
      )
    : authRedirect(destination);
}
