SET check_function_bodies = false;

-- ---------------------------------------------------------------------------------------------
-- BOTS, AND THE LOOP THAT RUNS THEM.
--
-- An Edge Function is given about two minutes and then it dies. A useful agent — one that reads a
-- few things, calls an API, thinks again and comes back — does not fit in two minutes, and an
-- agent that loses everything when its function is recycled is not an agent, it is a gamble.
--
-- So THE DATABASE IS THE LOOP. A run is a row; every step it takes is a row; the worker takes one
-- step and returns. Three things follow for free, and each of them is the reason for the design:
--
--   RESUMABLE  — the state is rows, so a worker that dies mid-step loses that step and nothing
--                else. A lease (not a status) says a worker is on it, and an expired lease is a
--                run somebody else may pick up. A deploy in the middle of a run is not an event.
--   CANCELLABLE — `cancel_at` is a column the worker reads between steps and at every tool
--                boundary, so a run stops mid-flight, keeps what it did and says so.
--   ACCOUNTABLE — every model call and every tool call is a step with what it cost, so a bot's
--                spend is a sum rather than a surprise, and a run that would go over its budget
--                stops before the call rather than after the bill.
--
-- A bot is a FILE (content/bots/*.md), projected here like every other declaration. What it may
-- do, who may summon it and what it costs are the file's; what it has actually done is state.

-- ---------------------------------------------------------------------------------------------
-- the declaration

CREATE TABLE IF NOT EXISTS "public"."bots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "avatar" "text",
    "model" "text",
    "billing" "text",
    -- where it may be summoned: a room, the support desk, a coaching thread
    "surfaces" "text"[] DEFAULT ARRAY['spaces'::"text"] NOT NULL,
    -- who may summon it — the same grammar a space's membership is filled by
    "audience" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    -- WHO IT MAY BE RUN FOR, as against who may summon it. On a desk those are different people:
    -- the asker is a member of staff and the person being answered for is the customer, and where a
    -- bot answers directly it is the CUSTOMER'S message that spends the money. A gate on the asker
    -- would pass every time and protect nothing.
    "serves" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    -- how it is offered on a desk: off (a staff tool) | ask (the person chooses) | always
    "offer" "text" DEFAULT 'off'::"text" NOT NULL,
    -- the spaces it may be summoned in, by slug; empty is wherever it is granted
    "spaces" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    -- what wakes it without being asked: a mention, a schedule, one of the platform's own events
    "hears" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    -- when a scheduled bot last woke. The clock is kept on the bot rather than worked out from its
    -- runs, because a run that was cancelled or failed still happened: a missed Monday is not
    -- repeated on Tuesday, and a worker restarted twice does not send the same thing twice.
    "fired_at" timestamp with time zone,
    "tools" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    -- what it may spend of itself: steps, money, minutes
    "limits" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "memory" "text" DEFAULT 'thread'::"text" NOT NULL,
    -- the bot whose prompt and tools this one starts from; the kit's own desk bot is the usual one
    "extends" "text",
    "prompt" "text" NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- the same decided set as MEMORIES in lib/agents/loop.js. It is written out again here because
    -- a check constraint cannot import anything -- and that is exactly why this one fell behind
    -- when person+recall was added, after the compile's own second copy had already been removed.
    CONSTRAINT "bots_memory_check" CHECK (("memory" = ANY (ARRAY['none'::"text", 'thread'::"text", 'person'::"text", 'person+recall'::"text"])))
);

-- ---------------------------------------------------------------------------------------------
-- the state machine

CREATE TABLE IF NOT EXISTS "public"."agent_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    -- A RUN IS ONE OF TWO THINGS, and the constraint at the foot says so: a BOT answering on a
    -- surface, or a JOB — a piece of work with stages, started by an administrator, answering
    -- nobody. Enrichment is the first job: a sequence of model calls with stored results, a budget
    -- and a cancel, which is what this loop already is. The alternative was a second job table with
    -- its own lease, its own cancel and its own answer to "what happened in that run"; the reason
    -- there is one loop is that there was nearly two.
    "bot" "text",
    "surface" "text",
    -- WHAT THE WORK IS, for a run that is not a conversation: { script, book, … }. The worker sees
    -- it and walks stages instead of a transcript. It is written at summon and never by a client.
    "job" "jsonb",
    -- where it is talking: a room and a thread, or a conversation of one of the two chats
    "channel_id" "uuid",
    "conversation_id" "uuid",
    "root_id" "uuid",
    -- who asked. Null where a schedule or an event woke it, which is a run nobody is waiting on.
    "asked_by" "uuid",
    -- WHO THIS RUN IS FOR, as one string to count spending against: an account's id, or for
    -- somebody with no account the contact they wrote in as ('c:'||contact). Written once at
    -- summon and never by a client.
    --
    -- It is a DERIVED CACHE and not the truth: agent_subject() still resolves live from the row, so
    -- what a bot may SEE never depends on it. It exists so a ceiling can be counted without
    -- resolving every run in the window one at a time — and so that a guest, who has no account to
    -- count against, is still counted. A bot that answers by itself will meet plenty of those.
    "subject_key" "text",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "step" integer DEFAULT 0 NOT NULL,
    -- what it has said and been told so far, and whatever a tool left for the next step
    "state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- MONEY IN FRACTIONS OF A PENNY, because that is what a call costs. Held as whole pennies,
    -- every cheap model rounded to nothing: a run could make twenty calls, record zero against its
    -- budget and never stop. A budget that only counts the expensive half is not a budget.
    "budget_cents" numeric(12,4) DEFAULT 50 NOT NULL,
    "spent_cents" numeric(12,4) DEFAULT 0 NOT NULL,
    -- A LEASE, NOT A STATUS: a worker holds a run for a minute at a time. One that dies leaves an
    -- expired lease, which is a run anybody may pick up — no sweeper, no stuck 'running' rows.
    "lease_until" timestamp with time zone,
    "worker" "text",
    "cancel_at" timestamp with time zone,
    "deadline_at" timestamp with time zone,
    "error" "text",
    "said" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "agent_runs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'waiting'::"text", 'done'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    -- the same decided set as SURFACES in build/bots.mjs. Written out again because a check
    -- constraint cannot import; agents-db.test.mjs pins the database copy with an insert.
    CONSTRAINT "agent_runs_surface_check" CHECK (("surface" IS NULL OR "surface" = ANY (ARRAY['spaces'::"text", 'support'::"text", 'coaching'::"text", 'voice'::"text", 'social'::"text"]))),
    -- ONE OR THE OTHER, never both and never neither: a bot on a surface, or a job. A row that is
    -- half of each is a row the worker cannot read, and it would not find out until it tried.
    CONSTRAINT "agent_runs_kind_check" CHECK (
      (("bot" IS NOT NULL AND "surface" IS NOT NULL AND "job" IS NULL)
        OR ("job" IS NOT NULL AND "bot" IS NULL AND "surface" IS NULL)))
);

CREATE TABLE IF NOT EXISTS "public"."agent_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "n" integer NOT NULL,
    "kind" "text" NOT NULL,
    "name" "text",
    "request" "jsonb",
    "response" "jsonb",
    "tokens_in" integer DEFAULT 0 NOT NULL,
    "tokens_out" integer DEFAULT 0 NOT NULL,
    "cost_cents" numeric(12,4) DEFAULT 0 NOT NULL,
    "ms" integer DEFAULT 0 NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agent_steps_kind_check" CHECK (("kind" = ANY (ARRAY['model'::"text", 'tool'::"text", 'say'::"text", 'note'::"text"])))
);

ALTER TABLE ONLY "public"."bots" ADD CONSTRAINT "bots_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."bots" ADD CONSTRAINT "bots_slug_key" UNIQUE ("slug");
ALTER TABLE ONLY "public"."agent_runs" ADD CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."agent_steps" ADD CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."agent_steps" ADD CONSTRAINT "agent_steps_once" UNIQUE ("run_id", "n");
ALTER TABLE ONLY "public"."agent_steps"
    ADD CONSTRAINT "agent_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."agent_runs"
    ADD CONSTRAINT "agent_runs_asked_by_fkey" FOREIGN KEY ("asked_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

-- the one index the claim needs: what is waiting, oldest first
CREATE INDEX IF NOT EXISTS "agent_runs_waiting_idx" ON "public"."agent_runs" USING "btree" ("created_at")
  WHERE ("status" = ANY (ARRAY['queued'::"text", 'running'::"text"]));
CREATE INDEX IF NOT EXISTS "agent_runs_where_idx" ON "public"."agent_runs" USING "btree" ("root_id");
CREATE INDEX IF NOT EXISTS "agent_steps_run_idx" ON "public"."agent_steps" USING "btree" ("run_id", "n");

ALTER TABLE ONLY "public"."agent_runs" REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------------------------
-- TAKING THE NEXT STEP. The claim is the whole of the concurrency story: one statement, under a
-- row lock, that hands out exactly one run and marks it held for a minute. Two workers racing get
-- one run each; a worker that dies holds nothing anybody has to clean up.

CREATE OR REPLACE FUNCTION "public"."agent_claim"("p_worker" "text", "p_lease_seconds" integer DEFAULT 60) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.agent_runs;
begin
  update public.agent_runs
     set status = 'running', worker = p_worker, lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 10)),
         updated_at = now()
   where id = (
     select id from public.agent_runs
      where status in ('queued', 'running')
        and (lease_until is null or lease_until < now())
      -- a cancelled run IS claimed: somebody has to write its ending, and the loop's first
      -- decision on seeing the mark is to stop. Excluding it here is how a cancel gets stuck.
      order by created_at
      for update skip locked
      limit 1)
  returning * into r;
  if not found then return null; end if;
  return to_jsonb(r);
end;
$$;

-- what a run is told when it comes back: itself, its bot, and the steps it has taken
CREATE OR REPLACE FUNCTION "public"."agent_run_state"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'run', to_jsonb(r),
    'bot', (select to_jsonb(b) from public.bots b where b.slug = r.bot),
    'steps', coalesce((select jsonb_agg(to_jsonb(s) order by s.n) from public.agent_steps s where s.run_id = r.id), '[]'::jsonb))
    from public.agent_runs r where r.id = p_run;
$$;

-- STOPPING ONE MID-FLIGHT. Whoever asked may call it off, and so may the staff. It is a column
-- rather than a status because the worker may be inside a call when it is set: the run keeps
-- running until the step it is on returns, and stops at the boundary.
CREATE OR REPLACE FUNCTION "public"."agent_cancel"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.agent_runs;
begin
  select * into r from public.agent_runs where id = p_run;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  if not (public.is_staff() or r.asked_by = auth.uid()) then return jsonb_build_object('error', 'not-yours'); end if;
  if r.status in ('done', 'failed', 'cancelled') then return jsonb_build_object('ok', true, 'status', r.status); end if;
  -- NOBODY IS HOLDING IT: cancelling it is the end, here and now. A run left 'running' with a
  -- cancel on it and no worker would wait for ever, which is the one thing a cancel must not do.
  if r.lease_until is null or r.lease_until < now() then
    update public.agent_runs
       set status = 'cancelled', cancel_at = now(), finished_at = now(), lease_until = null, updated_at = now()
     where id = p_run;
    return jsonb_build_object('ok', true, 'status', 'cancelled');
  end if;
  -- SOMEBODY IS MID-STEP: the mark is enough. The worker reads it before its next step and before
  -- every tool, stops there, and writes the ending itself.
  update public.agent_runs set cancel_at = now(), updated_at = now() where id = p_run;
  return jsonb_build_object('ok', true, 'status', 'cancelling');
end;
$$;

-- what is running here, for the surface that is waiting on it
CREATE OR REPLACE FUNCTION "public"."agent_runs_here"("p_root" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'bot', r.bot, 'status', r.status, 'step', r.step, 'said', r.said,
      'error', r.error, 'mine', r.asked_by = auth.uid(), 'created_at', r.created_at) order by r.created_at), '[]'::jsonb)
    from public.agent_runs r
   where r.root_id = p_root
     and (r.asked_by = auth.uid() or public.is_staff()
          or (r.channel_id is not null and public.can_read_channel(r.channel_id)));
$$;

-- ---------------------------------------------------------------------------------------------
-- WHO MAY SEE WHAT. A run belongs to whoever asked for it and to the staff. The steps hold the
-- prompts, what the tools answered and what the model said on the way — the staff alone read
-- those, because a tool may have looked at somebody's order to answer a question.

ALTER TABLE "public"."bots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."agent_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."agent_steps" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bots_select" ON "public"."bots" FOR SELECT TO "authenticated", "anon"
  USING (("published" = true) AND "public"."event_for_me"("audience"));
CREATE POLICY "agent_runs_select" ON "public"."agent_runs" FOR SELECT TO "authenticated"
  USING (("asked_by" = ( SELECT "auth"."uid"())) OR "public"."is_staff"());
-- what the tools answered — orders, tickets, transcripts — is the desk's, not every role's
CREATE POLICY "agent_steps_select_staff" ON "public"."agent_steps" FOR SELECT TO "authenticated"
  USING ("public"."is_support"());

GRANT SELECT ON TABLE "public"."bots" TO "anon", "authenticated";
GRANT ALL ON TABLE "public"."bots" TO "service_role";
GRANT SELECT ON TABLE "public"."agent_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."agent_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_steps" TO "service_role";

-- the worker's (agent-run): a run carries the customer's records it was asked about
REVOKE ALL ON FUNCTION "public"."agent_claim"("text", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_claim"("text", integer) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."agent_claim"("text", integer) TO "service_role";
-- the worker's too; a person reads their own run through agent_runs, under its policy
REVOKE ALL ON FUNCTION "public"."agent_run_state"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_run_state"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."agent_run_state"("uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."agent_cancel"("uuid") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."agent_runs_here"("uuid") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- KEEPING IT GOING. A run advances a step at a time; something has to ask for the next one. The
-- worker asks for itself while it is alive, and pg_cron is the backstop for the run whose worker
-- died — the same shape as the funnels' runner, over pg_net, on the url and secret in app_settings.

CREATE OR REPLACE FUNCTION "public"."run_agents"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text; n integer;
begin
  select count(*) into n from public.agent_runs
   where status in ('queued', 'running') and (lease_until is null or lease_until < now()) and cancel_at is null;
  if n = 0 then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/agent-run',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := jsonb_build_object('sweep', true));
end;
$$;

-- the schedule's (pg_cron, as the owner): it posts to a function with the service secret, so a visitor calling it would run the job
REVOKE ALL ON FUNCTION "public"."run_agents"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_agents"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_agents"() TO "service_role";

-- WHAT THE CLOCK IS OWED. A bot may wake on a schedule, and something has to ask whether the time
-- has come. Which time that is cannot be worked out here — "every third Friday" over a daylight
-- change is arithmetic that lives in one place (src/lib/recurrence.js) and is tested there — so
-- this asks the worker, which holds the same file. One job, five minutes, nothing to catch up.
CREATE OR REPLACE FUNCTION "public"."run_agent_schedules"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text;
begin
  if not exists (select 1 from public.bots where published and hears @> '[{"kind":"schedule"}]'::jsonb) then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/agent-run',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := jsonb_build_object('schedules', true));
end;
$$;

-- the schedule's (pg_cron, as the owner): it posts to a function with the service secret, so a visitor calling it would run the job
REVOKE ALL ON FUNCTION "public"."run_agent_schedules"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_agent_schedules"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_agent_schedules"() TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- SUMMONING ONE. A browser never inserts a run: it asks, and this decides. Three things have to be
-- true and only the database knows them — the bot exists and is published, this person is allowed
-- to summon it (its own audience), and they are somewhere they are allowed to be. A client that
-- could insert a row could summon a bot it is not entitled to, in a room it cannot read.

--
-- HAS THIS PERSON SPENT WHAT THEY MAY, over any window the bot's file names? Returns the window
-- that is full, or null.
--
-- Identity is not a spend control: one signed-in paying customer in a loop costs what a thousand
-- strangers would, and with a bot that answers by itself the loop can be somebody typing quickly.
-- So a file may say several at once — a minute to stop a hammering, a month to stop a slow drain —
-- and EVERY one given must hold. A month is thirty days and a week is seven: rolling windows, not
-- calendar ones, because "you may ask again on the 1st" is not a thing anybody wants to be told.
--
CREATE OR REPLACE FUNCTION "public"."agent_over_cap"("p_bot" "text", "p_subject" "text", "p_per" "jsonb")
  RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare k text; v text; win interval; cap numeric; spent numeric;
begin
  if p_subject is null or p_per is null or jsonb_typeof(p_per) <> 'object' then return null; end if;
  for k, v in select key, value from jsonb_each_text(p_per) loop
    win := case k
             when 'minute' then interval '1 minute'  when 'hour'  then interval '1 hour'
             when 'day'    then interval '1 day'     when 'week'  then interval '7 days'
             when 'month'  then interval '30 days'   else null end;
    cap := nullif(v, '')::numeric;
    if win is null or cap is null or cap <= 0 then continue; end if;
    select coalesce(sum(x.spent_cents), 0) into spent
      from public.agent_runs x
     where x.bot = p_bot and x.subject_key = p_subject and x.created_at > now() - win;
    if spent >= cap * 100 then return k; end if;
  end loop;
  return null;
end;
$$;
REVOKE ALL ON FUNCTION "public"."agent_over_cap"("text", "text", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_over_cap"("text", "text", "jsonb") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_over_cap"("text", "text", "jsonb") TO "service_role";

-- one string for whoever a run is for, account or not
CREATE OR REPLACE FUNCTION "public"."agent_subject_key"("p_subject" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$ select coalesce(p_subject->>'user_id', case when p_subject->>'contact_id' is not null
             then 'c:' || (p_subject->>'contact_id') end); $$;

CREATE OR REPLACE FUNCTION "public"."agent_summon"("p_bot" "text", "p_surface" "text" DEFAULT 'spaces'::"text", "p_channel" "uuid" DEFAULT NULL::"uuid", "p_conversation" "uuid" DEFAULT NULL::"uuid", "p_root" "uuid" DEFAULT NULL::"uuid", "p_ask" "text" DEFAULT NULL::"text", "p_context" "text" DEFAULT NULL::"text", "p_command" "text" DEFAULT NULL::"text", "p_args" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare b public.bots; r public.agent_runs; state jsonb; subj jsonb; su uuid; sk text; spent_window text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign-in'); end if;
  if p_surface = 'social' then return jsonb_build_object('error', 'not-yours'); end if;
  select * into b from public.bots where slug = p_bot and published;
  if not found then return jsonb_build_object('error', 'no-bot'); end if;
  -- nothing to think with: a bot that cannot run is not refused politely, it is not there
  if not public.agents_live() then return jsonb_build_object('error', 'no-provider'); end if;
  if not public.event_for_me(b.audience) then return jsonb_build_object('error', 'not-for-you'); end if;
  if not (p_surface = any(b.surfaces)) then return jsonb_build_object('error', 'not-here'); end if;
  -- where it is being summoned must be somewhere the asker is
  if p_surface = 'spaces' and (p_channel is null or not public.can_read_channel(p_channel)) then
    return jsonb_build_object('error', 'not-yours');
  end if;
  if p_surface = 'support' and not public.is_staff() then return jsonb_build_object('error', 'not-yours'); end if;
  if p_surface = 'coaching' and (p_conversation is null or not public.in_conversation(p_conversation)) then
    return jsonb_build_object('error', 'not-yours');
  end if;

  --
  -- WHO IT WOULD BE ANSWERING FOR, and whether it may.
  --
  -- `for:` above asked about the ASKER: may this person summon this bot. `serves:` asks about the
  -- SUBJECT: may the bot be run for the person it would be answering about. On a desk those are
  -- different people, and where a bot answers directly it is the customer's own message that spends
  -- the money — so a gate on the asker would pass every time and protect nothing.
  --
  -- Refused BEFORE the row exists, so a refusal costs nothing at all.
  --
  subj := public.agent_subject_of(p_surface, p_conversation, auth.uid());
  su := (subj->>'user_id')::uuid;
  sk := public.agent_subject_key(subj);
  if coalesce(jsonb_array_length(coalesce(b.serves, '[]'::jsonb)), 0) > 0
     and not (su is not null and public.space_fill_matches(su, b.serves)) then
    return jsonb_build_object('error', 'not-served');
  end if;

  -- and whether they have spent what they may, over every window the file names
  spent_window := public.agent_over_cap(b.slug, sk, b.limits->'per');
  if spent_window is not null then
    return jsonb_build_object('error', 'spent', 'window', spent_window);
  end if;
  -- A billed run reserves its bounded cost in agent-run immediately before each provider call.
  -- Reject an unbillable subject here, but never substitute the legacy balance-only check for the
  -- shared authorization/reservation/settlement contract.
  if b.billing is not null and su is null then
    return jsonb_build_object('error', 'usage-subject-required');
  end if;

  state := jsonb_build_object('messages',
    case when coalesce(trim(p_ask), '') = '' then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('role', 'user', 'content', p_ask)) end);
  -- p_context IS IGNORED, and is kept only so an older client does not fail on an unknown argument.
  --
  -- It used to be written onto the run and put in the SYSTEM message, above the bot's own conduct —
  -- so anybody who could summon a bot could write its instructions. A forged three-line context made
  -- the desk bot promise free two-day shipping to Japan in one step, against a prompt telling it
  -- never to state a delivery time it had not read from the site.
  --
  -- The worker reads the transcript itself now (agent_transcript). A person can still put words in
  -- front of a bot — by saying them, in the room, under their own name, where everyone can see
  -- them. That is the ordinary trust of a chat room; a private channel into the system prompt is
  -- not.
  -- A COMMAND IS A NAME AND ITS ARGUMENTS, never a prompt. What /summarise asks the bot lives in
  -- the file it was compiled from and is filled in by the worker, so no client can send its own
  -- words under a command's name.
  if coalesce(trim(p_command), '') <> '' then
    state := state || jsonb_build_object('command', trim(p_command), 'args', coalesce(p_args, '{}'::jsonb));
  end if;

  insert into public.agent_runs (bot, surface, channel_id, conversation_id, root_id, asked_by, subject_key, status, state, deadline_at)
       values (b.slug, p_surface, p_channel, p_conversation, p_root, auth.uid(), sk, 'queued', state,
               now() + make_interval(mins => coalesce((b.limits->>'minutes')::int, 10)))
  returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'bot', b.slug, 'name', b.name);
end;
$$;

GRANT ALL ON FUNCTION "public"."agent_summon"("text", "text", "uuid", "uuid", "uuid", "text", "text", "text", "jsonb") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- A JOB: A RUN THAT IS NOT A CONVERSATION.
--
-- Enrichment is a sequence of narrow model calls with stored results, a budget, a cancel and an
-- account of what each one cost. That is a description of this loop, so it rides it rather than
-- growing a second one beside it — a second lease with its own bugs, a second cancel meaning
-- something slightly different, a second place spend is counted, and a second answer to "what
-- happened in that run".
--
-- It is STAFF ONLY and one subject at a time. A whole-library pass stays a checkout's job, where
-- somebody is watching it: the reason this project has a spend rule at all is $130 of reruns.
--
-- There is no bot, no surface and no subject to serve — `asked_by` is the administrator who
-- pressed the button, which is the whole of "whose run is this to watch and to stop".
CREATE OR REPLACE FUNCTION "public"."agent_job"("p_script" "text", "p_subject" "text", "p_options" "jsonb" DEFAULT '{}'::"jsonb", "p_budget_cents" numeric DEFAULT NULL)
    RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.agent_runs; j jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign-in'); end if;
  if not public.is_admin() then return jsonb_build_object('error', 'not-allowed'); end if;
  -- nothing to think with: a job that cannot run is not refused politely, it is not there
  if not public.agents_live() then return jsonb_build_object('error', 'no-provider'); end if;
  -- AND A DEPLOYMENT HAS TO HAVE SAID YES TO SPENDING. A bot answers a person who asked it a
  -- question, in a room, a few cents at a time. A JOB IS DIFFERENT IN KIND: one press enriches a
  -- whole book, dozens of calls deep, and the bill arrives afterwards. So a provider key being
  -- present is not consent — Settings has to say so, per deployment, on purpose.
  --
  -- This exists because it was needed and was not there. A local stack with real keys in its .env
  -- ran two enrichment jobs from the button during the work that built it, and bought about
  -- twenty-seven cents of Anthropic nobody had approved. Small, and exactly the shape of the
  -- mistake that once cost this project $130: the button was there, the keys were there, and
  -- nothing in between asked.
  if coalesce((select value from public.app_settings where key = 'job_spend'), 'false') <> 'true' then
    return jsonb_build_object('error', 'not-opted-in');
  end if;
  if coalesce(trim(p_script), '') = '' or coalesce(trim(p_subject), '') = '' then
    return jsonb_build_object('error', 'what-job');
  end if;

  -- ONE AT A TIME PER SUBJECT. Two runs enriching the same book would each redo what the other had
  -- just cached and pay for it twice, which is the exact shape of the money this rule exists to
  -- stop. The one already going is handed back rather than refused: the button means "show me this
  -- book being enriched", and it is.
  select * into r from public.agent_runs x
   where x.job->>'script' = trim(p_script) and x.job->>'subject' = trim(p_subject)
     and x.status in ('queued', 'running', 'waiting') and x.cancel_at is null
   limit 1;
  if found then return jsonb_build_object('ok', true, 'id', r.id, 'already', true); end if;

  j := jsonb_build_object('script', trim(p_script), 'subject', trim(p_subject))
       || jsonb_build_object('options', coalesce(p_options, '{}'::jsonb));

  insert into public.agent_runs (job, asked_by, subject_key, status, state, budget_cents, deadline_at)
       values (j, auth.uid(), 'job:' || trim(p_script), 'queued', '{}'::jsonb,
               coalesce(p_budget_cents, 100), now() + make_interval(mins => 60))
  returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'already', false);
end;
$$;

REVOKE ALL ON FUNCTION "public"."agent_job"("text", "text", "jsonb", numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_job"("text", "text", "jsonb", numeric) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_job"("text", "text", "jsonb", numeric) TO "authenticated", "service_role";



-- THE ROW WAKES THE WORKER. Nothing in a browser pokes it — a browser holds no key that the worker
-- would accept, and a surface that had to wait for a model would be a surface that stalls. The
-- insert is the signal, pg_net carries it, and pg_cron is the backstop for anything it misses.
CREATE OR REPLACE FUNCTION "public"."agent_wake"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- the variables are named url and secret, as every other runner here names them, because a
-- plpgsql variable called `key` would shadow the column and make `where key = …` ambiguous
declare url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return null; end if;
  perform net.http_post(
    url := url || '/agent-run',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := jsonb_build_object('run', new.id));
  return null;
end;
$$;

CREATE OR REPLACE TRIGGER "trg_agent_wake" AFTER INSERT ON "public"."agent_runs"
  FOR EACH ROW WHEN (NEW."status" = 'queued') EXECUTE FUNCTION "public"."agent_wake"();

-- ---------------------------------------------------------------------------------------------
-- WHO A RUN IS ABOUT, as against who asked for it.
--
-- `asked_by` answers "who asked": may this person summon this bot, whose run is this to see and to
-- cancel. It is NOT the answer to "whose orders". In a room those are the same person, which is why
-- this went unnoticed; on a desk the asker is a member of staff and the person being answered about
-- is the customer, so every personal tool was returning the support agent's own account and the bot
-- was writing a draft to the customer about it.
--
-- So the subject is derived, here, from the run's own row:
--
--   a room        whoever asked. A room is many people; a bot summoned there answers its summoner.
--   support       the conversation's contact, and their account if they have one (a guest has none).
--   coaching      the other member of the conversation — the one who is not the asker — because a
--                 bot on a one-to-one surface drafts a reply for one party to send to the other.
--
-- Derived rather than stored: a column would be a second place the truth lives, would need
-- backfilling, and would one day be written to. A conversation's other party does not change.
--
-- Where the other party cannot be determined without guessing, the subject is NOBODY, and every
-- personal tool refuses. Falling back to the asker is exactly the bug this exists to remove.

-- The same resolution, from the parts rather than from a row, so a summon can ask "who would this
-- be for?" before it has decided whether to create anything.
CREATE OR REPLACE FUNCTION "public"."agent_subject_of"(
      "p_surface" "text", "p_conversation" "uuid", "p_asked_by" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_surface = 'support' then (
      select jsonb_build_object('user_id', k.user_id, 'contact_id', c.contact_id)
        from public.support_conversations c
        left join public.support_contacts k on k.id = c.contact_id
       where c.id = p_conversation)
    when p_surface = 'coaching' then jsonb_build_object(
      'user_id', (select (array_agg(m.user_id))[1] from public.conversation_members m
                   where m.conversation_id = p_conversation
                     and m.user_id is distinct from p_asked_by
                  having count(*) = 1),
      'contact_id', null)
    when p_surface = 'social' then jsonb_build_object('user_id', null, 'contact_id', null)
    else jsonb_build_object('user_id', p_asked_by, 'contact_id', null)
  end;
$$;
REVOKE ALL ON FUNCTION "public"."agent_subject_of"("text", "uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_subject_of"("text", "uuid", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_subject_of"("text", "uuid", "uuid") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."agent_subject"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.agent_subject_of(r.surface, r.conversation_id, r.asked_by)
    from public.agent_runs r where r.id = p_run;
$$;

REVOKE ALL ON FUNCTION "public"."agent_subject"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_subject"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_subject"("uuid") TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- WHAT A BOT MAY LOOK UP ABOUT ITS SUBJECT — one function per fact, each taking the RUN.
--
-- This is the shape on purpose. The obvious fix for "the tool looked up the wrong person" is to
-- pass the subject instead of the asker, and the next personal tool somebody writes reaches for
-- whatever identity happens to be in scope. So the tool is given no identity at all: it names the
-- run, and the database resolves whose data that is. Passing the wrong person stops being something
-- a reviewer has to notice and becomes something nobody can write.
--
-- One function per fact rather than one agent_facts(run, what): a single entry point with a string
-- discriminator is a place to add a `what` nobody reviewed, and a grant on it is all or nothing.
--
-- NULL means "there is nobody to ask about" — a guest with no account — and the caller says so.
-- An empty result means "this person has none". The two are different answers and the difference
-- matters: one is "I cannot see that", the other is "you have not bought anything".

CREATE OR REPLACE FUNCTION "public"."agent_orders"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare u uuid;
begin
  select (public.agent_subject(p_run)->>'user_id')::uuid into u;
  if u is null then return null; end if;
  return jsonb_build_object(
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('sku', p.sku, 'amount_total', p.amount_total,
               'currency', p.currency, 'status', p.status, 'created_at', p.created_at,
               'variant', p.variant) order by p.created_at desc)
        from (select * from public.purchases where user_id = u order by created_at desc limit 20) p
    ), '[]'::jsonb),
    'parcels', coalesce((
      select jsonb_agg(jsonb_build_object('book', o.chosen ->> 'book', 'format', o.chosen ->> 'format', 'contents', o.chosen ->> 'contents',
               'status', o.status, 'supplier_status', o.supplier_status, 'tracking', o.tracking,
               'created_at', o.created_at) order by o.created_at desc)
        from (select * from public.fulfilments where user_id = u order by created_at desc limit 20) o
    ), '[]'::jsonb));
end;
$$;

CREATE OR REPLACE FUNCTION "public"."agent_membership"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare u uuid;
begin
  select (public.agent_subject(p_run)->>'user_id')::uuid into u;
  if u is null then return null; end if;
  return (
    select jsonb_build_object(
      'tiers', coalesce(jsonb_agg(distinct e.tier) filter (where e.tier is not null), '[]'::jsonb),
      'entitlements', coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'key', e.key,
        'tier', e.tier, 'expires_at', e.expires_at, 'created_at', e.created_at)), '[]'::jsonb))
      from public.entitlements e
     where e.user_id = u and e.active
       and (e.expires_at is null or e.expires_at > now()));
end;
$$;

-- A ticket belongs to a CONTACT, and one person may have several (a guest who later signed up, the
-- same address written in twice). So this takes the subject's own contact and every contact their
-- account holds — never a contact belonging to anybody else.
CREATE OR REPLACE FUNCTION "public"."agent_tickets"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s jsonb; u uuid; k uuid;
begin
  s := public.agent_subject(p_run);
  u := (s->>'user_id')::uuid;
  k := (s->>'contact_id')::uuid;
  if u is null and k is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('ref', t.ref, 'title', t.title, 'status', t.status,
             'created_at', t.created_at, 'last_at', t.last_at) order by t.last_at desc)
      from (select * from public.support_tickets
             where contact_id in (
               select c.id from public.support_contacts c
                where (k is not null and c.id = k)
                   or (u is not null and c.user_id = u))
             order by last_at desc limit 20) t
  ), '[]'::jsonb);
end;
$$;

REVOKE ALL ON FUNCTION "public"."agent_orders"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_orders"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_orders"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."agent_membership"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_membership"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_membership"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."agent_tickets"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_tickets"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_tickets"("uuid") TO "service_role";

-- A ticket a bot raises belongs to the run's SUBJECT, and the run says who that is.
--
-- The tool used to pass a contact it had been handed — run.state.contact, which nothing anywhere
-- ever set — so every ticket a bot raised was attached to no contact, and agent_tickets, which finds
-- tickets BY contact, could never find one. Here the contact is resolved rather than passed, which
-- is the same reason the facts above take a run: there is no wrong contact available to send.
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

REVOKE ALL ON FUNCTION "public"."agent_raise_ticket"("uuid", "text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_raise_ticket"("uuid", "text", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_raise_ticket"("uuid", "text", "text", "text") TO "service_role";

-- WHAT THE SUBJECT HAS ASKED BEFORE — for a bot whose file says `memory: person`.
--
-- Derived from the run like everything else, so the worker never holds an identity: this returns the
-- SUBJECT's own earlier questions and answers, never the asker's. On a desk that distinction is the
-- whole point — a bot recalling what the support agent asked about other customers would be the
-- leak this change exists to remove, wearing a different hat.
--
-- Only finished runs, only what was asked and what was said, newest last, and nothing from a run
-- about somebody else even where the same person asked it.
CREATE OR REPLACE FUNCTION "public"."agent_recall"("p_run" "uuid", "p_limit" integer DEFAULT 6) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s jsonb; u uuid; k uuid; r public.agent_runs;
begin
  select * into r from public.agent_runs where id = p_run;
  if not found then return '[]'::jsonb; end if;
  s := public.agent_subject(p_run);
  u := (s->>'user_id')::uuid;
  k := (s->>'contact_id')::uuid;
  if u is null and k is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'asked', x.state->'messages'->0->>'content', 'said', x.said) order by x.created_at)
      from (
        select o.* from public.agent_runs o
         where o.id <> p_run and o.bot = r.bot and o.status = 'done'
           and coalesce(o.said, '') <> ''
           -- the same SUBJECT, not the same asker
           and public.agent_subject(o.id) = s
         order by o.created_at desc
         limit greatest(1, least(coalesce(p_limit, 6), 20))) x
  ), '[]'::jsonb);
end;
$$;

REVOKE ALL ON FUNCTION "public"."agent_recall"("uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_recall"("uuid", integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_recall"("uuid", integer) TO "service_role";


-- ---------------------------------------------------------------------------------------------
-- A BOT SEES ONLY WHAT THAT PERSON'S OWN SCREEN COULD SHOW THEM.
--
-- The version before this resolved the subject and then wrote `where user_id = u`. Better than
-- being handed the wrong person, but the filter still lived in a function body somebody could get
-- wrong, and "this function is careful" is not a boundary.
--
-- The boundary is now the SHAPE. A bot's facts are fetched by the same functions the reader's own
-- client calls — get_my_entitlements(), support_tickets_mine(), my_orders() — and every one of
-- them TAKES NO ARGUMENT. There is no parameter anywhere in the chain that names a person. The only
-- thing that steers them is `auth.uid()`, and the only thing that sets it is agent_become, which
-- derives the subject from the run. So a bot cannot ask about somebody else: not because the code
-- declines to, but because there is nowhere to put their id.
--
-- It also means there is ONE implementation of "what may this person see" rather than two. A policy
-- change for readers reaches bots the same day, and a bot can never drift into seeing more than the
-- account it is answering for.
--
-- What this is NOT: a role switch. Postgres refuses `SET ROLE` inside a SECURITY DEFINER function,
-- so the reads are not literally executed as the subject and raw table access here still bypasses
-- RLS. That is why nothing below reads a table directly. If a fact is wanted that has no
-- reader-facing function, the answer is to write one — for readers and bots together — not to add
-- a query here.

-- Become the run's subject for the rest of this statement's transaction. A DOWNGRADE and never an
-- escalation: it sets who is being answered for, and nothing else. Returns null when there is
-- nobody, which is the whole of the guest case.
CREATE OR REPLACE FUNCTION "public"."agent_become"("p_run" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare u uuid;
begin
  select (public.agent_subject(p_run)->>'user_id')::uuid into u;
  if u is null then return null; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  return u;
end;
$$;

-- What somebody has bought, for themselves. The reader's own question, which had no function of its
-- own because a client reads these tables directly under RLS; a bot cannot, so here it is, written
-- once for both. No argument: it is always and only about whoever is asking.
CREATE OR REPLACE FUNCTION "public"."my_orders"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('sku', p.sku, 'amount_total', p.amount_total,
               'currency', p.currency, 'status', p.status, 'created_at', p.created_at,
               'variant', p.variant) order by p.created_at desc)
        from (select * from public.purchases where user_id = auth.uid()
               order by created_at desc limit 20) p), '[]'::jsonb),
    'parcels', coalesce((
      select jsonb_agg(jsonb_build_object('book', o.chosen ->> 'book', 'format', o.chosen ->> 'format', 'contents', o.chosen ->> 'contents',
               'status', o.status, 'supplier_status', o.supplier_status, 'tracking', o.tracking,
               'created_at', o.created_at) order by o.created_at desc)
        from (select * from public.fulfilments where user_id = auth.uid()
               order by created_at desc limit 20) o), '[]'::jsonb)) end;
$$;
REVOKE ALL ON FUNCTION "public"."my_orders"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_orders"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_orders"() TO "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."agent_orders"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.agent_become(p_run) is null then return null; end if;
  return public.my_orders();
end;
$$;

CREATE OR REPLACE FUNCTION "public"."agent_membership"("p_run" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.agent_become(p_run) is null then return null; end if;
  return public.get_my_entitlements();
end;
$$;

-- A guest has no account to become, and their tickets hang off a contact rather than a user, so
-- that one case is answered here — filtered to the single contact the run is about and nothing else.
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

REVOKE ALL ON FUNCTION "public"."agent_become"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_become"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_become"("uuid") TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- WHAT WAS ACTUALLY SAID — read here, never accepted from a client.
--
-- agent_summon used to take the transcript as a parameter and the worker put it in the SYSTEM
-- message, above the bot's own conduct. Anyone who could summon a bot could therefore write its
-- instructions. A forged three-line "context" made the desk bot — whose prompt says never to state
-- a policy it has not read from the site — promise free two-day shipping to Japan in one step,
-- without looking anything up.
--
-- So the transcript is read from the tables, by the run. A person can still put words in front of a
-- bot: by SAYING them, in the room, where everybody can see them and under their own name. That is
-- the ordinary trust of a chat room, and it is a different thing entirely from handing somebody a
-- private channel into the system prompt.
--
-- Which lines, by the same rule the surface draws: in a thread the thread (root_id differs from the
-- channel), otherwise the channel. Newest last, capped.
CREATE OR REPLACE FUNCTION "public"."agent_transcript"("p_run" "uuid", "p_limit" integer DEFAULT 60) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.agent_runs; n int := greatest(1, least(coalesce(p_limit, 60), 200)); inthread boolean;
begin
  select * into r from public.agent_runs where id = p_run;
  if not found then return '[]'::jsonb; end if;

  if r.surface = 'spaces' and r.channel_id is not null then
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
  end if;

  if r.surface = 'support' and r.conversation_id is not null then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', m.kind, 'body', m.body, 'meta', jsonb_build_object(),
               'attachment_name', m.attachment_name, 'deleted_at', m.deleted_at,
               'mine', m.author = 'agent') order by m.created_at)
        from (select * from public.support_messages x
               where x.conversation_id = r.conversation_id
               order by x.created_at desc limit n) m), '[]'::jsonb);
  end if;

  if r.surface = 'coaching' and r.conversation_id is not null then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', m.kind, 'body', m.body, 'meta', jsonb_build_object(),
               'deleted_at', m.deleted_at, 'mine', m.sender_id = r.asked_by) order by m.created_at)
        from (select * from public.messages x
               where x.conversation_id = r.conversation_id
               order by x.created_at desc limit n) m), '[]'::jsonb);
  end if;

  return '[]'::jsonb;
end;
$$;

REVOKE ALL ON FUNCTION "public"."agent_transcript"("uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_transcript"("uuid", integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_transcript"("uuid", integer) TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- A BOT THAT ANSWERS BY ITSELF.
--
-- Everything above is a bot somebody SUMMONED: a person pressed something, and `for:` asked whether
-- that person may. A bot with `hears: [{ event: support-message, ask: … }]` has no such person. The
-- customer's own message starts it, and the customer is not asking for a bot — they are asking a
-- question and a bot happens to answer.
--
-- So the gate is `serves:`, against the SUBJECT, and nothing else could be right: there is no asker
-- to ask about. `serves: authenticated` is how a site says "not for people we cannot identify";
-- `serves: customer` is how it says "only for people who have bought something". A bot that names
-- neither answers everybody, which is a decision somebody writes in a file.
--
-- And the ceiling matters far more here than for a summon, because the loop can now be somebody
-- typing quickly rather than somebody clicking. It is counted against the account, or against the
-- contact for somebody who has none — a bot that answers by itself will meet plenty of those.
--
-- asked_by is NULL: nobody asked. That is already the shape a scheduled run has, and every personal
-- tool already refuses where there is nobody to ask about.

CREATE OR REPLACE FUNCTION "public"."agent_hear"(
      "p_event" "text", "p_surface" "text", "p_conversation" "uuid", "p_channel" "uuid" DEFAULT NULL::"uuid",
      "p_ask" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare b public.bots; subj jsonb; su uuid; sk text; n int := 0; ask text;
begin
  if not public.agents_live() then return 0; end if;

  -- somebody who asked for a person gets a person
  if exists (select 1 from public.support_conversations c
              where c.id = p_conversation and c.bot_off_at is not null) then return 0; end if;

  subj := public.agent_subject_of(p_surface, p_conversation, null);
  su := (subj->>'user_id')::uuid;
  sk := public.agent_subject_key(subj);

  for b in
    select * from public.bots
     where published and p_surface = any(surfaces)
       and exists (select 1 from jsonb_array_elements(coalesce(hears, '[]'::jsonb)) h
                    where h->>'kind' = 'event' and h->>'event' = p_event)
  loop
    -- AN `ask` BOT ANSWERS ONLY THE THREADS IT WAS CHOSEN FOR. It hears the button (support-asked)
    -- wherever it is offered; it hears ordinary messages (support-message) only once somebody has
    -- chosen it, which is what makes the choice stick instead of asking them to press every time.
    if p_event = 'support-message' and b.offer = 'ask'
       and not exists (select 1 from public.support_conversations c
                        where c.id = p_conversation and c.bot_at is not null) then
      continue;
    end if;

    -- who it may be run FOR. There is no asker, so this is the whole of the question.
    if coalesce(jsonb_array_length(coalesce(b.serves, '[]'::jsonb)), 0) > 0
       and not (su is not null and public.space_fill_matches(su, b.serves)) then
      continue;
    end if;
    -- and what they have already spent
    if public.agent_over_cap(b.slug, sk, b.limits->'per') is not null then continue; end if;
    -- one run per bot per event: a bot already thinking about this conversation is not asked again,
    -- which is what stops a fast typist from starting five
    if exists (select 1 from public.agent_runs x
                where x.bot = b.slug and x.conversation_id = p_conversation
                  and x.status in ('queued', 'running') and x.cancel_at is null) then
      continue;
    end if;

    ask := coalesce(nullif(trim(p_ask), ''), (
      select h->>'ask' from jsonb_array_elements(coalesce(b.hears, '[]'::jsonb)) h
       where h->>'kind' = 'event' and h->>'event' = p_event limit 1));

    insert into public.agent_runs (bot, surface, channel_id, conversation_id, root_id,
                                   asked_by, subject_key, status, state, deadline_at)
         values (b.slug, p_surface, p_channel, p_conversation, p_conversation,
                 null, sk, 'queued',
                 jsonb_build_object('messages', case when coalesce(ask, '') = '' then '[]'::jsonb
                   else jsonb_build_array(jsonb_build_object('role', 'user', 'content', ask)) end),
                 now() + make_interval(mins => coalesce((b.limits->>'minutes')::int, 10)));
    n := n + 1;
  end loop;
  return n;
end;
$$;

REVOKE ALL ON FUNCTION "public"."agent_hear"("text", "text", "uuid", "uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_hear"("text", "text", "uuid", "uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_hear"("text", "text", "uuid", "uuid", "text") TO "service_role";

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

-- the words a bot is asked, with the mention tokens taken out: it is being asked a question, not
-- handed the room's markup. The same rule the browser applied before this moved.
CREATE OR REPLACE FUNCTION "public"."space_plain_body"("p_body" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select btrim(regexp_replace(coalesce(p_body, ''), '<@(bot:[a-z0-9-]{1,60}|role:[a-z0-9-]{1,48}|[0-9a-fA-F-]{36})>', '', 'g'))
$$;
REVOKE ALL ON FUNCTION "public"."space_plain_body"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_plain_body"("text") TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- WHICH OF A BOT'S TOOLS AND SKILLS THIS RUN MAY HAVE.
--
-- A tool's audience asks about the ASKER — who may USE it — which is the opposite end from
-- `serves:`. A refund tool is staff-only to use and acts on the customer; getting those two the
-- wrong way round would be a worse bug than having neither.
--
-- Takes every name and its audience at once and answers with the permitted ones, because the tool
-- list and the skills line must be filtered in the same breath: a skill named in the prompt whose
-- tool was withheld is a model reaching for something that is not there.
--
-- A run nobody asked for (a schedule, a bot that answers by itself) has no asker, so anything with
-- an audience is withheld. That is the safe direction: the alternative is a tool gated on "staff"
-- running with nobody behind it.
CREATE OR REPLACE FUNCTION "public"."agent_permits"("p_run" "uuid", "p_named" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(e.key), '[]'::jsonb)
    from public.agent_runs r, jsonb_each(coalesce(p_named, '{}'::jsonb)) e
   where r.id = p_run
     and (coalesce(jsonb_array_length(e.value), 0) = 0
          or (r.asked_by is not null and public.space_fill_matches(r.asked_by, e.value)));
$$;

REVOKE ALL ON FUNCTION "public"."agent_permits"("uuid", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_permits"("uuid", "jsonb") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_permits"("uuid", "jsonb") TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- HOW A BOT IS OFFERED ON THE DESK, and how somebody gets away from it.
--
--   off      (the default) a staff tool: somebody presses Ask the bot and reads a draft.
--   ask      the widget offers it and the person chooses. Nothing happens unless they press.
--   always   it answers every message they send.
--
-- And whichever it is, a person may ask for a human. That is an ACT — they said they want somebody
-- — so it is a row, it is theirs, and nothing undoes it but a human picking the thread up. A bot
-- you cannot get away from is a bad bot, and every one of these has an escape by construction
-- rather than by a prompt asking it nicely to hand over.

CREATE OR REPLACE FUNCTION "public"."support_want_human"("p_conversation" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.support_conversations
     set bot_off_at = coalesce(bot_off_at, now()),
         status = case when status = 'resolved' then 'open' else status end
   where id = p_conversation;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  -- a bot already thinking is called off: the answer it was writing is not wanted
  update public.agent_runs set cancel_at = now()
   where conversation_id = p_conversation and status in ('queued', 'running') and cancel_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

REVOKE ALL ON FUNCTION "public"."support_want_human"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."support_want_human"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."support_want_human"("uuid") TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- IS THERE ANYWHERE TO BUY A THOUGHT?
--
-- A bot declared in markdown is CONFIGURED. It is not therefore usable: thinking is bought, and a
-- deployment with no provider key — or one that has not opted in to spending (AGENTS_LIVE) — has
-- nothing to buy it from. A site in that state must show no bot anywhere: no mention in a composer,
-- no slash command, no Ask the bot on a desk, no assistant in the widget. Offering something that
-- cannot work is worse than not offering it.
--
-- One fact, in one place, so every surface gets it without asking. The worker writes it on each
-- invocation (it is the only thing that knows what keys it has), and the bots table's own read
-- policy reads it — so a site with no provider lists no bots, and every affordance that is drawn
-- from that list disappears by construction rather than by each surface remembering to check.
--
-- Absent means NO. A fresh deployment shows nothing until the worker has run once and said
-- otherwise, which is the safe direction and self-heals within a minute of the sweep.
CREATE OR REPLACE FUNCTION "public"."agents_live"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select value = 'true' from public.app_settings where key = 'agents_live'), false);
$$;
GRANT EXECUTE ON FUNCTION "public"."agents_live"() TO "anon", "authenticated", "service_role";

DROP POLICY IF EXISTS "bots_select" ON "public"."bots";
CREATE POLICY "bots_select" ON "public"."bots" FOR SELECT TO "authenticated", "anon"
  USING (("published" = true) AND "public"."agents_live"() AND "public"."event_for_me"("audience"));

-- WHICH RUNG THE PERSON A RUN IS FOR STANDS ON — the same ladder _shared/access.js defines, read
-- from the subject's entitlements. A run with nobody behind it is a guest, which is the safe end.
CREATE OR REPLACE FUNCTION "public"."agent_class"("p_run" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when (public.agent_subject(p_run)->>'user_id') is null then 'guest'
    when exists (select 1 from public.entitlements e
                  where e.user_id = (public.agent_subject(p_run)->>'user_id')::uuid
                    and e.kind = 'class' and e.key = 'subscribed' and e.active
                    and (e.expires_at is null or e.expires_at > now())) then 'subscribed'
    when exists (select 1 from public.entitlements e
                  where e.user_id = (public.agent_subject(p_run)->>'user_id')::uuid
                    and e.kind = 'class' and e.key = 'paid' and e.active
                    and (e.expires_at is null or e.expires_at > now())) then 'paid'
    else 'authenticated' end;
$$;
REVOKE ALL ON FUNCTION "public"."agent_class"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."agent_class"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."agent_class"("uuid") TO "service_role";
