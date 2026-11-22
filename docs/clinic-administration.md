# Clinic and staff administration

An organization administrator can manage clinics and employee access from the staff web app or staff mobile app. Use the local provisioning steps in the [identity guide](identity-and-access.md) to grant the first administrator access to a new organization.

## Grant access to an employee

1. Have the employee sign in to their own staff account and share the staff ID shown there. The ID identifies the account in the organization’s configured Keycloak issuer.
2. Open the organization in the staff app. Create the clinics the employee will need, if necessary.
3. Add the employee by staff ID. An administrator can manage every clinic and staff membership in the organization. A staff member can work in the clinics explicitly assigned to them.
4. Save the membership. The employee can refresh their organization list. Permissions are evaluated against the current directory on each API request, including for users who are already signed in.

Removing a membership removes that employee’s grants in the selected organization. The employee keeps their identity and their memberships elsewhere. Each organization must retain at least one administrator. Add another administrator before removing or demoting the last one.

## Directory requests

The staff directory returns a page of 25 employees and a revision number. Every mutating request includes the revision the operator was viewing. When concurrent edits conflict, reload the directory and review the latest assignments. Retrying a previously successful request with the same desired state returns the current revision. Clinic creation uses a client-generated UUID so a retry keeps the same clinic.

| Method | Path under `/organizations/{organizationId}/administration` | Purpose                               |
| ------ | ----------------------------------------------------------- | ------------------------------------- |
| GET    | `?page=1`                                                   | Read the administration page          |
| PUT    | `/clinics/{clinicId}`                                       | Create or rename a clinic             |
| PUT    | `/members`                                                  | Assign an employee’s role and clinics |
| POST   | `/members/revoke`                                           | Remove an employee’s access           |

The generated OpenAPI contract describes request and response fields. Unauthorized organizations and staff accounts cannot access the administration routes. Staff use the existing `/organizations/{organizationId}/clinics` route to see their assigned clinics.
