-- GLUE: what joins the bots module and the spaces module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- ---------------------------------------------------------------------------------------------
-- A BOT NAMED IN A ROOM IS BEING ASKED SOMETHING — and it is the MESSAGE that asks, not the client
-- that wrote it.
--
-- This used to be the browser's job: SpacesPage saw a mention in what it had just sent and called
-- agent_summon. That works for exactly one client. A line written by anything else — the Matrix
-- surface, a bridge, a script holding a key, a second client of the site's own — landed as a
-- perfectly good row that no bot ever heard, and nothing anywhere said so. The desk never had the
-- problem because the desk has always had a trigger.
--
-- So the summon happens where the row happens. Nothing about WHO may is changed: agent_summon
-- makes every one of its own refusals — the bot must be published, live, offered on this surface,
-- its audience must admit this person, and they must be able to read the room — and this only
-- decides WHERE the asking is noticed. The browser stops asking in the same change: two paths
-- that both summon would summon twice, which is worse than not answering.
--
-- Only a mention in a PERSON'S line. A bot's own answer is a system line, and a bot that heard
-- itself would talk to itself for as long as its budget lasted.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."agent_hear_mention"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare slug text;
begin
  if new.author_id is null or new.kind = 'system' or new.deleted_at is not null then return null; end if;
  -- the first bot named, and only the first: naming three bots is not asking three
  slug := substring(coalesce(new.body, '') from '<@bot:([a-z0-9-]{1,60})>');
  if slug is null then return null; end if;
  -- summoned AS THE AUTHOR, so every refusal agent_summon makes is made about them and not about
  -- whatever wrote the row. The result is discarded on purpose: a bot that may not be summoned
  -- here is not an error in somebody's message.
  perform public.agent_summon(
    slug, 'spaces', new.channel_id, null,
    coalesce(new.thread_root_id, new.id),
    public.space_plain_body(coalesce(new.body, '')), null, null, null);
  return null;
end;
$$;

DROP TRIGGER IF EXISTS "trg_agent_hear_mention" ON "public"."space_messages";
CREATE TRIGGER "trg_agent_hear_mention" AFTER INSERT ON "public"."space_messages"
  FOR EACH ROW EXECUTE FUNCTION "public"."agent_hear_mention"();

-- a bot asked in a room the asker can read, and the room's lines it is shown
CREATE OR REPLACE FUNCTION "public"."agent_where_spaces"("p_channel" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select public.can_read_channel(p_channel) $$;

CREATE OR REPLACE FUNCTION "public"."agent_transcript_spaces"("p_run" "uuid", "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.agent_runs; n int := p_limit; inthread boolean;
begin
  select * into r from public.agent_runs where id = p_run;
  inthread := r.root_id is not null and r.root_id is distinct from r.channel_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', m.kind, 'body', m.body, 'title', m.title, 'meta', m.meta,
             'attachment_name', m.attachment_name,
             'deleted_at', m.deleted_at, 'author_id', m.author_id,
             'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)))
           order by m.created_at)
      from (select * from public.space_messages x
             where x.channel_id = r.channel_id
               and (case when inthread
                         then x.id = r.root_id or x.thread_root_id = r.root_id
                         else x.thread_root_id is null end)
             order by x.created_at desc limit n) m
      left join public.profiles p on p.id = m.author_id), '[]'::jsonb);
  return '[]'::jsonb;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_hook_bots"("p_channel" "uuid", "p_event" "text", "p_meta" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare b record;
begin
  -- AND A BOT THAT LISTENS FOR IT. A bot may say `hears: [{ event: purchase.paid, … }]`, and
  -- this is where that becomes true: the same event that writes the line queues the run, in the
  -- room the line went to, with the facts on it. It is a run like any other from there on — the
  -- loop, the budget, the Stop button — and a bot nobody declared for this event costs nothing.
  for b in select slug, hears from public.bots where published loop
    if b.hears @> jsonb_build_array(jsonb_build_object('kind', 'event', 'event', p_event)) then
      insert into public.agent_runs (bot, surface, channel_id, root_id, status, state)
           values (b.slug, 'spaces', p_channel, p_channel, 'queued',
                   jsonb_build_object(
                     'messages', jsonb_build_array(jsonb_build_object('role', 'user', 'content',
                       (select coalesce(x->>'ask', 'Something happened: ' || p_event)
                          from jsonb_array_elements(b.hears) x
                         where x->>'kind' = 'event' and x->>'event' = p_event limit 1))),
                     'context', 'The facts: ' || coalesce(p_meta::text, '{}')));
    end if;
  end loop;
end;
$$;
