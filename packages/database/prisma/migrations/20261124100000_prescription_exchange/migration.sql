BEGIN;
ALTER TABLE public.exchange_export_events ADD COLUMN prescription_ids uuid[] NOT NULL DEFAULT '{}';

CREATE FUNCTION public.exchange_owner_source(pet uuid,org uuid,clinic uuid,patient uuid,notes uuid[],files uuid[],include_owner boolean,versions uuid[],prescriptions uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE snapshot jsonb; records jsonb;
BEGIN
 snapshot:=public.exchange_owner_source(pet,org,clinic,patient,notes,files,include_owner,versions);
 IF snapshot ? 'error' THEN RETURN snapshot; END IF;
 IF prescriptions IS NULL OR cardinality(prescriptions)<>(SELECT count(DISTINCT v) FROM unnest(prescriptions) v) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind','prescription','occurredAt',vetx_care.utc(r.recorded_at),'recordedAt',vetx_care.utc(r.recorded_at),
  'author',jsonb_build_object('issuer',r.actor_issuer,'subject',r.actor_subject),'data',jsonb_build_object('medication',r.medication,'instructions',r.instructions,'quantity',r.quantity::text,'unit',r.unit)) ORDER BY r.id),'[]')
 INTO records FROM public.patient_prescriptions r WHERE (r.organization_id,r.clinic_id,r.patient_id)=(org,clinic,patient) AND r.id=ANY(prescriptions)
 AND vetx_trade.released(org,clinic,patient,r.id,pet);
 IF jsonb_array_length(records)<>cardinality(prescriptions) THEN RETURN '{"error":"not_found"}'; END IF;
 RETURN snapshot||jsonb_build_object('prescriptions',records);
END $$;

CREATE FUNCTION public.exchange_confirm_export(pet uuid,org uuid,clinic uuid,patient uuid,notes uuid[],files uuid[],include_owner boolean,
 destination_org uuid,destination_clinic uuid,package uuid,versions uuid[],prescriptions uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
 IF num_nonnulls(destination_org,destination_clinic,package)<>3 OR (org,clinic)=(destination_org,destination_clinic) THEN RETURN '{"error":"invalid"}'; END IF;
 snapshot:=public.exchange_owner_source(pet,org,clinic,patient,notes,files,include_owner,versions,prescriptions);
 IF snapshot ? 'error' THEN RETURN snapshot; END IF;
 INSERT INTO public.exchange_export_events(package_id,organization_id,clinic_id,patient_id,pet_id,destination_organization_id,destination_clinic_id,
 encounter_ids,asset_ids,include_owner,actor_issuer,actor_subject,clinical_revision_ids,prescription_ids)
 VALUES(package,org,clinic,patient,pet,destination_org,destination_clinic,notes,files,include_owner,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'),versions,prescriptions);
 RETURN '{"ok":true}';
END $$;
REVOKE ALL ON FUNCTION public.exchange_owner_source(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid[],uuid[]),public.exchange_confirm_export(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid,uuid,uuid,uuid[],uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_owner_source(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid[],uuid[]),public.exchange_confirm_export(uuid,uuid,uuid,uuid,uuid[],uuid[],boolean,uuid,uuid,uuid,uuid[],uuid[]) TO vetx_runtime;

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
 UNION ALL
 SELECT r.id,'prescription',r.medication,r.recorded_at FROM public.patient_prescriptions r
 WHERE (r.organization_id,r.clinic_id,r.patient_id)=(org,clinic,patient) AND vetx_trade.released(org,clinic,patient,r.id,pet)
 ), matches AS (SELECT * FROM released ORDER BY stamp DESC,kind,id LIMIT 26 OFFSET (page_num::bigint-1)*25),
 entries AS (SELECT * FROM matches ORDER BY stamp DESC,kind,id LIMIT 25)
 SELECT jsonb_build_object('page',page_num,'hasNextPage',(SELECT count(*)>25 FROM matches),'records',coalesce(jsonb_agg(jsonb_build_object(
 'id',id,'kind',kind,'title',title,'occurredAt',vetx_care.utc(stamp)) ORDER BY stamp DESC,kind,id),'[]')) INTO result FROM entries;
 RETURN result;
END $$;
COMMIT;
