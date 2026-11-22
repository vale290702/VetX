BEGIN;

CREATE SCHEMA vetx_registry;
REVOKE ALL ON SCHEMA vetx_registry FROM PUBLIC;

ALTER TABLE public.organizations ADD COLUMN pet_link_lifetime_seconds integer
  CHECK (pet_link_lifetime_seconds > 0);

CREATE TABLE public.patients (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  species text NOT NULL CHECK (length(species) BETWEEN 1 AND 80),
  birth_date date,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (organization_id, clinic_id, id),
  FOREIGN KEY (organization_id, clinic_id) REFERENCES public.clinics(organization_id,id)
);
CREATE INDEX patients_names ON public.patients(organization_id, clinic_id, lower(name), id);

CREATE TABLE public.owner_contacts (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(btrim(email))),
  PRIMARY KEY (organization_id, clinic_id, id),
  UNIQUE (organization_id, clinic_id, email),
  FOREIGN KEY (organization_id, clinic_id) REFERENCES public.clinics(organization_id,id)
);

-- The clinic's guardian relationship is independent of the owner's private grouping.
-- A new contact/guardian and invitation are required after revocation.
CREATE TABLE public.guardians (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  id uuid NOT NULL,
  contact_id uuid NOT NULL,
  removed_at timestamptz(3),
  issue_request_id uuid,
  digest text CHECK (digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz(3),
  recipient_issuer text,
  recipient_email text,
  owner_subject text,
  pet_id uuid,
  claim_request_id uuid,
  claim_target uuid,
  PRIMARY KEY (organization_id, clinic_id, patient_id, id),
  FOREIGN KEY (organization_id, clinic_id, patient_id) REFERENCES public.patients(organization_id,clinic_id,id),
  FOREIGN KEY (organization_id, clinic_id, contact_id) REFERENCES public.owner_contacts(organization_id,clinic_id,id),
  CHECK ((owner_subject IS NULL) = (pet_id IS NULL) AND (pet_id IS NULL) = (claim_request_id IS NULL)),
  CHECK (pet_id IS NULL OR digest IS NOT NULL),
  CHECK (num_nonnulls(issue_request_id,digest,expires_at,recipient_issuer,recipient_email) IN (0,5))
);
CREATE UNIQUE INDEX active_guardian_contacts ON public.guardians(organization_id,clinic_id,patient_id,contact_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX guardian_digests ON public.guardians(digest) WHERE digest IS NOT NULL;
CREATE INDEX owner_pet_groups ON public.guardians(recipient_issuer,owner_subject,pet_id) WHERE removed_at IS NULL;

CREATE TABLE public.registry_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  guardian_id uuid,
  actor_issuer text NOT NULL,
  actor_subject text NOT NULL,
  action text NOT NULL CHECK (action IN ('PATIENT_CREATED','PATIENT_UPDATED','GUARDIAN_ADDED','GUARDIAN_REMOVED','LINK_ISSUED','LINK_REDEEMED')),
  request_id uuid,
  recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, clinic_id, patient_id) REFERENCES public.patients(organization_id,clinic_id,id)
);
CREATE UNIQUE INDEX registry_issue_receipts ON public.registry_events(organization_id,clinic_id,patient_id,guardian_id,request_id) WHERE action='LINK_ISSUED';
CREATE TABLE public.pet_link_attempts (
  issuer text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  PRIMARY KEY (issuer, subject)
);

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.owner_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians FORCE ROW LEVEL SECURITY;
ALTER TABLE public.registry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pet_link_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pet_link_attempts FORCE ROW LEVEL SECURITY;

CREATE FUNCTION vetx_registry.clinic_id() RETURNS uuid LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT nullif(current_setting('vetx.clinic_id',true),'')::uuid
$$;

CREATE FUNCTION vetx_registry.staff_access(org uuid, clinic uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT current_setting('vetx.client_kind',true)='staff'
    AND org=vetx_directory.organization_id() AND clinic=vetx_registry.clinic_id()
    AND EXISTS (
      SELECT FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
      WHERE m.organization_id=org AND u.identity_issuer=current_setting('vetx.identity_issuer',true)
        AND u.identity_subject=current_setting('vetx.identity_subject',true)
        AND (m.role='ADMIN' OR EXISTS(SELECT FROM public.clinic_grants g
          WHERE g.organization_id=m.organization_id AND g.clinic_id=clinic AND g.user_id=m.user_id))
    )
$$;

CREATE FUNCTION vetx_registry.self(link_issuer text, link_subject text) RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT current_setting('vetx.client_kind',true)='owner'
    AND link_issuer=nullif(current_setting('vetx.identity_issuer',true),'')
    AND link_subject=nullif(current_setting('vetx.identity_subject',true),'')
$$;

CREATE POLICY registry_staff ON public.patients TO vetx_migration USING (vetx_registry.staff_access(organization_id, clinic_id));
CREATE POLICY registry_staff ON public.owner_contacts TO vetx_migration USING (vetx_registry.staff_access(organization_id, clinic_id));
CREATE POLICY registry_staff ON public.guardians TO vetx_migration USING (vetx_registry.staff_access(organization_id, clinic_id));

-- A pending invitation is visible only to its verified recipient, during a lookup of that exact digest.
CREATE POLICY registry_owner_select ON public.guardians FOR SELECT TO vetx_migration USING (
  removed_at IS NULL AND (
    vetx_registry.self(recipient_issuer, owner_subject) OR (
      owner_subject IS NULL AND current_setting('vetx.client_kind',true)='owner'
      AND recipient_issuer=current_setting('vetx.identity_issuer',true)
      AND recipient_email=lower(btrim(current_setting('vetx.verified_email',true)))
      AND digest=current_setting('vetx.link_digest',true)
    )
  )
);
CREATE POLICY registry_owner_claim ON public.guardians FOR UPDATE TO vetx_migration USING (
  removed_at IS NULL AND current_setting('vetx.client_kind',true)='owner'
  AND recipient_issuer=current_setting('vetx.identity_issuer',true)
  AND (owner_subject=current_setting('vetx.identity_subject',true) OR (
    owner_subject IS NULL AND recipient_email=lower(btrim(current_setting('vetx.verified_email',true)))
    AND digest=current_setting('vetx.link_digest',true)
  ))
) WITH CHECK (removed_at IS NULL AND vetx_registry.self(recipient_issuer,owner_subject));

CREATE FUNCTION vetx_registry.owns_record(org uuid, clinic uuid, patient uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT current_setting('vetx.client_kind',true)='owner' AND EXISTS (
    SELECT FROM public.guardians g WHERE g.organization_id=org AND (clinic IS NULL OR clinic=g.clinic_id)
      AND (patient IS NULL OR patient=g.patient_id) AND g.removed_at IS NULL
      AND vetx_registry.self(g.recipient_issuer,g.owner_subject)
  )
$$;
CREATE POLICY registry_owner ON public.patients FOR SELECT TO vetx_migration
  USING (vetx_registry.owns_record(organization_id,clinic_id,id));
CREATE POLICY registry_owner ON public.clinics FOR SELECT TO vetx_migration
  USING (vetx_registry.owns_record(organization_id,id,NULL));
CREATE POLICY registry_owner ON public.organizations FOR SELECT TO vetx_migration
  USING (vetx_registry.owns_record(id,NULL,NULL));

CREATE POLICY registry_owner_attempts ON public.pet_link_attempts TO vetx_migration
  USING (vetx_registry.self(issuer,subject));
CREATE POLICY registry_receipts ON public.registry_events FOR SELECT TO vetx_migration
  USING (vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY registry_append ON public.registry_events FOR INSERT TO vetx_migration WITH CHECK (
  actor_issuer=current_setting('vetx.identity_issuer',true) AND actor_subject=current_setting('vetx.identity_subject',true)
  AND (vetx_registry.staff_access(organization_id,clinic_id)
    OR (action='LINK_REDEEMED' AND vetx_registry.owns_record(organization_id,clinic_id,patient_id)))
);

CREATE FUNCTION public.registry_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  LOCK TABLE public.patients, public.owner_contacts, public.guardians, public.registry_events,
    public.pet_link_attempts, public.directory_events IN ACCESS SHARE MODE;
  RETURN true;
END
$$;

-- Serialize clinic writes with directory changes. Recheck the live grant after obtaining the lock.
CREATE FUNCTION vetx_registry.clinic_access(write_access boolean) RETURNS boolean LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
BEGIN
  IF vetx_registry.staff_access(org,clinic) IS NOT TRUE THEN RETURN false; END IF;
  IF write_access THEN
    PERFORM FROM public.organizations WHERE id=org FOR UPDATE;
    IF vetx_registry.staff_access(org,clinic) IS NOT TRUE THEN RETURN false; END IF;
  END IF;
  RETURN EXISTS(SELECT FROM public.clinics WHERE organization_id=org AND id=clinic);
END
$$;

CREATE FUNCTION vetx_registry.audit(patient uuid, guardian uuid, change text, request uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  INSERT INTO public.registry_events(organization_id,clinic_id,patient_id,guardian_id,action,request_id,actor_issuer,actor_subject)
  VALUES(vetx_directory.organization_id(),vetx_registry.clinic_id(),patient,guardian,change,request,
    current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'))
$$;

CREATE FUNCTION vetx_registry.patient_summary(p public.patients) RETURNS jsonb LANGUAGE sql STABLE
SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'name',p.name,'species',p.species,'birthDate',to_char(p.birth_date,'YYYY-MM-DD'),'revision',p.revision)
$$;

CREATE FUNCTION public.registry_list(page integer, search text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF page IS NULL OR page < 1 OR search IS NULL OR length(search)>120 THEN RETURN '{"error":"invalid"}'; END IF;
  WITH matches AS MATERIALIZED (
    SELECT p.* FROM public.patients p WHERE p.organization_id=vetx_directory.organization_id() AND p.clinic_id=vetx_registry.clinic_id()
      AND strpos(lower(p.name),lower(btrim(search)))>0
    ORDER BY lower(p.name),p.id LIMIT 26 OFFSET ((page::bigint-1)*25)
  ), visible AS (SELECT m.* FROM matches m ORDER BY lower(m.name),m.id LIMIT 25)
  SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),
    'patients',coalesce(jsonb_agg(vetx_registry.patient_summary(v::public.patients) ORDER BY lower(v.name),v.id),'[]')) INTO result FROM visible v;
  RETURN result;
END
$$;

CREATE FUNCTION public.registry_detail(patient uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  SELECT jsonb_build_object('patient',vetx_registry.patient_summary(p),'guardians',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',c.name,'email',c.email,'linked',g.owner_subject IS NOT NULL) ORDER BY c.name,g.id)
    FROM public.guardians g JOIN public.owner_contacts c
      ON (c.organization_id,c.clinic_id,c.id)=(g.organization_id,g.clinic_id,g.contact_id)
    WHERE (g.organization_id,g.clinic_id,g.patient_id)=(p.organization_id,p.clinic_id,p.id) AND g.removed_at IS NULL
  ),'[]')) INTO result FROM public.patients p WHERE p.organization_id=vetx_directory.organization_id()
    AND p.clinic_id=vetx_registry.clinic_id() AND p.id=patient;
  RETURN coalesce(result,'{"error":"not_found"}');
END
$$;

CREATE FUNCTION public.registry_save_patient(patient uuid, new_name text, new_species text, birth text, expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
  p public.patients; born date; change text;
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  new_name := btrim(new_name); new_species := btrim(new_species);
  IF patient IS NULL OR new_name IS NULL OR length(new_name) NOT BETWEEN 1 AND 120
    OR new_species IS NULL OR length(new_species) NOT BETWEEN 1 AND 80
    OR expected_revision IS NULL OR expected_revision<0 THEN RETURN '{"error":"invalid"}'; END IF;
  IF birth IS NOT NULL THEN
    IF birth !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT pg_input_is_valid(birth,'date') THEN RETURN '{"error":"invalid"}'; END IF;
    born := birth::date;
    IF born > (clock_timestamp() AT TIME ZONE 'UTC')::date THEN RETURN '{"error":"invalid"}'; END IF;
  END IF;
  SELECT * INTO p FROM public.patients WHERE organization_id=org AND clinic_id=clinic AND id=patient;
  IF NOT FOUND THEN
    IF expected_revision<>0 THEN RETURN '{"error":"not_found"}'; END IF;
    INSERT INTO public.patients(organization_id,clinic_id,id,name,species,birth_date)
      VALUES(org,clinic,patient,new_name,new_species,born) RETURNING * INTO p;
    change := 'PATIENT_CREATED';
  ELSE
    IF (p.name,p.species,p.birth_date) IS NOT DISTINCT FROM (new_name,new_species,born) THEN RETURN vetx_registry.patient_summary(p); END IF;
    IF expected_revision<>p.revision THEN RETURN '{"error":"conflict"}'; END IF;
    UPDATE public.patients SET name=new_name,species=new_species,birth_date=born,revision=revision+1
      WHERE organization_id=org AND clinic_id=clinic AND id=patient RETURNING * INTO p;
    change := 'PATIENT_UPDATED';
  END IF;
  PERFORM vetx_registry.audit(patient,NULL,change);
  RETURN vetx_registry.patient_summary(p);
END
$$;

CREATE FUNCTION public.registry_add_guardian(patient uuid, guardian uuid, contact_name text, contact_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
  c public.owner_contacts; g public.guardians;
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF NOT EXISTS(SELECT FROM public.patients WHERE organization_id=org AND clinic_id=clinic AND id=patient) THEN RETURN '{"error":"not_found"}'; END IF;
  contact_name := btrim(contact_name); contact_email := lower(btrim(contact_email));
  IF guardian IS NULL OR contact_name IS NULL OR length(contact_name) NOT BETWEEN 1 AND 120
    OR contact_email IS NULL OR length(contact_email)>254 OR contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    THEN RETURN '{"error":"invalid"}'; END IF;
  SELECT * INTO c FROM public.owner_contacts WHERE organization_id=org AND clinic_id=clinic AND email=contact_email;
  IF FOUND AND c.name<>contact_name THEN RETURN '{"error":"conflict"}'; END IF;
  SELECT * INTO g FROM public.guardians WHERE organization_id=org AND clinic_id=clinic AND patient_id=patient
    AND (id=guardian OR (contact_id=c.id AND removed_at IS NULL)) ORDER BY (id=guardian) DESC LIMIT 1;
  IF FOUND THEN
    IF g.id<>guardian OR g.contact_id IS DISTINCT FROM c.id OR g.removed_at IS NOT NULL THEN RETURN '{"error":"conflict"}'; END IF;
  ELSE
    IF c.id IS NULL THEN
      INSERT INTO public.owner_contacts(organization_id,clinic_id,name,email) VALUES(org,clinic,contact_name,contact_email) RETURNING * INTO c;
    END IF;
    INSERT INTO public.guardians(organization_id,clinic_id,patient_id,id,contact_id)
      VALUES(org,clinic,patient,guardian,c.id) RETURNING * INTO g;
    PERFORM vetx_registry.audit(patient,guardian,'GUARDIAN_ADDED');
  END IF;
  RETURN jsonb_build_object('id',g.id,'name',c.name,'email',c.email,'linked',g.owner_subject IS NOT NULL);
END
$$;

CREATE FUNCTION public.registry_remove_guardian(patient uuid, guardian uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id(); g public.guardians;
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  SELECT * INTO g FROM public.guardians WHERE organization_id=org AND clinic_id=clinic AND patient_id=patient AND id=guardian FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
  IF g.removed_at IS NULL THEN
    UPDATE public.guardians SET removed_at=clock_timestamp(),issue_request_id=NULL,digest=NULL,expires_at=NULL,
      recipient_issuer=NULL,recipient_email=NULL,owner_subject=NULL,pet_id=NULL,claim_request_id=NULL,claim_target=NULL
      WHERE organization_id=org AND clinic_id=clinic AND patient_id=patient AND id=guardian;
    PERFORM vetx_registry.audit(patient,guardian,'GUARDIAN_REMOVED');
  END IF;
  RETURN '{}';
END
$$;

CREATE FUNCTION public.registry_issue(patient uuid, guardian uuid, request uuid, code_digest text, default_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
  g public.guardians; lifetime integer; expiry timestamptz(3);
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF request IS NULL OR code_digest IS NULL OR code_digest !~ '^[a-f0-9]{64}$' OR default_seconds IS NULL OR default_seconds<1 THEN RETURN '{"error":"invalid"}'; END IF;
  SELECT * INTO g FROM public.guardians WHERE organization_id=org AND clinic_id=clinic AND patient_id=patient AND id=guardian AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
  IF g.owner_subject IS NOT NULL THEN RETURN '{"error":"conflict"}'; END IF;
  IF request=g.issue_request_id AND code_digest=g.digest AND g.expires_at>clock_timestamp() THEN
    expiry := g.expires_at;
  ELSE
    IF EXISTS(SELECT FROM public.registry_events WHERE organization_id=org AND clinic_id=clinic AND patient_id=patient
      AND guardian_id=guardian AND action='LINK_ISSUED' AND request_id=request) THEN RETURN '{"error":"conflict"}'; END IF;
    SELECT coalesce(pet_link_lifetime_seconds,default_seconds) INTO lifetime FROM public.organizations WHERE id=org;
    expiry := clock_timestamp()+make_interval(secs=>lifetime);
    UPDATE public.guardians SET issue_request_id=request,digest=code_digest,expires_at=expiry,
      recipient_issuer=current_setting('vetx.identity_issuer'),recipient_email=c.email
      FROM public.owner_contacts c WHERE guardians.organization_id=org AND guardians.clinic_id=clinic
      AND guardians.patient_id=patient AND guardians.id=guardian AND (c.organization_id,c.clinic_id,c.id)=(org,clinic,g.contact_id);
    PERFORM vetx_registry.audit(patient,guardian,'LINK_ISSUED',request);
  END IF;
  RETURN jsonb_build_object('expiresAt',to_char(expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END
$$;

CREATE FUNCTION public.registry_redeem(code_digest text, request uuid, existing_pet uuid, attempt_limit integer, window_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  actor_issuer text := nullif(current_setting('vetx.identity_issuer',true),'');
  actor_subject text := nullif(current_setting('vetx.identity_subject',true),'');
  actor_email text := nullif(lower(btrim(current_setting('vetx.verified_email',true))),'');
  attempts public.pet_link_attempts; g public.guardians; chosen_pet uuid;
BEGIN
  IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' OR actor_issuer IS NULL OR actor_subject IS NULL OR actor_email IS NULL
    THEN RETURN '{"error":"forbidden"}'; END IF;
  IF request IS NULL OR attempt_limit IS NULL OR attempt_limit<1 OR window_seconds IS NULL OR window_seconds<1
    THEN RETURN '{"error":"invalid"}'; END IF;
  -- One row per authenticated owner serializes attempts across application instances.
  INSERT INTO public.pet_link_attempts(issuer,subject,window_start) VALUES(actor_issuer,actor_subject,clock_timestamp())
    ON CONFLICT (issuer,subject) DO NOTHING;
  SELECT * INTO STRICT attempts FROM public.pet_link_attempts WHERE issuer=actor_issuer AND subject=actor_subject FOR UPDATE;
  IF attempts.window_start+make_interval(secs=>window_seconds)<=clock_timestamp() THEN
    UPDATE public.pet_link_attempts SET window_start=clock_timestamp(),failures=0 WHERE issuer=actor_issuer AND subject=actor_subject;
    attempts.failures := 0;
  END IF;
  IF attempts.failures>=attempt_limit THEN RETURN '{"error":"rate_limited"}'; END IF;

  PERFORM set_config('vetx.link_digest',coalesce(code_digest,''),true);
  SELECT * INTO g FROM public.guardians WHERE digest=code_digest AND removed_at IS NULL FOR UPDATE;
  IF FOUND AND vetx_registry.self(g.recipient_issuer,g.owner_subject) AND g.claim_request_id=request
    AND g.claim_target IS NOT DISTINCT FROM existing_pet THEN RETURN jsonb_build_object('petId',g.pet_id); END IF;
  IF g.id IS NOT NULL AND g.owner_subject IS NULL AND g.recipient_issuer=actor_issuer
    AND g.recipient_email=actor_email AND g.expires_at>clock_timestamp() THEN
    IF existing_pet IS NULL THEN
      chosen_pet := gen_random_uuid();
    ELSE
      -- Keep the authorizing link alive until this new clinic record joins the group.
      SELECT pet_id INTO chosen_pet FROM public.guardians
        WHERE pet_id=existing_pet AND removed_at IS NULL AND recipient_issuer=actor_issuer AND owner_subject=actor_subject
        ORDER BY organization_id,clinic_id,patient_id,id LIMIT 1 FOR SHARE;
    END IF;
    IF chosen_pet IS NOT NULL THEN
      UPDATE public.guardians SET owner_subject=actor_subject,pet_id=chosen_pet,claim_request_id=request,claim_target=existing_pet
        WHERE organization_id=g.organization_id AND clinic_id=g.clinic_id AND patient_id=g.patient_id AND id=g.id;
      INSERT INTO public.registry_events(organization_id,clinic_id,patient_id,guardian_id,actor_issuer,actor_subject,action,request_id)
        VALUES(g.organization_id,g.clinic_id,g.patient_id,g.id,actor_issuer,actor_subject,'LINK_REDEEMED',request);
      RETURN jsonb_build_object('petId',chosen_pet);
    END IF;
  END IF;
  UPDATE public.pet_link_attempts SET failures=failures+1 WHERE issuer=actor_issuer AND subject=actor_subject;
  RETURN '{"error":"not_found"}';
END
$$;

CREATE FUNCTION public.registry_owner_pets() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
  WITH records AS (
    SELECT DISTINCT g.pet_id,p.id,p.name,p.species,c.id AS clinic_id,c.name AS clinic,o.id AS org_id,o.name AS organization
    FROM public.guardians g JOIN public.patients p ON (p.organization_id,p.clinic_id,p.id)=(g.organization_id,g.clinic_id,g.patient_id)
    JOIN public.clinics c ON (c.organization_id,c.id)=(g.organization_id,g.clinic_id) JOIN public.organizations o ON o.id=g.organization_id
    WHERE g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)
  ), pets AS (
    SELECT pet_id,(array_agg(name ORDER BY organization,clinic,org_id,clinic_id,id))[1] AS name,
      (array_agg(species ORDER BY organization,clinic,org_id,clinic_id,id))[1] AS species,
      jsonb_agg(jsonb_build_object('recordId',id,'clinicName',clinic,'organizationName',organization)
        ORDER BY organization,clinic,org_id,clinic_id,id) AS clinics FROM records GROUP BY pet_id
  )
  SELECT jsonb_build_object('pets',coalesce(jsonb_agg(jsonb_build_object('id',pet_id,'name',name,'species',species,'clinics',clinics)
    ORDER BY lower(name),pet_id),'[]')) INTO result FROM pets;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.registry_lock_tables(), public.registry_list(integer,text), public.registry_detail(uuid),
  public.registry_save_patient(uuid,text,text,text,integer), public.registry_add_guardian(uuid,uuid,text,text),
  public.registry_remove_guardian(uuid,uuid), public.registry_issue(uuid,uuid,uuid,text,integer),
  public.registry_redeem(text,uuid,uuid,integer,integer), public.registry_owner_pets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registry_lock_tables(), public.registry_list(integer,text), public.registry_detail(uuid),
  public.registry_save_patient(uuid,text,text,text,integer), public.registry_add_guardian(uuid,uuid,text,text),
  public.registry_remove_guardian(uuid,uuid), public.registry_issue(uuid,uuid,uuid,text,integer),
  public.registry_redeem(text,uuid,uuid,integer,integer), public.registry_owner_pets() TO vetx_runtime;
COMMIT;
