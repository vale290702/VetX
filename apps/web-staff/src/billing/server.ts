import "server-only";
import { staffRequestOptions } from "../auth/account.ts";
import type { Access } from "../inventory/api.ts";
import type { ClinicScope } from "../patients/forms.ts";
export async function billingRequest(
  access: Access,
  scope: ClinicScope,
  path: string,
  body?: unknown,
) {
  try {
    const url = new URL(
      `/organizations/${scope.organizationId}/clinics/${scope.clinicId}/${path}`,
      access.config.apiOrigin,
    );
    const options = staffRequestOptions(access.session.accessToken);
    return await fetch(url, {
      ...options,
      method: body === undefined ? "GET" : "PUT",
      ...(body === undefined
        ? {}
        : {
            headers: { ...options.headers, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
