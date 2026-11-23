BEGIN;
ALTER TABLE public.medical_documents ADD COLUMN imaging jsonb;
ALTER TABLE public.medical_documents DROP CONSTRAINT medical_documents_media_type_check;
ALTER TABLE public.medical_documents ADD CHECK(media_type IN ('application/pdf','image/png','image/jpeg','application/dicom'));
ALTER TABLE public.medical_documents ADD CHECK((imaging IS NULL OR media_type='application/dicom') AND (media_type<>'application/dicom' OR NOT ready OR imaging IS NOT NULL));
CREATE OR REPLACE FUNCTION vetx_documents.summary(d public.medical_documents) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'assetId',d.asset_id,'organizationId',d.organization_id,'clinicId',d.clinic_id,'patientId',d.patient_id,
 'title',d.title,'mediaType',d.media_type,'byteLength',d.byte_length,'sha256',d.sha256,'ready',d.ready,
 'recordedAt',to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 || CASE WHEN d.imaging IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('imaging',d.imaging) END
$$;
CREATE OR REPLACE FUNCTION public.document_reserve(patient uuid,doc uuid,label text,mime text,bytes int,digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); d public.medical_documents;
  issuer text:=current_setting('vetx.identity_issuer',true); subject text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(patient,doc,label,mime,bytes,digest)<>6 OR length(btrim(label)) NOT BETWEEN 1 AND 180 OR label ~ '[[:cntrl:]]' OR
    mime NOT IN ('application/pdf','image/png','image/jpeg','application/dicom') OR bytes<=0 OR digest !~ '^[a-f0-9]{64}$' THEN RETURN '{"error":"invalid"}'; END IF;
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
CREATE OR REPLACE FUNCTION public.document_finish(patient uuid,doc uuid,digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); d public.medical_documents;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 SELECT * INTO d FROM public.medical_documents WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,doc);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 IF (d.sha256,d.uploader_issuer,d.uploader_subject) IS DISTINCT FROM (digest,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject')) THEN RETURN '{"error":"conflict"}'; END IF;
 IF d.media_type='application/dicom' AND d.imaging IS NULL THEN RETURN '{"error":"conflict"}'; END IF;
 IF NOT d.ready THEN
   UPDATE public.medical_documents SET ready=true WHERE asset_id=d.asset_id RETURNING * INTO d;
   PERFORM vetx_documents.audit(d,'UPLOADED');
 END IF;
 RETURN vetx_documents.staff_summary(d);
END $$;
CREATE FUNCTION public.document_finish_dicom(patient uuid,doc uuid,digest text,details jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id();d public.medical_documents;u text;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF jsonb_typeof(details) IS DISTINCT FROM 'object' OR num_nonnulls(details->>'modality',details->>'frames',details->>'studyInstanceUid',details->>'seriesInstanceUid',details->>'sopInstanceUid')<>5
 OR jsonb_typeof(details->'frames') IS DISTINCT FROM 'number' OR details->>'modality' !~ '^[A-Z0-9_ ]{1,16}$' OR details->>'frames' !~ '^[1-9][0-9]{0,9}$'
 OR (details->>'frames')::bigint>2147483647 OR (details - ARRAY['modality','frames','studyInstanceUid','seriesInstanceUid','sopInstanceUid','preview'])<>'{}' THEN RETURN '{"error":"invalid"}'; END IF;
 FOREACH u IN ARRAY ARRAY[details->>'studyInstanceUid',details->>'seriesInstanceUid',details->>'sopInstanceUid'] LOOP
   IF length(u)>64 OR u !~ '^(0|[1-9][0-9]*)([.](0|[1-9][0-9]*))+$' THEN RETURN '{"error":"invalid"}'; END IF;
 END LOOP;
 IF details ? 'preview' AND (jsonb_typeof(details->'preview') IS DISTINCT FROM 'object' OR
   jsonb_typeof(details#>'{preview,byteLength}') IS DISTINCT FROM 'number' OR num_nonnulls(details#>>'{preview,sha256}',details#>>'{preview,byteLength}')<>2 OR details#>>'{preview,sha256}' !~ '^[0-9a-f]{64}$' OR
   details#>>'{preview,byteLength}' !~ '^[1-9][0-9]{0,9}$' OR (details#>>'{preview,byteLength}')::bigint>2147483647 OR
   ((details->'preview')-ARRAY['sha256','byteLength'])<>'{}') THEN RETURN '{"error":"invalid"}';END IF;
 SELECT * INTO d FROM public.medical_documents WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,doc) FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 IF (d.media_type,d.sha256,d.uploader_issuer,d.uploader_subject) IS DISTINCT FROM ('application/dicom',digest,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'))
   OR (d.imaging IS NOT NULL AND d.imaging<>details) THEN RETURN '{"error":"conflict"}'; END IF;
 UPDATE public.medical_documents SET imaging=details WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,doc) AND imaging IS NULL;
 RETURN public.document_finish(patient,doc,digest);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid"}';
END $$;
REVOKE ALL ON FUNCTION public.document_finish_dicom(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_finish_dicom(uuid,uuid,text,jsonb) TO vetx_runtime;
COMMIT;
