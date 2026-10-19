-- sessions: bookings — the site's own (a host's hours, a time never booked twice, the reminders) and cal.com's mirrored — the follow-ups and the refusals
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

-- the exclusion constraint on a host's time needs btree_gist (equality on a uuid inside a gist index)
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "extensions";

-- A HOST'S HOURS, and they may keep more than one set.
--
-- "Mornings for discovery calls, evenings for clients" is a thing people say, and with one row per
-- host it could not be said. So a host keeps any number of NAMED sets, exactly one of them theirs by
-- default, and a booking type may ask for one by name — falling back to their default where they
-- have no set of that name, because a type naming hours somebody does not keep should offer their
-- ordinary times rather than nothing.
CREATE TABLE IF NOT EXISTS "public"."provider_schedules" ( -- renamed from: provider_hours, coach_hours
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Working hours'::"text" NOT NULL,
    "is_default" boolean DEFAULT true NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "weekly" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- BREATHING ROOM BOTH SIDES. One number meant the same either side of a call, which is not how
    -- anybody works: ten minutes to write a note after, none needed before.
    "buffer_before" integer DEFAULT 0 NOT NULL, -- renamed from: buffer_min
    "buffer_after" integer DEFAULT 0 NOT NULL,
    "notice_hours" integer DEFAULT 24 NOT NULL,
    "max_per_day" integer DEFAULT 0 NOT NULL,
    "max_per_week" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provider_schedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_schedules_sane" CHECK ((("buffer_before" >= 0) AND ("buffer_after" >= 0) AND ("notice_hours" >= 0) AND ("max_per_day" >= 0) AND ("max_per_week" >= 0))),
    -- and a name is what was typed, trimmed: the writer trims before it saves, so " Evenings" and
    -- "Evenings" cannot become two sets
    CONSTRAINT "provider_schedules_named" CHECK ((length(btrim("name")) > 0) AND ("name" = btrim("name")))
);
ALTER TABLE ONLY "public"."provider_schedules"
    ADD CONSTRAINT "provider_schedules_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
-- one name per person: two sets called Evenings is two answers to one question. A plain constraint
-- rather than an index over lower(name), because ON CONFLICT can only target named columns and a
-- caller that cannot upsert by name has to read-then-write, which is a race.
ALTER TABLE ONLY "public"."provider_schedules"
    ADD CONSTRAINT "provider_schedules_user_name_key" UNIQUE ("user_id", "name");
-- and exactly one default, held by the database rather than by whatever wrote last
CREATE UNIQUE INDEX IF NOT EXISTS "provider_schedules_default_idx" ON "public"."provider_schedules" USING "btree" ("user_id") WHERE "is_default";
CREATE INDEX IF NOT EXISTS "provider_schedules_user_idx" ON "public"."provider_schedules" USING "btree" ("user_id");

-- MARKING ONE THE DEFAULT unmarks the last, in one act: the unique index would otherwise refuse the
-- second of two writes and leave a person unable to change their mind.
CREATE OR REPLACE FUNCTION "public"."provider_schedule_default"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare who uuid;
begin
  select user_id into who from public.provider_schedules where id = p_id;
  if who is null then raise exception 'no such schedule'; end if;
  if who <> auth.uid() and not public.is_admin() then raise exception 'not yours'; end if;
  update public.provider_schedules set is_default = false where user_id = who and id <> p_id and is_default;
  update public.provider_schedules set is_default = true where id = p_id;
end;
$$;
REVOKE ALL ON FUNCTION "public"."provider_schedule_default"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."provider_schedule_default"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."provider_schedule_default"("uuid") TO "authenticated", "service_role";
-- a day off, or a day's ranges instead of the week's
CREATE TABLE IF NOT EXISTS "public"."provider_overrides" ( -- renamed from: coach_overrides
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- A DAY OFF IS A DAY OFF FROM THE HOURS IT WAS WRITTEN ON, not from the person: somebody who
    -- keeps evenings as well as mornings may be away from one and not the other. Null is their
    -- default set, which is what every override written before there was more than one meant.
    "schedule_id" "uuid",
    "day" "date" NOT NULL,
    "ranges" "jsonb",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
-- the reminders sent, one row each, so a rerun never repeats one
CREATE TABLE IF NOT EXISTS "public"."session_reminders" (
    "booking_uid" "text" NOT NULL,
    "hours" integer NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

-- the reminders (session-reminders): every five minutes, the reminders due, posted to the function with the service key
CREATE OR REPLACE FUNCTION "public"."run_session_reminders"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  if not exists (select 1 from public.bookings where provider = 'native' and status = 'accepted' and start_at between now() and now() + interval '8 days') then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/session-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"send"}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

-- the hosts a booking type may name: every account that gives appointments (an administrator today), for the admin's editor
CREATE OR REPLACE FUNCTION "public"."admin_hosts"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_admin() then coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'name', display_name) order by display_name, email), '[]'::jsonb) else null end
  from public.profiles where public.is_provider(id) and email is not null;
$$;

-- WHO COULD COVER FOR ME. The other people who give appointments, by the name they show — for
-- anybody who gives them themselves, because choosing a cover is a thing a host does and
-- admin_hosts is the DESK's read, granted to administrators alone.
--
-- Names and ids, never addresses: knowing who can take your Tuesday is not knowing how to write to
-- them, and the two should not arrive together.
CREATE OR REPLACE FUNCTION "public"."cover_choices"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.is_provider(auth.uid()) then null else
    coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.display_name, ''), nullif(p.username, ''), nullif(p.first_name, ''), 'Someone')) order by p.display_name), '[]'::jsonb) end
  from public.profiles p
  where public.is_provider(p.id) and p.id <> auth.uid();
$$;
REVOKE ALL ON FUNCTION "public"."cover_choices"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."cover_choices"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."cover_choices"() TO "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."refuse_booking"("p_uid" "text", "p_reason" "text", "p_body" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  b record; cid uuid;
begin
  select uid, provider_id, user_id into b from public.bookings where uid = p_uid;
  if b.uid is null then return false; end if;
  update public.bookings set status = 'cancelled', refused = p_reason, updated_at = now() where uid = p_uid;
  if b.provider_id is not null and b.user_id is not null and p_body is not null and p_body <> '' then
    cid := public.conversation_between(b.user_id, b.provider_id);
    insert into public.messages (conversation_id, sender_id, kind, body) values (cid, b.provider_id, 'text', p_body);
    return true;
  end if;
  return false;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."send_booking_followups"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  b record; who record; cid uuid; sent integer := 0;
begin
  for b in
    select uid, provider_id, user_id, attendee_emails, followup_body
    from public.bookings
    where followup_sent_at is null and followup_at is not null and followup_at <= now()
      and provider_id is not null and followup_body is not null
    for update skip locked
  loop
    for who in
      select distinct p.id from public.profiles p
      where p.id <> b.provider_id
        and (p.id = b.user_id or lower(coalesce(p.email, '')) = any (b.attendee_emails))
    loop
      cid := public.conversation_between(who.id, b.provider_id);
      insert into public.messages (conversation_id, sender_id, kind, body) values (cid, b.provider_id, 'text', b.followup_body);
      sent := sent + 1;
    end loop;
    update public.bookings set followup_sent_at = now() where uid = b.uid;
  end loop;
  return sent;
end;
$$;

CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "uid" "text" NOT NULL,
    "user_id" "uuid",
    "checkout_identity" "text",
    "stripe_checkout_session_id" "text",
    "email" "text",
    "name" "text",
    "title" "text",
    "start_at" timestamp with time zone,
    "end_at" timestamp with time zone,
    "status" "text" DEFAULT 'accepted'::"text" NOT NULL,
    "join_url" "text",
    "reschedule_url" "text",
    "cancel_url" "text",
    "recording_url" "text",
    "transcript_url" "text",
    "payload" "jsonb",
    -- WHAT THEY ANSWERED ON THE WAY IN. A type may ask a form's questions between the time and the
    -- confirmation; the answers are a form response like any other, and this is the booking saying
    -- which one. Null where the type asks nothing, which is most of them.
    "response_id" "uuid",
    -- WHICH RUN THIS ONE BELONGS TO, where a reader booked several at once. Every session of a run
    -- carries the first one's uid, including the first, so "the run" is one query and moving or
    -- cancelling one can be told from doing it to all of them.
    "run_of" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event" "text",
    "provider_id" "uuid", -- renamed from: coach_id
    "provider_email" "text", -- renamed from: coach_email
    "attendee_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "no_show" boolean DEFAULT false NOT NULL,
    "started_at" timestamp with time zone,
    "followup_at" timestamp with time zone,
    "followup_body" "text",
    "followup_sent_at" timestamp with time zone,
    "refused" "text",
    "credit_id" "uuid",
    "recording_path" "text",
    "transcript_path" "text",
    "recording_at" timestamp with time zone,
    "recording_state" "text",
    "recording_error" "text",
    "recording_tries" integer DEFAULT 0 NOT NULL,
    "provider" "text" DEFAULT 'cal'::"text" NOT NULL,
    "type" "text",
    "host_id" "uuid",
    "seat_of" "text",
    "where" "jsonb",
    "no_show_by" "uuid",
    "room" "text",
    "made_by" "uuid",
    "made_by_name" "text",
    CONSTRAINT "bookings_recording_state_check" CHECK ((("recording_state" IS NULL) OR ("recording_state" = ANY (ARRAY['pending'::"text", 'failed'::"text", 'removed'::"text"])))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rescheduled'::"text", 'cancelled'::"text", 'rejected'::"text", 'ended'::"text"])))
);

-- One paid checkout may fulfil a booking only once, even when the provider webhook and the
-- buyer's success-page confirmation arrive together or are replayed. The key is provider-scoped.
CREATE TABLE IF NOT EXISTS "public"."booking_checkout_fulfilments" (
    "checkout_session_id" "text" NOT NULL,
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "email" "text",
    "booking_uid" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_checkout_fulfilments_pkey" PRIMARY KEY ("checkout_session_id"),
    CONSTRAINT "booking_checkout_fulfilments_status_check" CHECK (("status" = ANY (ARRAY['processing'::"text", 'booked'::"text", 'unavailable'::"text", 'failed'::"text"])))
);

-- a native booking, made whole under a lock on its time: a group session's seats counted, the row inserted
-- (the exclusion constraint refuses a one-to-one's second insert on its own), the row answered
CREATE OR REPLACE FUNCTION "public"."book_native"("p" "jsonb", "p_seats" integer, "p_hosts" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "public"."bookings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r public.bookings; taken integer; first_uid text;
begin
  -- the defaults a populated record would lose
  p := jsonb_build_object('status', 'accepted', 'created_at', now(), 'updated_at', now(), 'attendee_emails', '[]'::jsonb, 'no_show', false, 'recording_tries', 0, 'provider', 'native') || p;
  perform pg_advisory_xact_lock(hashtext(coalesce(p->>'type', '') || '|' || coalesce(p->>'start_at', '')));
  if p_seats > 0 then
    select count(*), min(uid) into taken, first_uid from public.bookings
      where type = p->>'type' and start_at = (p->>'start_at')::timestamptz and status in ('accepted', 'pending') and seat_of is not null;
    if taken >= p_seats then raise exception 'full' using errcode = 'P0001'; end if;
    p := p || jsonb_build_object('seat_of', coalesce(first_uid, p->>'uid'));
  end if;
  insert into public.bookings select * from jsonb_populate_record(null::public.bookings, p) returning * into r;
  /* AND WHOSE TIME IT TAKES, inside the same transaction as the row: the exclusion constraint on the
     holds is what refuses a second booking of anybody on this list, and it refuses it here rather
     than after the booking exists. */
  perform public.booking_hold(r.uid, coalesce(p_hosts, case when r.host_id is null then '{}'::uuid[] else array[r.host_id] end));
  return r;
end;
$$;


-- a call's recording (session-recordings): every ten minutes the pending pulls, nightly the keep — both posted to the
-- function with the service key, like the support desk's clocks
CREATE OR REPLACE FUNCTION "public"."run_session_recordings"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  if not exists (select 1 from public.bookings where recording_state = 'pending') then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/session-recordings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"pull"}'::jsonb,
    timeout_milliseconds := 300000);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."run_session_recordings_retain"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/session-recordings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"retain"}'::jsonb,
    timeout_milliseconds := 120000);
end;
$$;

CREATE OR REPLACE VIEW "public"."sessions" WITH ("security_invoker"='false') AS
 SELECT "session_id" AS "id",
    ("array_agg"("user_id" ORDER BY "occurred_at") FILTER (WHERE ("user_id" IS NOT NULL)))[1] AS "user_id",
    ("array_agg"("anon_id" ORDER BY "occurred_at"))[1] AS "anon_id",
    "min"("occurred_at") AS "started_at",
    "max"("occurred_at") AS "ended_at",
    ("array_agg"("ref" ORDER BY "occurred_at") FILTER (WHERE ("ref" IS NOT NULL)))[1] AS "referrer",
    ("array_agg"("path" ORDER BY "occurred_at") FILTER (WHERE ("type" = 'pageview'::"text")))[1] AS "entry_path",
    ("array_agg"("path" ORDER BY "occurred_at" DESC) FILTER (WHERE ("type" = 'pageview'::"text")))[1] AS "exit_path",
    "count"(*) FILTER (WHERE ("type" = 'pageview'::"text")) AS "pageviews"
   FROM "public"."events"
  GROUP BY "session_id";

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("uid");
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_checkout_session_idx"
    ON "public"."bookings" USING "btree" ("stripe_checkout_session_id")
    WHERE ("stripe_checkout_session_id" IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_checkout_identity_idx"
    ON "public"."bookings" USING "btree" ("checkout_identity")
    WHERE ("checkout_identity" IS NOT NULL);

CREATE INDEX "bookings_attendees_idx" ON "public"."bookings" USING "gin" ("attendee_emails");

CREATE INDEX "bookings_provider_email_idx" ON "public"."bookings" USING "btree" ("lower"("provider_email"), "start_at" DESC);

CREATE INDEX "bookings_provider_idx" ON "public"."bookings" USING "btree" ("provider_id", "start_at" DESC);

CREATE INDEX "bookings_email_idx" ON "public"."bookings" USING "btree" ("lower"("email"), "start_at" DESC);

CREATE INDEX "bookings_event_idx" ON "public"."bookings" USING "btree" ("user_id", "event", "start_at" DESC);

CREATE INDEX "bookings_followup_idx" ON "public"."bookings" USING "btree" ("followup_at") WHERE (("followup_sent_at" IS NULL) AND ("followup_at" IS NOT NULL));

CREATE INDEX "bookings_user_idx" ON "public"."bookings" USING "btree" ("user_id", "start_at" DESC);

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
-- the response is the booking's, and goes with it; a response deleted on its own simply leaves the
-- booking with nothing to show, which is better than refusing to delete either
ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_response_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "public"."entitlements"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

-- a host's time is never booked twice: a native one-to-one (a seat shares its time on purpose)
ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_provider_check" CHECK (("provider" = ANY (ARRAY['cal'::"text", 'native'::"text"])));
CREATE INDEX "bookings_host_idx" ON "public"."bookings" USING "btree" ("host_id", "start_at");
CREATE INDEX "bookings_type_start_idx" ON "public"."bookings" USING "btree" ("type", "start_at") WHERE ("provider" = 'native'::"text");

ALTER TABLE ONLY "public"."provider_overrides"
    ADD CONSTRAINT "provider_overrides_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."provider_overrides"
    -- one exception per day PER SET OF HOURS, since a day off from the evenings is not a day off
    -- from the mornings. NULLS NOT DISTINCT so a row written before there were several sets — whose
    -- set is the default and therefore null — is still one per day.
    ADD CONSTRAINT "provider_overrides_user_day_key" UNIQUE NULLS NOT DISTINCT ("user_id", "day", "schedule_id");
ALTER TABLE ONLY "public"."provider_overrides"
    ADD CONSTRAINT "provider_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."provider_overrides"
    ADD CONSTRAINT "provider_overrides_schedule_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."provider_schedules"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."session_reminders"
    ADD CONSTRAINT "session_reminders_pkey" PRIMARY KEY ("booking_uid", "hours");

ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."booking_checkout_fulfilments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."session_reminders" ENABLE ROW LEVEL SECURITY;

-- a host's hours are theirs: read and written by the host alone, read by an administrator (the desk shows them)
CREATE POLICY "provider_schedules_own" ON "public"."provider_schedules" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));
CREATE POLICY "provider_schedules_admin_read" ON "public"."provider_schedules" FOR SELECT USING ("public"."is_admin"());
CREATE POLICY "provider_overrides_own" ON "public"."provider_overrides" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));
CREATE POLICY "provider_overrides_admin_read" ON "public"."provider_overrides" FOR SELECT USING ("public"."is_admin"());

-- the people on the booking, and an administrator (the desk's Bookings page)
-- by address only once the account has PROVEN it (my_proven_email): sign-ups are confirmed at once, so the
-- address in a token is only what somebody typed, and a guest's booking carries its join link and recording
CREATE POLICY "bookings_select_party" ON "public"."bookings" FOR SELECT USING (("public"."is_admin"() OR ("auth"."uid"() = "user_id") OR ("auth"."uid"() = "provider_id") OR ("public"."my_proven_email"() = ANY ("attendee_emails")) OR (("email" IS NOT NULL) AND ("lower"("email") = "public"."my_proven_email"())) OR (("provider_email" IS NOT NULL) AND ("lower"("provider_email") = "public"."my_proven_email"()))));

REVOKE ALL ON FUNCTION "public"."refuse_booking"("p_uid" "text", "p_reason" "text", "p_body" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."refuse_booking"("p_uid" "text", "p_reason" "text", "p_body" "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."refuse_booking"("p_uid" "text", "p_reason" "text", "p_body" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."send_booking_followups"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."send_booking_followups"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."send_booking_followups"() TO "service_role";

-- the schedule's (pg_cron, as the owner): it posts to a function with the service secret, so a visitor calling it would run the job
REVOKE ALL ON FUNCTION "public"."run_session_recordings"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_session_recordings"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_session_recordings"() TO "service_role";

-- the schedule's (pg_cron, as the owner): it posts to a function with the service secret, so a visitor calling it would run the job
REVOKE ALL ON FUNCTION "public"."run_session_recordings_retain"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_session_recordings_retain"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_session_recordings_retain"() TO "service_role";

-- the native scheduler's write (book-session, after the judge): it takes a whole row, so nobody else may call it
REVOKE ALL ON FUNCTION "public"."book_native"("p" "jsonb", "p_seats" integer, "p_hosts" "uuid"[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."book_native"("p" "jsonb", "p_seats" integer, "p_hosts" "uuid"[]) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."book_native"("p" "jsonb", "p_seats" integer, "p_hosts" "uuid"[]) TO "service_role";
REVOKE ALL ON TABLE "public"."booking_checkout_fulfilments" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."booking_checkout_fulfilments" TO "service_role";
-- the schedule's (pg_cron, as the owner): it posts to a function with the service secret, so a visitor calling it would run the job
REVOKE ALL ON FUNCTION "public"."run_session_reminders"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_session_reminders"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_session_reminders"() TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_hosts"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_hosts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_hosts"() TO "service_role";
GRANT ALL ON TABLE "public"."provider_schedules" TO "anon";
GRANT ALL ON TABLE "public"."provider_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_schedules" TO "service_role";
GRANT ALL ON TABLE "public"."provider_overrides" TO "anon";
GRANT ALL ON TABLE "public"."provider_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_overrides" TO "service_role";
GRANT ALL ON TABLE "public"."session_reminders" TO "service_role";
GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";

GRANT ALL ON TABLE "public"."sessions" TO "service_role";

REVOKE ALL ON FUNCTION "public"."refuse_booking"("text", "text", "text") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."send_booking_followups"() FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON TABLE "public"."sessions" FROM "anon", "authenticated";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."bookings";

-- webhook subscriptions on the sessions, as the Scheduling API (cal.com's) keeps them: a subscriber url, the triggers it
-- wants, whether it is active, the secret that signs its deliveries (X-Cal-Signature-256; kept whole, the service role's
-- alone, never answered back). Every booking the site knows — native, or cal.com's re-emitted — is delivered to each
-- active one from _shared/booking.ts (scheduling-api). Administrators read them under RLS; the API writes.
CREATE TABLE IF NOT EXISTS "public"."scheduling_webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscriber_url" "text" NOT NULL,
    "triggers" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "secret" "text",
    "payload_template" "text",
    "event_type_slug" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_at" timestamp with time zone,
    "last_error" "text",
    -- A subscription a deployment SHIPS is declared (platformkit.config.js `webhooks`) and is the
    -- projection's to replace; one somebody made through the API is theirs and is never touched.
    "source" "text" DEFAULT 'hand'::"text" NOT NULL,
    CONSTRAINT "scheduling_webhooks_source_check" CHECK (("source" = ANY (ARRAY['file'::"text", 'hand'::"text"])))
);
ALTER TABLE ONLY "public"."scheduling_webhooks" ADD CONSTRAINT "scheduling_webhooks_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."scheduling_webhooks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scheduling_webhooks_admin_select" ON "public"."scheduling_webhooks" FOR SELECT TO "authenticated" USING ("public"."is_admin"());
GRANT SELECT ON TABLE "public"."scheduling_webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduling_webhooks" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- WHOSE TIME A BOOKING TAKES
-- ---------------------------------------------------------------------------------------------
--
-- A hold is one person's time, taken by one booking. It is a row rather than a column on the
-- booking because a booking may take more than one person's time — a collective session is every
-- host's — and an exclusion constraint can only refuse an overlap for a value it can see in a row.
--
-- A hold EXISTS exactly while the booking holds the time, so the constraint needs no condition of
-- its own: booking writes one, cancelling removes it, moving carries it. That is simpler than the
-- column it replaces, whose partial condition had to restate what a live booking was in three
-- clauses and could drift from the code that wrote it.
--
-- A group session holds its host ONCE, on the first seat: the seats are counted under the advisory
-- lock, and what the hold stops is the host being booked for something else at that hour — which
-- the column this replaces never did, because it excused every seated booking.
CREATE TABLE IF NOT EXISTS "public"."booking_holds" (
    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    "booking_uid" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    CONSTRAINT "booking_holds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_holds_span" CHECK (("end_at" > "start_at"))
);
ALTER TABLE ONLY "public"."booking_holds"
    ADD CONSTRAINT "booking_holds_booking_fkey" FOREIGN KEY ("booking_uid") REFERENCES "public"."bookings"("uid") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."booking_holds"
    ADD CONSTRAINT "booking_holds_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
-- THE ONE RULE THIS TABLE EXISTS FOR: nobody's time is taken twice.
ALTER TABLE ONLY "public"."booking_holds"
    ADD CONSTRAINT "booking_holds_no_overlap" EXCLUDE USING "gist" ("user_id" WITH =, "tstzrange"("start_at", "end_at") WITH &&);
CREATE INDEX IF NOT EXISTS "booking_holds_booking_idx" ON "public"."booking_holds" USING "btree" ("booking_uid");
CREATE INDEX IF NOT EXISTS "booking_holds_user_idx" ON "public"."booking_holds" USING "btree" ("user_id", "start_at");

-- a hold is nobody's to write and nobody's to read but the people who can already see the booking
ALTER TABLE "public"."booking_holds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "booking_holds_read" ON "public"."booking_holds" FOR SELECT TO "authenticated"
  USING (("user_id" = (SELECT "auth"."uid"())) OR "public"."is_admin"());
GRANT SELECT ON TABLE "public"."booking_holds" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_holds" TO "service_role";

-- AWAY. A stretch of days somebody is not available for — a holiday, a course, a week ill — kept
-- apart from their hours because it is not a change to how they work: their week is still their
-- week, and comes back by itself when they do. A day off on its own is provider_overrides; this is
-- for the stretch.
--
-- A COVER may take what would have been theirs: somebody else who gives the same types. Where there
-- is one, the times offered in that stretch are the cover's, so a reader is not turned away from a
-- practice that has somebody free. Where there is none, the stretch is simply closed.
--
-- Bookings already made inside it STAND. Being away later is not a reason to cancel what somebody
-- has already been promised; the host cancels the ones they mean to, one at a time.
CREATE TABLE IF NOT EXISTS "public"."provider_ooo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "from" "date" NOT NULL,
    "to" "date" NOT NULL,
    "reason" "text",
    "cover_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provider_ooo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_ooo_span" CHECK (("to" >= "from")),
    CONSTRAINT "provider_ooo_not_self" CHECK (("cover_id" IS NULL) OR ("cover_id" <> "user_id"))
);
ALTER TABLE ONLY "public"."provider_ooo"
    ADD CONSTRAINT "provider_ooo_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."provider_ooo"
    ADD CONSTRAINT "provider_ooo_cover_fkey" FOREIGN KEY ("cover_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "provider_ooo_user_idx" ON "public"."provider_ooo" USING "btree" ("user_id", "from");
ALTER TABLE "public"."provider_ooo" ENABLE ROW LEVEL SECURITY;
-- theirs to keep, an administrator's to read; a reader learns of it only through the open times
CREATE POLICY "provider_ooo_own" ON "public"."provider_ooo" USING (("user_id" = "auth"."uid"()) OR "public"."is_admin"()) WITH CHECK (("user_id" = "auth"."uid"()) OR "public"."is_admin"());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."provider_ooo" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_ooo" TO "service_role";

-- WHO ELSE IS COMING to a group session — the other seats of the same time, by the name each
-- person chose to show. Only for somebody who holds a seat of it themselves, and only ever names:
-- an address is somebody else's to give out, and a list of who is in the room should not also be a
-- list of how to write to them.
--
-- It exists because a reader sees only their OWN booking under RLS, which is right: the other seats
-- are other people's rows. This says the one thing about them that the room itself would.
CREATE OR REPLACE FUNCTION "public"."booking_company"("p_uid" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (select seat_of, start_at from public.bookings where uid = p_uid and (user_id = auth.uid() or public.is_admin()))
  select coalesce(jsonb_agg(jsonb_build_object('name', n) order by n), '[]'::jsonb)
    from (
      select distinct coalesce(nullif(p.display_name, ''), nullif(p.first_name, ''), nullif(b.name, ''), '') as n
        from public.bookings b
        join me on me.seat_of is not null and b.seat_of = me.seat_of
        left join public.profiles p on p.id = b.user_id
       where b.uid <> p_uid and b.status in ('accepted', 'pending')
    ) x
   where n <> '';
$$;
REVOKE ALL ON FUNCTION "public"."booking_company"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."booking_company"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."booking_company"("text") TO "authenticated", "service_role";

-- WHAT A BOOKING HOLDS, written where the booking is made and nowhere else. A group session's
-- second seat holds nothing: its first already holds the host.
--
-- WITH NO LIST IT HOLDS ITS OWN HOST, which is what a booking that names one means. The list is for
-- a collective type, where every host of the booking is held at once; passing nothing and getting
-- nothing held was a hole a seeded or backfilled booking fell straight through.
CREATE OR REPLACE FUNCTION "public"."booking_hold"("p_uid" "text", "p_users" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare b public.bookings;
begin
  select * into b from public.bookings where uid = p_uid;
  if not found then return; end if;
  if b.seat_of is not null and b.seat_of <> b.uid then return; end if;
  insert into public.booking_holds (booking_uid, user_id, start_at, end_at)
  -- NO "on conflict do nothing" HERE, EVER. The constraint this insert can violate is the exclusion
  -- on host × time, and swallowing it would mean a second booking at the same hour quietly succeeds
  -- with nothing held — which is the one thing the holds exist to stop.
  select p_uid, u, b.start_at, b.end_at from unnest(coalesce(p_users, array_remove(array[b.host_id], null))) u
   where u is not null;
end;
$$;

-- AND WHAT IT LETS GO. A seated booking's hold belongs to the group, so it is released only when
-- the last seat has gone: one attendee leaving does not free the hour the rest are still in.
CREATE OR REPLACE FUNCTION "public"."booking_release"("p_uid" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare b public.bookings; owner text; left_over integer;
begin
  select * into b from public.bookings where uid = p_uid;
  if not found then delete from public.booking_holds where booking_uid = p_uid; return; end if;
  owner := coalesce(b.seat_of, b.uid);
  if b.seat_of is not null then
    select count(*) into left_over from public.bookings
     where seat_of = b.seat_of and uid <> p_uid and status in ('accepted', 'pending');
    if left_over > 0 then
      /* the hold stays with the group; where the seat that owned it is the one leaving, it moves to
         one that remains, because a row pointing at a cancelled booking is a row nobody can explain */
      if owner = p_uid then
        update public.booking_holds set booking_uid = (
          select uid from public.bookings where seat_of = b.seat_of and uid <> p_uid
             and status in ('accepted', 'pending') order by created_at limit 1)
         where booking_uid = p_uid;
      end if;
      return;
    end if;
  end if;
  delete from public.booking_holds where booking_uid = owner or booking_uid = p_uid;
end;
$$;

-- a move carries every hold the booking has, so the constraint is asked about the new time
CREATE OR REPLACE FUNCTION "public"."booking_hold_move"("p_uid" "text", "p_start" timestamp with time zone, "p_end" timestamp with time zone) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.booking_holds set start_at = p_start, end_at = p_end
   where booking_uid = p_uid or booking_uid = (select coalesce(seat_of, uid) from public.bookings where uid = p_uid);
$$;

REVOKE ALL ON FUNCTION "public"."booking_hold"("text", "uuid"[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."booking_hold"("text", "uuid"[]) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."booking_hold"("text", "uuid"[]) TO "service_role";
REVOKE ALL ON FUNCTION "public"."booking_release"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."booking_release"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."booking_release"("text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."booking_hold_move"("text", timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."booking_hold_move"("text", timestamp with time zone, timestamp with time zone) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."booking_hold_move"("text", timestamp with time zone, timestamp with time zone) TO "service_role";
