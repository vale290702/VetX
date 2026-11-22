import "server-only";

import { createVetxClient } from "@vetx/api-client";

import { loadOrganizationProfile, staffRequestOptions } from "../auth/account.ts";
import type { WebSession } from "../auth/flows.ts";
import type { DirectoryNotice, parseDirectoryChange } from "./forms.ts";

export async function loadDirectory(
  origin: string,
  session: WebSession,
  organizationId: string,
  page: number,
) {
  const organizations = await loadOrganizationProfile(origin, session.accessToken, session.subject);
  if (!organizations) return { kind: "unavailable" } as const;
  const organization = organizations.find((item) => item.id === organizationId);
  if (!organization) return { kind: "denied" } as const;
  const client = createVetxClient(origin);
  const path = { organizationId };
  try {
    const admin = await client.GET("/organizations/{organizationId}/administration", {
      ...staffRequestOptions(session.accessToken),
      params: { path, query: { page } },
    });
    if (admin.data) return { kind: "admin", organization, directory: admin.data } as const;
    if (admin.response.status !== 403) return { kind: "unavailable", organization } as const;
    const visible = await client.GET("/organizations/{organizationId}/clinics", {
      ...staffRequestOptions(session.accessToken),
      params: { path },
    });
    if (visible.data)
      return { kind: "staff", organization, clinics: visible.data.clinics } as const;
    if (visible.response.status === 403) return { kind: "denied" } as const;
  } catch {
    console.warn("Unable to load the staff directory.");
  }
  return { kind: "unavailable", organization } as const;
}

type Change = NonNullable<ReturnType<typeof parseDirectoryChange>>;

export async function saveDirectoryChange(
  origin: string,
  token: string,
  organizationId: string,
  change: Change,
): Promise<DirectoryNotice> {
  const client = createVetxClient(origin);
  const path = { organizationId };
  const options = staffRequestOptions(token);
  const { revision } = change;
  let result: { response: Response; error?: { error: { code: string } } };
  if (change.action === "clinic") {
    result = await client.PUT("/organizations/{organizationId}/administration/clinics/{clinicId}", {
      ...options,
      params: { path: { ...path, clinicId: change.clinicId } },
      body: { revision, name: change.name },
    });
  } else if (change.action === "member") {
    result = await client.PUT("/organizations/{organizationId}/administration/members", {
      ...options,
      params: { path },
      body: { revision, subject: change.subject, role: change.role, clinicIds: change.clinicIds },
    });
  } else {
    result = await client.POST("/organizations/{organizationId}/administration/members/revoke", {
      ...options,
      params: { path },
      body: { revision, subject: change.subject },
    });
  }
  switch (result.response.status) {
    case 200:
      return "saved";
    case 400:
      return "invalid";
    case 401:
    case 403:
      return "denied";
    case 409:
      return result.error?.error.code === "LAST_ORGANIZATION_ADMIN" ? "lastAdmin" : "conflict";
    default:
      return "writeUnavailable";
  }
}
