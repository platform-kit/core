-- GLUE: what joins the spaces module and the support module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."space_on_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.escalated_at is null or old.escalated_at is not null then return null; end if;
  perform public.space_hook_post('support.escalated', null, jsonb_build_object(
    'event', 'support-escalated', 'conversation', new.id));
  return null;
end;
$$;

REVOKE ALL ON FUNCTION "public"."space_on_escalation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_on_escalation"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_on_escalation"() TO "service_role";

CREATE OR REPLACE TRIGGER "trg_space_escalation" AFTER UPDATE OF "escalated_at" ON "public"."support_conversations" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_escalation"();
