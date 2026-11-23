BEGIN;
CREATE SCHEMA vetx_trade;
REVOKE ALL ON SCHEMA vetx_trade FROM PUBLIC;

CREATE TABLE public.trade_suppliers (
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL,
 revision integer NOT NULL CHECK(revision>0), actor_issuer text NOT NULL, actor_subject text NOT NULL,
 PRIMARY KEY(organization_id,clinic_id,id), FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id)
);
CREATE UNIQUE INDEX supplier_clinic_name ON public.trade_suppliers(organization_id,clinic_id,lower(name));
CREATE TABLE public.purchase_orders (
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, id uuid NOT NULL, supplier_id uuid NOT NULL,supplier_name text NOT NULL,
 actor_issuer text NOT NULL, actor_subject text NOT NULL, recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,clinic_id,id), FOREIGN KEY(organization_id,clinic_id,supplier_id) REFERENCES public.trade_suppliers(organization_id,clinic_id,id)
);
CREATE TABLE public.purchase_lines (
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,order_id uuid NOT NULL,item_id uuid NOT NULL,line_no integer NOT NULL CHECK(line_no>0),
 item_name text NOT NULL,unit text NOT NULL,quantity numeric(18,3) NOT NULL CHECK(quantity>0 AND quantity<1000000000000000),
 PRIMARY KEY(organization_id,clinic_id,order_id,item_id), UNIQUE(organization_id,clinic_id,order_id,line_no),
 FOREIGN KEY(organization_id,clinic_id,order_id) REFERENCES public.purchase_orders(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,item_id) REFERENCES public.inventory_items(organization_id,clinic_id,id)
);
CREATE TABLE public.purchase_receipts (
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,id uuid NOT NULL,order_id uuid NOT NULL,
 actor_issuer text NOT NULL,actor_subject text NOT NULL,recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,clinic_id,id), UNIQUE(organization_id,clinic_id,id,order_id),
 FOREIGN KEY(organization_id,clinic_id,order_id) REFERENCES public.purchase_orders(organization_id,clinic_id,id)
);
CREATE TABLE public.purchase_receipt_lines (
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,receipt_id uuid NOT NULL,order_id uuid NOT NULL,item_id uuid NOT NULL,
 movement_id uuid NOT NULL,line_no integer NOT NULL CHECK(line_no>0),
 PRIMARY KEY(organization_id,clinic_id,movement_id), UNIQUE(organization_id,clinic_id,receipt_id,line_no),
 CONSTRAINT receipt_header_fk FOREIGN KEY(organization_id,clinic_id,receipt_id,order_id) REFERENCES public.purchase_receipts(organization_id,clinic_id,id,order_id),
 CONSTRAINT receipt_order_line_fk FOREIGN KEY(organization_id,clinic_id,order_id,item_id) REFERENCES public.purchase_lines(organization_id,clinic_id,order_id,item_id),
 FOREIGN KEY(organization_id,clinic_id,movement_id) REFERENCES public.stock_movements(organization_id,clinic_id,id)
);
CREATE INDEX received_order_items ON public.purchase_receipt_lines(organization_id,clinic_id,order_id,item_id);
CREATE TABLE public.supplier_returns (
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,id uuid NOT NULL,receipt_movement_id uuid NOT NULL,movement_id uuid NOT NULL,reason text NOT NULL,
 actor_issuer text NOT NULL,actor_subject text NOT NULL,recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,clinic_id,id), UNIQUE(organization_id,clinic_id,movement_id),
 FOREIGN KEY(organization_id,clinic_id,receipt_movement_id) REFERENCES public.purchase_receipt_lines(organization_id,clinic_id,movement_id),
 FOREIGN KEY(organization_id,clinic_id,movement_id) REFERENCES public.stock_movements(organization_id,clinic_id,id)
);
CREATE INDEX returns_by_receipt ON public.supplier_returns(organization_id,clinic_id,receipt_movement_id);

CREATE TABLE public.pharmacy_capabilities (
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES public.users(id),
 can_prescribe boolean NOT NULL,can_dispense boolean NOT NULL,revision integer NOT NULL CHECK(revision>0),
 actor_issuer text NOT NULL,actor_subject text NOT NULL,
 PRIMARY KEY(organization_id,clinic_id,user_id), FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id)
);
CREATE TABLE public.patient_prescriptions (
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,id uuid NOT NULL,patient_id uuid NOT NULL,item_id uuid NOT NULL,
 item_name text NOT NULL,unit text NOT NULL,medication text NOT NULL,instructions text NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK(quantity>0 AND quantity<1000000000000000),
 actor_issuer text NOT NULL,actor_subject text NOT NULL,recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,patient_id) REFERENCES public.patients(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,item_id) REFERENCES public.inventory_items(organization_id,clinic_id,id)
);
CREATE INDEX prescriptions_patient ON public.patient_prescriptions(organization_id,clinic_id,patient_id,recorded_at DESC,id);
CREATE TABLE public.prescription_dispensings (
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,id uuid NOT NULL,prescription_id uuid NOT NULL,movement_id uuid NOT NULL,
 actor_issuer text NOT NULL,actor_subject text NOT NULL,recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,clinic_id,id), UNIQUE(organization_id,clinic_id,movement_id),
 FOREIGN KEY(organization_id,clinic_id,prescription_id) REFERENCES public.patient_prescriptions(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,movement_id) REFERENCES public.stock_movements(organization_id,clinic_id,id)
);
CREATE INDEX dispensing_prescription ON public.prescription_dispensings(organization_id,clinic_id,prescription_id);
CREATE TABLE public.prescription_sharing (
 organization_id uuid NOT NULL,clinic_id uuid NOT NULL,prescription_id uuid NOT NULL,patient_id uuid NOT NULL,
 guardian_ids uuid[] NOT NULL,revision integer NOT NULL CHECK(revision>0),actor_issuer text NOT NULL,actor_subject text NOT NULL,
 PRIMARY KEY(organization_id,clinic_id,prescription_id),
 FOREIGN KEY(organization_id,clinic_id,prescription_id) REFERENCES public.patient_prescriptions(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,patient_id) REFERENCES public.patients(organization_id,clinic_id,id)
);
CREATE TABLE public.pharmacy_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid NOT NULL,clinic_id uuid NOT NULL,target_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('CAPABILITIES_CHANGED','SHARING_CHANGED')),revision integer NOT NULL,
 actor_issuer text NOT NULL,actor_subject text NOT NULL,recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id)
);

CREATE INDEX purchases_by_time ON public.purchase_orders(organization_id,clinic_id,recorded_at DESC,id);
CREATE INDEX receipts_by_order ON public.purchase_receipts(organization_id,clinic_id,order_id,recorded_at DESC,id);
CREATE INDEX purchase_item_commitments ON public.purchase_lines(organization_id,clinic_id,item_id);
CREATE INDEX prescription_item_commitments ON public.patient_prescriptions(organization_id,clinic_id,item_id);

DO $$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['trade_suppliers','purchase_orders','purchase_lines','purchase_receipts','purchase_receipt_lines','supplier_returns',
   'pharmacy_capabilities','patient_prescriptions','prescription_dispensings','prescription_sharing','pharmacy_events'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
   EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,vetx_runtime',tbl);
   IF tbl='pharmacy_capabilities' THEN
     EXECUTE format('CREATE POLICY staff_read ON public.%I FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id) AND (vetx_directory.is_admin() OR EXISTS(SELECT FROM public.users u WHERE u.id=user_id AND (u.identity_issuer,u.identity_subject)=(current_setting(''vetx.identity_issuer''),current_setting(''vetx.identity_subject'')))))',tbl);
   ELSE
     EXECUTE format('CREATE POLICY staff_read ON public.%I FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id))',tbl);
   END IF;
   IF tbl IN ('trade_suppliers','pharmacy_capabilities') THEN
     EXECUTE format('CREATE POLICY admin_add ON public.%I FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id) AND vetx_directory.is_admin())',tbl);
     EXECUTE format('CREATE POLICY admin_edit ON public.%I FOR UPDATE TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id) AND vetx_directory.is_admin())',tbl);
   ELSIF tbl IN ('purchase_lines','purchase_receipt_lines') THEN
     EXECUTE format('CREATE POLICY add_line ON public.%I FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id))',tbl);
   ELSE
     EXECUTE format('CREATE POLICY add_event ON public.%I FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id) AND (actor_issuer,actor_subject)=(current_setting(''vetx.identity_issuer''),current_setting(''vetx.identity_subject'')))',tbl);
   END IF;
 END LOOP;
END
$$;
CREATE POLICY update_sharing ON public.prescription_sharing FOR UPDATE TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY owner_release ON public.prescription_sharing FOR SELECT TO vetx_migration USING(
 EXISTS(SELECT FROM public.guardians g WHERE (g.organization_id,g.clinic_id,g.patient_id)=(prescription_sharing.organization_id,prescription_sharing.clinic_id,prescription_sharing.patient_id)
  AND g.id=ANY(guardian_ids) AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject))
);
CREATE FUNCTION vetx_trade.released(org uuid,clinic uuid,patient uuid,rx uuid,pet uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT FROM public.prescription_sharing s JOIN public.guardians g
   ON (g.organization_id,g.clinic_id,g.patient_id)=(s.organization_id,s.clinic_id,s.patient_id) AND g.id=ANY(s.guardian_ids)
   WHERE (s.organization_id,s.clinic_id,s.patient_id,s.prescription_id)=(org,clinic,patient,rx) AND g.removed_at IS NULL
   AND vetx_registry.self(g.recipient_issuer,g.owner_subject) AND (pet IS NULL OR g.pet_id=pet))
$$;
CREATE POLICY owner_prescription ON public.patient_prescriptions FOR SELECT TO vetx_migration USING(vetx_trade.released(organization_id,clinic_id,patient_id,id));
CREATE FUNCTION public.trade_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN LOCK TABLE public.trade_suppliers,public.purchase_orders,public.purchase_lines,public.purchase_receipts,public.purchase_receipt_lines,public.supplier_returns,
 public.pharmacy_capabilities,public.patient_prescriptions,public.prescription_dispensings,public.prescription_sharing,public.pharmacy_events IN ACCESS SHARE MODE; RETURN true; END
$$;
CREATE FUNCTION vetx_trade.keep_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT FROM public.purchase_lines WHERE (organization_id,clinic_id,item_id)=(OLD.organization_id,OLD.clinic_id,OLD.id))
  OR EXISTS(SELECT FROM public.patient_prescriptions WHERE (organization_id,clinic_id,item_id)=(OLD.organization_id,OLD.clinic_id,OLD.id))
 THEN RAISE EXCEPTION 'Base unit has order or prescription history' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER preserve_order_unit BEFORE UPDATE OF unit ON public.inventory_items FOR EACH ROW WHEN(OLD.unit IS DISTINCT FROM NEW.unit) EXECUTE FUNCTION vetx_trade.keep_unit();

CREATE FUNCTION vetx_trade.amount(input text) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN input ~ '^(0|[1-9][0-9]{0,14})([.][0-9]{1,3})?$' THEN nullif(input::numeric(18,3),0) END
$$;
CREATE FUNCTION vetx_trade.event(id uuid,issuer text,subject text,stamp timestamptz) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',id,'author',jsonb_build_object('issuer',issuer,'subject',subject),'recordedAt',vetx_care.utc(stamp))
$$;
CREATE FUNCTION vetx_trade.stock(item uuid,warehouse uuid,lot text,amount numeric,kind text,reason text) RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE movement uuid:=gen_random_uuid(); result jsonb;
BEGIN
 result:=public.stock_record_movement(movement,item,kind,CASE WHEN kind='ISSUE' THEN warehouse END,CASE WHEN kind='RECEIPT' THEN warehouse END,amount::text,lot,reason);
 -- Raising here rolls back the entire operation, including any earlier lines.
 IF result ? 'error' THEN RAISE EXCEPTION USING ERRCODE='P6100',MESSAGE=result->>'error'; END IF;
 RETURN movement;
END
$$;

CREATE FUNCTION public.trade_save_supplier(supplier uuid,new_name text,expected integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); r public.trade_suppliers;
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR NOT vetx_directory.is_admin() THEN RETURN '{"error":"forbidden"}'; END IF;
 IF supplier IS NULL OR NOT vetx_stock.label(new_name,120) OR expected IS NULL OR expected<0 THEN RETURN '{"error":"invalid"}'; END IF;
 new_name:=btrim(new_name);
 SELECT * INTO r FROM public.trade_suppliers WHERE (organization_id,clinic_id,id)=(org,clinic,supplier);
 IF NOT FOUND THEN
   IF expected<>0 THEN RETURN '{"error":"not_found"}'; END IF;
   INSERT INTO public.trade_suppliers VALUES(org,clinic,supplier,new_name,1,issuer,subj) RETURNING * INTO r;
 ELSIF NOT (r.name=new_name AND (expected=r.revision OR (expected=r.revision-1 AND (r.actor_issuer,r.actor_subject)=(issuer,subj)))) THEN
   IF expected<>r.revision OR expected=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
   UPDATE public.trade_suppliers SET name=new_name,revision=revision+1,actor_issuer=issuer,actor_subject=subj
    WHERE (organization_id,clinic_id,id)=(org,clinic,supplier) RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('id',r.id,'name',r.name,'revision',r.revision);
EXCEPTION WHEN unique_violation THEN RETURN '{"error":"conflict"}';
END
$$;

CREATE FUNCTION vetx_trade.normalize_lines(raw jsonb,receipt boolean) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb; result jsonb:='[]'; line jsonb; amount numeric;
BEGIN
 IF jsonb_typeof(raw) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF jsonb_array_length(raw) NOT BETWEEN 1 AND 100 THEN RETURN NULL; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(raw) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'itemId') IS DISTINCT FROM 'string'
    OR NOT pg_input_is_valid(item->>'itemId','uuid') OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
   amount:=vetx_trade.amount(item->>'quantity'); IF amount IS NULL THEN RETURN NULL; END IF;
   line:=jsonb_build_object('itemId',(item->>'itemId')::uuid,'quantity',amount::text);
   IF receipt THEN
     IF item-ARRAY['itemId','quantity','warehouseId','lot']<>'{}'::jsonb OR jsonb_typeof(item->'warehouseId') IS DISTINCT FROM 'string'
      OR NOT pg_input_is_valid(item->>'warehouseId','uuid') OR jsonb_typeof(item->'lot') IS DISTINCT FROM 'string'
      OR length(btrim(item->>'lot'))>120 OR (item->>'lot') ~ '[[:cntrl:]]' THEN RETURN NULL; END IF;
     line:=line||jsonb_build_object('warehouseId',(item->>'warehouseId')::uuid,'lot',btrim(item->>'lot'));
   ELSIF item-ARRAY['itemId','quantity']<>'{}'::jsonb OR result @> jsonb_build_array(jsonb_build_object('itemId',(item->>'itemId')::uuid)) THEN RETURN NULL;
   END IF;
   result:=result||jsonb_build_array(line);
 END LOOP;
 RETURN result;
END
$$;
CREATE FUNCTION vetx_trade.received(org uuid,clinic uuid,purchase uuid,item uuid) RETURNS numeric LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(sum(m.quantity),0.000) FROM public.purchase_receipt_lines l JOIN public.stock_movements m
  ON (m.organization_id,m.clinic_id,m.id)=(l.organization_id,l.clinic_id,l.movement_id)
  WHERE (l.organization_id,l.clinic_id,l.order_id,l.item_id)=(org,clinic,purchase,item)
$$;
CREATE FUNCTION vetx_trade.purchase(o public.purchase_orders) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH lines AS MATERIALIZED (SELECT l.*,vetx_trade.received(l.organization_id,l.clinic_id,l.order_id,l.item_id) AS received
 FROM public.purchase_lines l WHERE (l.organization_id,l.clinic_id,l.order_id)=(o.organization_id,o.clinic_id,o.id))
 SELECT vetx_trade.event(o.id,o.actor_issuer,o.actor_subject,o.recorded_at)||jsonb_build_object('supplierId',o.supplier_id,'supplierName',o.supplier_name,
 'status',CASE WHEN bool_and(received=quantity) THEN 'RECEIVED' WHEN bool_or(received>0) THEN 'PARTIALLY_RECEIVED' ELSE 'OPEN' END,
 'lines',jsonb_agg(jsonb_build_object('itemId',item_id,'itemName',item_name,'unit',unit,'quantity',quantity::text,'receivedQuantity',received::text) ORDER BY line_no)) FROM lines
$$;
CREATE FUNCTION public.trade_order(purchase uuid,supplier uuid,raw jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); o public.purchase_orders; lines jsonb; existing jsonb; supplier_name text;
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 lines:=vetx_trade.normalize_lines(raw,false);
 IF num_nonnulls(purchase,supplier,lines)<>3 THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT * INTO o FROM public.purchase_orders WHERE (organization_id,clinic_id,id)=(org,clinic,purchase);
 IF FOUND THEN
   SELECT jsonb_agg(jsonb_build_object('itemId',item_id,'quantity',quantity::text) ORDER BY line_no) INTO existing
    FROM public.purchase_lines WHERE (organization_id,clinic_id,order_id)=(org,clinic,purchase);
   IF (o.supplier_id,o.actor_issuer,o.actor_subject,existing) IS DISTINCT FROM (supplier,issuer,subj,lines) THEN RETURN '{"error":"conflict"}'; END IF;
 ELSE
   SELECT name INTO supplier_name FROM public.trade_suppliers WHERE (organization_id,clinic_id,id)=(org,clinic,supplier);
   IF NOT FOUND OR EXISTS (SELECT FROM jsonb_array_elements(lines) l WHERE NOT EXISTS(SELECT FROM public.inventory_items i
     WHERE (i.organization_id,i.clinic_id,i.id)=(org,clinic,(l->>'itemId')::uuid))) THEN RETURN '{"error":"not_found"}'; END IF;
   INSERT INTO public.purchase_orders(organization_id,clinic_id,id,supplier_id,supplier_name,actor_issuer,actor_subject)
     VALUES(org,clinic,purchase,supplier,supplier_name,issuer,subj) RETURNING * INTO o;
   INSERT INTO public.purchase_lines(organization_id,clinic_id,order_id,item_id,line_no,item_name,unit,quantity)
    SELECT org,clinic,purchase,i.id,l.n,i.name,i.unit,(l.v->>'quantity')::numeric FROM jsonb_array_elements(lines) WITH ORDINALITY l(v,n)
     JOIN public.inventory_items i ON (i.organization_id,i.clinic_id,i.id)=(org,clinic,(l.v->>'itemId')::uuid);
 END IF;
 RETURN vetx_trade.purchase(o);
END
$$;
CREATE FUNCTION vetx_trade.receipt(r public.purchase_receipts) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT vetx_trade.event(r.id,r.actor_issuer,r.actor_subject,r.recorded_at)||jsonb_build_object('orderId',r.order_id,'lines',jsonb_agg(
 jsonb_build_object('itemId',m.item_id,'quantity',m.quantity::text,'lot',m.lot,'warehouseId',m.to_warehouse_id,'movementId',m.id) ORDER BY l.line_no))
 FROM public.purchase_receipt_lines l JOIN public.stock_movements m ON (m.organization_id,m.clinic_id,m.id)=(l.organization_id,l.clinic_id,l.movement_id)
 WHERE (l.organization_id,l.clinic_id,l.receipt_id)=(r.organization_id,r.clinic_id,r.id)
$$;
CREATE FUNCTION public.trade_receive(purchase uuid,receipt uuid,raw jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); r public.purchase_receipts; lines jsonb; existing jsonb; line jsonb;
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true); n integer:=0; item uuid; missing boolean; excessive boolean; movement uuid;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 lines:=vetx_trade.normalize_lines(raw,true);
 IF num_nonnulls(purchase,receipt,lines)<>3 THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT * INTO r FROM public.purchase_receipts WHERE (organization_id,clinic_id,id)=(org,clinic,receipt);
 IF FOUND THEN
   existing:=vetx_trade.receipt(r);
   IF (r.order_id,r.actor_issuer,r.actor_subject) IS DISTINCT FROM (purchase,issuer,subj) OR lines<>(SELECT jsonb_agg(i-'movementId' ORDER BY l.n)
     FROM jsonb_array_elements(existing->'lines') WITH ORDINALITY l(i,n)) THEN RETURN '{"error":"conflict"}'; END IF;
   RETURN existing;
 END IF;
 IF NOT EXISTS(SELECT FROM public.purchase_orders WHERE (organization_id,clinic_id,id)=(org,clinic,purchase)) THEN RETURN '{"error":"not_found"}'; END IF;
 -- Validate the combined delivery quantity for each ordered item before posting.
 -- A split-lot receipt can contain many lines for the same catalog item.
 WITH requested AS (
   SELECT (l->>'itemId')::uuid AS item_id,sum((l->>'quantity')::numeric) AS quantity FROM jsonb_array_elements(lines) l GROUP BY (l->>'itemId')::uuid
 )
 SELECT bool_or(o.item_id IS NULL),bool_or(requested.quantity>o.quantity-vetx_trade.received(org,clinic,purchase,requested.item_id))
 INTO missing,excessive FROM requested LEFT JOIN public.purchase_lines o ON (o.organization_id,o.clinic_id,o.order_id,o.item_id)=(org,clinic,purchase,requested.item_id);
 IF missing THEN RETURN '{"error":"not_found"}'; END IF;
 IF excessive THEN RETURN '{"error":"conflict"}'; END IF;
 INSERT INTO public.purchase_receipts(organization_id,clinic_id,id,order_id,actor_issuer,actor_subject) VALUES(org,clinic,receipt,purchase,issuer,subj) RETURNING * INTO r;
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
   n:=n+1; item:=(line->>'itemId')::uuid;
   movement:=vetx_trade.stock(item,(line->>'warehouseId')::uuid,line->>'lot',(line->>'quantity')::numeric,'RECEIPT','Purchase receipt');
   INSERT INTO public.purchase_receipt_lines VALUES(org,clinic,receipt,purchase,item,movement,n);
 END LOOP;
 RETURN vetx_trade.receipt(r);
EXCEPTION WHEN SQLSTATE 'P6100' THEN RETURN jsonb_build_object('error',SQLERRM);
END
$$;
CREATE FUNCTION vetx_trade.return_entry(r public.supplier_returns) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT vetx_trade.event(r.id,r.actor_issuer,r.actor_subject,r.recorded_at)||jsonb_build_object('orderId',l.order_id,'receiptMovementId',r.receipt_movement_id,
 'movementId',m.id,'quantity',m.quantity::text,'reason',r.reason) FROM public.purchase_receipt_lines l,public.stock_movements m
 WHERE (l.organization_id,l.clinic_id,l.movement_id)=(r.organization_id,r.clinic_id,r.receipt_movement_id)
 AND (m.organization_id,m.clinic_id,m.id)=(r.organization_id,r.clinic_id,r.movement_id)
$$;
CREATE FUNCTION public.trade_return(purchase uuid,return_id uuid,received_move uuid,amount_input text,reason_input text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); r public.supplier_returns; m public.stock_movements;
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true);
 amount numeric:=vetx_trade.amount(amount_input); already numeric; movement uuid; output jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(purchase,return_id,received_move,amount)<>4 OR NOT vetx_stock.label(reason_input,250) THEN RETURN '{"error":"invalid"}'; END IF;
 reason_input:=btrim(reason_input);
 SELECT * INTO r FROM public.supplier_returns WHERE (organization_id,clinic_id,id)=(org,clinic,return_id);
 IF FOUND THEN
   output:=vetx_trade.return_entry(r);
   IF (r.actor_issuer,r.actor_subject,r.receipt_movement_id,r.reason,output->>'quantity',output->>'orderId')
    IS DISTINCT FROM (issuer,subj,received_move,reason_input,amount::text,purchase::text) THEN RETURN '{"error":"conflict"}'; END IF;
   RETURN output;
 END IF;
 SELECT stock.* INTO m FROM public.purchase_receipt_lines l JOIN public.stock_movements stock ON (stock.organization_id,stock.clinic_id,stock.id)=(l.organization_id,l.clinic_id,l.movement_id)
 WHERE (l.organization_id,l.clinic_id,l.order_id,l.movement_id)=(org,clinic,purchase,received_move);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT coalesce(sum(stock.quantity),0) INTO already FROM public.supplier_returns ret JOIN public.stock_movements stock
 ON (stock.organization_id,stock.clinic_id,stock.id)=(ret.organization_id,ret.clinic_id,ret.movement_id)
 WHERE (ret.organization_id,ret.clinic_id,ret.receipt_movement_id)=(org,clinic,received_move);
 IF amount+already>m.quantity THEN RETURN '{"error":"conflict"}'; END IF;
 movement:=vetx_trade.stock(m.item_id,m.to_warehouse_id,m.lot,amount,'ISSUE','Supplier return');
 INSERT INTO public.supplier_returns(organization_id,clinic_id,id,receipt_movement_id,movement_id,reason,actor_issuer,actor_subject)
 VALUES(org,clinic,return_id,received_move,movement,reason_input,issuer,subj) RETURNING * INTO r;
 RETURN vetx_trade.return_entry(r);
EXCEPTION WHEN SQLSTATE 'P6100' THEN RETURN jsonb_build_object('error',SQLERRM);
END
$$;

CREATE FUNCTION vetx_trade.eligible(org uuid,clinic uuid,account uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT FROM public.organization_memberships m WHERE (m.organization_id,m.user_id)=(org,account)
 AND (m.role='ADMIN' OR EXISTS(SELECT FROM public.clinic_grants g WHERE (g.organization_id,g.clinic_id,g.user_id)=(org,clinic,account))))
$$;
CREATE FUNCTION vetx_trade.capability(org uuid,clinic uuid,u public.users) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('issuer',u.identity_issuer,'subject',u.identity_subject,'clinicAccess',vetx_trade.eligible(org,clinic,u.id),
 'canPrescribe',coalesce(c.can_prescribe,false),'canDispense',coalesce(c.can_dispense,false),'revision',coalesce(c.revision,0))
 FROM (VALUES(1)) sentinel(x) LEFT JOIN public.pharmacy_capabilities c ON (c.organization_id,c.clinic_id,c.user_id)=(org,clinic,u.id)
$$;
CREATE FUNCTION vetx_trade.permitted(org uuid,clinic uuid,prescribing boolean) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT vetx_registry.staff_access(org,clinic) AND EXISTS(SELECT FROM public.pharmacy_capabilities c JOIN public.users u ON u.id=c.user_id
 WHERE (c.organization_id,c.clinic_id,u.identity_issuer,u.identity_subject)=(org,clinic,current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'))
 AND CASE WHEN prescribing THEN c.can_prescribe ELSE c.can_dispense END)
$$;
CREATE POLICY prescriber_required ON public.patient_prescriptions AS RESTRICTIVE FOR INSERT TO vetx_migration
 WITH CHECK(vetx_trade.permitted(organization_id,clinic_id,true));
CREATE POLICY dispenser_required ON public.prescription_dispensings AS RESTRICTIVE FOR INSERT TO vetx_migration
 WITH CHECK(vetx_trade.permitted(organization_id,clinic_id,false));
CREATE FUNCTION public.pharmacy_me() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 SELECT vetx_trade.capability(vetx_directory.organization_id(),vetx_registry.clinic_id(),u) INTO result FROM public.users u
 WHERE (u.identity_issuer,u.identity_subject)=(current_setting('vetx.identity_issuer'),current_setting('vetx.identity_subject'));
 RETURN result;
END
$$;
CREATE FUNCTION public.pharmacy_grant(subject_input text,prescribe boolean,dispense boolean,expected integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); c public.pharmacy_capabilities; account public.users;
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR NOT vetx_directory.is_admin() THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(subject_input,prescribe,dispense,expected)<>4 OR expected<0 THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT * INTO account FROM public.users WHERE (identity_issuer,identity_subject)=(issuer,subject_input);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO c FROM public.pharmacy_capabilities WHERE (organization_id,clinic_id,user_id)=(org,clinic,account.id);
 IF NOT FOUND THEN
   IF NOT vetx_trade.eligible(org,clinic,account.id) THEN RETURN '{"error":"not_found"}'; END IF;
   IF expected<>0 THEN RETURN '{"error":"conflict"}'; END IF;
   IF NOT prescribe AND NOT dispense THEN RETURN vetx_trade.capability(org,clinic,account); END IF;
   INSERT INTO public.pharmacy_capabilities VALUES(org,clinic,account.id,prescribe,dispense,1,issuer,subj) RETURNING * INTO c;
 ELSE
   IF (c.can_prescribe,c.can_dispense)=(prescribe,dispense) AND (c.revision=expected OR
     (c.revision-1=expected AND (c.actor_issuer,c.actor_subject)=(issuer,subj))) THEN RETURN vetx_trade.capability(org,clinic,account); END IF;
   IF c.revision<>expected OR c.revision=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
   IF NOT vetx_trade.eligible(org,clinic,account.id) AND ((prescribe AND NOT c.can_prescribe) OR (dispense AND NOT c.can_dispense))
    THEN RETURN '{"error":"not_found"}'; END IF;
   UPDATE public.pharmacy_capabilities SET can_prescribe=prescribe,can_dispense=dispense,revision=revision+1,actor_issuer=issuer,actor_subject=subj
    WHERE (organization_id,clinic_id,user_id)=(org,clinic,account.id) RETURNING * INTO c;
 END IF;
 INSERT INTO public.pharmacy_events(organization_id,clinic_id,target_id,action,revision,actor_issuer,actor_subject)
 VALUES(org,clinic,account.id,'CAPABILITIES_CHANGED',c.revision,issuer,subj);
 RETURN vetx_trade.capability(org,clinic,account);
END
$$;

CREATE FUNCTION vetx_trade.sharing(org uuid,clinic uuid,patient uuid,rx uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('revision',coalesce(s.revision,0),'guardianIds',coalesce((SELECT jsonb_agg(g.id ORDER BY g.id) FROM public.guardians g
 WHERE (g.organization_id,g.clinic_id,g.patient_id)=(org,clinic,patient) AND g.id=ANY(s.guardian_ids) AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL),'[]'))
 FROM (VALUES(1)) sentinel(x) LEFT JOIN public.prescription_sharing s ON (s.organization_id,s.clinic_id,s.prescription_id)=(org,clinic,rx)
$$;
CREATE FUNCTION vetx_trade.dispensed(org uuid,clinic uuid,rx uuid) RETURNS numeric LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(sum(m.quantity),0.000) FROM public.prescription_dispensings d JOIN public.stock_movements m
 ON (m.organization_id,m.clinic_id,m.id)=(d.organization_id,d.clinic_id,d.movement_id)
 WHERE (d.organization_id,d.clinic_id,d.prescription_id)=(org,clinic,rx)
$$;
CREATE FUNCTION vetx_trade.prescription(r public.patient_prescriptions) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT vetx_trade.event(r.id,r.actor_issuer,r.actor_subject,r.recorded_at)||jsonb_build_object('patientId',r.patient_id,'itemId',r.item_id,'itemName',r.item_name,
 'unit',r.unit,'medication',r.medication,'instructions',r.instructions,'quantity',r.quantity::text,
 'dispensedQuantity',vetx_trade.dispensed(r.organization_id,r.clinic_id,r.id)::text,'sharing',vetx_trade.sharing(r.organization_id,r.clinic_id,r.patient_id,r.id))
$$;
CREATE FUNCTION public.pharmacy_prescribe(patient uuid,rx uuid,item uuid,med text,directions text,amount_input text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); r public.patient_prescriptions; i public.inventory_items;
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true); amount numeric:=vetx_trade.amount(amount_input);
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR NOT vetx_trade.permitted(org,clinic,true) THEN RETURN '{"error":"forbidden"}'; END IF;
 directions:=vetx_care.clean(directions);
 IF num_nonnulls(patient,rx,item,amount,directions)<>5 OR NOT vetx_stock.label(med,250) OR length(directions) NOT BETWEEN 1 AND 8000 OR
 translate(directions,E'\t\n\r','') ~ '[[:cntrl:]]' THEN RETURN '{"error":"invalid"}'; END IF;
 med:=btrim(med);
 SELECT * INTO r FROM public.patient_prescriptions WHERE (organization_id,clinic_id,id)=(org,clinic,rx);
 IF FOUND THEN
   IF (r.patient_id,r.item_id,r.medication,r.instructions,r.quantity,r.actor_issuer,r.actor_subject)
    IS DISTINCT FROM (patient,item,med,directions,amount,issuer,subj) THEN RETURN '{"error":"conflict"}'; END IF;
 ELSE
   SELECT * INTO i FROM public.inventory_items WHERE (organization_id,clinic_id,id)=(org,clinic,item);
   IF NOT FOUND OR NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) THEN RETURN '{"error":"not_found"}'; END IF;
   INSERT INTO public.patient_prescriptions(organization_id,clinic_id,id,patient_id,item_id,item_name,unit,medication,instructions,quantity,actor_issuer,actor_subject)
    VALUES(org,clinic,rx,patient,item,i.name,i.unit,med,directions,amount,issuer,subj) RETURNING * INTO r;
 END IF;
 RETURN vetx_trade.prescription(r);
END
$$;
CREATE FUNCTION vetx_trade.dispensing(d public.prescription_dispensings) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT vetx_trade.event(d.id,d.actor_issuer,d.actor_subject,d.recorded_at)||jsonb_build_object('prescriptionId',d.prescription_id,'movementId',m.id,
 'quantity',m.quantity::text,'lot',m.lot,'warehouseId',m.from_warehouse_id) FROM public.stock_movements m WHERE (m.organization_id,m.clinic_id,m.id)=(d.organization_id,d.clinic_id,d.movement_id)
$$;
CREATE FUNCTION public.pharmacy_dispense(patient uuid,rx uuid,request uuid,warehouse uuid,lot_input text,amount_input text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); r public.patient_prescriptions; d public.prescription_dispensings;
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true); amount numeric:=vetx_trade.amount(amount_input); movement uuid; output jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR NOT vetx_trade.permitted(org,clinic,false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(patient,rx,request,warehouse,lot_input,amount)<>6 OR length(btrim(lot_input))>120 OR lot_input ~ '[[:cntrl:]]' THEN RETURN '{"error":"invalid"}'; END IF;
 lot_input:=btrim(lot_input);
 SELECT * INTO r FROM public.patient_prescriptions WHERE (organization_id,clinic_id,id,patient_id)=(org,clinic,rx,patient);
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO d FROM public.prescription_dispensings WHERE (organization_id,clinic_id,id)=(org,clinic,request);
 IF FOUND THEN
  output:=vetx_trade.dispensing(d);
  IF (d.prescription_id,d.actor_issuer,d.actor_subject,output->>'warehouseId',output->>'lot',output->>'quantity')
   IS DISTINCT FROM (rx,issuer,subj,warehouse::text,lot_input,amount::text) THEN RETURN '{"error":"conflict"}'; END IF;
  RETURN output;
 END IF;
 IF amount+vetx_trade.dispensed(org,clinic,rx)>r.quantity THEN RETURN '{"error":"conflict"}'; END IF;
 movement:=vetx_trade.stock(r.item_id,warehouse,lot_input,amount,'ISSUE','Prescription dispensing');
 INSERT INTO public.prescription_dispensings(organization_id,clinic_id,id,prescription_id,movement_id,actor_issuer,actor_subject)
 VALUES(org,clinic,request,rx,movement,issuer,subj) RETURNING * INTO d;
 RETURN vetx_trade.dispensing(d);
EXCEPTION WHEN SQLSTATE 'P6100' THEN RETURN jsonb_build_object('error',SQLERRM);
END
$$;
CREATE FUNCTION public.pharmacy_share(patient uuid,rx uuid,guardians_input uuid[],expected integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); s public.prescription_sharing; ids uuid[];
 issuer text:=current_setting('vetx.identity_issuer',true); subj text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR NOT vetx_trade.permitted(org,clinic,true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF expected IS NULL OR expected<0 OR guardians_input IS NULL OR cardinality(guardians_input)>100 THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),ARRAY[]::uuid[]) INTO ids FROM unnest(guardians_input) id WHERE id IS NOT NULL;
 IF cardinality(ids)<>cardinality(guardians_input) THEN RETURN '{"error":"invalid"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.patient_prescriptions WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,rx))
  OR cardinality(ids)<>(SELECT count(*) FROM public.guardians g WHERE (g.organization_id,g.clinic_id,g.patient_id)=(org,clinic,patient) AND g.id=ANY(ids)
    AND g.removed_at IS NULL AND g.owner_subject IS NOT NULL) THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO s FROM public.prescription_sharing WHERE (organization_id,clinic_id,prescription_id)=(org,clinic,rx);
 IF NOT FOUND THEN
  IF expected<>0 THEN RETURN '{"error":"conflict"}'; END IF;
  IF cardinality(ids)=0 THEN RETURN vetx_trade.sharing(org,clinic,patient,rx); END IF;
  INSERT INTO public.prescription_sharing VALUES(org,clinic,rx,patient,ids,1,issuer,subj) RETURNING * INTO s;
 ELSE
  IF s.guardian_ids=ids AND (s.revision=expected OR (s.revision-1=expected AND (s.actor_issuer,s.actor_subject)=(issuer,subj))) THEN RETURN vetx_trade.sharing(org,clinic,patient,rx); END IF;
  IF s.revision<>expected OR expected=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
  UPDATE public.prescription_sharing SET guardian_ids=ids,revision=revision+1,actor_issuer=issuer,actor_subject=subj WHERE (organization_id,clinic_id,prescription_id)=(org,clinic,rx) RETURNING * INTO s;
 END IF;
 INSERT INTO public.pharmacy_events(organization_id,clinic_id,target_id,action,revision,actor_issuer,actor_subject)
 VALUES(org,clinic,rx,'SHARING_CHANGED',s.revision,issuer,subj);
 RETURN vetx_trade.sharing(org,clinic,patient,rx);
END
$$;

CREATE FUNCTION public.trade_suppliers_list(page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT jsonb_build_object('id',t.id,'name',t.name,'revision',t.revision) AS entry,lower(t.name) AS sort_key,t.id AS tie FROM public.trade_suppliers t
  WHERE (t.organization_id,t.clinic_id)=(org,clinic) ORDER BY sort_key ASC,tie LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY sort_key ASC,tie LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'suppliers',coalesce(jsonb_agg(entry ORDER BY sort_key ASC,tie),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.trade_orders_list(page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT vetx_trade.purchase(t) AS entry,t.recorded_at AS sort_key,t.id AS tie FROM public.purchase_orders t
  WHERE (t.organization_id,t.clinic_id)=(org,clinic) ORDER BY sort_key DESC,tie LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY sort_key DESC,tie LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'orders',coalesce(jsonb_agg(entry ORDER BY sort_key DESC,tie),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.trade_receipts_list(purchase uuid,page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.purchase_orders WHERE (organization_id,clinic_id,id)=(org,clinic,purchase)) THEN RETURN '{"error":"not_found"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT vetx_trade.receipt(t) AS entry,t.recorded_at AS sort_key,t.id AS tie FROM public.purchase_receipts t
  WHERE (t.organization_id,t.clinic_id,t.order_id)=(org,clinic,purchase) ORDER BY sort_key DESC,tie LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY sort_key DESC,tie LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'receipts',coalesce(jsonb_agg(entry ORDER BY sort_key DESC,tie),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.trade_returns_list(purchase uuid,page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.purchase_orders WHERE (organization_id,clinic_id,id)=(org,clinic,purchase)) THEN RETURN '{"error":"not_found"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT vetx_trade.return_entry(t) AS entry,t.recorded_at AS sort_key,t.id AS tie FROM public.supplier_returns t JOIN public.purchase_receipt_lines l ON (l.organization_id,l.clinic_id,l.movement_id)=(t.organization_id,t.clinic_id,t.receipt_movement_id)
  WHERE (t.organization_id,t.clinic_id,l.order_id)=(org,clinic,purchase) ORDER BY sort_key DESC,tie LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY sort_key DESC,tie LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'returns',coalesce(jsonb_agg(entry ORDER BY sort_key DESC,tie),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.pharmacy_prescriptions_list(patient uuid,page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.patients WHERE (organization_id,clinic_id,id)=(org,clinic,patient)) THEN RETURN '{"error":"not_found"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT vetx_trade.prescription(t) AS entry,t.recorded_at AS sort_key,t.id AS tie FROM public.patient_prescriptions t
  WHERE (t.organization_id,t.clinic_id,t.patient_id)=(org,clinic,patient) ORDER BY sort_key DESC,tie LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY sort_key DESC,tie LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'prescriptions',coalesce(jsonb_agg(entry ORDER BY sort_key DESC,tie),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.pharmacy_dispensings_list(patient uuid,rx uuid,page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.patient_prescriptions WHERE (organization_id,clinic_id,patient_id,id)=(org,clinic,patient,rx)) THEN RETURN '{"error":"not_found"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT vetx_trade.dispensing(t) AS entry,t.recorded_at AS sort_key,t.id AS tie FROM public.prescription_dispensings t
  WHERE (t.organization_id,t.clinic_id,t.prescription_id)=(org,clinic,rx) ORDER BY sort_key DESC,tie LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY sort_key DESC,tie LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'dispensings',coalesce(jsonb_agg(entry ORDER BY sort_key DESC,tie),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.pharmacy_capabilities_list(page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF NOT vetx_directory.is_admin() THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT vetx_trade.capability(org,clinic,t) AS entry,t.identity_subject AS sort_key,t.id AS tie FROM public.users t
  WHERE t.identity_issuer=current_setting('vetx.identity_issuer') AND (vetx_trade.eligible(org,clinic,t.id) OR EXISTS(SELECT FROM public.pharmacy_capabilities c WHERE (c.organization_id,c.clinic_id,c.user_id)=(org,clinic,t.id))) ORDER BY sort_key ASC,tie LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY sort_key ASC,tie LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'capabilities',coalesce(jsonb_agg(entry ORDER BY sort_key ASC,tie),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.pharmacy_owner_list(pet uuid,page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF current_setting('vetx.client_kind',true) IS DISTINCT FROM 'owner' THEN RETURN '{"error":"forbidden"}'; END IF;
 IF NOT EXISTS(SELECT FROM public.guardians g WHERE g.pet_id=pet AND g.removed_at IS NULL AND vetx_registry.self(g.recipient_issuer,g.owner_subject)) THEN RETURN '{"error":"not_found"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT jsonb_build_object('id',t.id,'patientId',t.patient_id,'clinicId',t.clinic_id,'clinicName',c.name,'organizationName',o.name,'medication',t.medication,'instructions',t.instructions,'quantity',t.quantity::text,'unit',t.unit,'recordedAt',vetx_care.utc(t.recorded_at)) AS entry,t.recorded_at AS sort_key,t.clinic_id::text||t.id::text AS tie FROM public.patient_prescriptions t JOIN public.clinics c ON (c.organization_id,c.id)=(t.organization_id,t.clinic_id)
  JOIN public.organizations o ON o.id=t.organization_id
  WHERE vetx_trade.released(t.organization_id,t.clinic_id,t.patient_id,t.id,pet) ORDER BY sort_key DESC,tie LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY sort_key DESC,tie LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'prescriptions',coalesce(jsonb_agg(entry ORDER BY sort_key DESC,tie),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;
REVOKE ALL ON FUNCTION
 public.trade_lock_tables(),
 public.trade_save_supplier(uuid,text,integer),
 public.trade_order(uuid,uuid,jsonb),
 public.trade_receive(uuid,uuid,jsonb),
 public.trade_return(uuid,uuid,uuid,text,text),
 public.pharmacy_me(),
 public.pharmacy_grant(text,boolean,boolean,integer),
 public.pharmacy_prescribe(uuid,uuid,uuid,text,text,text),
 public.pharmacy_dispense(uuid,uuid,uuid,uuid,text,text),
 public.pharmacy_share(uuid,uuid,uuid[],integer),
 public.trade_suppliers_list(integer),
 public.trade_orders_list(integer),
 public.trade_receipts_list(uuid,integer),
 public.trade_returns_list(uuid,integer),
 public.pharmacy_prescriptions_list(uuid,integer),
 public.pharmacy_dispensings_list(uuid,uuid,integer),
 public.pharmacy_capabilities_list(integer),
 public.pharmacy_owner_list(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 public.trade_lock_tables(),
 public.trade_save_supplier(uuid,text,integer),
 public.trade_order(uuid,uuid,jsonb),
 public.trade_receive(uuid,uuid,jsonb),
 public.trade_return(uuid,uuid,uuid,text,text),
 public.pharmacy_me(),
 public.pharmacy_grant(text,boolean,boolean,integer),
 public.pharmacy_prescribe(uuid,uuid,uuid,text,text,text),
 public.pharmacy_dispense(uuid,uuid,uuid,uuid,text,text),
 public.pharmacy_share(uuid,uuid,uuid[],integer),
 public.trade_suppliers_list(integer),
 public.trade_orders_list(integer),
 public.trade_receipts_list(uuid,integer),
 public.trade_returns_list(uuid,integer),
 public.pharmacy_prescriptions_list(uuid,integer),
 public.pharmacy_dispensings_list(uuid,uuid,integer),
 public.pharmacy_capabilities_list(integer),
 public.pharmacy_owner_list(uuid,integer) TO vetx_runtime;
COMMIT;
