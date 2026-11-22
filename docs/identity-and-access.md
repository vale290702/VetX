# Identity and clinic access

## Local accounts

Open the staff app at the exact origin set in `WEB_PUBLIC_ORIGIN`. Select **Iniciar sesión** or **Sign in**. The local realm allows account registration and defaults to Spanish. Registration includes an email verification message. Use the local Mailpit inbox to complete verification in development. Existing realms can enable **Verify email** under realm login settings. Staff access requires an explicit organization membership in the application database.

Keycloak stores credentials and authentication factors. Users can configure an authenticator and review active sessions in the Keycloak account console at `http://127.0.0.1:58080/realms/vetx/account/`. The password recovery link on the sign-in page sends a recovery message to the local Mailpit inbox at `http://127.0.0.1:58025`. Configure an authenticated SMTP service for deployed environments.

## Sessions and clients

The web app uses a confidential client, Authorization Code with PKCE, and an opaque HTTP-only session cookie. Redis stores the server-side session, including the access and refresh tokens. On sign-out the browser returns to Keycloak with an ID-token hint. The web client includes its own audience in access tokens so it can check its sessions through Keycloak introspection. All three application clients also include the API audience. The two Expo apps use distinct public clients, the system browser and PKCE. Device credentials are kept in secure storage. Client IDs and the issuer are public configuration. Supply the web and introspection client secrets only to their server processes.

The API checks the issuer, audience, originating client and expiration, and checks current token activity with Keycloak. Signing out of a browser or revoking its session in Keycloak invalidates that session. Other signed-in devices can continue to work.

## Staff permissions

`GET /me` returns the authenticated subject and the organizations available to the originating client. An owner client receives an empty staff organization list. An identity that signs in before staff provisioning can also have an empty list.

`GET /organizations/{organizationId}/clinics` requires staff access. An organization administrator can list clinics in that organization. A staff member can list clinics for which they have a matching grant. The API binds identity and tenant context inside a database transaction. PostgreSQL row-level policies enforce those boundaries with the application role.

### Provision the first local administrator

Register the staff account in the local realm. In the Keycloak admin console, open **Users**, select the account, and copy its ID. From the repository root, run the following command and supply that ID, the issuer used by the API, and your organization and clinic names when prompted. Run this once for a new organization. Existing accounts can have memberships in additional organizations.

```sh
pnpm compose exec postgres psql -X -U vetx_bootstrap -d vetx
```

```sql
\set ON_ERROR_STOP on
\prompt 'Keycloak user ID: ' subject
\prompt 'Issuer URL: ' issuer
\prompt 'New organization name: ' organization
\prompt 'First clinic name: ' clinic
BEGIN;
INSERT INTO users (identity_issuer, identity_subject) VALUES (:'issuer', :'subject')
  ON CONFLICT (identity_issuer, identity_subject) DO NOTHING;
INSERT INTO organizations (name) VALUES (:'organization') RETURNING id AS org_id \gset
INSERT INTO clinics (organization_id, name) VALUES (:'org_id', :'clinic');
INSERT INTO organization_memberships (organization_id, user_id, role)
  SELECT :'org_id', id, 'ADMIN' FROM users
  WHERE identity_issuer = :'issuer' AND identity_subject = :'subject';
COMMIT;
\q
```

The example uses the default Compose database `vetx`. The API uses the restricted `vetx_runtime` login. Reload the signed-in staff app to see the organization. A `STAFF` membership also requires a `clinic_grants` row for each clinic that user may access.

## Configuration and deployment

The development realm template lives in `infrastructure/keycloak/vetx-realm.json`. Compose supplies its client identifiers, secrets and the single web callback origin at import time. Keycloak imports a realm once. To change client settings on a realm already in use, apply the corresponding changes through the Keycloak administration interface.

Use the same issuer URL for every participant, HTTPS for deployed origins, and a private Redis instance restricted to the web app. Direct password grants are disabled on the application clients. The development Compose stack uses local credentials, development-mode Keycloak and a local mail sink. [Keycloak import behavior](https://www.keycloak.org/server/importExport)

The development Compose service sets `KEYCLOAK_MEMORY_LIMIT` to 1 GiB by default. This gives the JVM a container-specific heap budget when other services share the Docker VM. [Keycloak container memory settings](https://www.keycloak.org/server/containers#_specifying_different_memory_settings)
