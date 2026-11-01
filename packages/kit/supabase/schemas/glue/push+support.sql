-- GLUE: what joins the push module and the support module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."push_on_support_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  n integer;
begin
  if new.author <> 'contact' then return null; end if;
  select count(*) into n from public.support_messages where conversation_id = new.conversation_id and author = 'contact' and id <> new.id;
  perform public.push_notify(case when n = 0 then 'support-new' else 'support-message' end,
    jsonb_build_object('conversation_id', new.conversation_id, 'kind', new.kind, 'body', left(coalesce(new.body, new.attachment_name, ''), 120)));
  return null;
end;
$$;

GRANT ALL ON FUNCTION "public"."push_on_support_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."push_on_support_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."push_on_support_message"() TO "service_role";

CREATE OR REPLACE TRIGGER "trg_push_support_message" AFTER INSERT ON "public"."support_messages" FOR EACH ROW EXECUTE FUNCTION "public"."push_on_support_message"();
