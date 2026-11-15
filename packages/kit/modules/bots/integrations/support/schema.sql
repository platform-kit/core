-- GLUE: what joins the bots module and the support module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- A contact writing in is the event. Never an agent's own line, and never a system line, or a bot
-- would answer itself.
CREATE OR REPLACE FUNCTION "public"."agent_hear_support"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.author <> 'contact' then return null; end if;
  perform public.agent_hear('support-message', 'support', new.conversation_id, null, null);
  return null;
end;
$$;

DROP TRIGGER IF EXISTS "trg_agent_hear_support" ON "public"."support_messages";
CREATE TRIGGER "trg_agent_hear_support" AFTER INSERT ON "public"."support_messages"
  FOR EACH ROW EXECUTE FUNCTION "public"."agent_hear_support"();

-- a desk's thread: who it is about, whether its person asked for a human or chose the bot, its lines, its tickets
CREATE OR REPLACE FUNCTION "public"."agent_subject_support"("p_conversation" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object('user_id', k.user_id, 'contact_id', c.contact_id)
        from public.support_conversations c
        left join public.support_contacts k on k.id = c.contact_id
       where c.id = p_conversation;
$$;

CREATE OR REPLACE FUNCTION "public"."agent_support_state"("p_conversation" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_build_object('human', c.bot_off_at is not null, 'chosen', c.bot_at is not null)
                     from public.support_conversations c where c.id = p_conversation), '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION "public"."agent_transcript_support"("p_run" "uuid", "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.agent_runs; n int := p_limit; inthread boolean;
begin
  select * into r from public.agent_runs where id = p_run;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', m.kind, 'body', m.body, 'meta', jsonb_build_object(),
             'attachment_name', m.attachment_name, 'deleted_at', m.deleted_at,
             'mine', m.author = 'agent') order by m.created_at)
      from (select * from public.support_messages x
             where x.conversation_id = r.conversation_id
             order by x.created_at desc limit n) m), '[]'::jsonb);
  return '[]'::jsonb;
end;
$$;

-- the run in progress on a thread whose person asked for a human, called off
CREATE OR REPLACE FUNCTION "public"."support_call_off_bot"("p_conversation" "uuid") RETURNS "void"
    LANGUAGE "sql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.agent_runs set cancel_at = now()
   where conversation_id = p_conversation and status in ('queued', 'running') and cancel_at is null;
$$;

CREATE OR REPLACE FUNCTION "public"."agent_tickets"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s jsonb; k uuid;
begin
  s := public.agent_subject(p_run);
  k := (s->>'contact_id')::uuid;
  if (s->>'user_id') is null then
    if k is null then return null; end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object('ref', t.ref, 'title', t.title, 'status', t.status,
               'created_at', t.created_at, 'last_at', t.last_at) order by t.last_at desc)
        from (select * from public.support_tickets where contact_id = k
               order by last_at desc limit 20) t), '[]'::jsonb);
  end if;
  perform public.agent_become(p_run);
  return coalesce(public.support_tickets_mine(), '[]'::jsonb);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."agent_raise_ticket"(
      "p_run" "uuid", "p_title" "text", "p_body" "text" DEFAULT NULL::"text",
      "p_priority" "text" DEFAULT 'normal'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s jsonb; r public.agent_runs;
begin
  select * into r from public.agent_runs where id = p_run;
  if not found then return jsonb_build_object('error', 'no such run'); end if;
  s := public.agent_subject(p_run);
  -- this run, this transaction, and nothing else: the opener admits it by name
  perform set_config('app.bot_ticket', '1', true);
  return public.support_ticket_open(
    p_title => p_title,
    p_body => p_body,
    p_contact => (s->>'contact_id')::uuid,
    p_priority => p_priority,
    p_category => null,
    -- the thread it came out of, so the desk can see where it started
    p_conversation => case when r.surface = 'support' then r.conversation_id else null end,
    p_assign => null);
end;
$$;
