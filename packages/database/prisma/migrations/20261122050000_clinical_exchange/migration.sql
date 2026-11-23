BEGIN;

-- The verified manifest is attachment-free. Its immutable archive is addressed by
-- destination and SHA-256 in object storage. Package IDs belong to the sending clinic.
CREATE TABLE public.exchange_packages (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_organization_id uuid NOT NULL,
  source_clinic_id uuid NOT NULL,
  source_package_id uuid NOT NULL,
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length > 0),
  manifest jsonb NOT NULL,
  record_digests jsonb NOT NULL,
  PRIMARY KEY (organization_id, clinic_id, id),
  CONSTRAINT exchange_package_source UNIQUE (organization_id, clinic_id, source_organization_id, source_clinic_id, source_package_id),
  FOREIGN KEY (organization_id, clinic_id) REFERENCES public.clinics(organization_id, id)
);

CREATE TABLE public.exchange_receipts (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  actor_issuer text NOT NULL,
  actor_subject text NOT NULL,
  staged_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, clinic_id, id),
  CONSTRAINT exchange_operator_receipt UNIQUE (organization_id, clinic_id, package_id, actor_issuer, actor_subject),
  FOREIGN KEY (organization_id, clinic_id, package_id) REFERENCES public.exchange_packages(organization_id, clinic_id, id)
);

CREATE TABLE public.exchange_patients (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  source_organization_id uuid NOT NULL,
  source_clinic_id uuid NOT NULL,
  source_patient_id uuid NOT NULL,
  PRIMARY KEY (organization_id, clinic_id, id),
  CONSTRAINT exchange_source_patient UNIQUE (organization_id, clinic_id, source_organization_id, source_clinic_id, source_patient_id),
  FOREIGN KEY (organization_id, clinic_id, patient_id) REFERENCES public.patients(organization_id, clinic_id, id)
);
CREATE INDEX exchange_patients_local ON public.exchange_patients(organization_id, clinic_id, patient_id);

-- One append-only audit entry per committed package. The receipt attributes
-- the operation to its operator. No clinical text or owner details enter this table.
CREATE TABLE public.exchange_imports (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  package_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  mapping_id uuid NOT NULL,
  choice text NOT NULL CHECK (choice IN ('create','match')),
  inserted_count integer NOT NULL CHECK (inserted_count >= 0),
  skipped_count integer NOT NULL CHECK (skipped_count >= 0),
  imported_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, clinic_id, package_id),
  FOREIGN KEY (organization_id, clinic_id, package_id) REFERENCES public.exchange_packages(organization_id, clinic_id, id),
  FOREIGN KEY (organization_id, clinic_id, receipt_id) REFERENCES public.exchange_receipts(organization_id, clinic_id, id),
  FOREIGN KEY (organization_id, clinic_id, mapping_id) REFERENCES public.exchange_patients(organization_id, clinic_id, id)
);

CREATE TABLE public.exchange_records (
  organization_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL,
  package_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (organization_id, clinic_id, id),
  CONSTRAINT exchange_record_source UNIQUE (organization_id, clinic_id, mapping_id, source_record_id),
  FOREIGN KEY (organization_id, clinic_id, mapping_id) REFERENCES public.exchange_patients(organization_id, clinic_id, id),
  FOREIGN KEY (organization_id, clinic_id, package_id) REFERENCES public.exchange_imports(organization_id, clinic_id, package_id),
  CHECK (record->>'kind' NOT IN ('document','radiograph','dicom') OR NOT ((record->'data') ? 'content'))
);
CREATE INDEX exchange_records_chronology ON public.exchange_records(organization_id, clinic_id, mapping_id, occurred_at DESC, id);

-- All exchange rows are insert-only. The runtime can only call the public
-- entry points below. FORCE RLS also applies to their NOBYPASSRLS owner.
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['exchange_packages','exchange_receipts','exchange_patients','exchange_imports','exchange_records'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation);
    EXECUTE format('CREATE POLICY read_clinic ON public.%I FOR SELECT TO vetx_migration USING (vetx_registry.staff_access(organization_id, clinic_id))', relation);
    IF relation = 'exchange_receipts' THEN
      EXECUTE format('CREATE POLICY append_clinic ON public.%I FOR INSERT TO vetx_migration WITH CHECK (vetx_registry.staff_access(organization_id, clinic_id) AND actor_issuer=current_setting(''vetx.identity_issuer'') AND actor_subject=current_setting(''vetx.identity_subject''))', relation);
    ELSE
      EXECUTE format('CREATE POLICY append_clinic ON public.%I FOR INSERT TO vetx_migration WITH CHECK (vetx_registry.staff_access(organization_id, clinic_id))', relation);
    END IF;
  END LOOP;
END
$$;

CREATE FUNCTION public.exchange_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  LOCK TABLE public.exchange_packages, public.exchange_receipts, public.exchange_patients, public.exchange_imports, public.exchange_records IN ACCESS SHARE MODE;
  RETURN true;
END
$$;

CREATE FUNCTION public.exchange_stage(payload jsonb, archive_hash text, archive_size integer, digests jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  org uuid := vetx_directory.organization_id();
  clinic uuid := vetx_registry.clinic_id();
  issuer text := current_setting('vetx.identity_issuer',true);
  subject text := current_setting('vetx.identity_subject',true);
  sender_org uuid; sender_clinic uuid; sender_package uuid; sender_patient uuid;
  pkg public.exchange_packages;
  receipt uuid; mapped uuid; committed uuid; candidates jsonb; total integer;
BEGIN
  -- clinic_access(true) takes the same organization lock as grant changes and
  -- other clinic writes. Its second permission check also covers waiting writers.
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF (payload#>>'{destination,organizationId}',payload#>>'{destination,clinicId}') IS DISTINCT FROM (org::text,clinic::text)
    THEN RETURN '{"error":"forbidden"}'; END IF;
  sender_org := (payload#>>'{source,organizationId}')::uuid;
  sender_clinic := (payload#>>'{source,clinicId}')::uuid;
  sender_package := (payload->>'packageId')::uuid;
  sender_patient := (payload#>>'{patient,id}')::uuid;
  IF num_nonnulls(sender_org,sender_clinic,sender_package,sender_patient,archive_size,archive_hash)<>6
    OR payload->'version' IS DISTINCT FROM '1'::jsonb
    OR archive_size<1 OR archive_hash !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(digests) IS DISTINCT FROM 'object'
    OR jsonb_typeof(payload->'records') IS DISTINCT FROM 'array'
    THEN RETURN '{"error":"invalid"}'; END IF;
  total := jsonb_array_length(payload->'records');
  IF (SELECT count(*) FROM jsonb_object_keys(digests)) <> total
    OR (SELECT count(DISTINCT (r->>'id')::uuid) FROM jsonb_array_elements(payload->'records') r) <> total
    OR EXISTS (SELECT FROM jsonb_array_elements(payload->'records') r WHERE
      coalesce(digests->>(r->>'id'),'') !~ '^[0-9a-f]{64}$' OR
      (r->>'kind' IN ('document','radiograph','dicom') AND (r->'data') ? 'content'))
    THEN RETURN '{"error":"invalid"}'; END IF;
  SELECT * INTO pkg FROM public.exchange_packages
    WHERE (organization_id,clinic_id,source_organization_id,source_clinic_id,source_package_id)=(org,clinic,sender_org,sender_clinic,sender_package);
  IF FOUND THEN
    IF (pkg.archive_sha256,pkg.byte_length,pkg.manifest,pkg.record_digests) IS DISTINCT FROM (archive_hash,archive_size,payload,digests)
      THEN RETURN '{"error":"conflict"}'; END IF;
  ELSE
    INSERT INTO public.exchange_packages(organization_id,clinic_id,source_organization_id,source_clinic_id,source_package_id,archive_sha256,byte_length,manifest,record_digests)
      VALUES(org,clinic,sender_org,sender_clinic,sender_package,archive_hash,archive_size,payload,digests) RETURNING * INTO pkg;
  END IF;
  SELECT id INTO receipt FROM public.exchange_receipts
    WHERE (organization_id,clinic_id,package_id,actor_issuer,actor_subject)=(org,clinic,pkg.id,issuer,subject);
  IF NOT FOUND THEN
    INSERT INTO public.exchange_receipts(organization_id,clinic_id,package_id,actor_issuer,actor_subject)
      VALUES(org,clinic,pkg.id,issuer,subject) RETURNING id INTO receipt;
  END IF;
  SELECT patient_id INTO mapped FROM public.exchange_patients
    WHERE (organization_id,clinic_id,source_organization_id,source_clinic_id,source_patient_id)=(org,clinic,sender_org,sender_clinic,sender_patient);
  IF EXISTS (SELECT FROM public.exchange_imports WHERE (organization_id,clinic_id,package_id)=(org,clinic,pkg.id))
    THEN committed := mapped; END IF;
  SELECT coalesce(jsonb_agg(vetx_registry.patient_summary(m.p) ORDER BY m.bound DESC, (m.p).id),'[]') INTO candidates
    FROM (SELECT p, p.id IS NOT DISTINCT FROM mapped AS bound FROM public.patients p
      WHERE (p.organization_id,p.clinic_id)=(org,clinic) AND (p.id=mapped OR (
        lower(p.name)=lower(btrim(payload#>>'{patient,name}')) AND lower(p.species)=lower(btrim(payload#>>'{patient,species}'))
        AND (payload#>>'{patient,birthDate}' IS NULL OR p.birth_date IS NULL OR p.birth_date=(payload#>>'{patient,birthDate}')::date)))
      ORDER BY bound DESC, p.id LIMIT 25) m;
  RETURN jsonb_build_object('receiptId',receipt,'packageId',sender_package,'source',payload->'source',
    'patient',payload->'patient','recordCount',total,'candidates',candidates,'mappedPatientId',mapped,'committedPatientId',committed)
    || CASE WHEN payload ? 'owner' THEN jsonb_build_object('owner',payload->'owner') ELSE '{}'::jsonb END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RETURN '{"error":"invalid"}';
END
$$;

CREATE FUNCTION public.exchange_receipt(receipt uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id(); result jsonb;
BEGIN
  IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  SELECT jsonb_build_object('archiveSha256',p.archive_sha256,'byteLength',p.byte_length,'packageId',p.source_package_id)
    INTO result FROM public.exchange_receipts r JOIN public.exchange_packages p
    ON (p.organization_id,p.clinic_id,p.id)=(r.organization_id,r.clinic_id,r.package_id)
    WHERE (r.organization_id,r.clinic_id,r.id,r.actor_issuer,r.actor_subject)=
      (org,clinic,receipt,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'));
  RETURN coalesce(result,'{"error":"not_found"}');
END
$$;

CREATE FUNCTION public.exchange_commit(receipt uuid, decision text, chosen_patient uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  org uuid := vetx_directory.organization_id();
  clinic uuid := vetx_registry.clinic_id();
  pkg public.exchange_packages; mapping public.exchange_patients; done public.exchange_imports;
  patient uuid; sender_patient uuid; saved jsonb; known integer; added integer; changed boolean;
BEGIN
  IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF decision IS NULL OR decision NOT IN ('create','match') OR (decision='match')<>(chosen_patient IS NOT NULL)
    THEN RETURN '{"error":"invalid"}'; END IF;
  SELECT p.* INTO pkg FROM public.exchange_receipts r JOIN public.exchange_packages p
    ON (p.organization_id,p.clinic_id,p.id)=(r.organization_id,r.clinic_id,r.package_id)
    WHERE (r.organization_id,r.clinic_id,r.id,r.actor_issuer,r.actor_subject)=
      (org,clinic,receipt,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'));
  IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
  sender_patient := (pkg.manifest#>>'{patient,id}')::uuid;
  SELECT * INTO mapping FROM public.exchange_patients
    WHERE (organization_id,clinic_id,source_organization_id,source_clinic_id,source_patient_id)=
      (org,clinic,pkg.source_organization_id,pkg.source_clinic_id,sender_patient);
  SELECT * INTO done FROM public.exchange_imports WHERE (organization_id,clinic_id,package_id)=(org,clinic,pkg.id);
  IF FOUND THEN
    IF (decision='match' AND chosen_patient=mapping.patient_id)
      OR (decision='create' AND done.choice='create' AND done.receipt_id=receipt) THEN
      RETURN jsonb_build_object('packageId',pkg.source_package_id,'patientId',mapping.patient_id,'inserted',done.inserted_count,'skipped',done.skipped_count);
    END IF;
    RETURN '{"error":"conflict"}';
  END IF;
  IF mapping.id IS NOT NULL AND (decision='create' OR chosen_patient<>mapping.patient_id)
    THEN RETURN '{"error":"conflict"}'; END IF;
  IF decision='match' AND NOT EXISTS (SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,chosen_patient))
    THEN RETURN '{"error":"not_found"}'; END IF;

  -- Check the entire package before creating a patient or importing any record.
  -- Different packages received concurrently see earlier commits under the clinic lock.
  SELECT count(*),coalesce(bool_or((r.digest,r.record) IS DISTINCT FROM (pkg.record_digests->>(item->>'id'),item)),false)
    INTO known,changed FROM jsonb_array_elements(pkg.manifest->'records') item JOIN public.exchange_records r
    ON (r.organization_id,r.clinic_id,r.mapping_id,r.source_record_id)=(org,clinic,mapping.id,(item->>'id')::uuid);
  IF changed THEN RETURN '{"error":"conflict"}'; END IF;
  added := jsonb_array_length(pkg.manifest->'records')-known;

  IF mapping.id IS NULL THEN
    patient := chosen_patient;
    IF decision='create' THEN
      patient := gen_random_uuid();
      saved := public.registry_save_patient(patient,pkg.manifest#>>'{patient,name}',pkg.manifest#>>'{patient,species}',pkg.manifest#>>'{patient,birthDate}',0);
      IF saved ? 'error' THEN RETURN saved; END IF;
    END IF;
    INSERT INTO public.exchange_patients(organization_id,clinic_id,patient_id,source_organization_id,source_clinic_id,source_patient_id)
      VALUES(org,clinic,patient,pkg.source_organization_id,pkg.source_clinic_id,sender_patient) RETURNING * INTO mapping;
  END IF;
  INSERT INTO public.exchange_imports(organization_id,clinic_id,package_id,receipt_id,mapping_id,choice,inserted_count,skipped_count)
    VALUES(org,clinic,pkg.id,receipt,mapping.id,decision,added,known);
  INSERT INTO public.exchange_records(organization_id,clinic_id,mapping_id,package_id,source_record_id,digest,occurred_at,record)
    SELECT org,clinic,mapping.id,pkg.id,(item->>'id')::uuid,pkg.record_digests->>(item->>'id'),(item->>'occurredAt')::timestamptz,item
    FROM jsonb_array_elements(pkg.manifest->'records') item WHERE NOT EXISTS (
      SELECT FROM public.exchange_records r WHERE (r.organization_id,r.clinic_id,r.mapping_id,r.source_record_id)=(org,clinic,mapping.id,(item->>'id')::uuid)
    );
  RETURN jsonb_build_object('packageId',pkg.source_package_id,'patientId',mapping.patient_id,'inserted',added,'skipped',known);
END
$$;

CREATE FUNCTION public.exchange_records_list(patient uuid, page integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id(); result jsonb;
BEGIN
  IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
  IF NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient))
    THEN RETURN '{"error":"not_found"}'; END IF;
  WITH matches AS MATERIALIZED (
    SELECT r.id,r.occurred_at,r.record || jsonb_build_object(
      'importedId',r.id,'packageId',p.source_package_id,'importedAt',vetx_care.utc(i.imported_at),
      'source',jsonb_build_object('organizationId',m.source_organization_id,'clinicId',m.source_clinic_id,'patientId',m.source_patient_id)
    ) AS entry FROM public.exchange_patients m
    JOIN public.exchange_records r ON (r.organization_id,r.clinic_id,r.mapping_id)=(m.organization_id,m.clinic_id,m.id)
    JOIN public.exchange_imports i ON (i.organization_id,i.clinic_id,i.package_id)=(r.organization_id,r.clinic_id,r.package_id)
    JOIN public.exchange_packages p ON (p.organization_id,p.clinic_id,p.id)=(r.organization_id,r.clinic_id,r.package_id)
    WHERE (m.organization_id,m.clinic_id,m.patient_id)=(org,clinic,patient)
    ORDER BY r.occurred_at DESC,r.id LIMIT 26 OFFSET ((page::bigint-1)*25)
  ), visible AS (SELECT * FROM matches ORDER BY occurred_at DESC,id LIMIT 25)
  SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),
    'records',coalesce(jsonb_agg(entry ORDER BY occurred_at DESC,id),'[]')) INTO result FROM visible;
  RETURN result;
END
$$;

CREATE FUNCTION public.exchange_attachment(patient uuid, imported uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid := vetx_directory.organization_id(); clinic uuid := vetx_registry.clinic_id(); result jsonb;
BEGIN
  IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
  SELECT jsonb_build_object('packageId',p.source_package_id,'archiveSha256',p.archive_sha256,'byteLength',p.byte_length,
    'recordId',r.source_record_id,'kind',r.record->>'kind',
    'source',jsonb_build_object('organizationId',m.source_organization_id,'clinicId',m.source_clinic_id,'patientId',m.source_patient_id))
    INTO result FROM public.exchange_records r
    JOIN public.exchange_patients m ON (m.organization_id,m.clinic_id,m.id)=(r.organization_id,r.clinic_id,r.mapping_id)
    JOIN public.exchange_packages p ON (p.organization_id,p.clinic_id,p.id)=(r.organization_id,r.clinic_id,r.package_id)
    WHERE (r.organization_id,r.clinic_id,r.id,m.patient_id)=(org,clinic,imported,patient)
      AND r.record->>'kind' IN ('document','radiograph','dicom');
  RETURN coalesce(result,'{"error":"not_found"}');
END
$$;

REVOKE ALL ON FUNCTION public.exchange_lock_tables(),public.exchange_stage(jsonb,text,integer,jsonb),public.exchange_receipt(uuid),public.exchange_commit(uuid,text,uuid),
  public.exchange_records_list(uuid,integer),public.exchange_attachment(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_lock_tables(),public.exchange_stage(jsonb,text,integer,jsonb),public.exchange_receipt(uuid),public.exchange_commit(uuid,text,uuid),
  public.exchange_records_list(uuid,integer),public.exchange_attachment(uuid,uuid) TO vetx_runtime;

COMMIT;
