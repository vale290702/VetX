BEGIN;
CREATE SCHEMA vetx_clinical;
REVOKE ALL ON SCHEMA vetx_clinical FROM PUBLIC,vetx_runtime;
CREATE TABLE public.clinical_record_revisions (
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, patient_id uuid NOT NULL, record_id uuid NOT NULL, encounter_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), revision_id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('diagnosis','treatment','vaccination','lab')), data jsonb NOT NULL,
 occurred_at timestamptz(3) NOT NULL, recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), change_reason text,
 author_issuer text NOT NULL, author_subject text NOT NULL, result_author_issuer text, result_author_subject text, result_recorded_at timestamptz(3),
 PRIMARY KEY(organization_id,clinic_id,patient_id,record_id,revision),
 UNIQUE(organization_id,clinic_id,request_id), UNIQUE(organization_id,clinic_id,revision_id),
 FOREIGN KEY(organization_id,clinic_id,patient_id,encounter_id) REFERENCES public.clinical_encounters(organization_id,clinic_id,patient_id,id)
);
CREATE TABLE public.clinical_record_heads (
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, patient_id uuid NOT NULL, record_id uuid NOT NULL, revision integer NOT NULL,
 share_revision integer NOT NULL DEFAULT 0, guardian_ids uuid[] NOT NULL DEFAULT '{}', share_issuer text, share_subject text,
 PRIMARY KEY(organization_id,clinic_id,patient_id,record_id),
 FOREIGN KEY(organization_id,clinic_id,patient_id,record_id,revision) REFERENCES public.clinical_record_revisions(organization_id,clinic_id,patient_id,record_id,revision)
);
ALTER TABLE public.clinical_record_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_record_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_record_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_record_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY staff ON public.clinical_record_heads TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY staff_read ON public.clinical_record_revisions FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY staff_append ON public.clinical_record_revisions FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id)
 AND author_issuer=current_setting('vetx.identity_issuer') AND author_subject=current_setting('vetx.identity_subject'));
CREATE FUNCTION vetx_clinical.guardian(h public.clinical_record_heads,pet uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT FROM public.guardians g WHERE (g.organization_id,g.clinic_id,g.patient_id)=(h.organization_id,h.clinic_id,h.patient_id)
 AND g.id=ANY(h.guardian_ids) AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject) AND (pet IS NULL OR g.pet_id=pet))
$$;
CREATE POLICY released_heads ON public.clinical_record_heads FOR SELECT TO vetx_migration USING(vetx_clinical.guardian(clinical_record_heads));
CREATE POLICY released_revisions ON public.clinical_record_revisions FOR SELECT TO vetx_migration USING(EXISTS(SELECT FROM public.clinical_record_heads h
 WHERE (h.organization_id,h.clinic_id,h.patient_id,h.record_id,h.revision)=(clinical_record_revisions.organization_id,clinical_record_revisions.clinic_id,clinical_record_revisions.patient_id,clinical_record_revisions.record_id,clinical_record_revisions.revision)
 AND vetx_clinical.guardian(h)));
REVOKE ALL ON public.clinical_record_heads,public.clinical_record_revisions FROM PUBLIC,vetx_runtime;
ALTER TABLE public.care_events DROP CONSTRAINT care_events_action_check;
ALTER TABLE public.care_events ADD CONSTRAINT care_events_action_check CHECK (action IN ('ENCOUNTER_RECORDED','ENCOUNTER_SHARING_CHANGED','APPOINTMENT_CREATED','APPOINTMENT_UPDATED','CLINICAL_REVISION','CLINICAL_SHARING'));
CREATE FUNCTION public.clinical_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN LOCK TABLE public.clinical_record_heads,public.clinical_record_revisions IN ACCESS SHARE MODE; RETURN true; END $$;

-- The typed payload and its shape are validated again at the restricted database boundary.
CREATE FUNCTION vetx_clinical.valid(kind text,d jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE required_key text; keys text[]; k text; v text; lim int;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 CASE kind
 WHEN 'diagnosis' THEN required_key:='diagnosis'; keys:=ARRAY['diagnosis','code'];
 WHEN 'treatment' THEN required_key:='treatment'; keys:=ARRAY['treatment','notes'];
 WHEN 'vaccination' THEN required_key:='vaccine'; keys:=ARRAY['vaccine','lotNumber','nextDueDate'];
 WHEN 'lab' THEN
  required_key:='test'; keys:=ARRAY['test','specimen','status','result','unit','referenceRange'];
  IF NOT d?'status' OR d->>'status' NOT IN ('ORDERED','RESULTED','REVIEWED') THEN RETURN false; END IF;
  IF d->>'status'='ORDERED' AND d ?| ARRAY['result','unit','referenceRange'] OR d->>'status'<>'ORDERED' AND NOT d?'result' THEN RETURN false; END IF;
 ELSE RETURN false;
 END CASE;
 IF NOT d?required_key OR d-keys<>'{}'::jsonb THEN RETURN false; END IF;
 FOR k IN SELECT jsonb_object_keys(d) LOOP
  IF jsonb_typeof(d->k)<>'string' THEN RETURN false; END IF;
  v:=d->>k;
  IF k IN ('diagnosis','treatment','notes','result') THEN
   IF length(v)>8000 OR (k<>'notes' AND length(vetx_care.clean(v))=0) OR translate(v,E'\t\n\r','') ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  ELSIF k='nextDueDate' THEN
   IF v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT pg_input_is_valid(v,'date') THEN RETURN false; END IF;
  ELSE
   lim:=CASE WHEN k IN ('code','unit','lotNumber') THEN 128 ELSE 250 END;
   IF length(v)>lim OR NOT vetx_stock.label(v,lim) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION vetx_clinical.sharing(h public.clinical_record_heads) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('revision',coalesce(h.share_revision,0),'guardianIds',coalesce((SELECT jsonb_agg(g.id ORDER BY g.id) FROM public.guardians g
 WHERE (g.organization_id,g.clinic_id,g.patient_id)=(h.organization_id,h.clinic_id,h.patient_id) AND g.id=ANY(h.guardian_ids) AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL),'[]'))
$$;
CREATE FUNCTION vetx_clinical.view_revision(r public.clinical_record_revisions) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',r.record_id,'revisionId',r.revision_id,'revision',r.revision,'patientId',r.patient_id,'kind',r.kind,
 'occurredAt',vetx_care.utc(r.occurred_at),'recordedAt',vetx_care.utc(r.recorded_at),'data',r.data)
$$;
CREATE FUNCTION vetx_clinical.staff(r public.clinical_record_revisions) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT vetx_clinical.view_revision(r)||jsonb_build_object('encounterId',r.encounter_id,'changeReason',r.change_reason,'author',jsonb_build_object('issuer',r.author_issuer,'subject',r.author_subject),
 'sharing',vetx_clinical.sharing((SELECT h FROM public.clinical_record_heads h WHERE (h.organization_id,h.clinic_id,h.patient_id,h.record_id,h.revision)=(r.organization_id,r.clinic_id,r.patient_id,r.record_id,r.revision))))
$$;
CREATE FUNCTION public.clinical_write(patient uuid,entry uuid,request uuid,encounter uuid,category text,occurred text,expected int,reason text,details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); r public.clinical_record_revisions; prior public.clinical_record_revisions;
 stamp timestamptz:=vetx_care.instant(occurred); issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true); reviewing boolean;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(patient,entry,request,encounter,category,stamp,expected,details)<>8 OR expected NOT BETWEEN 0 AND 2147483646 OR NOT vetx_clinical.valid(category,details)
 OR (expected=0 AND reason IS NOT NULL) OR (expected>0 AND (NOT vetx_stock.label(reason,500) OR length(reason)>500)) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT * INTO r FROM public.clinical_record_revisions WHERE (organization_id,clinic_id,request_id)=(org,clinic,request);
 IF FOUND THEN
  IF (r.patient_id,r.record_id,r.encounter_id,r.kind,r.occurred_at,r.revision,r.change_reason,r.data,r.author_issuer,r.author_subject)
    IS DISTINCT FROM (patient,entry,encounter,category,stamp,expected+1,reason,details,issuer,subj) THEN RETURN '{"error":"conflict"}'; END IF;
  RETURN vetx_clinical.staff(r);
 END IF;
 IF NOT EXISTS(SELECT FROM public.clinical_encounters WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,encounter)) THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO prior FROM public.clinical_record_revisions WHERE (organization_id,clinic_id,patient_id,record_id)=(org,clinic,patient,entry) ORDER BY revision DESC LIMIT 1;
 IF expected<>coalesce(prior.revision,0) OR (prior.revision IS NOT NULL AND (prior.kind,prior.encounter_id) IS DISTINCT FROM (category,encounter)) THEN RETURN '{"error":"conflict"}'; END IF;
 IF category='lab' THEN
  IF expected=0 AND details->>'status'<>'ORDERED' THEN RETURN '{"error":"invalid"}'; END IF;
  IF expected>0 THEN
   IF details->>'status'='ORDERED' AND prior.data->>'status'<>'ORDERED' THEN RETURN '{"error":"conflict"}'; END IF;
   IF details->>'status'<>'ORDERED' AND (details->>'test',details->>'specimen') IS DISTINCT FROM (prior.data->>'test',prior.data->>'specimen') THEN RETURN '{"error":"conflict"}'; END IF;
   reviewing:=details->>'status'='REVIEWED';
   IF reviewing AND (prior.data->>'status'<>'RESULTED' OR details-'status'<>prior.data-'status' OR stamp<>prior.occurred_at) THEN RETURN '{"error":"conflict"}'; END IF;
  END IF;
 END IF;
 INSERT INTO public.clinical_record_revisions(organization_id,clinic_id,patient_id,record_id,encounter_id,revision,request_id,kind,data,occurred_at,change_reason,author_issuer,author_subject,result_author_issuer,result_author_subject,result_recorded_at)
 VALUES(org,clinic,patient,entry,encounter,expected+1,request,category,details,stamp,reason,issuer,subj,CASE WHEN reviewing THEN prior.author_issuer END,CASE WHEN reviewing THEN prior.author_subject END,CASE WHEN reviewing THEN prior.recorded_at END) RETURNING * INTO r;
 INSERT INTO public.clinical_record_heads(organization_id,clinic_id,patient_id,record_id,revision) VALUES(org,clinic,patient,entry,r.revision)
 ON CONFLICT(organization_id,clinic_id,patient_id,record_id) DO UPDATE SET revision=EXCLUDED.revision,share_revision=0,guardian_ids='{}',share_issuer=NULL,share_subject=NULL;
 PERFORM vetx_care.audit(patient,entry,'CLINICAL_REVISION',jsonb_build_object('revision',r.revision,'revisionId',r.revision_id));
 RETURN vetx_clinical.staff(r);
END $$;
CREATE FUNCTION public.clinical_share(patient uuid,entry uuid,version int,expected int,guardians uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); h public.clinical_record_heads; targets uuid[];
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(patient,entry,version,expected,guardians)<>5 OR version<1 OR expected<0 OR cardinality(guardians)>100 OR cardinality(guardians)<>(SELECT count(DISTINCT g) FROM unnest(guardians) g) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT * INTO h FROM public.clinical_record_heads WHERE (organization_id,clinic_id,patient_id,record_id)=(org,clinic,patient,entry);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 IF version<>h.revision OR (cardinality(guardians)>0 AND EXISTS(SELECT FROM public.clinical_record_revisions r WHERE (r.organization_id,r.clinic_id,r.patient_id,r.record_id,r.revision)=(org,clinic,patient,entry,version)
 AND r.kind='lab' AND r.data->>'status'<>'REVIEWED')) THEN RETURN '{"error":"conflict"}'; END IF;
 SELECT coalesce(array_agg(g.id ORDER BY g.id),'{}') INTO targets FROM public.guardians g WHERE (g.organization_id,g.clinic_id,g.patient_id)=(org,clinic,patient) AND g.id=ANY(guardians) AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL;
 IF cardinality(targets)<>cardinality(guardians) THEN RETURN '{"error":"not_found"}'; END IF;
 IF h.guardian_ids=targets AND (expected=h.share_revision OR (expected=h.share_revision-1 AND (issuer,subj)=(h.share_issuer,h.share_subject))) THEN RETURN vetx_clinical.sharing(h); END IF;
 IF expected<>h.share_revision OR expected=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
 UPDATE public.clinical_record_heads SET guardian_ids=targets,share_revision=expected+1,share_issuer=issuer,share_subject=subj WHERE (organization_id,clinic_id,patient_id,record_id)=(org,clinic,patient,entry) RETURNING * INTO h;
 PERFORM vetx_care.audit(patient,entry,'CLINICAL_SHARING',jsonb_build_object('recordRevision',version,'revision',h.share_revision,'guardianIds',targets));
 RETURN vetx_clinical.sharing(h);
END $$;
CREATE FUNCTION public.clinical_list(patient uuid,entry uuid,page_num int) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); output jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page_num IS NULL OR page_num<1 THEN RETURN '{"error":"invalid"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) OR
 (entry IS NOT NULL AND NOT EXISTS(SELECT FROM public.clinical_record_heads WHERE (organization_id,clinic_id,patient_id,record_id)=(org,clinic,patient,entry))) THEN RETURN '{"error":"not_found"}'; END IF;
 WITH matches AS MATERIALIZED (
 SELECT r,CASE WHEN entry IS NOT NULL THEN r.revision END AS seq FROM public.clinical_record_revisions r
 JOIN public.clinical_record_heads h USING(organization_id,clinic_id,patient_id,record_id)
 WHERE (r.organization_id,r.clinic_id,r.patient_id)=(org,clinic,patient)
 AND ((entry IS NULL AND h.revision=r.revision) OR r.record_id=entry)
 ORDER BY seq DESC,r.occurred_at DESC,r.revision_id LIMIT 26 OFFSET ((page_num::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY seq DESC,(r).occurred_at DESC,(r).revision_id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM matches),'records',coalesce(jsonb_agg(vetx_clinical.staff(r) ORDER BY seq DESC,(r).occurred_at DESC,(r).revision_id),'[]')) INTO output FROM visible;
 RETURN output;
END $$;
CREATE FUNCTION public.clinical_owner_list(pet uuid,page_num int) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE output jsonb;
BEGIN
 IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page_num IS NULL OR page_num<1 THEN RETURN '{"error":"invalid"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.guardians g WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)) THEN RETURN '{"error":"not_found"}'; END IF;
 WITH matches AS MATERIALIZED (
 SELECT r,c.name AS clinic,o.name AS org FROM public.clinical_record_heads h JOIN public.clinical_record_revisions r USING(organization_id,clinic_id,patient_id,record_id,revision)
 JOIN public.clinics c ON (c.organization_id,c.id)=(h.organization_id,h.clinic_id) JOIN public.organizations o ON o.id=h.organization_id
 WHERE vetx_clinical.guardian(h,pet) ORDER BY r.occurred_at DESC,r.revision_id,r.organization_id,r.clinic_id LIMIT 26 OFFSET ((page_num::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY (r).occurred_at DESC,(r).revision_id,(r).organization_id,(r).clinic_id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM matches),'records',coalesce(jsonb_agg(vetx_clinical.view_revision(r)||jsonb_build_object('clinicId',(r).clinic_id,'clinicName',clinic,'organizationName',org) ORDER BY (r).occurred_at DESC,(r).revision_id,(r).organization_id,(r).clinic_id),'[]')) INTO output FROM visible;
 RETURN output;
END $$;
ALTER TABLE public.exchange_export_events ADD COLUMN clinical_revision_ids uuid[] NOT NULL DEFAULT '{}';
CREATE FUNCTION public.exchange_owner_source(pet uuid,org uuid,clinic uuid,patient uuid,notes uuid[],files uuid[],include_owner boolean,versions uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE snapshot jsonb; records jsonb;
BEGIN
 snapshot:=public.exchange_owner_source(pet,org,clinic,patient,notes,files,include_owner);
 IF snapshot ? 'error' THEN RETURN snapshot; END IF;
 IF versions IS NULL OR cardinality(versions)<>(SELECT count(DISTINCT v) FROM unnest(versions) v) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.revision_id,'kind',CASE WHEN r.kind='lab' THEN 'labResult' ELSE r.kind END,'occurredAt',vetx_care.utc(r.occurred_at),
 'recordedAt',vetx_care.utc(r.recorded_at),'author',jsonb_build_object('issuer',r.author_issuer,'subject',r.author_subject),
 'data',r.data-'status','clinicalRevision',jsonb_build_object('recordId',r.record_id,'revision',r.revision)||
 CASE WHEN r.kind='lab' THEN jsonb_build_object('resultAuthor',jsonb_build_object('issuer',r.result_author_issuer,'subject',r.result_author_subject),'resultRecordedAt',vetx_care.utc(r.result_recorded_at)) ELSE '{}' END)
 ORDER BY r.revision_id),'[]') INTO records FROM public.clinical_record_heads h JOIN public.clinical_record_revisions r USING(organization_id,clinic_id,patient_id,record_id,revision)
 WHERE (h.organization_id,h.clinic_id,h.patient_id)=(org,clinic,patient) AND r.revision_id=ANY(versions) AND vetx_clinical.guardian(h,pet) AND (r.kind<>'lab' OR r.data->>'status'='REVIEWED');
 IF jsonb_array_length(records)<>cardinality(versions) THEN RETURN '{"error":"not_found"}'; END IF;
 RETURN snapshot||jsonb_build_object('clinical',records);
END $$;
CREATE FUNCTION public.exchange_confirm_export(pet uuid,org uuid,clinic uuid,patient uuid,notes uuid[],files uuid[],include_owner boolean,
 destination_org uuid,destination_clinic uuid,package uuid,versions uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
 IF num_nonnulls(destination_org,destination_clinic,package)<>3 OR (org,clinic)=(destination_org,destination_clinic) THEN RETURN '{"error":"invalid"}'; END IF;
 snapshot:=public.exchange_owner_source(pet,org,clinic,patient,notes,files,include_owner,versions);
 IF snapshot ? 'error' THEN RETURN snapshot; END IF;
 INSERT INTO public.exchange_export_events(package_id,organization_id,clinic_id,patient_id,pet_id,destination_organization_id,destination_clinic_id,
 encounter_ids,asset_ids,include_owner,actor_issuer,actor_subject,clinical_revision_ids) VALUES(package,org,clinic,patient,pet,destination_org,destination_clinic,notes,files,include_owner,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'),versions);
 RETURN '{"ok":true}';
END $$;
CREATE OR REPLACE FUNCTION public.exchange_owner_choices(pet uuid,org uuid,clinic uuid,patient uuid,page_num int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page_num IS NULL OR page_num<1 THEN RETURN '{"error":"invalid"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.guardians g WHERE (g.organization_id,g.clinic_id,g.patient_id,g.pet_id)=(org,clinic,patient,pet)
 AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)) THEN RETURN '{"error":"not_found"}'; END IF;
 WITH released AS (
 SELECT e.id,'encounter'::text AS kind,e.reason AS title,e.occurred_at AS stamp FROM public.clinical_encounters e
 WHERE (e.organization_id,e.clinic_id,e.patient_id)=(org,clinic,patient) AND vetx_care.released(org,clinic,patient,e.id,pet)
 UNION ALL
 SELECT d.asset_id,'document',d.title,d.recorded_at FROM public.medical_documents d WHERE
 (d.organization_id,d.clinic_id,d.patient_id)=(org,clinic,patient) AND vetx_documents.released(d,pet)
 UNION ALL
 SELECT r.revision_id,'clinical',left(coalesce(r.data->>'diagnosis',r.data->>'treatment',r.data->>'vaccine',r.data->>'test'),250),r.occurred_at
 FROM public.clinical_record_heads h JOIN public.clinical_record_revisions r USING(organization_id,clinic_id,patient_id,record_id,revision)
 WHERE (h.organization_id,h.clinic_id,h.patient_id)=(org,clinic,patient) AND vetx_clinical.guardian(h,pet)
 ), matches AS (SELECT * FROM released ORDER BY stamp DESC,kind,id LIMIT 26 OFFSET (page_num::bigint-1)*25),
 entries AS (SELECT * FROM matches ORDER BY stamp DESC,kind,id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM matches),'records',coalesce(jsonb_agg(jsonb_build_object(
 'id',id,'kind',kind,'title',title,'occurredAt',vetx_care.utc(stamp)) ORDER BY stamp DESC,kind,id),'[]')) INTO result FROM entries;
 RETURN result;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vetx_clinical FROM PUBLIC,vetx_runtime;
REVOKE ALL ON FUNCTION public.clinical_lock_tables(),public.clinical_write(uuid,uuid,uuid,uuid,text,text,int,text,jsonb),public.clinical_share(uuid,uuid,int,int,uuid[]),public.clinical_list(uuid,uuid,int),public.clinical_owner_list(uuid,int),public.exchange_owner_source(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid[]),public.exchange_confirm_export(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid,uuid,uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clinical_lock_tables(),public.clinical_write(uuid,uuid,uuid,uuid,text,text,int,text,jsonb),public.clinical_share(uuid,uuid,int,int,uuid[]),public.clinical_list(uuid,uuid,int),public.clinical_owner_list(uuid,int),public.exchange_owner_source(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid[]),public.exchange_confirm_export(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid,uuid,uuid,uuid[]) TO vetx_runtime;
COMMIT;
