BEGIN;

CREATE TYPE public.organization_role AS ENUM ('ADMIN', 'STAFF');

CREATE TABLE public.organization_memberships (
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role public.organization_role NOT NULL,
    CONSTRAINT organization_memberships_pkey PRIMARY KEY (organization_id, user_id),
    CONSTRAINT organization_memberships_organization_id_fkey FOREIGN KEY (organization_id)
        REFERENCES public.organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX organization_memberships_user_id_organization_id_idx
    ON public.organization_memberships (user_id, organization_id);

CREATE TABLE public.clinic_grants (
    organization_id UUID NOT NULL,
    clinic_id UUID NOT NULL,
    user_id UUID NOT NULL,
    CONSTRAINT clinic_grants_pkey PRIMARY KEY (organization_id, clinic_id, user_id),
    CONSTRAINT clinic_grants_organization_id_user_id_fkey FOREIGN KEY (organization_id, user_id)
        REFERENCES public.organization_memberships (organization_id, user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT clinic_grants_organization_id_clinic_id_fkey FOREIGN KEY (organization_id, clinic_id)
        REFERENCES public.clinics (organization_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX clinic_grants_organization_id_user_id_idx
    ON public.clinic_grants (organization_id, user_id);

GRANT SELECT ON public.organization_memberships, public.clinic_grants TO vetx_runtime;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_runtime_select ON public.users FOR SELECT TO vetx_runtime
USING (
    current_setting('vetx.client_kind', true) = 'staff'
    AND identity_issuer = NULLIF(current_setting('vetx.identity_issuer', true), '')
    AND identity_subject = NULLIF(current_setting('vetx.identity_subject', true), '')
);

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_memberships_runtime_select
    ON public.organization_memberships FOR SELECT TO vetx_runtime
USING (
    user_id IN (SELECT id FROM public.users)
    AND (
        NULLIF(current_setting('vetx.organization_id', true), '') IS NULL
        OR organization_id = NULLIF(current_setting('vetx.organization_id', true), '')::uuid
    )
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_runtime_select ON public.organizations FOR SELECT TO vetx_runtime
USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships AS membership
        WHERE membership.organization_id = organizations.id
    )
);

ALTER TABLE public.clinic_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_grants_runtime_select ON public.clinic_grants FOR SELECT TO vetx_runtime
USING (
    organization_id = NULLIF(current_setting('vetx.organization_id', true), '')::uuid
    AND user_id IN (SELECT id FROM public.users)
);

ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinics FORCE ROW LEVEL SECURITY;
CREATE POLICY clinics_runtime_select ON public.clinics FOR SELECT TO vetx_runtime
USING (
    organization_id = NULLIF(current_setting('vetx.organization_id', true), '')::uuid
    AND EXISTS (
        SELECT 1 FROM public.organization_memberships AS membership
        WHERE membership.organization_id = clinics.organization_id
        AND (
            membership.role = 'ADMIN'
            OR EXISTS (
                SELECT 1 FROM public.clinic_grants AS grant_row
                WHERE grant_row.organization_id = membership.organization_id
                AND grant_row.user_id = membership.user_id
                AND grant_row.clinic_id = clinics.id
            )
        )
    )
);

COMMIT;
