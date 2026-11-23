BEGIN;

CREATE POLICY owner_export_contact ON public.owner_contacts FOR SELECT TO vetx_migration USING (
 EXISTS(SELECT FROM public.guardians g
 WHERE (g.organization_id,g.clinic_id,g.contact_id)=(owner_contacts.organization_id,owner_contacts.clinic_id,owner_contacts.id)
 AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject))
);

CREATE FUNCTION public.exchange_owner_source(pet uuid,org uuid,clinic uuid,patient uuid,notes uuid[],files uuid[],include_owner boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE patient_info jsonb; owner_info jsonb; note_rows jsonb; file_rows jsonb;
BEGIN
 IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(pet,org,clinic,patient,notes,files,include_owner)<>7 OR
   cardinality(notes)<>(SELECT count(DISTINCT x) FROM unnest(notes) x) OR
   cardinality(files)<>(SELECT count(DISTINCT x) FROM unnest(files) x) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT jsonb_build_object('id',p.id,'name',p.name,'species',p.species,'birthDate',p.birth_date),
   CASE WHEN include_owner THEN jsonb_build_object('name',c.name,'email',g.recipient_email) END
 INTO patient_info,owner_info FROM public.guardians g JOIN public.patients p ON
   (p.organization_id,p.clinic_id,p.id)=(g.organization_id,g.clinic_id,g.patient_id)
 JOIN public.owner_contacts c ON (c.organization_id,c.clinic_id,c.id)=(g.organization_id,g.clinic_id,g.contact_id)
 WHERE (g.organization_id,g.clinic_id,g.patient_id,g.pet_id)=(org,clinic,patient,pet) AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)
 ORDER BY g.id LIMIT 1;
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',CASE WHEN e.addendum_to IS NOT NULL THEN 'addendum' ELSE 'encounter' END,
 'occurredAt',vetx_care.utc(e.occurred_at),'recordedAt',vetx_care.utc(e.recorded_at),'author', jsonb_build_object('issuer',e.author_issuer,'subject',e.author_subject),
 'data',jsonb_build_object('reason',e.reason,'subjective',e.subjective,'objective',e.objective,'assessment',e.assessment,'plan',e.plan)||
 CASE WHEN e.addendum_to IS NOT NULL THEN jsonb_build_object('addendumTo',e.addendum_to) ELSE '{}'::jsonb END)
 ORDER BY e.id),'[]'::jsonb) INTO note_rows FROM public.clinical_encounters e
 WHERE (e.organization_id,e.clinic_id,e.patient_id)=(org,clinic,patient) AND e.id=ANY(notes) AND vetx_care.released(org,clinic,patient,e.id,pet);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.asset_id,'objectId',d.id,'title',d.title,'mediaType',d.media_type,'byteLength',d.byte_length,'sha256',d.sha256,
 'recordedAt',vetx_care.utc(d.recorded_at),'author',jsonb_build_object('issuer',d.uploader_issuer,'subject',d.uploader_subject)) ORDER BY d.asset_id),'[]'::jsonb)
 INTO file_rows FROM public.medical_documents d WHERE (d.organization_id,d.clinic_id,d.patient_id)=(org,clinic,patient) AND d.asset_id=ANY(files) AND vetx_documents.released(d,pet);
 IF jsonb_array_length(note_rows)<>cardinality(notes) OR jsonb_array_length(file_rows)<>cardinality(files) THEN RETURN '{"error":"not_found"}'; END IF;
 RETURN jsonb_build_object('patient',patient_info,'notes',note_rows,'files',file_rows)||CASE WHEN include_owner THEN jsonb_build_object('owner',owner_info) ELSE '{}'::jsonb END;
END $$;
REVOKE ALL ON FUNCTION public.exchange_owner_source(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_owner_source(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean) TO vetx_runtime;

CREATE FUNCTION public.exchange_owner_locations(pet uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
 WITH locations AS (
  SELECT DISTINCT g.organization_id,g.clinic_id,g.patient_id,c.name AS clinic,o.name AS org FROM public.guardians g
  JOIN public.clinics c ON (c.organization_id,c.id)=(g.organization_id,g.clinic_id)
  JOIN public.organizations o ON o.id=g.organization_id
  WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject))
 SELECT jsonb_build_object('sources',coalesce(jsonb_agg(jsonb_build_object('organizationId',organization_id,'clinicId',clinic_id,
 'patientId',patient_id,'organizationName',org,'clinicName',clinic) ORDER BY org,clinic,organization_id,clinic_id,patient_id),'[]')) INTO result FROM locations;
 IF jsonb_array_length(result->'sources')=0 THEN RETURN '{"error":"not_found"}'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.exchange_owner_choices(pet uuid,org uuid,clinic uuid,patient uuid,page_num int) RETURNS jsonb
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
 ), matches AS (SELECT * FROM released ORDER BY stamp DESC,kind,id LIMIT 26 OFFSET (page_num::bigint-1)*25),
 entries AS (SELECT * FROM matches ORDER BY stamp DESC,kind,id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM matches),'records',coalesce(jsonb_agg(jsonb_build_object(
 'id',id,'kind',kind,'title',title,'occurredAt',vetx_care.utc(stamp)) ORDER BY stamp DESC,kind,id),'[]')) INTO result FROM entries;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.exchange_owner_locations(uuid),public.exchange_owner_choices(uuid,uuid,uuid,uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_owner_locations(uuid),public.exchange_owner_choices(uuid,uuid,uuid,uuid,int) TO vetx_runtime;

CREATE TABLE public.exchange_export_events (
  package_id uuid PRIMARY KEY, organization_id uuid NOT NULL, clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL, pet_id uuid NOT NULL, destination_organization_id uuid NOT NULL,
  destination_clinic_id uuid NOT NULL, encounter_ids uuid[] NOT NULL, asset_ids uuid[] NOT NULL,
  include_owner boolean NOT NULL, actor_issuer text NOT NULL, actor_subject text NOT NULL,
  recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id,clinic_id,patient_id) REFERENCES public.patients(organization_id,clinic_id,id)
);
ALTER TABLE public.exchange_export_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_export_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.exchange_export_events FROM PUBLIC, vetx_runtime;
CREATE POLICY owner_export_audit ON public.exchange_export_events FOR INSERT TO vetx_migration
WITH CHECK (vetx_registry.self(actor_issuer,actor_subject) AND EXISTS (
 SELECT FROM public.guardians g WHERE (g.organization_id,g.clinic_id,g.patient_id,g.pet_id)=
 (exchange_export_events.organization_id,exchange_export_events.clinic_id,exchange_export_events.patient_id,exchange_export_events.pet_id)
 AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)
));
CREATE FUNCTION public.export_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN LOCK TABLE public.exchange_export_events IN ACCESS SHARE MODE; RETURN true; END $$;
CREATE FUNCTION public.exchange_confirm_export(pet uuid,org uuid,clinic uuid,patient uuid,notes uuid[],files uuid[],include_owner boolean,
 destination_org uuid,destination_clinic uuid,package uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
 IF num_nonnulls(destination_org,destination_clinic,package)<>3 OR (org,clinic)=(destination_org,destination_clinic)
 THEN RETURN '{"error":"invalid"}'; END IF;
 snapshot:=public.exchange_owner_source(pet,org,clinic,patient,notes,files,include_owner);
 IF snapshot ? 'error' THEN RETURN snapshot; END IF;
 INSERT INTO public.exchange_export_events(package_id,organization_id,clinic_id,patient_id,pet_id,destination_organization_id,destination_clinic_id,
 encounter_ids,asset_ids,include_owner,actor_issuer,actor_subject)
 VALUES (package,org,clinic,patient,pet,destination_org,destination_clinic,notes,files,include_owner,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'));
 RETURN '{"ok":true}';
END $$;
REVOKE ALL ON FUNCTION public.export_lock_tables(),public.exchange_confirm_export(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_lock_tables(),public.exchange_confirm_export(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid,uuid,uuid) TO vetx_runtime;
COMMIT;
