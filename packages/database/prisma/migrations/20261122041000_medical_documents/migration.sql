BEGIN;

CREATE SCHEMA vetx_documents;
REVOKE ALL ON SCHEMA vetx_documents FROM PUBLIC;
CREATE TABLE public.medical_documents (
  organization_id uuid NOT NULL, clinic_id uuid NOT NULL, patient_id uuid NOT NULL, id uuid NOT NULL,
  asset_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180 AND title !~ '[[:cntrl:]]'),
  media_type text NOT NULL CHECK (media_type IN ('application/pdf','image/png','image/jpeg')),
  byte_length int NOT NULL CHECK(byte_length>0), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  uploader_issuer text NOT NULL, uploader_subject text NOT NULL,
  ready boolean NOT NULL DEFAULT false, recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  recipients uuid[] NOT NULL DEFAULT '{}', revision int NOT NULL DEFAULT 0 CHECK(revision>=0),
  sharing_issuer text, sharing_subject text,
  PRIMARY KEY(organization_id,clinic_id,patient_id,id),
  FOREIGN KEY(organization_id,clinic_id,patient_id) REFERENCES public.patients(organization_id,clinic_id,id)
);
CREATE INDEX document_chronology ON public.medical_documents(organization_id,clinic_id,patient_id,recorded_at DESC,asset_id);
CREATE TABLE public.document_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL, clinic_id uuid NOT NULL, patient_id uuid NOT NULL, document_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('UPLOADED','SHARING_CHANGED')),
  actor_issuer text NOT NULL, actor_subject text NOT NULL, recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  revision int NOT NULL, guardian_ids uuid[] NOT NULL,
  FOREIGN KEY(organization_id,clinic_id,patient_id,document_id) REFERENCES public.medical_documents(organization_id,clinic_id,patient_id,id)
);
ALTER TABLE public.medical_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_events FORCE ROW LEVEL SECURITY;
CREATE POLICY staff ON public.medical_documents TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY staff_audit ON public.document_events FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id)
  AND actor_issuer=current_setting('vetx.identity_issuer',true) AND actor_subject=current_setting('vetx.identity_subject',true));
CREATE FUNCTION vetx_documents.released(d public.medical_documents,pet uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT d.ready AND EXISTS(SELECT FROM public.guardians g WHERE (g.organization_id,g.clinic_id,g.patient_id)=(d.organization_id,d.clinic_id,d.patient_id)
   AND g.id=ANY(d.recipients) AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject) AND (pet IS NULL OR g.pet_id=pet))
$$;
CREATE POLICY owner ON public.medical_documents FOR SELECT TO vetx_migration USING(vetx_documents.released(medical_documents));
CREATE FUNCTION public.document_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN LOCK TABLE public.medical_documents,public.document_events IN ACCESS SHARE MODE; RETURN true; END $$;
CREATE FUNCTION vetx_documents.sharing(d public.medical_documents) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('revision',d.revision,'guardianIds',coalesce((SELECT jsonb_agg(g.id ORDER BY g.id) FROM public.guardians g WHERE
 (g.organization_id,g.clinic_id,g.patient_id)=(d.organization_id,d.clinic_id,d.patient_id) AND g.id=ANY(d.recipients) AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL),'[]'::jsonb))
$$;
CREATE FUNCTION vetx_documents.summary(d public.medical_documents) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'assetId',d.asset_id,'organizationId',d.organization_id,'clinicId',d.clinic_id,'patientId',d.patient_id,
 'title',d.title,'mediaType',d.media_type,'byteLength',d.byte_length,'sha256',d.sha256,'ready',d.ready,
 'recordedAt',to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
CREATE FUNCTION vetx_documents.staff_summary(d public.medical_documents) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT vetx_documents.summary(d)||jsonb_build_object('sharing',vetx_documents.sharing(d))
$$;
CREATE FUNCTION vetx_documents.audit(d public.medical_documents,verb text) RETURNS void LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO public.document_events(organization_id,clinic_id,patient_id,document_id,action,actor_issuer,actor_subject,revision,guardian_ids)
 VALUES(d.organization_id,d.clinic_id,d.patient_id,d.id,verb,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'),d.revision,d.recipients)
$$;
CREATE FUNCTION public.document_reserve(patient uuid,doc uuid,label text,mime text,bytes int,digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); d public.medical_documents;
  issuer text:=current_setting('vetx.identity_issuer',true); subject text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(patient,doc,label,mime,bytes,digest)<>6 OR length(btrim(label)) NOT BETWEEN 1 AND 180 OR label ~ '[[:cntrl:]]' OR
    mime NOT IN ('application/pdf','image/png','image/jpeg') OR bytes<=0 OR digest !~ '^[a-f0-9]{64}$' THEN RETURN '{"error":"invalid"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO d FROM public.medical_documents WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,doc);
 IF FOUND THEN
   IF (d.title,d.media_type,d.byte_length,d.sha256,d.uploader_issuer,d.uploader_subject) IS DISTINCT FROM (btrim(label),mime,bytes,digest,issuer,subject) THEN RETURN '{"error":"conflict"}'; END IF;
 ELSE
   INSERT INTO public.medical_documents(organization_id,clinic_id,patient_id,id,title,media_type,byte_length,sha256,uploader_issuer,uploader_subject)
   VALUES(org,clinic,patient,doc,btrim(label),mime,bytes,digest,issuer,subject) RETURNING * INTO d;
 END IF;
 RETURN vetx_documents.staff_summary(d);
END $$;
CREATE FUNCTION public.document_finish(patient uuid,doc uuid,digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); d public.medical_documents;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 SELECT * INTO d FROM public.medical_documents WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,doc);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 IF (d.sha256,d.uploader_issuer,d.uploader_subject) IS DISTINCT FROM (digest,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject')) THEN RETURN '{"error":"conflict"}'; END IF;
 IF NOT d.ready THEN
   UPDATE public.medical_documents SET ready=true WHERE asset_id=d.asset_id RETURNING * INTO d;
   PERFORM vetx_documents.audit(d,'UPLOADED');
 END IF;
 RETURN vetx_documents.staff_summary(d);
END $$;
CREATE FUNCTION public.document_share(patient uuid,doc uuid,guardian_ids uuid[],expected int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); d public.medical_documents;
 targets uuid[]; issuer text:=current_setting('vetx.identity_issuer',true); subject text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF guardian_ids IS NULL OR expected IS NULL OR expected<0 OR cardinality(guardian_ids)<>(SELECT count(DISTINCT g) FROM unnest(guardian_ids) g) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT * INTO d FROM public.medical_documents WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,doc) AND ready;
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT coalesce(array_agg(g.id ORDER BY g.id),'{}') INTO targets FROM public.guardians g WHERE
 (g.organization_id,g.clinic_id,g.patient_id)=(org,clinic,patient) AND g.id=ANY(guardian_ids) AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL;
 IF cardinality(targets)<>cardinality(guardian_ids) THEN RETURN '{"error":"not_found"}'; END IF;
 IF targets=d.recipients AND (expected=d.revision OR (expected=d.revision-1 AND (issuer,subject)=(d.sharing_issuer,d.sharing_subject))) THEN RETURN vetx_documents.sharing(d); END IF;
 IF expected<>d.revision OR d.revision=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
 UPDATE public.medical_documents SET recipients=targets,revision=revision+1,sharing_issuer=issuer,sharing_subject=subject WHERE asset_id=d.asset_id RETURNING * INTO d;
 PERFORM vetx_documents.audit(d,'SHARING_CHANGED');
 RETURN vetx_documents.sharing(d);
END $$;
CREATE FUNCTION public.document_staff_read(patient uuid,doc uuid,page_num int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); d public.medical_documents; result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page_num IS NULL OR page_num<1 THEN RETURN '{"error":"invalid"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) THEN RETURN '{"error":"not_found"}'; END IF;
 IF doc IS NOT NULL THEN
  SELECT * INTO d FROM public.medical_documents WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,doc) AND ready;
  IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
  RETURN vetx_documents.staff_summary(d);
 END IF;
 WITH candidates AS (SELECT m FROM public.medical_documents m WHERE (m.organization_id,m.clinic_id,m.patient_id)=(org,clinic,patient) AND m.ready
   ORDER BY m.recorded_at DESC,m.asset_id LIMIT 26 OFFSET (page_num::bigint-1)*25),
 entries AS (SELECT m FROM candidates ORDER BY (m).recorded_at DESC,(m).asset_id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM candidates),
 'documents',coalesce(jsonb_agg(vetx_documents.staff_summary(m) ORDER BY (m).recorded_at DESC,(m).asset_id),'[]')) INTO result FROM entries;
 RETURN result;
END $$;
CREATE FUNCTION public.document_owner_read(pet uuid,asset uuid,page_num int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page_num IS NULL OR page_num<1 THEN RETURN '{"error":"invalid"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.guardians g WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)) THEN RETURN '{"error":"not_found"}'; END IF;
 WITH linked_records AS MATERIALIZED (
 SELECT DISTINCT g.organization_id,g.clinic_id,g.patient_id FROM public.guardians g
 WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)
 ), candidates AS (
 SELECT m,c.name AS clinic,o.name AS org FROM linked_records r
 JOIN public.medical_documents m ON (m.organization_id,m.clinic_id,m.patient_id)=(r.organization_id,r.clinic_id,r.patient_id)
 JOIN public.clinics c ON (c.organization_id,c.id)=(m.organization_id,m.clinic_id) JOIN public.organizations o ON o.id=m.organization_id
 WHERE vetx_documents.released(m,pet) AND (asset IS NULL OR m.asset_id=asset)
 ORDER BY m.recorded_at DESC,m.asset_id LIMIT 26 OFFSET (page_num::bigint-1)*25),
 entries AS (SELECT * FROM candidates ORDER BY (m).recorded_at DESC,(m).asset_id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM candidates),
 'documents',coalesce(jsonb_agg(vetx_documents.summary(m)||jsonb_build_object('organizationName',org,'clinicName',clinic)
 ORDER BY (m).recorded_at DESC,(m).asset_id),'[]')) INTO result FROM entries;
 IF asset IS NOT NULL THEN RETURN coalesce(result->'documents'->0,'{"error":"not_found"}'::jsonb); END IF;
 RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vetx_documents FROM PUBLIC;
REVOKE ALL ON FUNCTION public.document_lock_tables(),public.document_reserve(uuid,uuid,text,text,int,text),public.document_finish(uuid,uuid,text),
 public.document_share(uuid,uuid,uuid[],int),public.document_staff_read(uuid,uuid,int),public.document_owner_read(uuid,uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_lock_tables(),public.document_reserve(uuid,uuid,text,text,int,text),public.document_finish(uuid,uuid,text),
 public.document_share(uuid,uuid,uuid[],int),public.document_staff_read(uuid,uuid,int),public.document_owner_read(uuid,uuid,int) TO vetx_runtime;
COMMIT;
