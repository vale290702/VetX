BEGIN;

CREATE FUNCTION vetx_documents.prepare_document(
  patient uuid, doc uuid, label text, mime text, bytes int, digest text, reserve boolean
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  org uuid := vetx_directory.organization_id();
  clinic uuid := vetx_registry.clinic_id();
  issuer text := current_setting('vetx.identity_issuer',true);
  subject text := current_setting('vetx.identity_subject',true);
  d public.medical_documents;
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF num_nonnulls(patient,doc,label,mime,bytes,digest)<>6
    OR length(btrim(label)) NOT BETWEEN 1 AND 180 OR label ~ '[[:cntrl:]]'
    OR mime NOT IN ('application/pdf','image/png','image/jpeg','application/dicom')
    OR bytes<=0 OR digest !~ '^[a-f0-9]{64}$' THEN
    RETURN '{"error":"invalid"}';
  END IF;
  IF NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) THEN
    RETURN '{"error":"not_found"}';
  END IF;

  SELECT * INTO d FROM public.medical_documents
  WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,doc);
  IF FOUND THEN
    IF (d.title,d.media_type,d.byte_length,d.sha256,d.uploader_issuer,d.uploader_subject)
      IS DISTINCT FROM (btrim(label),mime,bytes,digest,issuer,subject) THEN
      RETURN '{"error":"conflict"}';
    END IF;
  ELSIF reserve THEN
    INSERT INTO public.medical_documents(
      organization_id,clinic_id,patient_id,id,title,media_type,byte_length,sha256,uploader_issuer,uploader_subject
    ) VALUES(org,clinic,patient,doc,btrim(label),mime,bytes,digest,issuer,subject) RETURNING * INTO d;
  ELSE
    RETURN '{"document":null}';
  END IF;

  RETURN jsonb_build_object('document',vetx_documents.staff_summary(d));
END $$;

REVOKE ALL ON FUNCTION vetx_documents.prepare_document(uuid,uuid,text,text,int,text,boolean) FROM PUBLIC;

CREATE FUNCTION public.document_preflight(patient uuid,doc uuid,label text,mime text,bytes int,digest text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT vetx_documents.prepare_document(patient,doc,label,mime,bytes,digest,false)
$$;

CREATE OR REPLACE FUNCTION public.document_reserve(patient uuid,doc uuid,label text,mime text,bytes int,digest text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN result ? 'error' THEN result ELSE result->'document' END
  FROM vetx_documents.prepare_document(patient,doc,label,mime,bytes,digest,true) AS prepared(result)
$$;

REVOKE ALL ON FUNCTION public.document_preflight(uuid,uuid,text,text,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_preflight(uuid,uuid,text,text,int,text) TO vetx_runtime;

COMMIT;
