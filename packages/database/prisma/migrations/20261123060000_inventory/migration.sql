BEGIN;
CREATE SCHEMA vetx_stock;
REVOKE ALL ON SCHEMA vetx_stock FROM PUBLIC;
CREATE TABLE public.inventory_warehouses (
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL, revision integer NOT NULL CHECK(revision>0),
 actor_issuer text NOT NULL, actor_subject text NOT NULL,
 PRIMARY KEY(organization_id,clinic_id,id), FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id)
);
CREATE UNIQUE INDEX inventory_warehouse_name ON public.inventory_warehouses(organization_id,clinic_id,lower(name));
CREATE TABLE public.inventory_items (
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL, sku text NOT NULL, unit text NOT NULL,
 actor_issuer text NOT NULL, actor_subject text NOT NULL,
 revision integer NOT NULL CHECK(revision>0), PRIMARY KEY(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id) REFERENCES public.clinics(organization_id,id)
);
CREATE UNIQUE INDEX inventory_clinic_sku ON public.inventory_items(organization_id,clinic_id,lower(sku));
CREATE INDEX inventory_name ON public.inventory_items(organization_id,clinic_id,lower(name),id);
CREATE TABLE public.stock_balances (
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, warehouse_id uuid NOT NULL, item_id uuid NOT NULL, lot text NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK(quantity>=0 AND quantity<1000000000000000), PRIMARY KEY(organization_id,clinic_id,warehouse_id,item_id,lot),
 FOREIGN KEY(organization_id,clinic_id,warehouse_id) REFERENCES public.inventory_warehouses(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,item_id) REFERENCES public.inventory_items(organization_id,clinic_id,id)
);
CREATE TABLE public.stock_movements (
 ledger_sequence bigint GENERATED ALWAYS AS IDENTITY,
 item_name text NOT NULL,sku text NOT NULL,unit text NOT NULL,from_warehouse_name text,to_warehouse_name text,
 organization_id uuid NOT NULL, clinic_id uuid NOT NULL, id uuid NOT NULL, item_id uuid NOT NULL,
 kind text NOT NULL, from_warehouse_id uuid, to_warehouse_id uuid, lot text NOT NULL, reason text NOT NULL,
 quantity numeric(18,3) NOT NULL CHECK(quantity>0 AND quantity<1000000000000000), from_balance numeric(18,3), to_balance numeric(18,3),
 recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),actor_issuer text NOT NULL,actor_subject text NOT NULL,
 PRIMARY KEY(organization_id,clinic_id,id),
 CHECK ((from_warehouse_id IS NULL) = (from_balance IS NULL) AND (to_warehouse_id IS NULL) = (to_balance IS NULL)),
 CHECK (from_balance>=0 AND to_balance>=0),
 CHECK((kind IN ('RECEIPT','RETURN','ADJUST_IN') AND from_warehouse_id IS NULL AND to_warehouse_id IS NOT NULL) OR
       (kind IN ('ISSUE','ADJUST_OUT') AND from_warehouse_id IS NOT NULL AND to_warehouse_id IS NULL) OR
       (kind='TRANSFER' AND from_warehouse_id IS NOT NULL AND to_warehouse_id IS NOT NULL AND from_warehouse_id<>to_warehouse_id)),
 FOREIGN KEY(organization_id,clinic_id,from_warehouse_id) REFERENCES public.inventory_warehouses(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,to_warehouse_id) REFERENCES public.inventory_warehouses(organization_id,clinic_id,id),
 FOREIGN KEY(organization_id,clinic_id,item_id) REFERENCES public.inventory_items(organization_id,clinic_id,id)
);
CREATE INDEX stock_chronology ON public.stock_movements(organization_id,clinic_id,ledger_sequence DESC);
CREATE INDEX stock_item_history ON public.stock_movements(organization_id,clinic_id,item_id);
ALTER TABLE public.inventory_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['inventory_warehouses','inventory_items'] LOOP
    EXECUTE format('CREATE POLICY read_clinic ON public.%I FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id))',tbl);
    EXECUTE format('CREATE POLICY admin_create ON public.%I FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id) AND vetx_directory.is_admin())',tbl);
    EXECUTE format('CREATE POLICY admin_edit ON public.%I FOR UPDATE TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id) AND vetx_directory.is_admin())',tbl);
  END LOOP;
END
$$;
CREATE POLICY read_clinic ON public.stock_balances FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY new_balance ON public.stock_balances FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY change_balance ON public.stock_balances FOR UPDATE TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY read ON public.stock_movements FOR SELECT TO vetx_migration USING(vetx_registry.staff_access(organization_id,clinic_id));
CREATE POLICY append ON public.stock_movements FOR INSERT TO vetx_migration WITH CHECK(vetx_registry.staff_access(organization_id,clinic_id)
 AND actor_issuer=current_setting('vetx.identity_issuer') AND actor_subject=current_setting('vetx.identity_subject'));
REVOKE ALL ON public.inventory_warehouses,public.inventory_items,public.stock_balances,public.stock_movements FROM PUBLIC,vetx_runtime;
CREATE FUNCTION public.stock_lock_tables() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN LOCK TABLE public.inventory_warehouses,public.inventory_items,public.stock_balances,public.stock_movements IN ACCESS SHARE MODE; RETURN true; END $$;
CREATE FUNCTION vetx_stock.label(v text,lim integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT v IS NOT NULL AND length(btrim(v)) BETWEEN 1 AND lim AND v !~ '[[:cntrl:]]'
$$;
CREATE FUNCTION vetx_stock.movement(m public.stock_movements) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',m.id,'kind',m.kind,'itemId',m.item_id,'quantity',m.quantity::text,'fromWarehouseId',m.from_warehouse_id,
 'itemName',m.item_name,'sku',m.sku,'unit',m.unit,'fromWarehouseName',m.from_warehouse_name,'toWarehouseName',m.to_warehouse_name,
 'toWarehouseId',m.to_warehouse_id,'fromBalance',m.from_balance::text,'toBalance',m.to_balance::text,'lot',m.lot,'reason',m.reason,
 'recordedAt',vetx_care.utc(m.recorded_at),'actor',jsonb_build_object('issuer',m.actor_issuer,'subject',m.actor_subject))
$$;

CREATE FUNCTION vetx_stock.warehouse(w public.inventory_warehouses) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',w.id,'name',w.name,'revision',w.revision)
$$;
CREATE FUNCTION vetx_stock.item(i public.inventory_items) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',i.id,'name',i.name,'sku',i.sku,'unit',i.unit,'revision',i.revision,
 'unitLocked',exists(select from public.stock_movements m where (m.organization_id,m.clinic_id,m.item_id)=(i.organization_id,i.clinic_id,i.id)))
$$;

CREATE FUNCTION public.stock_save_warehouse(warehouse uuid,name_input text,expected integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); w public.inventory_warehouses;
 issuer text:=current_setting('vetx.identity_issuer',true); subject text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR vetx_directory.is_admin() IS NOT TRUE THEN RETURN '{"error":"forbidden"}'; END IF;
 IF warehouse IS NULL OR expected IS NULL OR expected<0 OR NOT vetx_stock.label(name_input,120) THEN RETURN '{"error":"invalid"}'; END IF;
 name_input:=btrim(name_input);
 SELECT * INTO w FROM public.inventory_warehouses WHERE (organization_id,clinic_id,id)=(org,clinic,warehouse);
 IF NOT FOUND THEN
   IF expected<>0 THEN RETURN '{"error":"not_found"}'; END IF;
   INSERT INTO public.inventory_warehouses(organization_id,clinic_id,id,name,revision,actor_issuer,actor_subject)
     VALUES(org,clinic,warehouse,name_input,1,issuer,subject) RETURNING * INTO w;
 ELSE
   IF w.name=name_input AND (expected=w.revision OR (expected=w.revision-1 AND (w.actor_issuer,w.actor_subject)=(issuer,subject)))
     THEN RETURN vetx_stock.warehouse(w); END IF;
   IF expected<>w.revision OR expected=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
   UPDATE public.inventory_warehouses SET name=name_input,revision=revision+1,actor_issuer=issuer,actor_subject=subject
     WHERE (organization_id,clinic_id,id)=(org,clinic,warehouse) RETURNING * INTO w;
 END IF;
 RETURN vetx_stock.warehouse(w);
EXCEPTION WHEN unique_violation THEN RETURN '{"error":"conflict"}';
END
$$;

CREATE FUNCTION vetx_stock.keep_base_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS (SELECT FROM public.stock_movements m WHERE (m.organization_id,m.clinic_id,m.item_id)=(OLD.organization_id,OLD.clinic_id,OLD.id))
   THEN RAISE EXCEPTION 'Base unit has stock history' USING ERRCODE='23514',CONSTRAINT='stock_item_base_unit'; END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER preserve_stock_unit BEFORE UPDATE OF unit ON public.inventory_items
 FOR EACH ROW WHEN (OLD.unit IS DISTINCT FROM NEW.unit) EXECUTE FUNCTION vetx_stock.keep_base_unit();

CREATE FUNCTION public.stock_save_item(item_id_input uuid,name_input text,sku_input text,unit_input text,expected integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); item public.inventory_items;
 issuer text:=current_setting('vetx.identity_issuer',true); subject text:=current_setting('vetx.identity_subject',true);
BEGIN
 IF NOT vetx_registry.clinic_access(true) OR vetx_directory.is_admin() IS NOT TRUE THEN RETURN '{"error":"forbidden"}'; END IF;
 IF item_id_input IS NULL OR expected IS NULL OR expected<0 OR NOT vetx_stock.label(name_input,120)
   OR NOT vetx_stock.label(sku_input,80) OR NOT vetx_stock.label(unit_input,40) THEN RETURN '{"error":"invalid"}'; END IF;
 name_input:=btrim(name_input); sku_input:=btrim(sku_input); unit_input:=btrim(unit_input);
 SELECT * INTO item FROM public.inventory_items WHERE (organization_id,clinic_id,id)=(org,clinic,item_id_input);
 IF NOT FOUND THEN
   IF expected<>0 THEN RETURN '{"error":"not_found"}'; END IF;
   INSERT INTO public.inventory_items(organization_id,clinic_id,id,name,sku,unit,revision,actor_issuer,actor_subject)
     VALUES(org,clinic,item_id_input,name_input,sku_input,unit_input,1,issuer,subject) RETURNING * INTO item;
 ELSE
   IF (item.name,item.sku,item.unit)=(name_input,sku_input,unit_input) AND
     (expected=item.revision OR (expected=item.revision-1 AND (item.actor_issuer,item.actor_subject)=(issuer,subject))) THEN RETURN vetx_stock.item(item); END IF;
   IF expected<>item.revision OR expected=2147483647 THEN RETURN '{"error":"conflict"}'; END IF;
   UPDATE public.inventory_items SET name=name_input,sku=sku_input,unit=unit_input,revision=revision+1,actor_issuer=issuer,actor_subject=subject
     WHERE (organization_id,clinic_id,id)=(org,clinic,item_id_input) RETURNING * INTO item;
 END IF;
 RETURN vetx_stock.item(item);
EXCEPTION WHEN unique_violation OR check_violation THEN RETURN '{"error":"conflict"}';
END
$$;

CREATE FUNCTION public.stock_list_warehouses(page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT w FROM public.inventory_warehouses w WHERE (w.organization_id,w.clinic_id)=(org,clinic)
   ORDER BY lower(w.name),w.id LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY lower((w).name),(w).id LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),
   'warehouses',coalesce(jsonb_agg(vetx_stock.warehouse(w) ORDER BY lower((w).name),(w).id),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;
CREATE FUNCTION public.stock_list_items(search text,page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page IS NULL OR page<1 OR search IS NULL OR length(search)>120 THEN RETURN '{"error":"invalid"}'; END IF;
 search:=lower(btrim(search));
 WITH matches AS MATERIALIZED (SELECT i FROM public.inventory_items i WHERE (i.organization_id,i.clinic_id)=(org,clinic)
   AND (strpos(lower(i.name),search)>0 OR strpos(lower(i.sku),search)>0)
   ORDER BY lower(i.name),i.id LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY lower((i).name),(i).id LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),
   'items',coalesce(jsonb_agg(vetx_stock.item(i) ORDER BY lower((i).name),(i).id),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.stock_record_movement(request uuid,item uuid,kind_input text,origin uuid,destination uuid,amount_input text,lot_input text,reason_input text,expected_unit text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); movement public.stock_movements;
 issuer text:=current_setting('vetx.identity_issuer',true); subject text:=current_setting('vetx.identity_subject',true);
 amount numeric(18,3); after_debit numeric; after_credit numeric;
BEGIN
 -- This lock also serializes catalog edits and grant revocation with the ledger.
 IF NOT vetx_registry.clinic_access(true) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF num_nonnulls(request,item,kind_input,amount_input,lot_input,reason_input)<>6 OR NOT vetx_stock.label(expected_unit,40)
    OR amount_input !~ '^[0-9]{1,15}([.][0-9]{1,3})?$' OR length(btrim(lot_input))>120
    OR lot_input ~ '[[:cntrl:]]' OR NOT vetx_stock.label(reason_input,250) THEN RETURN '{"error":"invalid"}'; END IF;
 amount:=amount_input::numeric(18,3); lot_input:=btrim(lot_input); reason_input:=btrim(reason_input);
 IF amount<=0 OR NOT (
    (kind_input IN ('RECEIPT','RETURN','ADJUST_IN') AND origin IS NULL AND destination IS NOT NULL) OR
    (kind_input IN ('ISSUE','ADJUST_OUT') AND origin IS NOT NULL AND destination IS NULL) OR
    (kind_input='TRANSFER' AND origin IS NOT NULL AND destination IS NOT NULL AND origin<>destination)
 ) THEN RETURN '{"error":"invalid"}'; END IF;
 SELECT * INTO movement FROM public.stock_movements WHERE (organization_id,clinic_id,id)=(org,clinic,request);
 IF FOUND THEN
   IF (movement.actor_issuer,movement.actor_subject,movement.item_id,movement.kind,movement.from_warehouse_id,
     movement.to_warehouse_id,movement.quantity,movement.lot,movement.reason,movement.unit)
     IS DISTINCT FROM (issuer,subject,item,kind_input,origin,destination,amount,lot_input,reason_input,expected_unit)
     THEN RETURN '{"error":"conflict"}'; END IF;
   RETURN vetx_stock.movement(movement);
 END IF;
 IF NOT EXISTS (SELECT FROM public.inventory_items WHERE (organization_id,clinic_id,id)=(org,clinic,item))
   OR (origin IS NOT NULL AND NOT EXISTS (SELECT FROM public.inventory_warehouses WHERE (organization_id,clinic_id,id)=(org,clinic,origin)))
   OR (destination IS NOT NULL AND NOT EXISTS (SELECT FROM public.inventory_warehouses WHERE (organization_id,clinic_id,id)=(org,clinic,destination)))
   THEN RETURN '{"error":"not_found"}'; END IF;

 IF expected_unit IS DISTINCT FROM (SELECT i.unit FROM public.inventory_items i WHERE (i.organization_id,i.clinic_id,i.id)=(org,clinic,item)) THEN RETURN '{"error":"conflict"}'; END IF;

 -- Compute and validate both sides before writing either one. Historical
 -- balances stored on the event make an exact retry independent of later stock.
 IF origin IS NOT NULL THEN
   SELECT b.quantity-amount INTO after_debit FROM public.stock_balances b
     WHERE (b.organization_id,b.clinic_id,b.warehouse_id,b.item_id,b.lot)=(org,clinic,origin,item,lot_input);
   IF after_debit IS NULL OR after_debit<0 THEN RETURN '{"error":"conflict"}'; END IF;
 END IF;
 IF destination IS NOT NULL THEN
   SELECT b.quantity INTO after_credit FROM public.stock_balances b
     WHERE (b.organization_id,b.clinic_id,b.warehouse_id,b.item_id,b.lot)=(org,clinic,destination,item,lot_input);
   after_credit:=coalesce(after_credit,0)+amount;
   IF after_credit>=1000000000000000 THEN RETURN '{"error":"conflict"}'; END IF;
 END IF;
 IF origin IS NOT NULL THEN
   UPDATE public.stock_balances SET quantity=after_debit WHERE
     (organization_id,clinic_id,warehouse_id,item_id,lot)=(org,clinic,origin,item,lot_input);
 END IF;
 IF destination IS NOT NULL THEN
   INSERT INTO public.stock_balances(organization_id,clinic_id,warehouse_id,item_id,lot,quantity)
     VALUES(org,clinic,destination,item,lot_input,after_credit)
     ON CONFLICT (organization_id,clinic_id,warehouse_id,item_id,lot) DO UPDATE SET quantity=excluded.quantity;
 END IF;
 INSERT INTO public.stock_movements(organization_id,clinic_id,id,item_id,kind,from_warehouse_id,to_warehouse_id,
   quantity,lot,reason,from_balance,to_balance,actor_issuer,actor_subject,item_name,sku,unit,from_warehouse_name,to_warehouse_name)
   SELECT org,clinic,request,item,kind_input,origin,destination,amount,lot_input,reason_input,after_debit,after_credit,issuer,subject,
   i.name,i.sku,i.unit,src.name,dst.name FROM public.inventory_items i
   LEFT JOIN public.inventory_warehouses src ON (src.organization_id,src.clinic_id,src.id)=(org,clinic,origin)
   LEFT JOIN public.inventory_warehouses dst ON (dst.organization_id,dst.clinic_id,dst.id)=(org,clinic,destination)
   WHERE (i.organization_id,i.clinic_id,i.id)=(org,clinic,item)
   RETURNING * INTO movement;
 RETURN vetx_stock.movement(movement);
END
$$;

CREATE FUNCTION public.stock_list_balances(warehouse uuid,page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 IF warehouse IS NOT NULL AND NOT EXISTS (SELECT FROM public.inventory_warehouses WHERE (organization_id,clinic_id,id)=(org,clinic,warehouse))
   THEN RETURN '{"error":"not_found"}'; END IF;
 WITH matches AS MATERIALIZED (
   SELECT b.warehouse_id,w.name AS warehouse_name,b.item_id,i.name AS item_name,i.sku,i.unit,b.lot,b.quantity
   FROM public.stock_balances b
   JOIN public.inventory_warehouses w ON (w.organization_id,w.clinic_id,w.id)=(b.organization_id,b.clinic_id,b.warehouse_id)
   JOIN public.inventory_items i ON (i.organization_id,i.clinic_id,i.id)=(b.organization_id,b.clinic_id,b.item_id)
   WHERE (b.organization_id,b.clinic_id)=(org,clinic) AND (warehouse IS NULL OR b.warehouse_id=warehouse)
   ORDER BY lower(w.name),w.id,lower(i.name),i.id,b.lot LIMIT 26 OFFSET ((page::bigint-1)*25)
 ), visible AS (SELECT * FROM matches ORDER BY lower(warehouse_name),warehouse_id,lower(item_name),item_id,lot LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),'balances',coalesce(jsonb_agg(jsonb_build_object(
   'warehouseId',warehouse_id,'warehouseName',warehouse_name,'itemId',item_id,'itemName',item_name,'sku',sku,'unit',unit,'lot',lot,'quantity',quantity::text)
   ORDER BY lower(warehouse_name),warehouse_id,lower(item_name),item_id,lot),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

CREATE FUNCTION public.stock_list_movements(page integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid:=vetx_directory.organization_id(); clinic uuid:=vetx_registry.clinic_id(); result jsonb;
BEGIN
 IF NOT vetx_registry.clinic_access(false) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF page IS NULL OR page<1 THEN RETURN '{"error":"invalid"}'; END IF;
 WITH matches AS MATERIALIZED (SELECT m FROM public.stock_movements m WHERE (m.organization_id,m.clinic_id)=(org,clinic)
   ORDER BY m.ledger_sequence DESC LIMIT 26 OFFSET ((page::bigint-1)*25)),
 visible AS (SELECT * FROM matches ORDER BY (m).ledger_sequence DESC LIMIT 25)
 SELECT jsonb_build_object('page',page,'hasNextPage',(SELECT count(*)>25 FROM matches),
   'movements',coalesce(jsonb_agg(vetx_stock.movement(m) ORDER BY (m).ledger_sequence DESC),'[]')) INTO result FROM visible;
 RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.stock_lock_tables(),public.stock_save_warehouse(uuid,text,integer),public.stock_save_item(uuid,text,text,text,integer),
 public.stock_list_warehouses(integer),public.stock_list_items(text,integer),public.stock_record_movement(uuid,uuid,text,uuid,uuid,text,text,text,text),
 public.stock_list_balances(uuid,integer),public.stock_list_movements(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_lock_tables(),public.stock_save_warehouse(uuid,text,integer),public.stock_save_item(uuid,text,text,text,integer),
 public.stock_list_warehouses(integer),public.stock_list_items(text,integer),public.stock_record_movement(uuid,uuid,text,uuid,uuid,text,text,text,text),
 public.stock_list_balances(uuid,integer),public.stock_list_movements(integer) TO vetx_runtime;

COMMIT;
