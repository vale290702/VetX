# Authentication

Verifies Keycloak bearer access tokens for the VetX API. The verifier pins the issuer, API audience and allowed application clients, then checks the session with Keycloak on each protected request.

See [Identity and access](../../docs/identity-and-access.md) for configuration and local verification.
