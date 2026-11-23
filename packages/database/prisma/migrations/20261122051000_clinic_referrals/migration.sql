BEGIN;
CREATE SCHEMA vetx_referral;
REVOKE ALL ON SCHEMA vetx_referral FROM PUBLIC;

-- Clinic grants, guardian authorization, and optimistic revisions apply to this row.
-- Referral details and counter-referrals have separate insert-only tables.
CREATE TABLE public.referral_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  source_org uuid NOT NULL, source_clinic uuid NOT NULL, patient_id uuid NOT NULL, guardian_id uuid NOT NULL,
  destination_org uuid NOT NULL, destination_clinic uuid NOT NULL,
  owner_issuer text NOT NULL, owner_subject text NOT NULL, pet_id uuid NOT NULL,
  linked boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','DECLINED','WITHDRAWN','RESPONDED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (source_org,source_clinic,request_id),
  FOREIGN KEY (source_org,source_clinic,patient_id,guardian_id) REFERENCES public.guardians(organization_id,clinic_id,patient_id,id),
  FOREIGN KEY (destination_org,destination_clinic) REFERENCES public.clinics(organization_id,id),
  CHECK ((source_org,source_clinic)<>(destination_org,destination_clinic))
);
CREATE INDEX referrals_destination ON public.referral_states(destination_org,destination_clinic,status);
CREATE INDEX referrals_guardian ON public.referral_states(source_org,source_clinic,patient_id,guardian_id);
CREATE INDEX referrals_owner ON public.referral_states(owner_issuer,owner_subject,pet_id);

CREATE TABLE public.referral_requests (
  id uuid PRIMARY KEY REFERENCES public.referral_states(id),
  source_organization_name text NOT NULL, source_clinic_name text NOT NULL,
  destination_organization_name text NOT NULL, destination_clinic_name text NOT NULL,
  patient_name text NOT NULL, species text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 250),
  summary text NOT NULL CHECK (length(summary) <= 8000),
  author_issuer text NOT NULL, author_subject text NOT NULL,
  requested_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX referrals_chronology ON public.referral_requests(requested_at DESC,id);

CREATE TABLE public.referral_responses (
  id uuid PRIMARY KEY REFERENCES public.referral_states(id),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 8000),
  author_issuer text NOT NULL, author_subject text NOT NULL,
  recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.referral_events (
  referral_id uuid NOT NULL REFERENCES public.referral_states(id),
  revision integer NOT NULL CHECK (revision > 0),
  action text NOT NULL CHECK (action IN ('REQUESTED','APPROVED','DECLINED','WITHDRAWN','RESPONDED','GUARDIAN_UNLINKED')),
  actor_issuer text NOT NULL, actor_subject text NOT NULL,
  recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (referral_id,revision)
);

CREATE FUNCTION vetx_referral.visible(s public.referral_states) RETURNS boolean LANGUAGE sql STABLE
SET search_path=pg_catalog,pg_temp AS $$
  SELECT vetx_registry.staff_access(s.source_org,s.source_clinic)
    OR (s.linked AND (vetx_registry.self(s.owner_issuer,s.owner_subject) OR
      (s.status IN ('APPROVED','RESPONDED') AND vetx_registry.staff_access(s.destination_org,s.destination_clinic))))
$$;
ALTER TABLE public.referral_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_states FORCE ROW LEVEL SECURITY;
CREATE POLICY referral_read ON public.referral_states FOR SELECT TO vetx_migration
  USING (vetx_referral.visible(referral_states));
CREATE POLICY referral_new ON public.referral_states FOR INSERT TO vetx_migration
  WITH CHECK (vetx_registry.staff_access(source_org,source_clinic) AND status='REQUESTED' AND revision=1 AND linked);
CREATE POLICY referral_transition ON public.referral_states FOR UPDATE TO vetx_migration
  USING (vetx_referral.visible(referral_states)) WITH CHECK (vetx_referral.visible(referral_states));

CREATE FUNCTION vetx_referral.immutable_route() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF to_jsonb(NEW)-ARRAY['status','revision','linked'] <> to_jsonb(OLD)-ARRAY['status','revision','linked']
    OR NEW.revision<>OLD.revision+1 OR (NOT OLD.linked AND NEW.linked)
    THEN RAISE EXCEPTION 'Invalid referral update' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER referral_route BEFORE UPDATE ON public.referral_states
  FOR EACH ROW EXECUTE FUNCTION vetx_referral.immutable_route();

-- Registry unlinking and revocation of recipient access commit together.
-- Locking referral_states also serializes unlink with decisions and responses.
CREATE FUNCTION vetx_referral.revoke_guardian() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  WITH revoked AS (
    UPDATE public.referral_states s SET linked=false,revision=revision+1,
      status=CASE WHEN status='DECLINED' THEN status ELSE 'WITHDRAWN' END
      WHERE (s.source_org,s.source_clinic,s.patient_id,s.guardian_id)=(OLD.organization_id,OLD.clinic_id,OLD.patient_id,OLD.id)
        AND s.linked RETURNING s.id,s.revision
  )
  INSERT INTO public.referral_events(referral_id,revision,action,actor_issuer,actor_subject)
    SELECT id,revision,'GUARDIAN_UNLINKED',coalesce(nullif(current_setting('vetx.identity_issuer',true),''),session_user),
      coalesce(nullif(current_setting('vetx.identity_subject',true),''),session_user) FROM revoked;
  RETURN NULL;
END
$$;
CREATE TRIGGER invalidate_referral_link AFTER UPDATE OF removed_at,recipient_issuer,owner_subject,pet_id ON public.guardians
  FOR EACH ROW WHEN (OLD.owner_subject IS NOT NULL AND
    (OLD.removed_at,OLD.recipient_issuer,OLD.owner_subject,OLD.pet_id) IS DISTINCT FROM (NEW.removed_at,NEW.recipient_issuer,NEW.owner_subject,NEW.pet_id))
  EXECUTE FUNCTION vetx_referral.revoke_guardian();

DO $$
DECLARE tbl text; fk text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['referral_requests','referral_responses','referral_events'] LOOP
    fk := CASE WHEN tbl='referral_events' THEN 'referral_id' ELSE 'id' END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY read_visible ON public.%I FOR SELECT TO vetx_migration USING (EXISTS (SELECT FROM public.referral_states s WHERE s.id=%I.%I))',tbl,tbl,fk);
  END LOOP;
END
$$;
CREATE POLICY request_append ON public.referral_requests FOR INSERT TO vetx_migration WITH CHECK (
  author_issuer=current_setting('vetx.identity_issuer') AND author_subject=current_setting('vetx.identity_subject') AND
  EXISTS (SELECT FROM public.referral_states s WHERE s.id=referral_requests.id AND vetx_registry.staff_access(s.source_org,s.source_clinic))
);
CREATE POLICY response_append ON public.referral_responses FOR INSERT TO vetx_migration WITH CHECK (
  author_issuer=current_setting('vetx.identity_issuer') AND author_subject=current_setting('vetx.identity_subject') AND
  EXISTS (SELECT FROM public.referral_states s WHERE s.id=referral_responses.id AND s.status='APPROVED' AND s.linked
    AND vetx_registry.staff_access(s.destination_org,s.destination_clinic))
);
CREATE POLICY event_append ON public.referral_events FOR INSERT TO vetx_migration WITH CHECK (
  actor_issuer=current_setting('vetx.identity_issuer') AND actor_subject=current_setting('vetx.identity_subject') AND
  EXISTS (SELECT FROM public.referral_states s WHERE s.id=referral_events.referral_id)
);

CREATE FUNCTION public.referral_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  LOCK TABLE public.referral_states,public.referral_requests,public.referral_responses,public.referral_events IN ACCESS SHARE MODE;
  RETURN true;
END
$$;

CREATE FUNCTION vetx_referral.audit(ref uuid, rev integer, change text) RETURNS void LANGUAGE sql
SET search_path=pg_catalog,pg_temp AS $$
  INSERT INTO public.referral_events(referral_id,revision,action,actor_issuer,actor_subject)
    VALUES(ref,rev,change,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'))
$$;

-- Resolve only the destination's two directory labels. Restore the caller's
-- organization before any protected patient lookup or write.
CREATE FUNCTION vetx_referral.clinic_label(org uuid, clinic uuid, OUT organization_name text, OUT clinic_name text)
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE selected_org text:=current_setting('vetx.organization_id',true);
BEGIN
  PERFORM set_config('vetx.organization_id',org::text,true);
  SELECT o.name,c.name INTO organization_name,clinic_name FROM public.organizations o JOIN public.clinics c ON c.organization_id=o.id
    WHERE (o.id,c.id)=(org,clinic);
  PERFORM set_config('vetx.organization_id',selected_org,true);
END
$$;

CREATE FUNCTION vetx_referral.detail(ref uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('id',s.id,'status',s.status,'revision',s.revision,'requestedAt',vetx_care.utc(q.requested_at),
    'requestedBy',jsonb_build_object('issuer',q.author_issuer,'subject',q.author_subject),
    'source',jsonb_build_object('organizationId',s.source_org,'clinicId',s.source_clinic,'organizationName',q.source_organization_name,'clinicName',q.source_clinic_name),
    'destination',jsonb_build_object('organizationId',s.destination_org,'clinicId',s.destination_clinic,'organizationName',q.destination_organization_name,'clinicName',q.destination_clinic_name),
    'patient',jsonb_build_object('id',s.patient_id,'name',q.patient_name,'species',q.species),'reason',q.reason,'summary',q.summary,
    'response',CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('summary',r.summary,'recordedAt',vetx_care.utc(r.recorded_at),
      'author',jsonb_build_object('issuer',r.author_issuer,'subject',r.author_subject)) END)
  FROM public.referral_states s JOIN public.referral_requests q ON q.id=s.id LEFT JOIN public.referral_responses r ON r.id=s.id
    WHERE s.id=ref
$$;

CREATE FUNCTION public.referral_request(patient uuid, request uuid, guardian uuid, target_org uuid, target_clinic uuid, reason_input text, summary_input text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
  issuer text:=current_setting('vetx.identity_issuer',true); subject text:=current_setting('vetx.identity_subject',true);
  s public.referral_states; q public.referral_requests; g public.guardians; p public.patients; src record; dest record;
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  reason_input:=vetx_care.clean(reason_input); summary_input:=vetx_care.clean(summary_input);
  IF num_nonnulls(patient,request,guardian,target_org,target_clinic,reason_input,summary_input)<>7 OR (org,clinic)=(target_org,target_clinic)
    OR length(reason_input) NOT BETWEEN 1 AND 250 OR reason_input ~ '[[:cntrl:]]' OR length(summary_input)>8000
    THEN RETURN '{"error":"invalid"}'; END IF;
  SELECT * INTO s FROM public.referral_states WHERE (source_org,source_clinic,request_id)=(org,clinic,request);
  IF FOUND THEN
    SELECT * INTO q FROM public.referral_requests WHERE id=s.id;
    IF (s.patient_id,s.guardian_id,s.destination_org,s.destination_clinic,q.reason,q.summary,q.author_issuer,q.author_subject)
      IS DISTINCT FROM (patient,guardian,target_org,target_clinic,reason_input,summary_input,issuer,subject) THEN RETURN '{"error":"conflict"}'; END IF;
    RETURN vetx_referral.detail(s.id);
  END IF;
  SELECT * INTO g FROM public.guardians WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,guardian)
    AND removed_at IS NULL AND pet_id IS NOT NULL AND recipient_issuer IS NOT NULL AND owner_subject IS NOT NULL;
  IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
  SELECT * INTO p FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient);
  SELECT * INTO dest FROM vetx_referral.clinic_label(target_org,target_clinic);
  IF dest.clinic_name IS NULL THEN RETURN '{"error":"not_found"}'; END IF;
  SELECT * INTO src FROM vetx_referral.clinic_label(org,clinic);
  INSERT INTO public.referral_states(request_id,source_org,source_clinic,patient_id,guardian_id,destination_org,destination_clinic,owner_issuer,owner_subject,pet_id)
    VALUES(request,org,clinic,patient,guardian,target_org,target_clinic,g.recipient_issuer,g.owner_subject,g.pet_id) RETURNING * INTO s;
  INSERT INTO public.referral_requests(id,source_organization_name,source_clinic_name,destination_organization_name,destination_clinic_name,patient_name,species,reason,summary,author_issuer,author_subject)
    VALUES(s.id,src.organization_name,src.clinic_name,dest.organization_name,dest.clinic_name,p.name,p.species,reason_input,summary_input,issuer,subject);
  PERFORM vetx_referral.audit(s.id,s.revision,'REQUESTED');
  RETURN vetx_referral.detail(s.id);
END
$$;

-- Establish the caller's active grant before consulting route configuration.
-- Only the distinct source clinic IDs are needed to filter inbox pagination.
CREATE FUNCTION public.referral_clinic_context(incoming boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); sources jsonb;
BEGIN
  IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF incoming THEN
    SELECT jsonb_agg(jsonb_build_object('organizationId',a.source_org,'clinicId',a.source_clinic)) INTO sources FROM
      (SELECT DISTINCT source_org,source_clinic FROM public.referral_states WHERE
        (destination_org,destination_clinic)=(org,clinic) AND linked AND status IN ('APPROVED','RESPONDED')) a;
  END IF;
  RETURN jsonb_build_object('sources',coalesce(sources,'[]'));
END
$$;

CREATE FUNCTION public.referral_route(ref uuid, pet uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); route jsonb;
BEGIN
  IF pet IS NULL THEN
    IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  ELSIF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
  SELECT jsonb_build_object('source',jsonb_build_object('organizationId',s.source_org,'clinicId',s.source_clinic),
    'destination',jsonb_build_object('organizationId',s.destination_org,'clinicId',s.destination_clinic))
    INTO route FROM public.referral_states s WHERE s.id=ref AND s.linked AND (
      (pet IS NOT NULL AND s.pet_id=pet AND vetx_registry.self(s.owner_issuer,s.owner_subject))
      OR (pet IS NULL AND (s.destination_org,s.destination_clinic)=(org,clinic) AND s.status IN ('APPROVED','RESPONDED')));
  RETURN coalesce(route,'{"error":"not_found"}');
END
$$;

CREATE FUNCTION public.referral_list(direction text, page integer, patient uuid, pet uuid, permitted_sources jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
  IF page IS NULL OR page<1 OR direction IS NULL OR direction NOT IN ('incoming','outgoing','owner') THEN RETURN '{"error":"invalid"}'; END IF;
  IF direction='owner' THEN
    IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
    IF NOT EXISTS(SELECT FROM public.guardians g WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject))
      THEN RETURN '{"error":"not_found"}'; END IF;
  ELSIF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  WITH matches AS MATERIALIZED (
    SELECT s.id,q.requested_at FROM public.referral_states s JOIN public.referral_requests q ON q.id=s.id
    WHERE (patient IS NULL OR s.patient_id=patient) AND (
      (direction='owner' AND s.pet_id=pet AND s.linked AND vetx_registry.self(s.owner_issuer,s.owner_subject))
      OR (direction='incoming' AND (s.destination_org,s.destination_clinic)=(org,clinic) AND s.linked AND s.status IN ('APPROVED','RESPONDED')
        AND (permitted_sources IS NULL OR permitted_sources @> jsonb_build_array(jsonb_build_object('organizationId',s.source_org,'clinicId',s.source_clinic))))
      OR (direction='outgoing' AND (s.source_org,s.source_clinic)=(org,clinic)))
    ORDER BY q.requested_at DESC,s.id LIMIT 26 OFFSET ((page::bigint-1)*25)
  ), visible AS (SELECT * FROM matches ORDER BY requested_at DESC,id LIMIT 25)
  SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),
    'referrals',coalesce(jsonb_agg(vetx_referral.detail(id) ORDER BY requested_at DESC,id),'[]')) INTO result FROM visible;
  RETURN result;
END
$$;

CREATE FUNCTION public.referral_decide(pet uuid, ref uuid, decision text, expected integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.referral_states; next_status text;
BEGIN
  IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
  next_status := CASE decision WHEN 'approve' THEN 'APPROVED' WHEN 'decline' THEN 'DECLINED' WHEN 'withdraw' THEN 'WITHDRAWN' END;
  IF next_status IS NULL OR expected IS NULL OR expected<1 THEN RETURN '{"error":"invalid"}'; END IF;
  SELECT * INTO s FROM public.referral_states WHERE id=ref AND pet_id=pet AND linked AND vetx_registry.self(owner_issuer,owner_subject) FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
  IF s.revision-1=expected AND s.status=next_status THEN RETURN vetx_referral.detail(ref); END IF;
  IF s.revision<>expected OR NOT ((decision IN ('approve','decline') AND s.status='REQUESTED') OR
    (decision='withdraw' AND s.status IN ('APPROVED','RESPONDED'))) THEN RETURN '{"error":"conflict"}'; END IF;
  UPDATE public.referral_states SET status=next_status,revision=revision+1 WHERE id=ref RETURNING * INTO s;
  PERFORM vetx_referral.audit(ref,s.revision,s.status);
  RETURN vetx_referral.detail(ref);
END
$$;

CREATE FUNCTION public.referral_respond(ref uuid, summary_input text, expected integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); s public.referral_states; r public.referral_responses;
  issuer text:=current_setting('vetx.identity_issuer',true); subject text:=current_setting('vetx.identity_subject',true);
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  summary_input:=vetx_care.clean(summary_input);
  IF summary_input IS NULL OR length(summary_input) NOT BETWEEN 1 AND 8000 OR expected IS NULL OR expected<1 THEN RETURN '{"error":"invalid"}'; END IF;
  SELECT * INTO s FROM public.referral_states WHERE id=ref AND (destination_org,destination_clinic)=(org,clinic)
    AND linked AND status IN ('APPROVED','RESPONDED') FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
  IF s.status='RESPONDED' THEN
    SELECT * INTO r FROM public.referral_responses WHERE id=ref;
    IF s.revision-1=expected AND (r.summary,r.author_issuer,r.author_subject)=(summary_input,issuer,subject)
      THEN RETURN vetx_referral.detail(ref); END IF;
    RETURN '{"error":"conflict"}';
  END IF;
  IF s.revision<>expected THEN RETURN '{"error":"conflict"}'; END IF;
  INSERT INTO public.referral_responses(id,summary,author_issuer,author_subject) VALUES(ref,summary_input,issuer,subject);
  UPDATE public.referral_states SET status='RESPONDED',revision=revision+1 WHERE id=ref RETURNING * INTO s;
  PERFORM vetx_referral.audit(ref,s.revision,s.status);
  RETURN vetx_referral.detail(ref);
END
$$;

REVOKE ALL ON FUNCTION public.referral_lock_tables(),public.referral_request(uuid,uuid,uuid,uuid,uuid,text,text),public.referral_list(text,integer,uuid,uuid,jsonb),public.referral_clinic_context(boolean),public.referral_route(uuid,uuid),
 public.referral_decide(uuid,uuid,text,integer),public.referral_respond(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_lock_tables(),public.referral_request(uuid,uuid,uuid,uuid,uuid,text,text),public.referral_list(text,integer,uuid,uuid,jsonb),public.referral_clinic_context(boolean),public.referral_route(uuid,uuid),
 public.referral_decide(uuid,uuid,text,integer),public.referral_respond(uuid,text,integer) TO vetx_runtime;
COMMIT;
