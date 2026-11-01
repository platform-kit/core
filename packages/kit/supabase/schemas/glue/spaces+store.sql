-- GLUE: what joins the spaces module and the store module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."space_on_print_order"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status is distinct from 'failed' or (tg_op = 'UPDATE' and old.status = 'failed') then return null; end if;
  perform public.space_hook_post('print.failed', null, jsonb_build_object(
    'event', 'print-failed', 'book', new.chosen ->> 'book', 'format', new.chosen ->> 'format', 'printer', new.supplier,
    'reason', left(coalesce(new.error, ''), 200), 'order', new.id));
  return null;
end;
$$;

REVOKE ALL ON FUNCTION "public"."space_on_print_order"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_on_print_order"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_on_print_order"() TO "service_role";

CREATE OR REPLACE TRIGGER "trg_space_print_order" AFTER INSERT OR UPDATE OF "status" ON "public"."fulfilments" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_print_order"();
