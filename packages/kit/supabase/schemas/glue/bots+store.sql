-- GLUE: what joins the bots module and the store module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- what has been sent to the person asking: the store's parcels
CREATE OR REPLACE FUNCTION "public"."my_parcels"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
      select jsonb_agg(jsonb_build_object('book', o.chosen ->> 'book', 'format', o.chosen ->> 'format', 'contents', o.chosen ->> 'contents',
               'status', o.status, 'supplier_status', o.supplier_status, 'tracking', o.tracking,
               'created_at', o.created_at) order by o.created_at desc)
        from (select * from public.fulfilments where user_id = auth.uid()
               order by created_at desc limit 20) o), '[]'::jsonb);
$$;
