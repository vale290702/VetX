BEGIN;
CREATE SCHEMA vetx_billing;
REVOKE ALL ON SCHEMA vetx_billing FROM PUBLIC;
CREATE TABLE public.billing_prices(
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,id uuid NOT NULL,name text NOT NULL,currency text NOT NULL,
 unit_price numeric(18,5) NOT NULL CHECK(unit_price>=0),tax_rate numeric(8,5) NOT NULL CHECK(tax_rate BETWEEN 0 AND 100),
 cabys text NOT NULL,stock_item_id uuid,unit text NOT NULL,revision integer NOT NULL CHECK(revision>0),
 PRIMARY KEY(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id),
 FOREIGN KEY(organization_id,clinic_id,stock_item_id) REFERENCES public.inventory_items(organization_id,clinic_id,id)
);
CREATE TABLE public.billing_price_events(
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,price_id uuid NOT NULL,revision integer NOT NULL,price jsonb NOT NULL,
 actor_issuer text NOT NULL,actor_subject text NOT NULL,recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,clinic_id,price_id,revision),
 FOREIGN KEY(organization_id,clinic_id,price_id) REFERENCES public.billing_prices(organization_id,clinic_id,id)
);
CREATE TABLE public.billing_sales(
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,id uuid NOT NULL,number bigint NOT NULL,patient_id uuid,currency text NOT NULL,
 request jsonb NOT NULL,lines jsonb NOT NULL,subtotal numeric(18,5) NOT NULL,tax numeric(18,5) NOT NULL,total numeric(18,5) NOT NULL CHECK(total>=0),
 actor_issuer text NOT NULL,actor_subject text NOT NULL,recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,clinic_id,id), UNIQUE(organization_id,clinic_id,number),
 FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id),
 FOREIGN KEY(organization_id,clinic_id,patient_id) REFERENCES public.patients(organization_id,clinic_id,id)
);
CREATE TABLE public.cash_shifts(
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,id uuid NOT NULL,label text NOT NULL,currency text NOT NULL,opening_float numeric(18,5) NOT NULL CHECK(opening_float>=0),
 cashier_issuer text NOT NULL,cashier_subject text NOT NULL,opened_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz(3),counted numeric(18,5) CHECK(counted>=0),PRIMARY KEY(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id), CHECK((closed_at IS NULL)=(counted IS NULL))
);
CREATE UNIQUE INDEX cashier_active_shift ON public.cash_shifts(organization_id,clinic_id,cashier_issuer,cashier_subject,currency) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX cash_drawer_active_shift ON public.cash_shifts(organization_id,clinic_id,lower(label)) WHERE closed_at IS NULL;
CREATE TABLE public.billing_payments(
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,id uuid NOT NULL,sale_id uuid NOT NULL,currency text NOT NULL,amount numeric(18,5) NOT NULL CHECK(amount>0),
 method text NOT NULL CHECK(method IN ('CASH','CARD','TRANSFER')),reference text NOT NULL,shift_id uuid,actor_issuer text NOT NULL,actor_subject text NOT NULL,
 recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,sale_id) REFERENCES public.billing_sales(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,shift_id) REFERENCES public.cash_shifts(organization_id,clinic_id,id),
 CHECK((method='CASH')=(shift_id IS NOT NULL))
);
CREATE UNIQUE INDEX external_payment_reference ON public.billing_payments(organization_id,clinic_id,method,reference) WHERE method<>'CASH';
CREATE INDEX billing_sale_time ON public.billing_sales(organization_id,clinic_id,recorded_at DESC,id);
CREATE INDEX billing_sale_payments ON public.billing_payments(organization_id,clinic_id,sale_id);
CREATE INDEX billing_shift_payments ON public.billing_payments(organization_id,clinic_id,shift_id);
ALTER TABLE public.billing_price_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.billing_price_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_prices ENABLE ROW LEVEL SECURITY; ALTER TABLE public.billing_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_sales ENABLE ROW LEVEL SECURITY; ALTER TABLE public.billing_sales FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.billing_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cash_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY read ON public.billing_price_events FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id) AND vetx_directory.is_admin());
CREATE POLICY append ON public.billing_price_events FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id) AND vetx_directory.is_admin()
 AND actor_issuer=current_setting('vetx.identity_issuer') AND actor_subject=current_setting('vetx.identity_subject'));
CREATE POLICY local ON public.billing_prices TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY local ON public.cash_shifts TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY read ON public.billing_sales FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY append ON public.billing_sales FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id)
 AND actor_issuer=current_setting('vetx.identity_issuer') AND actor_subject=current_setting('vetx.identity_subject'));
CREATE POLICY read ON public.billing_payments FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY append ON public.billing_payments FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id)
 AND actor_issuer=current_setting('vetx.identity_issuer') AND actor_subject=current_setting('vetx.identity_subject'));
REVOKE ALL ON public.billing_prices,public.billing_price_events,public.billing_sales,public.billing_payments,public.cash_shifts FROM PUBLIC,vetx_runtime;
CREATE FUNCTION public.billing_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN LOCK TABLE public.billing_prices,public.billing_price_events,public.billing_sales,public.billing_payments,public.cash_shifts IN ACCESS SHARE MODE; RETURN true; END $$;
CREATE FUNCTION vetx_billing.money(v text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(v ~ '^(0|[1-9][0-9]{0,12})(\.[0-9]{1,5})?$' AND length(v)<=19,false)
$$;
CREATE FUNCTION vetx_billing.price(p public.billing_prices) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',p.id,'revision',p.revision,'name',p.name,'currency',p.currency,'unitPrice',p.unit_price::text,
 'unit',p.unit,'taxRate',p.tax_rate::text,'cabys',p.cabys,'stockItemId',p.stock_item_id)
$$;
CREATE FUNCTION vetx_billing.payment(p public.billing_payments) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',p.id,'saleId',p.sale_id,'currency',p.currency,'amount',p.amount::text,'method',p.method,'reference',p.reference,
 'shiftId',p.shift_id,'recordedAt',vetx_care.utc(p.recorded_at),'author',jsonb_build_object('issuer',p.actor_issuer,'subject',p.actor_subject))
$$;
CREATE FUNCTION vetx_billing.sale(s public.billing_sales) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',s.id,'number',s.number::text,'patientId',s.patient_id,'currency',s.currency,'lines',s.lines,
 'subtotal',s.subtotal::text,'tax',s.tax::text,'total',s.total::text,'paid',p.amount::text,'balance',(s.total-p.amount)::numeric(18,5)::text,
 'recordedAt',vetx_care.utc(s.recorded_at),'author',jsonb_build_object('issuer',s.actor_issuer,'subject',s.actor_subject))
 FROM (SELECT coalesce(sum(amount),0)::numeric(18,5) AS amount FROM public.billing_payments
 WHERE (organization_id,clinic_id,sale_id)=(s.organization_id,s.clinic_id,s.id)) p
$$;
CREATE FUNCTION vetx_billing.shift(s public.cash_shifts) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',s.id,'label',s.label,'currency',s.currency,'openingFloat',s.opening_float::text,'expected',p.expected::text,
 'counted',s.counted::text,'difference',(s.counted-p.expected)::numeric(18,5)::text,'openedAt',vetx_care.utc(s.opened_at),
 'closedAt',vetx_care.utc(s.closed_at),'cashier',jsonb_build_object('issuer',s.cashier_issuer,'subject',s.cashier_subject))
 FROM (SELECT (s.opening_float+coalesce(sum(amount),0))::numeric(18,5) AS expected FROM public.billing_payments
 WHERE (organization_id,clinic_id,shift_id)=(s.organization_id,s.clinic_id,s.id)) p
$$;
CREATE FUNCTION public.billing_save_price(price uuid,title text,ccy text,unit_price_input text,rate text,cabys_code text,stock_id uuid,unit_input text,expected int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); p public.billing_prices;
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR vetx_directory.is_admin() IS NOT TRUE THEN RETURN '{"error":"forbidden"}';END IF;
 IF NOT vetx_stock.label(title,120) OR NOT vetx_stock.label(unit_input,40) OR ccy IS NULL OR ccy !~ '^[A-Z]{3}$' OR NOT vetx_billing.money(unit_price_input) OR NOT vetx_billing.money(rate)
 OR cabys_code IS NULL OR cabys_code !~ '^[0-9]{13}$' OR expected IS NULL OR expected<0 THEN RETURN '{"error":"invalid"}';END IF;
 IF rate::numeric>100 THEN RETURN '{"error":"invalid"}';END IF;
 IF stock_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.inventory_items WHERE (organization_id,clinic_id,id)=(org,clinic,stock_id)) THEN RETURN '{"error":"not_found"}';END IF;
 unit_input:=btrim(unit_input);
 IF stock_id IS NOT NULL AND unit_input IS DISTINCT FROM (SELECT i.unit FROM public.inventory_items i WHERE (i.organization_id,i.clinic_id,i.id)=(org,clinic,stock_id)) THEN RETURN '{"error":"conflict"}'; END IF;
 SELECT * INTO p FROM public.billing_prices WHERE (organization_id,clinic_id,id)=(org,clinic,price);
 IF FOUND THEN
  IF (p.name,p.currency,p.unit_price,p.tax_rate,p.cabys,p.stock_item_id,p.unit) IS NOT DISTINCT FROM
   (btrim(title),ccy,unit_price_input::numeric,rate::numeric,cabys_code,stock_id,unit_input) AND (expected=p.revision OR (expected=p.revision-1 AND EXISTS(SELECT FROM public.billing_price_events e WHERE (e.organization_id,e.clinic_id,e.price_id,e.revision,e.actor_issuer,e.actor_subject)=(org,clinic,p.id,p.revision,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'))))) THEN RETURN vetx_billing.price(p); END IF;
  IF expected<>p.revision OR expected=2147483647 THEN RETURN '{"error":"conflict"}';END IF;
  UPDATE public.billing_prices SET name=btrim(title),currency=ccy,unit_price=unit_price_input::numeric,tax_rate=rate::numeric,
   cabys=cabys_code,stock_item_id=stock_id,unit=unit_input,revision=revision+1 WHERE (organization_id,clinic_id,id)=(org,clinic,price) RETURNING * INTO p;
 ELSE
  IF expected<>0 THEN RETURN '{"error":"conflict"}';END IF;
  INSERT INTO public.billing_prices VALUES(org,clinic,price,btrim(title),ccy,unit_price_input::numeric,rate::numeric,cabys_code,stock_id,unit_input,1) RETURNING * INTO p;
 END IF;
 INSERT INTO public.billing_price_events(organization_id,clinic_id,price_id,revision,price,actor_issuer,actor_subject)
 VALUES(org,clinic,price,p.revision,vetx_billing.price(p),current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'));
 RETURN vetx_billing.price(p);
END $$;
CREATE FUNCTION public.billing_create_sale(request_id uuid,ccy text,patient uuid,items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id();
 issuer text:=current_setting('vetx.identity_issuer',true);subject text:=current_setting('vetx.identity_subject',true);
 entry jsonb; normalized jsonb:='[]'; priced jsonb:='[]'; p public.billing_prices; sale public.billing_sales;
 amount numeric(18,3); amount_net numeric(18,5);amount_tax numeric(18,5);net numeric(18,5):=0;tax_total numeric(18,5):=0;
 stock_move uuid; result jsonb;num bigint;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}';END IF;
 IF request_id IS NULL OR ccy IS NULL OR ccy !~ '^[A-Z]{3}$' OR jsonb_typeof(items) IS DISTINCT FROM 'array' THEN RETURN '{"error":"invalid"}'; END IF;
 IF jsonb_array_length(items) NOT BETWEEN 1 AND 1000 THEN RETURN '{"error":"invalid"}'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR num_nonnulls(entry->>'priceId',entry->>'priceRevision',entry->>'lot',entry->>'quantity')<>4
    OR NOT (entry ? 'warehouseId') OR NOT vetx_billing.money(entry->>'quantity') OR (entry->>'quantity') !~ '^(0|[1-9][0-9]{0,12})(\.[0-9]{1,3})?$'
    OR (entry->>'priceRevision') !~ '^[1-9][0-9]{0,9}$' OR length(entry->>'lot')>120 OR (entry->>'lot') ~ '[[:cntrl:]]' THEN RETURN '{"error":"invalid"}';END IF;
  amount:=(entry->>'quantity')::numeric;IF amount<=0 THEN RETURN '{"error":"invalid"}';END IF;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('priceId',(entry->>'priceId')::uuid,'priceRevision',(entry->>'priceRevision')::int,
   'warehouseId',(entry->>'warehouseId')::uuid,'quantity',amount::text,'lot',btrim(entry->>'lot')));
 END LOOP;
 SELECT * INTO sale FROM public.billing_sales WHERE (organization_id,clinic_id,id)=(org,clinic,request_id);
 IF FOUND THEN
  IF (sale.actor_issuer,sale.actor_subject,sale.currency,sale.patient_id,sale.request) IS DISTINCT FROM (issuer,subject,ccy,patient,normalized)
   THEN RETURN '{"error":"conflict"}';END IF;
  RETURN vetx_billing.sale(sale);
 END IF;
 IF patient IS NOT NULL AND NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) THEN RETURN '{"error":"not_found"}';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(normalized) LOOP
  SELECT * INTO p FROM public.billing_prices WHERE (organization_id,clinic_id,id)=(org,clinic,(entry->>'priceId')::uuid);
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0B01';END IF;
  IF p.revision<>(entry->>'priceRevision')::integer THEN RAISE EXCEPTION 'conflict' USING ERRCODE='P0B01';END IF;
  IF p.currency<>ccy OR ((p.stock_item_id IS NULL)<>(entry->>'warehouseId' IS NULL))
    OR (p.stock_item_id IS NULL AND entry->>'lot'<>'') THEN RAISE EXCEPTION 'invalid' USING ERRCODE='P0B01';END IF;
  amount:=(entry->>'quantity')::numeric;amount_net:=round(p.unit_price*amount,5);amount_tax:=round(amount_net*p.tax_rate/100,5);
  net:=net+amount_net;tax_total:=tax_total+amount_tax;stock_move:=NULL;
  IF p.stock_item_id IS NOT NULL THEN
   stock_move:=gen_random_uuid();
   result:=public.stock_record_movement(stock_move,p.stock_item_id,'ISSUE',(entry->>'warehouseId')::uuid,NULL,amount::text,entry->>'lot',request_id::text,p.unit);
   IF result ? 'error' THEN RAISE EXCEPTION USING MESSAGE=result->>'error',ERRCODE='P0B01';END IF;
  END IF;
  priced:=priced||jsonb_build_array(entry||jsonb_build_object('name',p.name,'unit',p.unit,'stockItemId',p.stock_item_id,'cabys',p.cabys,'unitPrice',p.unit_price::text,
   'taxRate',p.tax_rate::text,'subtotal',amount_net::text,'tax',amount_tax::text,'total',(amount_net+amount_tax)::numeric(18,5)::text,'movementId',stock_move));
 END LOOP;
 SELECT coalesce(max(number),0)+1 INTO num FROM public.billing_sales WHERE (organization_id,clinic_id)=(org,clinic);
 INSERT INTO public.billing_sales(organization_id,clinic_id,id,number,patient_id,currency,request,lines,subtotal,tax,total,actor_issuer,actor_subject)
 VALUES(org,clinic,request_id,num,patient,ccy,normalized,priced,net,tax_total,net+tax_total,issuer,subject) RETURNING * INTO sale;
 RETURN vetx_billing.sale(sale);
EXCEPTION WHEN SQLSTATE 'P0B01' THEN RETURN jsonb_build_object('error',SQLERRM);
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid"}';
END $$;
CREATE FUNCTION public.billing_open_shift(shift uuid,title text,ccy text,opening text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id(); s public.cash_shifts;
 issuer text:=current_setting('vetx.identity_issuer',true);subject text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}';END IF;
 IF NOT vetx_stock.label(title,120) OR ccy IS NULL OR ccy !~ '^[A-Z]{3}$' OR NOT vetx_billing.money(opening) THEN RETURN '{"error":"invalid"}';END IF;
 SELECT * INTO s FROM public.cash_shifts WHERE (organization_id,clinic_id,id)=(org,clinic,shift);
 IF FOUND THEN
  IF (s.label,s.currency,s.opening_float,s.cashier_issuer,s.cashier_subject) IS DISTINCT FROM (btrim(title),ccy,opening::numeric,issuer,subject) THEN RETURN '{"error":"conflict"}'; END IF;
 ELSE
  INSERT INTO public.cash_shifts(organization_id,clinic_id,id,label,currency,opening_float,cashier_issuer,cashier_subject)
   VALUES(org,clinic,shift,btrim(title),ccy,opening::numeric,issuer,subject) RETURNING * INTO s;
 END IF;
 RETURN vetx_billing.shift(s);
EXCEPTION WHEN unique_violation THEN RETURN '{"error":"conflict"}';END $$;
CREATE FUNCTION public.billing_close_shift(shift uuid,closing text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id(); s public.cash_shifts;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}';END IF;
 IF NOT vetx_billing.money(closing) THEN RETURN '{"error":"invalid"}';END IF;
 SELECT * INTO s FROM public.cash_shifts WHERE (organization_id,clinic_id,id)=(org,clinic,shift)
 AND (cashier_issuer,cashier_subject)=(current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'));
 IF NOT FOUND THEN RETURN '{"error":"not_found"}';END IF;
 IF s.closed_at IS NOT NULL THEN
  IF s.counted<>closing::numeric THEN RETURN '{"error":"conflict"}';END IF;
 ELSE UPDATE public.cash_shifts SET counted=closing::numeric,closed_at=clock_timestamp() WHERE (organization_id,clinic_id,id)=(org,clinic,shift) RETURNING * INTO s;END IF;
 RETURN vetx_billing.shift(s);
END $$;
CREATE FUNCTION public.billing_take_payment(sale uuid,request_id uuid,method_input text,amount_input text,ref text,shift uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id();s public.billing_sales;p public.billing_payments;
 issuer text:=current_setting('vetx.identity_issuer',true);subject text:=current_setting('vetx.identity_subject',true);balance numeric(18,5);
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}';END IF;
 IF NOT vetx_billing.money(amount_input) OR method_input IS NULL OR method_input NOT IN ('CASH','CARD','TRANSFER') OR ref IS NULL OR length(ref)>120 OR ref ~ '[[:cntrl:]]'
 OR (method_input='CASH')<>(shift IS NOT NULL) OR (method_input<>'CASH' AND NOT vetx_stock.label(ref,120)) THEN RETURN '{"error":"invalid"}';END IF;
 IF amount_input::numeric<=0 THEN RETURN '{"error":"invalid"}';END IF;
 SELECT * INTO p FROM public.billing_payments WHERE (organization_id,clinic_id,id)=(org,clinic,request_id);
 IF FOUND THEN
  IF (p.sale_id,p.method,p.amount,p.reference,p.shift_id,p.actor_issuer,p.actor_subject) IS DISTINCT FROM
   (sale,method_input,amount_input::numeric,btrim(ref),shift,issuer,subject) THEN RETURN '{"error":"conflict"}';END IF;
  RETURN vetx_billing.payment(p);
 END IF;
 SELECT * INTO s FROM public.billing_sales WHERE (organization_id,clinic_id,id)=(org,clinic,sale);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}';END IF;
 IF shift IS NOT NULL AND NOT EXISTS(SELECT FROM public.cash_shifts WHERE (organization_id,clinic_id,id,currency,cashier_issuer,cashier_subject)=(org,clinic,shift,s.currency,issuer,subject)
 AND closed_at IS NULL) THEN RETURN '{"error":"conflict"}';END IF;
 SELECT s.total-coalesce(sum(amount),0) INTO balance FROM public.billing_payments WHERE (organization_id,clinic_id,sale_id)=(org,clinic,sale);
 IF shift IS NOT NULL AND (SELECT cs.opening_float+amount_input::numeric+coalesce((SELECT sum(r.amount) FROM public.billing_payments r
 WHERE (r.organization_id,r.clinic_id,r.shift_id)=(org,clinic,shift)),0) FROM public.cash_shifts cs WHERE (cs.organization_id,cs.clinic_id,cs.id)=(org,clinic,shift))>=10000000000000
 THEN RETURN '{"error":"conflict"}';END IF;
 IF amount_input::numeric>balance THEN RETURN '{"error":"conflict"}';END IF;
 INSERT INTO public.billing_payments(organization_id,clinic_id,id,sale_id,currency,amount,method,reference,shift_id,actor_issuer,actor_subject)
 VALUES(org,clinic,request_id,sale,s.currency,amount_input::numeric,method_input,btrim(ref),shift,issuer,subject) RETURNING * INTO p;
 RETURN vetx_billing.payment(p);
EXCEPTION WHEN unique_violation THEN RETURN '{"error":"conflict"}';END $$;
CREATE FUNCTION public.billing_get_sale(sale uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}';END IF;
 SELECT vetx_billing.sale(s) INTO result FROM public.billing_sales s WHERE (s.organization_id,s.clinic_id,s.id)=(vetx_directory.organization_id(),vetx_registry.clinic_id(),sale);
 RETURN coalesce(result,'{"error":"not_found"}'::jsonb);
END $$;
CREATE FUNCTION public.billing_list(collection text,page_number integer,sale uuid,term text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id();clinic uuid:=vetx_registry.clinic_id(); result jsonb; skip bigint;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}';END IF;
 IF page_number IS NULL OR page_number<1 OR term IS NULL OR length(term)>120 THEN RETURN '{"error":"invalid"}';END IF;
 skip:=(page_number::bigint-1)*25;
 CASE collection
 WHEN 'prices' THEN
  SELECT coalesce(jsonb_agg(vetx_billing.price(p::public.billing_prices) ORDER BY lower(p.name),p.id),'[]') INTO result FROM (
    SELECT * FROM public.billing_prices WHERE (organization_id,clinic_id)=(org,clinic) AND (position(lower(btrim(term)) in lower(name))>0 OR position(btrim(term) in cabys)>0)
    ORDER BY lower(name),id LIMIT 26 OFFSET skip) p;
 WHEN 'sales' THEN
  SELECT coalesce(jsonb_agg(vetx_billing.sale(p::public.billing_sales) ORDER BY p.number DESC),'[]') INTO result FROM (
    SELECT * FROM public.billing_sales WHERE (organization_id,clinic_id)=(org,clinic)
    ORDER BY number DESC LIMIT 26 OFFSET skip) p;
 WHEN 'shifts' THEN
  SELECT coalesce(jsonb_agg(vetx_billing.shift(p::public.cash_shifts) ORDER BY p.opened_at DESC,p.id),'[]') INTO result FROM (
    SELECT * FROM public.cash_shifts WHERE (organization_id,clinic_id)=(org,clinic)
    AND ((cashier_issuer,cashier_subject)=(current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject')) OR vetx_directory.is_admin())
    ORDER BY opened_at DESC,id LIMIT 26 OFFSET skip) p;
 WHEN 'payments' THEN
  IF NOT EXISTS(SELECT FROM public.billing_sales WHERE (organization_id,clinic_id,id)=(org,clinic,sale)) THEN RETURN '{"error":"not_found"}';END IF;
  SELECT coalesce(jsonb_agg(vetx_billing.payment(p::public.billing_payments) ORDER BY p.recorded_at DESC,p.id),'[]') INTO result FROM (
    SELECT * FROM public.billing_payments WHERE (organization_id,clinic_id,sale_id)=(org,clinic,sale)
    ORDER BY recorded_at DESC,id LIMIT 26 OFFSET skip) p;
 ELSE RETURN '{"error":"invalid"}';END CASE;
 RETURN jsonb_build_object(collection,CASE WHEN jsonb_array_length(result)>25 THEN result-25 ELSE result END,
 'page',page_number,'hasNextPage',jsonb_array_length(result)>25);
END $$;
REVOKE ALL ON FUNCTION public.billing_lock_tables(),public.billing_save_price(uuid,text,text,text,text,text,uuid,text,int),public.billing_create_sale(uuid,text,uuid,jsonb),
 public.billing_open_shift(uuid,text,text,text),public.billing_close_shift(uuid,text),public.billing_take_payment(uuid,uuid,text,text,text,uuid),
 public.billing_get_sale(uuid),public.billing_list(text,int,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_lock_tables(),public.billing_save_price(uuid,text,text,text,text,text,uuid,text,int),public.billing_create_sale(uuid,text,uuid,jsonb),
 public.billing_open_shift(uuid,text,text,text),public.billing_close_shift(uuid,text),public.billing_take_payment(uuid,uuid,text,text,text,uuid),
 public.billing_get_sale(uuid),public.billing_list(text,int,uuid,text) TO vetx_runtime;
COMMIT;
