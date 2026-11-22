# VetX

VetX includes a staff web app, a staff mobile app, a pet-owner mobile app, and one NestJS API. Users can sign in through Keycloak in English or Spanish. The API resolves staff access from organization memberships and clinic grants in PostgreSQL. Clinics can register patients and guardians. Owners can link a clinic record to their account using a single-use code. [Patient and guardian guide](docs/patients-and-guardians.md)

## Repository structure

```text
apps/
  api/              NestJS API and OpenAPI generation
  web-staff/        Next.js staff application
  mobile-staff/     Expo staff application
  mobile-pets/      Expo pet-owner application
  worker/           BullMQ worker boundary
  ai-service/       AI service boundary
packages/
  api-client/       Typed fetch client generated from the OpenAPI contract
  auth/             Keycloak token verification
  config/           Validated environment and public client configuration
  contracts/        Generated OpenAPI contract
  database/         Prisma schema, migrations and PostgreSQL adapter
  design-tokens/    Shared web and native design tokens
  i18n/             English and Spanish translation catalogs
  permissions/      Staff and owner authorization types
  testing/          Playwright and Testcontainers suites
  ui-mobile/        Shared React Native UI
  ui-web/           Shared React UI
infrastructure/    Local Docker Compose services and database bootstrap
docs/              Implementation plan and milestones
.github/workflows/  GitHub Actions
```

## Local setup

Install Node.js 24.11.1 using `.nvmrc` and start Docker with Docker Compose v2. Run the following from the repository root. The example environment supplies loopback-only development services and disposable local credentials.

```sh
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
node scripts/init-local-env.mjs
pnpm compose up -d --wait
pnpm db:migrate
```

Run `node scripts/init-local-env.mjs` on existing checkouts to add the patient-link settings while keeping existing values. For a checkout upgraded from Phase 1, add the identity and Redis settings from the updated `.env.example` to your existing `.env`. Start the default Compose services again to import the VetX realm.

Start the API and web app in one terminal.

```sh
pnpm dev --filter=@vetx/api --filter=@vetx/web-staff
```

| Service       | Default local address                |
| ------------- | ------------------------------------ |
| Staff web     | `http://127.0.0.1:3000`              |
| API liveness  | `http://127.0.0.1:4000/health/live`  |
| API readiness | `http://127.0.0.1:4000/health/ready` |
| OpenAPI JSON  | `http://127.0.0.1:4000/openapi.json` |

Readiness performs a database query using the runtime account. Liveness stays available while the API can serve requests. Keep `DIRECT_DATABASE_URL` with the migration process and give the API only `DATABASE_URL`.

For sign-in, account recovery, session management and staff access setup, see the [identity guide](docs/identity-and-access.md). Organization administrators can [manage clinics and staff access](docs/clinic-administration.md) from the staff apps.

### Mobile development

Run these in separate terminals as needed. Use an iOS simulator or Android emulator with an Expo-compatible development build.

```sh
pnpm dev --filter=@vetx/mobile-staff
pnpm dev --filter=@vetx/mobile-pets
```

The staff Metro server uses port 8081 and the pet-owner server uses 8082. The iOS simulator can use the example loopback addresses. For the Android emulator, run `adb reverse tcp:4000 tcp:4000` and `adb reverse tcp:58080 tcp:58080` so the browser, app, and API use the same issuer. For a physical device, configure an HTTPS issuer and API reachable from the device. Rebuild the development client after adding authentication native modules.

To run a native development build, install Xcode and an iOS simulator or Android Studio and an Android emulator. Run the platform command for the selected app from the repository root. These commands build the native app and start Metro on the app’s configured port.

```sh
pnpm exec turbo run build --filter=@vetx/config
pnpm --filter @vetx/mobile-staff ios
pnpm --filter @vetx/mobile-pets android
```

Each app supports both the `ios` and `android` commands. Use HTTPS for deployed APIs. For a local HTTP API, the Android debug build must permit local cleartext traffic.

### Medical documents

To attach clinical files, start the private document store and initialize its local bucket after installing dependencies and compiling `@vetx/config`. Staff can share individual files with linked guardians. [Medical document setup and access](docs/medical-documents.md)

### Optional integrations

```sh
pnpm compose --profile integrations up -d --wait
pnpm compose --profile integrations down
```

| Local dependency       | Default host port |
| ---------------------- | ----------------- |
| PostgreSQL             | 56432             |
| Redis                  | 56379             |
| Keycloak               | 58080             |
| Mailpit inbox          | 58025             |
| S3-compatible storage  | 59000             |
| Orthanc HTTP and DICOM | 58042 and 54242   |

PostgreSQL, Redis, Keycloak and Mailpit start by default. The optional profile adds storage and Orthanc. Run `pnpm compose down` to stop the default services and retain local data.

## Checks

```sh
pnpm db:validate
pnpm generate:api
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm --filter @vetx/testing exec playwright install chromium
pnpm test:e2e
```

`pnpm build` compiles the API and web app and exports both Expo bundles for iOS and Android. `pnpm test:integration` starts an isolated PostgreSQL container and verifies the migration and runtime grants. `pnpm test:e2e` starts the built API and web app against the migrated local database. Free their configured ports before running it.

Regenerate and include both OpenAPI artifacts whenever API routes or types change. [Phase 1 plan and upcoming milestones](docs/phase-1-plan.md).
