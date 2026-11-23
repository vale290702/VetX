BEGIN;
ALTER TABLE public.clinical_record_revisions DROP CONSTRAINT clinical_record_revisions_kind_check;
ALTER TABLE public.clinical_record_revisions ADD CONSTRAINT clinical_record_revisions_kind_check
 CHECK (kind IN ('diagnosis','treatment','vaccination','lab','hospitalization','surgery'));
ALTER TABLE public.clinical_record_heads ADD COLUMN active_admission boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX clinical_one_active_admission ON public.clinical_record_heads(organization_id,clinic_id,patient_id) WHERE active_admission;

CREATE FUNCTION vetx_clinical.episode_data(kind text,d jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE status text:=d->>'status'; required_keys text[]; allowed_keys text[]; k text; v text; lim int;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR status IS NULL THEN RETURN false; END IF;
 IF kind='hospitalization' THEN
   IF status NOT IN ('ADMITTED','PROGRESS','DISCHARGED') THEN RETURN false; END IF;
   required_keys:=ARRAY['status','ward','note'];
   allowed_keys:=required_keys||ARRAY['location'];
 ELSIF kind='surgery' THEN
   IF status NOT IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED') THEN RETURN false; END IF;
   required_keys:=ARRAY['status','procedure','scheduledAt'];
   allowed_keys:=required_keys||ARRAY['notes'];
   IF status='COMPLETED' THEN
     required_keys:=required_keys||ARRAY['performedProcedure','recoveryNotes'];
     allowed_keys:=allowed_keys||ARRAY['performedProcedure','recoveryNotes'];
   END IF;
 ELSE RETURN false;
 END IF;
 IF status IN ('DISCHARGED','COMPLETED','CANCELLED') THEN
   required_keys:=array_append(required_keys,'summary'); allowed_keys:=array_append(allowed_keys,'summary');
 END IF;
 IF NOT (d ?& required_keys) OR d-allowed_keys<>'{}'::jsonb THEN RETURN false; END IF;
 FOR k IN SELECT jsonb_object_keys(d) LOOP
   IF jsonb_typeof(d->k)<>'string' THEN RETURN false; END IF;
   v:=d->>k;
   IF k='scheduledAt' THEN
     IF vetx_care.instant(v) IS NULL THEN RETURN false; END IF;
   ELSIF k IN ('note','notes','summary','recoveryNotes') THEN
     IF (k<>'notes' AND length(vetx_care.clean(v))=0) OR length(v)>8000 OR translate(v,E'\t\n\r','') ~ '[[:cntrl:]]' THEN RETURN false; END IF;
   ELSE
     lim:=CASE WHEN k IN ('procedure','performedProcedure') THEN 250 ELSE 120 END;
     IF length(v)>lim OR NOT vetx_stock.label(v,lim) THEN RETURN false; END IF;
   END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION vetx_clinical.episode_transition(previous public.clinical_record_revisions,d jsonb,stamp timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT stamp>=previous.occurred_at AND CASE previous.data->>'status'
 WHEN 'ADMITTED' THEN d->>'status' IN ('PROGRESS','DISCHARGED')
 WHEN 'PROGRESS' THEN d->>'status' IN ('PROGRESS','DISCHARGED')
 WHEN 'PLANNED' THEN d->>'status' IN ('PLANNED','IN_PROGRESS','CANCELLED')
 WHEN 'IN_PROGRESS' THEN d->>'status' IN ('COMPLETED','CANCELLED')
 ELSE d->>'status'=previous.data->>'status' AND stamp=previous.occurred_at END
 AND (previous.kind<>'surgery' OR (previous.data->>'status'='PLANNED' AND d->>'status'='PLANNED')
 OR (previous.data->>'procedure',previous.data->>'scheduledAt')=(d->>'procedure',d->>'scheduledAt'))
$$;

CREATE FUNCTION vetx_clinical.releasable(kind text,d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE kind WHEN 'lab' THEN d->>'status'='REVIEWED' WHEN 'hospitalization' THEN d->>'status'='DISCHARGED'
 WHEN 'surgery' THEN d->>'status' IN ('COMPLETED','CANCELLED') ELSE kind IN ('diagnosis','treatment','vaccination') END
$$;
CREATE FUNCTION vetx_clinical.guardian_data(kind text,d jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN kind IN ('hospitalization','surgery') THEN jsonb_build_object('status',d->>'status','summary',d->>'summary') ELSE d END
$$;
CREATE FUNCTION vetx_clinical.choice_title(r public.clinical_record_revisions) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT left(CASE WHEN r.kind IN ('hospitalization','surgery') THEN r.data->>'summary'
 ELSE coalesce(r.data->>'diagnosis',r.data->>'treatment',r.data->>'vaccine',r.data->>'test') END,250)
$$;
CREATE OR REPLACE FUNCTION public.clinical_write(patient uuid,entry uuid,request uuid,encounter uuid,category text,occurred text,expected int,reason text,details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); r public.clinical_record_revisions; prior public.clinical_record_revisions;
 stamp timestamptz:=vetx_care.instant(occurred); issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true); reviewing boolean; constraint_name_text text;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(patient,entry,request,encounter,category,stamp,expected,details)<>8 OR expected NOT BETWEEN 0 AND 2147483646 OR NOT (CASE WHEN category IN ('hospitalization','surgery') THEN vetx_clinical.episode_data(category,details)
 ELSE vetx_clinical.valid(category,details) END)
 OR (expected=0 AND reason IS NOT NULL) OR (expected>0 AND (NOT vetx_stock.label(reason,500) OR length(reason)>500)) THEN RETURN '{"error":"invalid"}'; END IF;
 IF category='surgery' THEN details:=jsonb_set(details,'{scheduledAt}',to_jsonb(vetx_care.utc(vetx_care.instant(details->>'scheduledAt')))); END IF;
 SELECT * INTO r FROM public.clinical_record_revisions WHERE (organization_id,clinic_id,request_id)=(org,clinic,request);
 IF FOUND THEN
  IF (r.patient_id,r.record_id,r.encounter_id,r.kind,r.occurred_at,r.revision,r.change_reason,r.data,r.author_issuer,r.author_subject)
    IS DISTINCT FROM (patient,entry,encounter,category,stamp,expected+1,reason,details,issuer,subj) THEN RETURN '{"error":"conflict"}'; END IF;
  RETURN vetx_clinical.staff(r);
 END IF;
 IF NOT EXISTS(SELECT FROM public.clinical_encounters WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,encounter)) THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO prior FROM public.clinical_record_revisions WHERE (organization_id,clinic_id,patient_id,record_id)=(org,clinic,patient,entry) ORDER BY revision DESC LIMIT 1;
 IF expected<>coalesce(prior.revision,0) OR (prior.revision IS NOT NULL AND (prior.kind,prior.encounter_id) IS DISTINCT FROM (category,encounter)) THEN RETURN '{"error":"conflict"}'; END IF;
 IF category IN ('hospitalization','surgery') THEN
   IF expected=0 AND details->>'status'<>(CASE category WHEN 'hospitalization' THEN 'ADMITTED' ELSE 'PLANNED' END) THEN RETURN '{"error":"invalid"}'; END IF;
   IF expected>0 AND NOT vetx_clinical.episode_transition(prior,details,stamp) THEN RETURN '{"error":"conflict"}'; END IF;
 END IF;
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
 INSERT INTO public.clinical_record_heads(organization_id,clinic_id,patient_id,record_id,revision,active_admission) VALUES(org,clinic,patient,entry,r.revision,category='hospitalization' AND details->>'status'<>'DISCHARGED')
 ON CONFLICT(organization_id,clinic_id,patient_id,record_id) DO UPDATE SET revision=EXCLUDED.revision,active_admission=EXCLUDED.active_admission,share_revision=0,guardian_ids='{}',share_issuer=NULL,share_subject=NULL;
 PERFORM vetx_care.audit(patient,entry,'CLINICAL_REVISION',jsonb_build_object('revision',r.revision,'revisionId',r.revision_id));
 RETURN vetx_clinical.staff(r);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS constraint_name_text=CONSTRAINT_NAME;
 IF constraint_name_text='clinical_one_active_admission' THEN RETURN '{"error":"conflict"}'; END IF;
 RAISE;
END $$;
CREATE OR REPLACE FUNCTION public.clinical_share(patient uuid,entry uuid,version int,expected int,guardians uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); h public.clinical_record_heads; targets uuid[];
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(patient,entry,version,expected,guardians)<>5 OR version<1 OR expected<0 OR cardinality(guardians)>100 OR cardinality(guardians)<>(SELECT count(DISTINCT g) FROM unnest(guardians) g) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT * INTO h FROM public.clinical_record_heads WHERE (organization_id,clinic_id,patient_id,record_id)=(org,clinic,patient,entry);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 IF version<>h.revision OR (cardinality(guardians)>0 AND EXISTS(SELECT FROM public.clinical_record_revisions r WHERE (r.organization_id,r.clinic_id,r.patient_id,r.record_id,r.revision)=(org,clinic,patient,entry,version)
 AND NOT vetx_clinical.releasable(r.kind,r.data))) THEN RETURN '{"error":"conflict"}'; END IF;
 SELECT coalesce(array_agg(g.id ORDER BY g.id),'{}') INTO targets FROM public.guardians g WHERE (g.organization_id,g.clinic_id,g.patient_id)=(org,clinic,patient) AND g.id=ANY(guardians) AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL;
 IF cardinality(targets)<>cardinality(guardians) THEN RETURN '{"error":"not_found"}'; END IF;
 IF h.guardian_ids=targets AND (expected=h.share_revision OR (expected=h.share_revision-1 AND (issuer,subj)=(h.share_issuer,h.share_subject))) THEN RETURN vetx_clinical.sharing(h); END IF;
 IF expected<>h.share_revision OR expected=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
 UPDATE public.clinical_record_heads SET guardian_ids=targets,share_revision=expected+1,share_issuer=issuer,share_subject=subj WHERE (organization_id,clinic_id,patient_id,record_id)=(org,clinic,patient,entry) RETURNING * INTO h;
 PERFORM vetx_care.audit(patient,entry,'CLINICAL_SHARING',jsonb_build_object('recordRevision',version,'revision',h.share_revision,'guardianIds',targets));
 RETURN vetx_clinical.sharing(h);
END $$;
CREATE OR REPLACE FUNCTION public.clinical_owner_list(pet uuid,page_num int) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE output jsonb;
BEGIN
 IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page_num IS NULL OR page_num<1 THEN RETURN '{"error":"invalid"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.guardians g WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)) THEN RETURN '{"error":"not_found"}'; END IF;
 WITH matches AS MATERIALIZED (
 SELECT r,c.name AS clinic,o.name AS org FROM public.clinical_record_heads h JOIN public.clinical_record_revisions r USING(organization_id,clinic_id,patient_id,record_id,revision)
 JOIN public.clinics c ON (c.organization_id,c.id)=(h.organization_id,h.clinic_id) JOIN public.organizations o ON o.id=h.organization_id
 WHERE vetx_clinical.guardian(h,pet) AND vetx_clinical.releasable(r.kind,r.data) ORDER BY r.occurred_at DESC,r.revision_id,r.organization_id,r.clinic_id LIMIT 26 OFFSET ((page_num::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY (r).occurred_at DESC,(r).revision_id,(r).organization_id,(r).clinic_id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM matches),'records',coalesce(jsonb_agg(vetx_clinical.view_revision(r)||jsonb_build_object('data',vetx_clinical.guardian_data((r).kind,(r).data),'clinicId',(r).clinic_id,'clinicName',clinic,'organizationName',org) ORDER BY (r).occurred_at DESC,(r).revision_id,(r).organization_id,(r).clinic_id),'[]')) INTO output FROM visible;
 RETURN output;
END $$;
CREATE OR REPLACE FUNCTION public.exchange_owner_source(pet uuid,org uuid,clinic uuid,patient uuid,notes uuid[],files uuid[],include_owner boolean,versions uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE snapshot jsonb; records jsonb;
BEGIN
 snapshot:=public.exchange_owner_source(pet,org,clinic,patient,notes,files,include_owner);
 IF snapshot ? 'error' THEN RETURN snapshot; END IF;
 IF versions IS NULL OR cardinality(versions)<>(SELECT count(DISTINCT v) FROM unnest(versions) v) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.revision_id,'kind',CASE WHEN r.kind='lab' THEN 'labResult' ELSE r.kind END,'occurredAt',vetx_care.utc(r.occurred_at),
 'recordedAt',vetx_care.utc(r.recorded_at),'author',jsonb_build_object('issuer',r.author_issuer,'subject',r.author_subject),
 'data',CASE WHEN r.kind='lab' THEN r.data-'status' ELSE vetx_clinical.guardian_data(r.kind,r.data) END,'clinicalRevision',jsonb_build_object('recordId',r.record_id,'revision',r.revision)||
 CASE WHEN r.kind='lab' THEN jsonb_build_object('resultAuthor',jsonb_build_object('issuer',r.result_author_issuer,'subject',r.result_author_subject),'resultRecordedAt',vetx_care.utc(r.result_recorded_at)) ELSE '{}' END)
 ORDER BY r.revision_id),'[]') INTO records FROM public.clinical_record_heads h JOIN public.clinical_record_revisions r USING(organization_id,clinic_id,patient_id,record_id,revision)
 WHERE (h.organization_id,h.clinic_id,h.patient_id)=(org,clinic,patient) AND r.revision_id=ANY(versions) AND vetx_clinical.guardian(h,pet) AND vetx_clinical.releasable(r.kind,r.data);
 IF jsonb_array_length(records)<>cardinality(versions) THEN RETURN '{"error":"not_found"}'; END IF;
 RETURN snapshot||jsonb_build_object('clinical',records);
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
 SELECT r.revision_id,'clinical',vetx_clinical.choice_title(r),r.occurred_at
 FROM public.clinical_record_heads h JOIN public.clinical_record_revisions r USING(organization_id,clinic_id,patient_id,record_id,revision)
 WHERE (h.organization_id,h.clinic_id,h.patient_id)=(org,clinic,patient) AND vetx_clinical.guardian(h,pet) AND vetx_clinical.releasable(r.kind,r.data)
 ), matches AS (SELECT * FROM released ORDER BY stamp DESC,kind,id LIMIT 26 OFFSET (page_num::bigint-1)*25),
 entries AS (SELECT * FROM matches ORDER BY stamp DESC,kind,id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM matches),'records',coalesce(jsonb_agg(jsonb_build_object(
 'id',id,'kind',kind,'title',title,'occurredAt',vetx_care.utc(stamp)) ORDER BY stamp DESC,kind,id),'[]')) INTO result FROM entries;
 RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vetx_clinical FROM PUBLIC,vetx_runtime;
COMMIT;
