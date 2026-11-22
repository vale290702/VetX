BEGIN;

ALTER TABLE public.organizations ADD COLUMN directory_revision integer NOT NULL DEFAULT 0;

CREATE TABLE public.directory_events (
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    revision integer NOT NULL,
    actor_issuer text NOT NULL,
    actor_subject text NOT NULL,
    action text NOT NULL CHECK (action IN (
        'CLINIC_CREATED', 'CLINIC_RENAMED', 'MEMBER_ASSIGNED', 'MEMBER_UPDATED', 'MEMBER_REVOKED'
    )),
    target text NOT NULL,
    details jsonb NOT NULL,
    recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, revision)
);
ALTER TABLE public.directory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_events FORCE ROW LEVEL SECURITY;

-- Only the migration owner can use these helpers. The three public functions below
-- are the runtime role's only directory entry points. Table writes remain ungranted.
CREATE SCHEMA vetx_directory;
REVOKE ALL ON SCHEMA vetx_directory FROM PUBLIC;

CREATE FUNCTION vetx_directory.organization_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT NULLIF(current_setting('vetx.organization_id', true), '')::uuid
$$;

-- No runtime table privileges are needed. The function owner has only an
-- INSERT policy, restricted to the actor and organization of this transaction.
CREATE POLICY directory_events_append ON public.directory_events FOR INSERT TO vetx_migration
    WITH CHECK (organization_id = vetx_directory.organization_id()
        AND actor_issuer = current_setting('vetx.identity_issuer', true)
        AND actor_subject = current_setting('vetx.identity_subject', true)
        AND current_setting('vetx.client_kind', true) = 'staff');

-- The function owner is NOBYPASSRLS, and FORCE ROW LEVEL SECURITY applies to it.
-- These policies give the functions the selected organization's rows and the
-- active issuer's identities, including accounts being provisioned for the first time.
CREATE POLICY directory_organizations ON public.organizations TO vetx_migration
    USING (id = vetx_directory.organization_id());
CREATE POLICY directory_clinics ON public.clinics TO vetx_migration
    USING (organization_id = vetx_directory.organization_id());
CREATE POLICY directory_memberships ON public.organization_memberships TO vetx_migration
    USING (organization_id = vetx_directory.organization_id());
CREATE POLICY directory_grants ON public.clinic_grants TO vetx_migration
    USING (organization_id = vetx_directory.organization_id());
CREATE POLICY directory_users ON public.users TO vetx_migration
    USING (identity_issuer = NULLIF(current_setting('vetx.identity_issuer', true), ''));

CREATE FUNCTION vetx_directory.is_admin() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT current_setting('vetx.client_kind', true) = 'staff' AND EXISTS (
        SELECT 1 FROM public.organization_memberships AS member
        JOIN public.users AS account ON account.id = member.user_id
        WHERE member.organization_id = vetx_directory.organization_id()
          AND member.role = 'ADMIN'
          AND account.identity_issuer = current_setting('vetx.identity_issuer', true)
          AND account.identity_subject = NULLIF(current_setting('vetx.identity_subject', true), '')
    )
$$;

CREATE FUNCTION vetx_directory.lock_revision() RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    revision integer;
BEGIN
    IF vetx_directory.is_admin() IS NOT TRUE THEN RETURN NULL; END IF;
    SELECT o.directory_revision INTO revision FROM public.organizations AS o
        WHERE o.id = vetx_directory.organization_id() FOR UPDATE;
    -- A concurrent writer may have revoked the caller while this transaction waited.
    IF vetx_directory.is_admin() IS NOT TRUE THEN RETURN NULL; END IF;
    RETURN revision;
END
$$;

CREATE FUNCTION public.directory_read(requested_page integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    directory jsonb;
BEGIN
    IF vetx_directory.is_admin() IS NOT TRUE THEN RETURN '{"error":"forbidden"}'; END IF;
    IF requested_page IS NULL OR requested_page < 1 THEN RETURN '{"error":"invalid"}'; END IF;

    WITH page_members AS MATERIALIZED (
        SELECT account.identity_subject AS subject, member.role, member.user_id
        FROM public.organization_memberships AS member
        JOIN public.users AS account ON account.id = member.user_id
        WHERE member.organization_id = vetx_directory.organization_id()
          AND account.identity_issuer = current_setting('vetx.identity_issuer', true)
        ORDER BY account.identity_subject COLLATE "C"
        LIMIT 26 OFFSET ((requested_page::bigint - 1) * 25)
    ), visible_members AS (
        SELECT subject, role, user_id FROM page_members ORDER BY subject COLLATE "C" LIMIT 25
    )
    SELECT jsonb_build_object(
        'revision', o.directory_revision,
        'clinics', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name, c.id)
            FROM public.clinics AS c WHERE c.organization_id = o.id
        ), '[]'::jsonb),
        'members', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'subject', m.subject, 'role', m.role,
                'clinicIds', COALESCE((
                    SELECT jsonb_agg(g.clinic_id ORDER BY g.clinic_id) FROM public.clinic_grants AS g
                    WHERE m.role = 'STAFF' AND g.organization_id = o.id AND g.user_id = m.user_id
                ), '[]'::jsonb)
            ) ORDER BY m.subject COLLATE "C") FROM visible_members AS m
        ), '[]'::jsonb),
        'page', requested_page, 'hasNextPage', (SELECT count(*) > 25 FROM page_members)
    ) INTO directory FROM public.organizations AS o WHERE o.id = vetx_directory.organization_id();
    RETURN directory;
END
$$;

CREATE FUNCTION vetx_directory.record_change(change_action text, change_target text, change_details jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    org uuid := vetx_directory.organization_id();
    new_revision integer;
BEGIN
    UPDATE public.organizations SET directory_revision = directory_revision + 1 WHERE id = org
        RETURNING directory_revision INTO STRICT new_revision;
    INSERT INTO public.directory_events (organization_id, revision, actor_issuer, actor_subject, action, target, details)
        VALUES (org, new_revision, current_setting('vetx.identity_issuer'),
                current_setting('vetx.identity_subject'), change_action, change_target, change_details);
    RETURN jsonb_build_object('revision', new_revision);
END
$$;

CREATE FUNCTION public.directory_save_clinic(clinic uuid, clinic_name text, expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    org uuid := vetx_directory.organization_id();
    revision integer := vetx_directory.lock_revision();
    old_name text;
BEGIN
    IF revision IS NULL THEN RETURN '{"error":"forbidden"}'; END IF;
    IF expected_revision IS NULL OR expected_revision < 0 OR clinic IS NULL OR clinic_name IS NULL
        OR length(clinic_name) NOT BETWEEN 1 AND 120 OR btrim(clinic_name) <> clinic_name
        OR clinic_name ~ '[[:cntrl:]]' THEN RETURN '{"error":"invalid"}'; END IF;
    SELECT c.name INTO old_name FROM public.clinics AS c WHERE c.organization_id = org AND c.id = clinic;
    IF old_name = clinic_name THEN RETURN jsonb_build_object('revision', revision); END IF;
    IF expected_revision <> revision THEN RETURN '{"error":"conflict"}'; END IF;
    IF old_name IS NULL THEN
        INSERT INTO public.clinics (id, organization_id, name) VALUES (clinic, org, clinic_name)
            ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN RETURN '{"error":"invalid"}'; END IF;
    ELSE
        UPDATE public.clinics SET name = clinic_name WHERE organization_id = org AND id = clinic;
    END IF;
    RETURN vetx_directory.record_change(
        CASE WHEN old_name IS NULL THEN 'CLINIC_CREATED' ELSE 'CLINIC_RENAMED' END,
        clinic::text, jsonb_build_object('name', clinic_name)
    );
END
$$;

-- A NULL role means revoke. An administrator's access is implicit, so an ADMIN
-- membership cannot carry a clinic grant set. A STAFF member may have zero grants.
CREATE FUNCTION public.directory_set_member(
    member_subject text, desired_role public.organization_role, clinic_ids uuid[], expected_revision integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    org uuid := vetx_directory.organization_id();
    revision integer := vetx_directory.lock_revision();
    issuer text := current_setting('vetx.identity_issuer', true);
    target_user uuid;
    old_role public.organization_role;
    old_clinics uuid[];
    desired_clinics uuid[];
BEGIN
    IF revision IS NULL THEN RETURN '{"error":"forbidden"}'; END IF;
    IF expected_revision IS NULL OR expected_revision < 0 OR member_subject IS NULL
        OR length(member_subject) NOT BETWEEN 1 AND 255 OR btrim(member_subject) <> member_subject
        OR member_subject ~ '[[:cntrl:]]' OR clinic_ids IS NULL
        OR array_position(clinic_ids, NULL) IS NOT NULL
        OR (desired_role IS DISTINCT FROM 'STAFF' AND cardinality(clinic_ids) <> 0)
        THEN RETURN '{"error":"invalid"}'; END IF;

    SELECT ARRAY(SELECT DISTINCT unnest(clinic_ids) ORDER BY 1) INTO desired_clinics;
    IF cardinality(desired_clinics) <> (
        SELECT count(*) FROM public.clinics AS c WHERE c.organization_id = org AND c.id = ANY(desired_clinics)
    ) THEN RETURN '{"error":"invalid"}'; END IF;

    SELECT a.id INTO target_user FROM public.users AS a
        WHERE a.identity_issuer = issuer AND a.identity_subject = member_subject;
    SELECT m.role INTO old_role FROM public.organization_memberships AS m
        WHERE m.organization_id = org AND m.user_id = target_user;
    SELECT ARRAY(SELECT g.clinic_id FROM public.clinic_grants AS g
        WHERE g.organization_id = org AND g.user_id = target_user ORDER BY g.clinic_id) INTO old_clinics;
    IF old_role IS NOT DISTINCT FROM desired_role AND old_clinics = desired_clinics THEN
        RETURN jsonb_build_object('revision', revision);
    END IF;
    IF expected_revision <> revision THEN RETURN '{"error":"conflict"}'; END IF;
    IF old_role = 'ADMIN' AND desired_role IS DISTINCT FROM 'ADMIN' AND NOT EXISTS (
        SELECT 1 FROM public.organization_memberships AS m
        WHERE m.organization_id = org AND m.role = 'ADMIN' AND m.user_id <> target_user
    ) THEN RETURN '{"error":"last_admin"}'; END IF;

    IF desired_role IS NULL THEN
        DELETE FROM public.organization_memberships WHERE organization_id = org AND user_id = target_user;
    ELSE
        IF target_user IS NULL THEN
            -- The same identity can be provisioned concurrently in different organizations.
            INSERT INTO public.users (identity_issuer, identity_subject) VALUES (issuer, member_subject)
                ON CONFLICT (identity_issuer, identity_subject) DO NOTHING;
            SELECT a.id INTO STRICT target_user FROM public.users AS a
                WHERE a.identity_issuer = issuer AND a.identity_subject = member_subject;
        END IF;
        INSERT INTO public.organization_memberships (organization_id, user_id, role)
            VALUES (org, target_user, desired_role) ON CONFLICT (organization_id, user_id)
            DO UPDATE SET role = EXCLUDED.role;
        DELETE FROM public.clinic_grants WHERE organization_id = org AND user_id = target_user;
        INSERT INTO public.clinic_grants (organization_id, clinic_id, user_id)
            SELECT org, c, target_user FROM unnest(desired_clinics) AS c;
    END IF;
    RETURN vetx_directory.record_change(
        CASE WHEN desired_role IS NULL THEN 'MEMBER_REVOKED'
             WHEN old_role IS NULL THEN 'MEMBER_ASSIGNED' ELSE 'MEMBER_UPDATED' END,
        member_subject,
        CASE WHEN desired_role IS NULL THEN '{}'::jsonb
             ELSE jsonb_build_object('role', desired_role, 'clinicIds', desired_clinics) END
    );
END
$$;

REVOKE ALL ON FUNCTION public.directory_read(integer),
    public.directory_save_clinic(uuid, text, integer),
    public.directory_set_member(text, public.organization_role, uuid[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.directory_read(integer),
    public.directory_save_clinic(uuid, text, integer),
    public.directory_set_member(text, public.organization_role, uuid[], integer) TO vetx_runtime;

COMMIT;
