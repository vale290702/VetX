BEGIN;

CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clinics_organization_id_fkey" FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identity_issuer" TEXT NOT NULL,
    "identity_subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinics_organization_id_id_key" ON "clinics"("organization_id", "id");
CREATE UNIQUE INDEX "users_identity_issuer_identity_subject_key" ON "users"("identity_issuer", "identity_subject");

GRANT SELECT ON "organizations", "clinics", "users" TO vetx_runtime;

COMMIT;
