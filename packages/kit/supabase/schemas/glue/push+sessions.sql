-- GLUE: what joins the push module and the sessions module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."push_on_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status <> 'accepted' or (tg_op = 'UPDATE' and old.status = 'accepted') then return null; end if;
  perform public.push_notify('bookings', jsonb_build_object('title', new.title, 'name', new.name, 'email', new.email, 'start_at', new.start_at));
  return null;
end;
$$;

GRANT ALL ON FUNCTION "public"."push_on_booking"() TO "anon";
GRANT ALL ON FUNCTION "public"."push_on_booking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."push_on_booking"() TO "service_role";

CREATE OR REPLACE TRIGGER "trg_push_booking" AFTER INSERT OR UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."push_on_booking"();
