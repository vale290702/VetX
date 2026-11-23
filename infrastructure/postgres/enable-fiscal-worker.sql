-- Run as the database administrator on an existing cluster after migrating.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF to_regrole('vetx_fiscal_worker') IS NULL THEN
   CREATE ROLE vetx_fiscal_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
 END IF;
END $$;
SELECT current_database() AS database_name \gset
GRANT CONNECT ON DATABASE :"database_name" TO vetx_fiscal_worker;
GRANT USAGE ON SCHEMA public TO vetx_fiscal_worker;
GRANT EXECUTE ON FUNCTION public.fiscal_provision(uuid,uuid,text,jsonb,bigint,boolean),public.fiscal_claim(text,integer),
 public.fiscal_save_signature(uuid,uuid,bytea),public.fiscal_start_delivery(uuid,uuid),public.fiscal_finish(uuid,uuid,text,text,int,bytea) TO vetx_fiscal_worker;
COMMIT;
