BEGIN;
CREATE SCHEMA vetx_fiscal;
REVOKE ALL ON SCHEMA vetx_fiscal FROM PUBLIC;

-- An operator provisions the issuer and its next consecutive number after onboarding.
CREATE TABLE public.fiscal_profiles (
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 issuer_number text NOT NULL CHECK(issuer_number ~ '^[0-9]{1,12}$'), branch text NOT NULL CHECK(branch ~ '^[0-9]{3}$'),
 terminal text NOT NULL CHECK(terminal ~ '^[0-9]{5}$'), profile jsonb NOT NULL, enabled boolean NOT NULL,
 next_number bigint NOT NULL CHECK(next_number BETWEEN 1 AND 10000000000),
 PRIMARY KEY(organization_id,clinic_id,environment),
 UNIQUE(environment,issuer_number,branch,terminal),
 FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id)
);
CREATE TABLE public.fiscal_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,clinic_id uuid NOT NULL,sale_id uuid NOT NULL,environment text NOT NULL,
 request jsonb NOT NULL,snapshot jsonb NOT NULL,document_key text NOT NULL CHECK(document_key ~ '^[0-9]{50}$'),
 actor_issuer text NOT NULL,actor_subject text NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','signed','sending','submitted','processing','accepted','rejected','invalid','blocked')),
 last_issue text, signed_xml bytea, receipt_xml bytea, lease uuid,lease_until timestamptz, next_attempt timestamptz NOT NULL DEFAULT clock_timestamp(), attempts int NOT NULL DEFAULT 0,
 UNIQUE(organization_id,clinic_id,sale_id,environment), UNIQUE(environment,document_key),
 FOREIGN KEY(organization_id,clinic_id,environment) REFERENCES public.fiscal_profiles(organization_id,clinic_id,environment),
 FOREIGN KEY(organization_id,clinic_id,sale_id) REFERENCES public.billing_sales(organization_id,clinic_id,id),
 CHECK ((lease IS NULL)=(lease_until IS NULL)),
 CHECK (state NOT IN ('signed','sending','submitted','processing','accepted','rejected') OR signed_xml IS NOT NULL)
);
CREATE INDEX fiscal_queue ON public.fiscal_invoices(environment,next_attempt,id)
 WHERE state IN ('pending','signed','sending','submitted','processing') OR (state IN ('accepted','rejected') AND receipt_xml IS NULL);
CREATE TABLE public.fiscal_events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL,clinic_id uuid NOT NULL,invoice_id uuid NOT NULL REFERENCES public.fiscal_invoices(id),
 state text NOT NULL,issue text,at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.fiscal_profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.fiscal_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_invoices ENABLE ROW LEVEL SECURITY; ALTER TABLE public.fiscal_invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.fiscal_events FORCE ROW LEVEL SECURITY;
CREATE FUNCTION vetx_fiscal.dispatcher() RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(pg_has_role(session_user,to_regrole('vetx_fiscal_worker'),'MEMBER'),false)
$$;
CREATE POLICY scope ON public.fiscal_profiles TO vetx_migration USING (vetx_fiscal.dispatcher() OR vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY scope ON public.fiscal_invoices TO vetx_migration USING (vetx_fiscal.dispatcher() OR vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY read ON public.fiscal_events FOR SELECT TO vetx_migration USING (vetx_fiscal.dispatcher() OR vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY append ON public.fiscal_events FOR INSERT TO vetx_migration WITH CHECK (vetx_fiscal.dispatcher() OR vetx_registry.staff_access(organization_id,clinic_id));
REVOKE ALL ON public.fiscal_profiles,public.fiscal_invoices,public.fiscal_events FROM PUBLIC,vetx_runtime;

CREATE FUNCTION vetx_fiscal.status(i public.fiscal_invoices) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',i.id,'saleId',i.sale_id,'environment',i.environment,'key',i.document_key,'state',i.state,'issue',i.last_issue,
 'createdAt',i.created_at,'hasSignedXml',i.signed_xml IS NOT NULL,'hasReceipt',i.receipt_xml IS NOT NULL)
$$;
CREATE FUNCTION vetx_fiscal.event(i public.fiscal_invoices) RETURNS void LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO public.fiscal_events(organization_id,clinic_id,invoice_id,state,issue) VALUES(i.organization_id,i.clinic_id,i.id,i.state,i.last_issue)
$$;

CREATE FUNCTION public.fiscal_provision(org uuid,clinic uuid,env text,settings jsonb,starting_number bigint,active boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE issuer text:=settings #>> '{issuer,identity,number}'; existing public.fiscal_profiles;
BEGIN
 IF NOT vetx_fiscal.dispatcher() OR env NOT IN ('production','sandbox') OR jsonb_typeof(settings) IS DISTINCT FROM 'object'
 OR num_nonnulls(org,clinic,env,issuer,settings->>'branch',settings->>'terminal',settings->>'providerId',settings->>'issuerActivity',active,starting_number)<>10
 OR starting_number NOT BETWEEN 1 AND 9999999999 THEN RAISE EXCEPTION 'Invalid fiscal profile'; END IF;
 -- Validate public issuer fields before enabling a series. Disabling a legacy
 -- profile remains possible even if its recorded address needs correction.
 IF active AND (
    jsonb_typeof(settings #> '{issuer,name}') IS DISTINCT FROM 'string'
    OR char_length(settings #>> '{issuer,name}') NOT BETWEEN 5 AND 100
    OR NOT vetx_stock.label(settings #>> '{issuer,name}',100)
    OR jsonb_typeof(settings #> '{issuer,address,details}') IS DISTINCT FROM 'string'
    OR char_length(settings #>> '{issuer,address,details}') NOT BETWEEN 5 AND 250
    OR NOT vetx_stock.label(settings #>> '{issuer,address,details}',250)
 ) THEN RAISE EXCEPTION 'Invalid fiscal profile'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||clinic::text||env,0));
 SELECT * INTO existing FROM public.fiscal_profiles WHERE (organization_id,clinic_id,environment)=(org,clinic,env) FOR UPDATE;
 IF FOUND THEN
   IF (existing.issuer_number,existing.branch,existing.terminal) IS DISTINCT FROM (issuer,settings->>'branch',settings->>'terminal') THEN RAISE EXCEPTION 'Fiscal series is in use'; END IF;
   UPDATE public.fiscal_profiles SET profile=settings,enabled=active WHERE (organization_id,clinic_id,environment)=(org,clinic,env);
 ELSE
   INSERT INTO public.fiscal_profiles(organization_id,clinic_id,environment,issuer_number,branch,terminal,profile,enabled,next_number)
   VALUES(org,clinic,env,issuer,settings->>'branch',settings->>'terminal',settings,active,starting_number);
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.fiscal_get_status(sale uuid,env text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id();i public.fiscal_invoices; active boolean;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF env IS NULL OR env NOT IN('sandbox','production') THEN RETURN '{"error":"invalid"}';END IF;
 IF NOT EXISTS(SELECT FROM public.billing_sales b WHERE (b.organization_id,b.clinic_id,b.id)=(org,clinic,sale)) THEN RETURN '{"error":"not_found"}';END IF;
 SELECT p.enabled INTO active FROM public.fiscal_profiles p WHERE (p.organization_id,p.clinic_id,p.environment)=(org,clinic,env);
 SELECT * INTO i FROM public.fiscal_invoices WHERE (organization_id,clinic_id,sale_id,environment)=(org,clinic,sale,env);
 RETURN jsonb_build_object('enabled',coalesce(active,false),'invoice',CASE WHEN i.id IS NOT NULL THEN vetx_fiscal.status(i) END);
END $$;
CREATE FUNCTION public.fiscal_artifact(sale uuid,env text,kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id();i public.fiscal_invoices;body bytea;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}';END IF;
 IF kind IS NULL OR kind NOT IN('invoice','receipt') THEN RETURN '{"error":"invalid"}';END IF;
 SELECT * INTO i FROM public.fiscal_invoices WHERE (organization_id,clinic_id,sale_id,environment)=(org,clinic,sale,env);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}';END IF;
 body:=CASE WHEN kind='invoice' THEN i.signed_xml ELSE i.receipt_xml END;
 IF body IS NULL THEN RETURN '{"error":"not_found"}';END IF;
 RETURN jsonb_build_object('key',i.document_key,'body',replace(encode(body,'base64'),chr(10),''));
END $$;
CREATE FUNCTION public.fiscal_request(sale uuid,env text,draft jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id();i public.fiscal_invoices;p public.fiscal_profiles;s public.billing_sales;
 actor_iss text:=current_setting('vetx.identity_issuer',true);actor_sub text:=current_setting('vetx.identity_subject',true);
 moment timestamptz:=clock_timestamp();local_time timestamp;seq text;k text;frozen jsonb;lines jsonb;paid jsonb;security_code text;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}';END IF;
 IF env IS NULL OR env NOT IN ('sandbox','production') OR jsonb_typeof(draft) IS DISTINCT FROM 'object' THEN RETURN '{"error":"invalid"}';END IF;
 SELECT * INTO i FROM public.fiscal_invoices WHERE (organization_id,clinic_id,sale_id,environment)=(org,clinic,sale,env);
 IF FOUND THEN
   IF (i.request,i.actor_issuer,i.actor_subject) IS DISTINCT FROM (draft,actor_iss,actor_sub) THEN RETURN '{"error":"conflict"}';END IF;
   RETURN jsonb_build_object('invoice',vetx_fiscal.status(i),'snapshot',i.snapshot,'created',false);
 END IF;
 SELECT * INTO s FROM public.billing_sales WHERE (organization_id,clinic_id,id)=(org,clinic,sale);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO p FROM public.fiscal_profiles WHERE (organization_id,clinic_id,environment)=(org,clinic,env) FOR UPDATE;
 IF NOT FOUND OR NOT p.enabled OR p.next_number>9999999999 THEN RETURN '{"error":"conflict"}';END IF;
 IF jsonb_typeof(draft->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(draft->'lines')<>jsonb_array_length(s.lines)
 OR jsonb_typeof(draft->'recipient') IS DISTINCT FROM 'object' OR jsonb_typeof(draft->'terms') IS DISTINCT FROM 'object'
 OR NOT vetx_billing.money(draft->>'exchangeRate') THEN RETURN '{"error":"invalid"}'; END IF;
 -- Copy amounts and clinical billing data only from the immutable sale. Classifications are explicit.
 SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('cabys',l.v->'cabys','name',l.v->'name','quantity',l.v->'quantity',
 'unitPrice',l.v->'unitPrice','taxRate',l.v->'taxRate','subtotal',l.v->'subtotal','tax',l.v->'tax','total',l.v->'total',
 'unitCode',c.v->'unitCode','category',c.v->'category','vatTariffCode',c.v->'vatTariffCode','medicine',c.v->'medicine')) ORDER BY l.n)
 INTO lines FROM jsonb_array_elements(s.lines) WITH ORDINALITY l(v,n) JOIN jsonb_array_elements(draft->'lines') WITH ORDINALITY c(v,n) USING(n);
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',v.code,'amount',v.amount::text) ORDER BY v.code),'[]') INTO paid FROM
 (SELECT CASE method WHEN 'CASH' THEN '01' WHEN 'CARD' THEN '02' WHEN 'TRANSFER' THEN '04' END AS code,sum(amount)::numeric(18,5) AS amount FROM public.billing_payments
 WHERE (organization_id,clinic_id,sale_id)=(org,clinic,sale) GROUP BY method) v;
 local_time:=moment AT TIME ZONE 'America/Costa_Rica'; seq:=p.branch||p.terminal||'01'||lpad(p.next_number::text,10,'0');
 -- gen_random_uuid supplies 32 random bits outside the version and variant fields.
 security_code:=lpad(((('x'||left(replace(gen_random_uuid()::text,'-',''),8))::bit(32)::bigint)%100000000)::text,8,'0');
 k:='506'||to_char(local_time,'DDMMYY')||lpad(p.issuer_number,12,'0')||seq||'1'||security_code;
 frozen:=jsonb_strip_nulls(jsonb_build_object('consecutive',seq,'issuedAt',to_char(local_time,'YYYY-MM-DD"T"HH24:MI:SS')||'-06:00','securityCode',security_code,
 'providerId',p.profile->'providerId','issuerActivity',p.profile->'issuerActivity','issuer',p.profile->'issuer','recipient',draft->'recipient',
 'recipientActivity',draft->'recipientActivity','terms',draft->'terms','exchangeRate',draft->'exchangeRate','currency',s.currency,'lines',lines,'payments',paid,
 'subtotal',s.subtotal::text,'tax',s.tax::text,'total',s.total::text));
 INSERT INTO public.fiscal_invoices(organization_id,clinic_id,sale_id,environment,request,snapshot,document_key,actor_issuer,actor_subject)
 VALUES(org,clinic,sale,env,draft,frozen,k,actor_iss,actor_sub) RETURNING * INTO i;
 UPDATE public.fiscal_profiles SET next_number=next_number+1 WHERE (organization_id,clinic_id,environment)=(org,clinic,env);
 PERFORM vetx_fiscal.event(i);
 RETURN jsonb_build_object('invoice',vetx_fiscal.status(i),'snapshot',i.snapshot,'created',true);
END $$;
CREATE FUNCTION public.fiscal_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN LOCK TABLE public.fiscal_profiles,public.fiscal_invoices,public.fiscal_events IN ACCESS SHARE MODE; RETURN true; END $$;
CREATE FUNCTION public.fiscal_claim(env text,duration integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i public.fiscal_invoices;
BEGIN
 IF NOT vetx_fiscal.dispatcher() OR duration IS NULL OR duration<=0 THEN RAISE EXCEPTION 'Invalid fiscal lease'; END IF;
 WITH candidate AS (SELECT j.id FROM public.fiscal_invoices j JOIN public.fiscal_profiles p USING(organization_id,clinic_id,environment)
 WHERE p.enabled AND j.environment=env AND (j.state IN ('pending','signed','sending','submitted','processing') OR (j.state IN ('accepted','rejected') AND j.receipt_xml IS NULL))
 AND j.next_attempt<=clock_timestamp() AND (j.lease_until IS NULL OR j.lease_until<=clock_timestamp())
 ORDER BY j.next_attempt,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED)
 UPDATE public.fiscal_invoices j SET lease=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>duration), attempts=attempts+1
 FROM candidate WHERE j.id=candidate.id RETURNING j.* INTO i;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',i.id,'organizationId',i.organization_id,'clinicId',i.clinic_id,'lease',i.lease,'state',i.state,'key',i.document_key,
 'snapshot',i.snapshot,'signed',CASE WHEN i.signed_xml IS NOT NULL THEN replace(encode(i.signed_xml,'base64'),chr(10),'') END);
END $$;
CREATE FUNCTION public.fiscal_save_signature(job uuid,token uuid,signed bytea) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i public.fiscal_invoices;
BEGIN
 IF signed IS NULL OR octet_length(signed)=0 THEN RETURN false; END IF;
 UPDATE public.fiscal_invoices SET state='signed',signed_xml=signed,last_issue=NULL WHERE id=job AND lease=token AND lease_until>clock_timestamp()
 AND state='pending' AND signed_xml IS NULL RETURNING * INTO i;
 IF NOT FOUND THEN RETURN false;END IF;PERFORM vetx_fiscal.event(i);RETURN true;
END $$;
CREATE FUNCTION public.fiscal_start_delivery(job uuid,token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i public.fiscal_invoices;
BEGIN
 UPDATE public.fiscal_invoices j SET state='sending' WHERE id=job AND lease=token AND lease_until>clock_timestamp() AND state IN('signed','sending')
 AND EXISTS(SELECT FROM public.fiscal_profiles p WHERE (p.organization_id,p.clinic_id,p.environment)=(j.organization_id,j.clinic_id,j.environment) AND p.enabled)
 RETURNING * INTO i;
 IF NOT FOUND THEN RETURN false;END IF;PERFORM vetx_fiscal.event(i);RETURN true;
END $$;
CREATE FUNCTION public.fiscal_finish(job uuid,token uuid,next_state text,issue text,delay_seconds int,receipt bytea) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i public.fiscal_invoices;
BEGIN
 IF next_state IS NULL OR next_state NOT IN ('defer','submitted','processing','accepted','rejected','invalid','blocked') OR delay_seconds IS NULL OR delay_seconds<0
 OR (issue IS NOT NULL AND issue NOT IN ('configuration','authentication','invalid_submission','rate_limited','unconfirmed','unexpected_response','unavailable','invalid_snapshot','authority_error'))
 OR (receipt IS NOT NULL AND next_state NOT IN ('accepted','rejected')) THEN RETURN false; END IF;
 UPDATE public.fiscal_invoices j SET state=CASE WHEN next_state='defer' THEN j.state ELSE next_state END,
 last_issue=issue,lease=NULL,lease_until=NULL,next_attempt=clock_timestamp()+make_interval(secs=>delay_seconds),receipt_xml=coalesce(receipt,j.receipt_xml)
 WHERE id=job AND lease=token AND lease_until>clock_timestamp() AND
 (next_state='defer' OR (j.state IN('pending','signed','sending') AND next_state IN ('blocked','invalid')) OR (j.state IN ('sending','submitted','processing') AND next_state IN ('submitted','processing','accepted','rejected')) OR (j.state=next_state AND j.receipt_xml IS NULL AND next_state IN('accepted','rejected')))
 RETURNING * INTO i;
 IF NOT FOUND THEN RETURN false; END IF;PERFORM vetx_fiscal.event(i);RETURN true;
END $$;
CREATE FUNCTION public.fiscal_retry(sale uuid,env text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id(); i public.fiscal_invoices;
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR vetx_directory.is_admin() IS NOT TRUE THEN RETURN '{"error":"forbidden"}';END IF;
 SELECT * INTO i FROM public.fiscal_invoices WHERE (organization_id,clinic_id,sale_id,environment)=(org,clinic,sale,env) FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 IF i.state='blocked' THEN
   -- Reconcile a previous delivery before considering another transmission.
   UPDATE public.fiscal_invoices SET state=CASE WHEN signed_xml IS NULL THEN 'pending' ELSE 'sending' END,
   next_attempt=clock_timestamp(),last_issue=NULL WHERE id=i.id RETURNING * INTO i;
   PERFORM vetx_fiscal.event(i);
 ELSIF i.state IN ('accepted','rejected','invalid') THEN RETURN '{"error":"conflict"}'; END IF;
 RETURN vetx_fiscal.status(i);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vetx_fiscal FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fiscal_provision(uuid,uuid,text,jsonb,bigint,boolean),public.fiscal_claim(text,integer),
 public.fiscal_save_signature(uuid,uuid,bytea),public.fiscal_start_delivery(uuid,uuid),public.fiscal_finish(uuid,uuid,text,text,int,bytea),
 public.fiscal_artifact(uuid,text,text),public.fiscal_lock_tables(),public.fiscal_request(uuid,text,jsonb),public.fiscal_get_status(uuid,text),public.fiscal_retry(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_artifact(uuid,text,text),public.fiscal_lock_tables(),public.fiscal_request(uuid,text,jsonb),public.fiscal_get_status(uuid,text),public.fiscal_retry(uuid,text) TO vetx_runtime;
-- Existing deployments can migrate even when fiscal dispatch has never been enabled.
DO $role$ BEGIN
 IF to_regrole('vetx_fiscal_worker') IS NOT NULL THEN
  GRANT EXECUTE ON FUNCTION public.fiscal_provision(uuid,uuid,text,jsonb,bigint,boolean),public.fiscal_claim(text,integer),
 public.fiscal_save_signature(uuid,uuid,bytea),public.fiscal_start_delivery(uuid,uuid),public.fiscal_finish(uuid,uuid,text,text,int,bytea) TO vetx_fiscal_worker;
 END IF;
END $role$;
COMMIT;
