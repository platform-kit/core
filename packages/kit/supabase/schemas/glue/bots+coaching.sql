-- GLUE: what joins the bots module and the coaching module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- a bot asked in a conversation the asker is in, who it is about, and the conversation's lines it is shown
CREATE OR REPLACE FUNCTION "public"."agent_where_coaching"("p_conversation" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select public.in_conversation(p_conversation) $$;

CREATE OR REPLACE FUNCTION "public"."agent_subject_coaching"("p_conversation" "uuid", "p_asked_by" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
      'user_id', (select (array_agg(m.user_id))[1] from public.conversation_members m
                   where m.conversation_id = p_conversation
                     and m.user_id is distinct from p_asked_by
                  having count(*) = 1),
      'contact_id', null);
$$;

CREATE OR REPLACE FUNCTION "public"."agent_transcript_coaching"("p_run" "uuid", "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.agent_runs; n int := p_limit; inthread boolean;
begin
  select * into r from public.agent_runs where id = p_run;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', m.kind, 'body', m.body, 'meta', jsonb_build_object(),
             'deleted_at', m.deleted_at, 'mine', m.sender_id = r.asked_by) order by m.created_at)
      from (select * from public.messages x
             where x.conversation_id = r.conversation_id
             order by x.created_at desc limit n) m), '[]'::jsonb);
  return '[]'::jsonb;
end;
$$;
