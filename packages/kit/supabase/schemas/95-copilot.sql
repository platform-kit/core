-- WHAT SOMEBODY TOLD AN ASSISTANT, where a bot's file says it recalls (memory: person+recall).
--
-- STATE, NEVER A PROJECTION. If the database were deleted and the repository redeployed this must
-- NOT come back: it is what a person said, not something a file declares. It is append-only -- a
-- row is written, read and deleted, never edited -- and it is theirs: they read their own, they
-- delete their own, and nothing else may touch it from a client at all.
--
-- The vectors here are gte-small's, made by Supabase.ai inside the edge runtime: free, no provider
-- key, no egress, and it works on a reset local stack, which is what lets a deployment with no
-- model provider still have an assistant that remembers. 384 dimensions.
--
-- THEY ARE NOT THE BROWSER'S VECTORS. The site's own semantic search is ternlight, also 384 wide,
-- built at build time and embedded in the browser. Same width, different model, so the two are NOT
-- interchangeable and must never be compared: this table is gte-small's alone. Two 384-vectors
-- that look alike is exactly the mistake somebody makes in a year.
--
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

-- A SCHEMA FILE THAT NEEDS AN EXTENSION DECLARES IT, because the schemas are applied before
-- data.sql and a table whose type does not exist yet fails the reset. The same statement is in
-- data.sql, idempotently, exactly as btree_gist is -- see 55-sessions.sql.
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

CREATE TABLE IF NOT EXISTS "public"."copilot_memory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    -- who said it: the SUBJECT the run answered for, never the asker -- the same distinction the
    -- agent loop already makes, for the same reason.
    "user_id" "uuid" NOT NULL,
    -- and which assistant they told. A person may use two, and what they told one is not the
    -- other's to recall.
    "bot" "text" NOT NULL,
    "said" "text" NOT NULL,
    "embedding" "extensions"."vector"(384),
    -- `said` is what they actually said; `summarised` is reserved for a later pass that condenses
    -- a long history. The column exists from the start so adding that is not a migration.
    "source" "text" DEFAULT 'said'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "copilot_memory_source_check" CHECK (("source" = ANY (ARRAY['said'::"text", 'summarised'::"text"])))
);

ALTER TABLE ONLY "public"."copilot_memory"
    ADD CONSTRAINT "copilot_memory_pkey" PRIMARY KEY ("id");

-- nearest neighbour over ONE person's rows for ONE bot, which is how it is always read
CREATE INDEX IF NOT EXISTS "copilot_memory_mine_idx" ON "public"."copilot_memory" USING "btree" ("user_id", "bot", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "copilot_memory_vec_idx" ON "public"."copilot_memory" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops");

ALTER TABLE "public"."copilot_memory" ENABLE ROW LEVEL SECURITY;

-- THEIRS TO READ AND THEIRS TO DELETE, and nothing else from a client. There is deliberately no
-- update policy and no insert policy: the platform writes with the service role, because a client
-- that could write here could put words in somebody's mouth that the assistant would later recall
-- as theirs.
CREATE POLICY "copilot_memory_select_own" ON "public"."copilot_memory" FOR SELECT USING (("user_id" = "auth"."uid"()));
CREATE POLICY "copilot_memory_delete_own" ON "public"."copilot_memory" FOR DELETE USING (("user_id" = "auth"."uid"()));

GRANT ALL ON TABLE "public"."copilot_memory" TO "anon";
GRANT ALL ON TABLE "public"."copilot_memory" TO "authenticated";
GRANT ALL ON TABLE "public"."copilot_memory" TO "service_role";

-- WHAT TO RECALL: the nearest things this person told this bot, far enough from nothing to be worth
-- saying. The floor matters -- a nearest neighbour is always SOMETHING, and recalling an unrelated
-- remark is worse than recalling nothing, because the assistant then sounds as though it
-- misremembers. Service role only: it answers for a subject the caller names, so a client calling
-- it could read another person's.
CREATE OR REPLACE FUNCTION "public"."copilot_recall"("p_user" "uuid", "p_bot" "text", "p_query" "extensions"."vector"(384), "p_limit" integer DEFAULT 6, "p_floor" double precision DEFAULT 0.25)
RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select coalesce(jsonb_agg(x.said order by x.near desc), '[]'::jsonb)
  from (
    select m.said, 1 - (m.embedding <=> p_query) as near
    from public.copilot_memory m
    where m.user_id = p_user and m.bot = p_bot and m.embedding is not null
    order by m.embedding <=> p_query
    limit greatest(p_limit, 0)
  ) x
  where x.near >= p_floor;
$$;

REVOKE ALL ON FUNCTION "public"."copilot_recall"("uuid", "text", "extensions"."vector"(384), integer, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."copilot_recall"("uuid", "text", "extensions"."vector"(384), integer, double precision) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."copilot_recall"("uuid", "text", "extensions"."vector"(384), integer, double precision) TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- THE CONVERSATIONS THEMSELVES, so somebody can come back to one.
--
-- STATE, and theirs. A conversation with an assistant is not declared by any file and must not
-- come back if the database is rebuilt from the repository: it is what two parties said to each
-- other. Unlike copilot_memory, which the platform writes because a client that could write it
-- could put words in somebody's mouth for the assistant to recall later, these rows are the
-- person's own record of their own session and they write them under their own session -- the
-- worst a forged line can do is lie to the person who forged it, in their own transcript.
--
-- A THREAD IS PER BOT. Two assistants are two sets of conversations; a thread never moves.
CREATE TABLE IF NOT EXISTS "public"."copilot_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "bot" "text" NOT NULL,
    -- the first thing they said, trimmed -- never typed by anybody, so there is no empty-title
    -- state and no "Untitled" in a list
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- when it was last SAID IN, which is the order the list is read in
    "spoke_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."copilot_threads"
    ADD CONSTRAINT "copilot_threads_pkey" PRIMARY KEY ("id");

CREATE INDEX IF NOT EXISTS "copilot_threads_mine_idx" ON "public"."copilot_threads" USING "btree" ("user_id", "bot", "spoke_at" DESC);

CREATE TABLE IF NOT EXISTS "public"."copilot_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    -- denormalised so a line can be policed without a join, exactly as the chat's messages are
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    -- 'me' and 'them' are the words the surface already uses for the two sides
    "who" "text" NOT NULL,
    "said" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "copilot_lines_who_check" CHECK (("who" = ANY (ARRAY['me'::"text", 'them'::"text"])))
);

ALTER TABLE ONLY "public"."copilot_lines"
    ADD CONSTRAINT "copilot_lines_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."copilot_lines"
    ADD CONSTRAINT "copilot_lines_thread_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."copilot_threads"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "copilot_lines_thread_idx" ON "public"."copilot_lines" USING "btree" ("thread_id", "created_at");

ALTER TABLE "public"."copilot_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."copilot_lines" ENABLE ROW LEVEL SECURITY;

-- theirs, all four ways. A thread may be renamed and deleted; a line is written and read and
-- never edited, which is the same rule every other transcript in this platform keeps.
CREATE POLICY "copilot_threads_select_own" ON "public"."copilot_threads" FOR SELECT USING (("user_id" = "auth"."uid"()));
CREATE POLICY "copilot_threads_insert_own" ON "public"."copilot_threads" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));
CREATE POLICY "copilot_threads_update_own" ON "public"."copilot_threads" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
CREATE POLICY "copilot_threads_delete_own" ON "public"."copilot_threads" FOR DELETE USING (("user_id" = "auth"."uid"()));

CREATE POLICY "copilot_lines_select_own" ON "public"."copilot_lines" FOR SELECT USING (("user_id" = "auth"."uid"()));
-- A LINE GOES IN A CONVERSATION OF THEIR OWN, not merely under their own name. Without the
-- second half of this somebody could append to a thread that is not theirs: the row would carry
-- the writer's id, so the owner would never see it, but a foreign key into a stranger's
-- conversation is a thing that should not be writable at all.
CREATE POLICY "copilot_lines_insert_own" ON "public"."copilot_lines" FOR INSERT WITH CHECK ((
  "user_id" = "auth"."uid"()
  AND EXISTS (SELECT 1 FROM "public"."copilot_threads" "t" WHERE "t"."id" = "thread_id" AND "t"."user_id" = "auth"."uid"())
));
CREATE POLICY "copilot_lines_delete_own" ON "public"."copilot_lines" FOR DELETE USING (("user_id" = "auth"."uid"()));

GRANT ALL ON TABLE "public"."copilot_threads" TO "anon";
GRANT ALL ON TABLE "public"."copilot_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."copilot_threads" TO "service_role";
GRANT ALL ON TABLE "public"."copilot_lines" TO "anon";
GRANT ALL ON TABLE "public"."copilot_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."copilot_lines" TO "service_role";

-- One row per signed grant. The transcript is theirs to keep; this short-lived row exists only
-- to enforce the grant's conversation-wide clock and budget across its multiple runs.
CREATE TABLE IF NOT EXISTS "public"."copilot_sessions" (
    "room" "text" NOT NULL,
    "bot" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "minutes" integer NOT NULL,
    "cents" numeric(12,4) NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "copilot_sessions_minutes_check" CHECK ("minutes" > 0),
    CONSTRAINT "copilot_sessions_cents_check" CHECK ("cents" > 0)
);

ALTER TABLE ONLY "public"."copilot_sessions"
    ADD CONSTRAINT "copilot_sessions_pkey" PRIMARY KEY ("room");

CREATE INDEX IF NOT EXISTS "copilot_sessions_expiry_idx" ON "public"."copilot_sessions" USING "btree" ("expires_at");

ALTER TABLE "public"."copilot_sessions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."copilot_sessions" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."copilot_sessions" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- A SPOKEN TURN IS A RUN, and this is the door it comes through.
--
-- `agent_summon` is the door for a PERSON: its first line is `if auth.uid() is null`. The caller
-- here is not a person and holds no session — it is a worker outside the deployment with a grant
-- (see _shared/copilot/grant.js), so it needs a service-role door exactly as `agent_job` is the
-- service-role door for enrichment. Same table, same loop, same lease, same cancel, same spend:
-- what differs is only who is allowed to knock.
--
-- Every check `agent_summon` makes is made here too, against the subject the grant names rather
-- than against the caller — the bot is published, something can think, the bot works on this
-- surface, it may be run FOR this person, and they have not spent what they may. Refused before
-- the row exists, so a refusal costs nothing.
CREATE OR REPLACE FUNCTION "public"."copilot_turn"("p_bot" "text", "p_subject" "uuid", "p_room" "text", "p_ask" "text")
RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  b public.bots;
  r public.agent_runs;
  c public.copilot_sessions;
  sk text;
  spent_window text;
  state jsonb;
  used numeric;
  turn_budget numeric;
  turn_deadline timestamp with time zone;
begin
  if p_subject is null then return jsonb_build_object('error', 'no-subject'); end if;
  select * into b from public.bots where slug = p_bot and published;
  if not found then return jsonb_build_object('error', 'no-bot'); end if;
  -- nothing to think with: a bot that cannot run is not refused politely, it is not there
  if not public.agents_live() then return jsonb_build_object('error', 'no-provider'); end if;
  if not ('voice' = any(b.surfaces)) then return jsonb_build_object('error', 'not-here'); end if;

  -- The signed room is the key to one immutable set of ceilings. A row lock serialises turns in
  -- the same room, and active runs reserve their remaining run budget before another turn starts.
  if coalesce(trim(p_room), '') = '' then return jsonb_build_object('error', 'invalid-grant'); end if;
  delete from public.copilot_sessions where expires_at <= now();
  select * into c
    from public.copilot_sessions
    where room = p_room and bot = p_bot and user_id = p_subject
    for update;
  if not found then return jsonb_build_object('error', 'invalid-grant'); end if;
  if c.expires_at <= now() then return jsonb_build_object('error', 'expired'); end if;
  if now() >= c.started_at + make_interval(mins => c.minutes) then
    return jsonb_build_object('error', 'conversation-minutes');
  end if;

  select coalesce(sum(
    case when status in ('queued', 'running', 'waiting') then budget_cents else spent_cents end
  ), 0)
    into used
    from public.agent_runs
    where surface = 'voice' and state->>'room' = p_room;
  if used >= c.cents then return jsonb_build_object('error', 'conversation-spend'); end if;
  turn_budget := least(
    coalesce(nullif(b.limits->>'spend', '')::numeric, 0.5) * 100,
    c.cents - used
  );
  if turn_budget <= 0 then return jsonb_build_object('error', 'conversation-spend'); end if;

  -- WHO IT ANSWERS FOR is the grant's subject, and `serves:` is asked about them — the same
  -- question `agent_summon` asks, about the same person, by the same rule.
  sk := public.agent_subject_key(jsonb_build_object('user_id', p_subject));
  if coalesce(jsonb_array_length(coalesce(b.serves, '[]'::jsonb)), 0) > 0
     and not public.space_fill_matches(p_subject, b.serves) then
    return jsonb_build_object('error', 'not-served');
  end if;

  -- the per-person ceiling still comes first, whether or not anybody is paying for the words
  spent_window := public.agent_over_cap(b.slug, sk, b.limits->'per');
  if spent_window is not null then
    return jsonb_build_object('error', 'spent', 'window', spent_window);
  end if;
  -- The agent worker reserves and settles each bounded provider call through the shared usage
  -- gate. This turn creator enforces the run's own ceilings, not a parallel balance-only gate.

  state := jsonb_build_object(
    'messages', case when coalesce(trim(p_ask), '') = '' then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('role', 'user', 'content', p_ask)) end,
    'room', coalesce(p_room, ''));

  turn_deadline := least(
    now() + make_interval(mins => coalesce((b.limits->>'minutes')::int, 10)),
    c.started_at + make_interval(mins => c.minutes),
    c.expires_at
  );

  -- `asked_by` is the subject: in a spoken conversation the person asking and the person answered
  -- for are the same, and saying so is what makes the run theirs to see and to stop.
  insert into public.agent_runs (bot, surface, asked_by, subject_key, status, state, budget_cents, deadline_at)
       values (b.slug, 'voice', p_subject, sk, 'queued', state, turn_budget, turn_deadline)
  returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'bot', b.slug, 'name', b.name);
end;
$$;

REVOKE ALL ON FUNCTION "public"."copilot_turn"("text", "uuid", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."copilot_turn"("text", "uuid", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."copilot_turn"("text", "uuid", "text", "text") TO "service_role";

-- WHAT SOMEBODY SAID, REMEMBERED. Written only here, only with the service role, and only where
-- the bot's file asked to recall — the embedding is made by the function (Supabase.ai, gte-small)
-- and handed in, because the database has no model of its own.
CREATE OR REPLACE FUNCTION "public"."copilot_remember"("p_user" "uuid", "p_bot" "text", "p_said" "text", "p_embedding" "extensions"."vector"(384))
RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  insert into public.copilot_memory (user_id, bot, said, embedding) values (p_user, p_bot, p_said, p_embedding);
$$;

REVOKE ALL ON FUNCTION "public"."copilot_remember"("uuid", "text", "text", "extensions"."vector"(384)) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."copilot_remember"("uuid", "text", "text", "extensions"."vector"(384)) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."copilot_remember"("uuid", "text", "text", "extensions"."vector"(384)) TO "service_role";
