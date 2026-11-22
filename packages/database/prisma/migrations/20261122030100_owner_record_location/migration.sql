-- Patient record identifiers are local to a clinic. Include the authorized source clinic in the projection.
CREATE OR REPLACE FUNCTION public.registry_owner_pets() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
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
      jsonb_agg(jsonb_build_object('recordId',id,'clinicId',clinic_id,'clinicName',clinic,'organizationName',organization)
        ORDER BY organization,clinic,org_id,clinic_id,id) AS clinics FROM records GROUP BY pet_id
  )
  SELECT jsonb_build_object('pets',coalesce(jsonb_agg(jsonb_build_object('id',pet_id,'name',name,'species',species,'clinics',clinics)
    ORDER BY lower(name),pet_id),'[]')) INTO result FROM pets;
  RETURN result;
END
$$;
