BEGIN;

CREATE SCHEMA vetx_care;
REVOKE ALL ON SCHEMA vetx_care FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA vetx_care;

CREATE TABLE public.clinical_encounters (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  id uuid NOT NULL,
  occurred_at timestamptz(3) NOT NULL,
  recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  author_issuer text NOT NULL,
  author_subject text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 250),
  subjective text NOT NULL CHECK (length(subjective) <= 8000),
  objective text NOT NULL CHECK (length(objective) <= 8000),
  assessment text NOT NULL CHECK (length(assessment) <= 8000),
  plan text NOT NULL CHECK (length(plan) <= 8000),
  addendum_to uuid,
  PRIMARY KEY (organization_id, clinic_id, patient_id, id),
  FOREIGN KEY (organization_id, clinic_id, patient_id) REFERENCES public.patients(organization_id, clinic_id, id),
  FOREIGN KEY (organization_id, clinic_id, patient_id, addendum_to) REFERENCES public.clinical_encounters(organization_id, clinic_id, patient_id, id),
  CHECK (greatest(length(subjective), length(objective), length(assessment), length(plan)) > 0),
  CHECK (id <> addendum_to)
);
CREATE INDEX encounters_chronology ON public.clinical_encounters(organization_id, clinic_id, patient_id, occurred_at DESC, id);

-- Mutable sharing metadata is independent of the immutable clinical entry.
CREATE TABLE public.encounter_sharing (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  encounter_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  actor_issuer text NOT NULL,
  actor_subject text NOT NULL,
  PRIMARY KEY (organization_id, clinic_id, patient_id, encounter_id),
  FOREIGN KEY (organization_id, clinic_id, patient_id, encounter_id) REFERENCES public.clinical_encounters(organization_id, clinic_id, patient_id, id)
);
CREATE TABLE public.encounter_recipients (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  encounter_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  PRIMARY KEY (organization_id, clinic_id, patient_id, encounter_id, guardian_id),
  CONSTRAINT recipients_sharing_fk FOREIGN KEY (organization_id, clinic_id, patient_id, encounter_id) REFERENCES public.encounter_sharing(organization_id, clinic_id, patient_id, encounter_id),
  CONSTRAINT recipients_guardian_fk FOREIGN KEY (organization_id, clinic_id, patient_id, guardian_id) REFERENCES public.guardians(organization_id, clinic_id, patient_id, id)
);
CREATE INDEX encounter_recipient_lookup ON public.encounter_recipients(organization_id, clinic_id, patient_id, guardian_id, encounter_id);

CREATE TABLE public.appointments (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  id uuid NOT NULL,
  patient_id uuid NOT NULL,
  start_at timestamptz(3) NOT NULL,
  end_at timestamptz(3) NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 250),
  status text NOT NULL CHECK (status IN ('BOOKED','CANCELLED','COMPLETED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  actor_issuer text NOT NULL,
  actor_subject text NOT NULL,
  PRIMARY KEY (organization_id, clinic_id, id),
  FOREIGN KEY (organization_id, clinic_id, patient_id) REFERENCES public.patients(organization_id, clinic_id, id),
  CHECK (end_at > start_at),
  EXCLUDE USING gist (
    organization_id WITH =, clinic_id WITH =, patient_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&
  ) WHERE (status <> 'CANCELLED')
);
CREATE INDEX appointment_calendar ON public.appointments(organization_id, clinic_id, start_at, id);

CREATE TABLE public.care_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('ENCOUNTER_RECORDED','ENCOUNTER_SHARING_CHANGED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED')),
  details jsonb NOT NULL,
  actor_issuer text NOT NULL,
  actor_subject text NOT NULL,
  recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, clinic_id, patient_id) REFERENCES public.patients(organization_id, clinic_id, id)
);

ALTER TABLE public.clinical_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_encounters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.encounter_sharing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounter_sharing FORCE ROW LEVEL SECURITY;
ALTER TABLE public.encounter_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounter_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.care_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_events FORCE ROW LEVEL SECURITY;

CREATE POLICY staff_read ON public.clinical_encounters FOR SELECT TO vetx_migration
  USING (vetx_registry.staff_access(organization_id, clinic_id));
CREATE POLICY staff_append ON public.clinical_encounters FOR INSERT TO vetx_migration WITH CHECK (
  vetx_registry.staff_access(organization_id, clinic_id) AND author_issuer=current_setting('vetx.identity_issuer')
  AND author_subject=current_setting('vetx.identity_subject')
);
CREATE POLICY staff ON public.encounter_sharing TO vetx_migration USING (vetx_registry.staff_access(organization_id, clinic_id));
CREATE POLICY staff ON public.encounter_recipients TO vetx_migration USING (vetx_registry.staff_access(organization_id, clinic_id));
CREATE POLICY staff ON public.appointments TO vetx_migration USING (vetx_registry.staff_access(organization_id, clinic_id));
CREATE POLICY staff_append ON public.care_events FOR INSERT TO vetx_migration WITH CHECK (
  vetx_registry.staff_access(organization_id, clinic_id) AND actor_issuer=current_setting('vetx.identity_issuer')
  AND actor_subject=current_setting('vetx.identity_subject')
);

CREATE POLICY owner_recipient ON public.encounter_recipients FOR SELECT TO vetx_migration USING (
  EXISTS (SELECT FROM public.guardians g
    WHERE (g.organization_id,g.clinic_id,g.patient_id,g.id)=(encounter_recipients.organization_id,encounter_recipients.clinic_id,encounter_recipients.patient_id,encounter_recipients.guardian_id)
    AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject))
);
CREATE FUNCTION vetx_care.released(org uuid, clinic uuid, patient uuid, encounter uuid, pet uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS (SELECT FROM public.encounter_recipients r JOIN public.guardians g
    ON (g.organization_id,g.clinic_id,g.patient_id,g.id)=(r.organization_id,r.clinic_id,r.patient_id,r.guardian_id)
    WHERE (r.organization_id,r.clinic_id,r.patient_id,r.encounter_id)=(org,clinic,patient,encounter)
    AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject) AND (pet IS NULL OR g.pet_id=pet))
$$;
CREATE POLICY owner_released ON public.clinical_encounters FOR SELECT TO vetx_migration
  USING (vetx_care.released(organization_id,clinic_id,patient_id,id));

CREATE FUNCTION public.care_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  LOCK TABLE public.clinical_encounters,public.encounter_sharing,public.encounter_recipients,public.appointments,public.care_events IN ACCESS SHARE MODE;
  RETURN true;
END
$$;

CREATE FUNCTION vetx_care.instant(input text) RETURNS timestamptz LANGUAGE sql STABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN input ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9]([.][0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-5][0-9])$'
    AND pg_input_is_valid(input,'timestamp with time zone') THEN input::timestamptz(3) END
$$;
CREATE FUNCTION vetx_care.utc(stamp timestamptz) RETURNS text LANGUAGE sql STABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
  SELECT to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION vetx_care.clean(input text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
  SELECT regexp_replace(input,'^[[:space:]]+|[[:space:]]+$','','g')
$$;
CREATE FUNCTION vetx_care.audit(patient uuid, resource uuid, change text, details jsonb) RETURNS void LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  INSERT INTO public.care_events(organization_id,clinic_id,patient_id,resource_id,action,details,actor_issuer,actor_subject)
  VALUES(vetx_directory.organization_id(),vetx_registry.clinic_id(),patient,resource,change,details,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'))
$$;

CREATE FUNCTION vetx_care.sharing(org uuid, clinic uuid, patient uuid, encounter uuid) RETURNS jsonb LANGUAGE sql STABLE
SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('revision',coalesce((SELECT s.revision FROM public.encounter_sharing s
    WHERE (s.organization_id,s.clinic_id,s.patient_id,s.encounter_id)=(org,clinic,patient,encounter)),0),
    'guardianIds',coalesce((SELECT jsonb_agg(r.guardian_id ORDER BY r.guardian_id) FROM public.encounter_recipients r
      JOIN public.guardians g ON (g.organization_id,g.clinic_id,g.patient_id,g.id)=(r.organization_id,r.clinic_id,r.patient_id,r.guardian_id)
      WHERE (r.organization_id,r.clinic_id,r.patient_id,r.encounter_id)=(org,clinic,patient,encounter) AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL),'[]'))
$$;
CREATE FUNCTION vetx_care.note(e public.clinical_encounters) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('id',e.id,'occurredAt',vetx_care.utc(e.occurred_at),'recordedAt',vetx_care.utc(e.recorded_at),
    'reason',e.reason,'subjective',e.subjective,'objective',e.objective,'assessment',e.assessment,'plan',e.plan,'addendumTo',e.addendum_to)
$$;
CREATE FUNCTION vetx_care.staff_note(e public.clinical_encounters) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT vetx_care.note(e) || jsonb_build_object('authorIssuer',e.author_issuer,'authorSubject',e.author_subject,
    'sharing',vetx_care.sharing(e.organization_id,e.clinic_id,e.patient_id,e.id))
$$;

CREATE FUNCTION public.care_save_encounter(patient uuid, encounter uuid, occurred text, reason_input text, s text, o text, a text, p text, parent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
  e public.clinical_encounters; stamp timestamptz := vetx_care.instant(occurred);
  issuer text := current_setting('vetx.identity_issuer',true); subject text := current_setting('vetx.identity_subject',true);
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  reason_input:=vetx_care.clean(reason_input); s:=vetx_care.clean(s); o:=vetx_care.clean(o); a:=vetx_care.clean(a); p:=vetx_care.clean(p);
  IF num_nonnulls(patient,encounter,stamp,reason_input,s,o,a,p)<>8 OR length(reason_input) NOT BETWEEN 1 AND 250
    OR reason_input ~ '[[:cntrl:]]' OR greatest(length(s),length(o),length(a),length(p)) NOT BETWEEN 1 AND 8000 OR encounter=parent
    THEN RETURN '{"error":"invalid"}'; END IF;
  IF NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) THEN RETURN '{"error":"not_found"}'; END IF;
  SELECT * INTO e FROM public.clinical_encounters WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,encounter);
  IF FOUND THEN
    IF (e.author_issuer,e.author_subject,e.occurred_at,e.reason,e.subjective,e.objective,e.assessment,e.plan,e.addendum_to)
      IS DISTINCT FROM (issuer,subject,stamp,reason_input,s,o,a,p,parent) THEN RETURN '{"error":"conflict"}'; END IF;
  ELSE
    IF parent IS NOT NULL AND NOT EXISTS(SELECT FROM public.clinical_encounters WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,parent))
      THEN RETURN '{"error":"not_found"}'; END IF;
    INSERT INTO public.clinical_encounters(organization_id,clinic_id,patient_id,id,occurred_at,author_issuer,author_subject,reason,subjective,objective,assessment,plan,addendum_to)
      VALUES(org,clinic,patient,encounter,stamp,issuer,subject,reason_input,s,o,a,p,parent) RETURNING * INTO e;
    PERFORM vetx_care.audit(patient,encounter,'ENCOUNTER_RECORDED',jsonb_build_object('addendumTo',parent));
  END IF;
  RETURN vetx_care.staff_note(e);
END
$$;

CREATE FUNCTION public.care_list_encounters(patient uuid, page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id(); result jsonb;
BEGIN
  IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
  IF NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) THEN RETURN '{"error":"not_found"}'; END IF;
  WITH matches AS MATERIALIZED (
    SELECT e FROM public.clinical_encounters e WHERE (organization_id,clinic_id,patient_id)=(org,clinic,patient)
    ORDER BY occurred_at DESC,id LIMIT 26 OFFSET ((page::bigint-1)*25)
  ), visible AS (SELECT e FROM matches ORDER BY (e).occurred_at DESC,(e).id LIMIT 25)
  SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),
    'encounters',coalesce(jsonb_agg(vetx_care.staff_note(e) ORDER BY (e).occurred_at DESC,(e).id),'[]')) INTO result FROM visible;
  RETURN result;
END
$$;

CREATE FUNCTION public.care_share_encounter(patient uuid, encounter uuid, guardians uuid[], expected integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
  issuer text := current_setting('vetx.identity_issuer',true); subject text := current_setting('vetx.identity_subject',true);
  state public.encounter_sharing; current_share jsonb; targets uuid[]; version integer;
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF expected IS NULL OR expected<0 OR guardians IS NULL OR array_position(guardians,NULL) IS NOT NULL
    OR (SELECT count(DISTINCT g) FROM unnest(guardians) g)<>cardinality(guardians) THEN RETURN '{"error":"invalid"}'; END IF;
  IF NOT EXISTS(SELECT FROM public.clinical_encounters WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,encounter))
    THEN RETURN '{"error":"not_found"}'; END IF;
  SELECT coalesce(array_agg(g.id ORDER BY g.id),ARRAY[]::uuid[]) INTO targets FROM public.guardians g
    WHERE (g.organization_id,g.clinic_id,g.patient_id)=(org,clinic,patient) AND g.id=ANY(guardians) AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL;
  IF cardinality(targets)<>cardinality(guardians) THEN RETURN '{"error":"not_found"}'; END IF;
  SELECT * INTO state FROM public.encounter_sharing WHERE (organization_id,clinic_id,patient_id,encounter_id)=(org,clinic,patient,encounter);
  version:=coalesce(state.revision,0);
  current_share:=vetx_care.sharing(org,clinic,patient,encounter);
  IF current_share->'guardianIds'=to_jsonb(targets) AND (expected=version OR (
    expected=version-1 AND (state.actor_issuer,state.actor_subject)=(issuer,subject))) THEN RETURN current_share; END IF;
  IF expected<>version OR version=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
  INSERT INTO public.encounter_sharing(organization_id,clinic_id,patient_id,encounter_id,revision,actor_issuer,actor_subject)
    VALUES(org,clinic,patient,encounter,version+1,issuer,subject)
    ON CONFLICT (organization_id,clinic_id,patient_id,encounter_id) DO UPDATE SET
      revision=EXCLUDED.revision, actor_issuer=EXCLUDED.actor_issuer, actor_subject=EXCLUDED.actor_subject;
  DELETE FROM public.encounter_recipients WHERE (organization_id,clinic_id,patient_id,encounter_id)=(org,clinic,patient,encounter);
  INSERT INTO public.encounter_recipients(organization_id,clinic_id,patient_id,encounter_id,guardian_id)
    SELECT org,clinic,patient,encounter,g FROM unnest(targets) g;
  PERFORM vetx_care.audit(patient,encounter,'ENCOUNTER_SHARING_CHANGED',jsonb_build_object('revision',version+1,'guardianIds',targets));
  RETURN jsonb_build_object('revision',version+1,'guardianIds',targets);
END
$$;

CREATE FUNCTION public.care_owner_encounters(pet uuid, page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
  IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
  IF NOT EXISTS(SELECT FROM public.guardians g WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject))
    THEN RETURN '{"error":"not_found"}'; END IF;
  WITH released AS (
    SELECT DISTINCT r.organization_id,r.clinic_id,r.patient_id,r.encounter_id FROM public.guardians g JOIN public.encounter_recipients r
      ON (r.organization_id,r.clinic_id,r.patient_id,r.guardian_id)=(g.organization_id,g.clinic_id,g.patient_id,g.id)
    WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)
  ), matches AS MATERIALIZED (
    SELECT e,c.name AS clinic_name,o.name AS org_name FROM released r JOIN public.clinical_encounters e
      ON (e.organization_id,e.clinic_id,e.patient_id,e.id)=(r.organization_id,r.clinic_id,r.patient_id,r.encounter_id)
    JOIN public.clinics c ON (c.organization_id,c.id)=(r.organization_id,r.clinic_id) JOIN public.organizations o ON o.id=r.organization_id
    ORDER BY e.occurred_at DESC,e.organization_id,e.clinic_id,e.patient_id,e.id LIMIT 26 OFFSET ((page::bigint-1)*25)
  ), visible AS (SELECT * FROM matches ORDER BY (e).occurred_at DESC,(e).organization_id,(e).clinic_id,(e).patient_id,(e).id LIMIT 25)
  SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'encounters',coalesce(jsonb_agg(
    vetx_care.note(e) || jsonb_build_object('clinicId',(e).clinic_id,'patientId',(e).patient_id,'clinicName',clinic_name,'organizationName',org_name,
      'addendumTo',CASE WHEN (e).addendum_to IS NOT NULL AND vetx_care.released((e).organization_id,(e).clinic_id,(e).patient_id,(e).addendum_to,pet)
      THEN (e).addendum_to END) ORDER BY (e).occurred_at DESC,(e).organization_id,(e).clinic_id,(e).patient_id,(e).id),'[]')) INTO result FROM visible;
  RETURN result;
END
$$;

CREATE FUNCTION vetx_care.appointment(a public.appointments, name text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('id',a.id,'patientId',a.patient_id,'patientName',name,'startAt',vetx_care.utc(a.start_at),
    'endAt',vetx_care.utc(a.end_at),'reason',a.reason,'status',a.status,'revision',a.revision)
$$;

CREATE FUNCTION public.care_save_appointment(appointment uuid, patient uuid, start_time text, end_time text, reason_input text, new_status text, expected integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
  issuer text := current_setting('vetx.identity_issuer',true); subject text := current_setting('vetx.identity_subject',true);
  start_stamp timestamptz := vetx_care.instant(start_time); end_stamp timestamptz := vetx_care.instant(end_time);
  a public.appointments; patient_name text; change text;
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  reason_input:=vetx_care.clean(reason_input);
  IF num_nonnulls(appointment,patient,start_stamp,end_stamp,reason_input,new_status,expected)<>7 OR start_stamp>=end_stamp
    OR length(reason_input) NOT BETWEEN 1 AND 250 OR reason_input ~ '[[:cntrl:]]' OR new_status NOT IN ('BOOKED','CANCELLED','COMPLETED') OR expected<0
    THEN RETURN '{"error":"invalid"}'; END IF;
  SELECT name INTO patient_name FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient);
  IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
  SELECT * INTO a FROM public.appointments WHERE (organization_id,clinic_id,id)=(org,clinic,appointment);
  IF NOT FOUND THEN
    IF expected<>0 THEN RETURN '{"error":"not_found"}'; END IF;
    IF new_status<>'BOOKED' THEN RETURN '{"error":"invalid"}'; END IF;
    INSERT INTO public.appointments(organization_id,clinic_id,id,patient_id,start_at,end_at,reason,status,actor_issuer,actor_subject)
      VALUES(org,clinic,appointment,patient,start_stamp,end_stamp,reason_input,new_status,issuer,subject) RETURNING * INTO a;
    change:='APPOINTMENT_CREATED';
  ELSE
    IF a.patient_id<>patient THEN RETURN '{"error":"conflict"}'; END IF;
    IF (a.start_at,a.end_at,a.reason,a.status)=(start_stamp,end_stamp,reason_input,new_status)
      AND (expected=a.revision OR (expected=a.revision-1 AND (a.actor_issuer,a.actor_subject)=(issuer,subject)))
      THEN RETURN vetx_care.appointment(a,patient_name); END IF;
    IF expected<>a.revision OR a.status<>'BOOKED' OR a.revision=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
    UPDATE public.appointments SET start_at=start_stamp,end_at=end_stamp,reason=reason_input,status=new_status,
      revision=revision+1,actor_issuer=issuer,actor_subject=subject WHERE (organization_id,clinic_id,id)=(org,clinic,appointment) RETURNING * INTO a;
    change:='APPOINTMENT_UPDATED';
  END IF;
  PERFORM vetx_care.audit(patient,appointment,change,jsonb_build_object('revision',a.revision,'status',a.status,'startAt',vetx_care.utc(a.start_at),'endAt',vetx_care.utc(a.end_at)));
  RETURN vetx_care.appointment(a,patient_name);
EXCEPTION WHEN exclusion_violation THEN RETURN '{"error":"overlap"}';
END
$$;

CREATE FUNCTION public.care_list_appointments(window_start text, window_end text, page integer, patient uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id();
  from_stamp timestamptz := vetx_care.instant(window_start); to_stamp timestamptz := vetx_care.instant(window_end); result jsonb;
BEGIN
  IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF from_stamp IS NULL OR to_stamp IS NULL OR from_stamp>=to_stamp OR page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
  WITH matches AS MATERIALIZED (
    SELECT a,p.name FROM public.appointments a JOIN public.patients p ON (p.organization_id,p.clinic_id,p.id)=(a.organization_id,a.clinic_id,a.patient_id)
    WHERE (a.organization_id,a.clinic_id)=(org,clinic) AND (patient IS NULL OR a.patient_id=patient) AND a.start_at<to_stamp AND a.end_at>from_stamp
    ORDER BY a.start_at,a.id LIMIT 26 OFFSET ((page::bigint-1)*25)
  ), visible AS (SELECT * FROM matches ORDER BY (a).start_at,(a).id LIMIT 25)
  SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),
    'appointments',coalesce(jsonb_agg(vetx_care.appointment(a,name) ORDER BY (a).start_at,(a).id),'[]')) INTO result FROM visible;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.care_lock_tables(),public.care_list_encounters(uuid,integer),public.care_save_encounter(uuid,uuid,text,text,text,text,text,text,uuid),
 public.care_share_encounter(uuid,uuid,uuid[],integer),public.care_owner_encounters(uuid,integer),public.care_save_appointment(uuid,uuid,text,text,text,text,integer),
 public.care_list_appointments(text,text,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.care_lock_tables(),public.care_list_encounters(uuid,integer),public.care_save_encounter(uuid,uuid,text,text,text,text,text,text,uuid),
 public.care_share_encounter(uuid,uuid,uuid[],integer),public.care_owner_encounters(uuid,integer),public.care_save_appointment(uuid,uuid,text,text,text,text,integer),
 public.care_list_appointments(text,text,integer,uuid) TO vetx_runtime;
COMMIT;
