# VetX Phase 1 implementation plan

## Deliverable

Initialize the empty VetX repository as a pnpm and Turborepo workspace. The three applications will present a bilingual entry screen with a language selector. This phase establishes platform readiness in the API and creates an empty database with tenant identity tables. The apps display no clinical or commercial data.

## Architecture

The API is a NestJS modular monolith. A PostgreSQL adapter owned by the database package supplies Prisma to the API. HTTP liveness reports whether Nest can serve requests. Readiness checks PostgreSQL using the service account and verifies access to the migrated schema. The API publishes OpenAPI through Swagger and the workspace generates an HTTP client from a checked-in specification.

The Next.js app uses locale routes. Both Expo apps use a single shared native screen and independently registered app entry points. English and Spanish share a typed catalog. A platform-neutral token package supplies the starting palette and spacing to web and React Native. The entry screen exposes only working language controls.

## Implementation

1. Establish workspace metadata, the pinned toolchain, strict shared compiler profiles, linting, formatting and the task graph. Confirm a frozen install and workspace discovery.
2. Add environment schemas and documented local configuration. Test missing or invalid service settings without surfacing supplied secrets. Run Compose validation and start local dependencies.
3. Define and migrate organization, clinic and user identity tables with the minimum tenant constraints. Keep schema ownership and runtime database credentials separate. Verify on a clean PostgreSQL instance. No tenant data routes are part of Phase 1, and tenant access policy development starts before those routes.
4. Implement and test liveness, readiness, the health error response and request correlation. Generate OpenAPI and TypeScript client types. Exercise success and failure with the running service.
5. Implement the token system, both locales, the web entry screen and both native entry points. Verify locale parity, desktop and mobile web navigation and iOS/Android bundle exports.
6. Add GitHub Actions for frozen install, generated contract verification, formatting, lint, type checks, unit tests, migrations, Playwright and native bundling. Verify locally and document reproducible commands.

## Subsequent milestones

1. Keycloak OIDC clients, staff BFF sessions, mobile PKCE, memberships and row-level security with isolation tests.
2. Staff and clinic administration, owners, patients and one-time recipient-bound linking codes.
3. Clinical encounters, document storage, appointments and owner access to authorized records.
4. Referrals and signed, encrypted clinical exchange with import review, deduplication and provenance.
5. Inventory, pharmacy and billing. Validate the Costa Rican invoicing requirements and provider interfaces before integration.
6. Remaining clinical and engagement modules in dependency order, with explicit authorization, contracts, translations and end-to-end coverage per release.
