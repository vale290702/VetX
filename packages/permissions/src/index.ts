export interface AccessPrincipal {
  readonly issuer: string;
  readonly subject: string;
  readonly kind: "staff" | "owner";
}

export type StaffPrincipal = AccessPrincipal & { readonly kind: "staff" };

export function isStaffPrincipal(principal: AccessPrincipal): principal is StaffPrincipal {
  return principal.kind === "staff";
}
