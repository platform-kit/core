-- A RUN, RECORDED (openspec: recorded-rounds): one recording per run of the question runner that the person chose to
-- record — an instrument's round, or a form — marked at every screen, in the private `run-recordings` bucket under
-- <user_id>/<recording_id>/<nnnn>.mp4. The person's own; their staff's too only where a form said so (staff_read).
-- Kept by membership: keep_days and keep_after_membership are written when the recording starts, from the site's
-- configuration, and run_recordings_due answers which have run out. Answers and results are never touched here.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."run_recordings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "ref" "text" NOT NULL,
    "response_id" "uuid",
    "kind" "text" NOT NULL,
    "mime" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "duration_ms" integer,
    "parts" integer DEFAULT 0 NOT NULL,
    "bytes" bigint DEFAULT 0 NOT NULL,
    -- one per screen: { id, shown_ms, answered_ms }, offsets from the recording's start
    "marks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'recording'::"text" NOT NULL,
    "staff_read" boolean DEFAULT false NOT NULL,
    "keep_days" integer,
    "keep_after_membership" integer,
    CONSTRAINT "run_recordings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "run_recordings_source_check" CHECK (("source" = ANY (ARRAY['instrument'::"text", 'form'::"text"]))),
    CONSTRAINT "run_recordings_kind_check" CHECK (("kind" = ANY (ARRAY['voice'::"text", 'video'::"text"]))),
    CONSTRAINT "run_recordings_status_check" CHECK (("status" = ANY (ARRAY['recording'::"text", 'complete'::"text", 'partial'::"text"]))),
    -- the instrument's recordings are the reader's alone, whatever a client writes
    CONSTRAINT "run_recordings_instrument_private" CHECK ((("source" <> 'instrument'::"text") OR (NOT "staff_read")))
);

CREATE INDEX IF NOT EXISTS "run_recordings_user_idx" ON "public"."run_recordings" USING "btree" ("user_id", "started_at" DESC);

ALTER TABLE ONLY "public"."run_recordings"
    ADD CONSTRAINT "run_recordings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- a recording's files outlive its row by at most an hour: every deleted row (its owner's delete, an account
-- deleted, the sweep's own) queues its folder here, and the run-recordings function empties the folder and the queue
CREATE TABLE IF NOT EXISTS "public"."run_recording_trash" (
    "prefix" "text" NOT NULL,
    "queued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "run_recording_trash_pkey" PRIMARY KEY ("prefix")
);

CREATE OR REPLACE FUNCTION "public"."run_recording_trashed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.run_recording_trash (prefix) values (old.user_id::text || '/' || old.id::text) on conflict do nothing;
  return old;
end;
$$;

CREATE OR REPLACE TRIGGER "run_recordings_trash" AFTER DELETE ON "public"."run_recordings" FOR EACH ROW EXECUTE FUNCTION "public"."run_recording_trashed"();

ALTER TABLE "public"."run_recordings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."run_recording_trash" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "run_recordings_select" ON "public"."run_recordings" FOR SELECT TO "authenticated"
  USING ((("auth"."uid"() = "user_id") OR ("staff_read" AND "public"."is_admin"())));
CREATE POLICY "run_recordings_insert_own" ON "public"."run_recordings" FOR INSERT TO "authenticated"
  WITH CHECK ((("auth"."uid"() = "user_id") AND ("status" = 'recording'::"text")));
CREATE POLICY "run_recordings_update_own" ON "public"."run_recordings" FOR UPDATE TO "authenticated"
  USING ((("auth"."uid"() = "user_id") AND ("status" = 'recording'::"text"))) WITH CHECK (("auth"."uid"() = "user_id"));
CREATE POLICY "run_recordings_delete_own" ON "public"."run_recordings" FOR DELETE TO "authenticated"
  USING (("auth"."uid"() = "user_id"));

REVOKE ALL ON TABLE "public"."run_recordings" FROM "anon", "authenticated";
GRANT SELECT, DELETE ON TABLE "public"."run_recordings" TO "authenticated";
GRANT INSERT ("id", "user_id", "source", "ref", "response_id", "kind", "mime", "started_at", "staff_read", "keep_days", "keep_after_membership") ON TABLE "public"."run_recordings" TO "authenticated";
-- what a recording in progress may change about itself: its progress, never who may read it or how long it is kept
GRANT UPDATE ("ended_at", "duration_ms", "parts", "bytes", "marks", "status", "response_id") ON TABLE "public"."run_recordings" TO "authenticated";
GRANT ALL ON TABLE "public"."run_recordings" TO "service_role";

REVOKE ALL ON TABLE "public"."run_recording_trash" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."run_recording_trash" TO "service_role";

REVOKE ALL ON FUNCTION "public"."run_recording_trashed"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_recording_trashed"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_recording_trashed"() TO "service_role";

-- the files: the owner's folder is theirs; a staff member reads one only where its recording says staff_read
CREATE POLICY "run recordings owner write" ON "storage"."objects" FOR INSERT TO "authenticated"
  WITH CHECK ((("bucket_id" = 'run-recordings'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));
CREATE POLICY "run recordings owner read" ON "storage"."objects" FOR SELECT TO "authenticated"
  USING (("bucket_id" = 'run-recordings'::"text") AND (
    (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")
    OR ("public"."is_admin"() AND EXISTS (SELECT 1 FROM "public"."run_recordings" "r"
          WHERE ("r"."id")::"text" = ("storage"."foldername"("objects"."name"))[2] AND "r"."staff_read"))));
CREATE POLICY "run recordings owner delete" ON "storage"."objects" FOR DELETE TO "authenticated"
  USING ((("bucket_id" = 'run-recordings'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));

-- WHICH RECORDINGS HAVE RUN OUT. Older than keep_days, and — where the site keeps members' longer
-- (keep_after_membership) — its owner holds no live membership and any they held ended more than
-- keep_after_membership days ago. A membership's end is the latest of its subscriptions' period ends and its
-- membership entitlements' expiries. keep_days null: kept until its owner deletes it.
CREATE OR REPLACE FUNCTION "public"."run_recordings_due"() RETURNS TABLE("id" "uuid", "user_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, r.user_id from public.run_recordings r
   where r.keep_days is not null
     and r.started_at < now() - make_interval(days => r.keep_days)
     and (r.keep_after_membership is null or (
       not exists (select 1 from public.entitlements e where e.user_id = r.user_id and e.kind = 'class' and e.key = 'subscribed'
                     and e.active and (e.expires_at is null or e.expires_at > now()))
       and coalesce(greatest(
             (select max(s.current_period_end) from public.subscriptions s where s.user_id = r.user_id),
             (select max(e.expires_at) from public.entitlements e where e.user_id = r.user_id and e.kind = 'class' and e.key = 'subscribed')),
           '-infinity'::timestamptz) < now() - make_interval(days => r.keep_after_membership)))
$$;
REVOKE ALL ON FUNCTION "public"."run_recordings_due"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_recordings_due"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_recordings_due"() TO "service_role";

-- the hourly sweep's caller: pg_cron holds no user, so it posts to the function with the service key (as session-recordings' retain)
CREATE OR REPLACE FUNCTION "public"."run_run_recordings_sweep"() RETURNS "void"
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
    url := url || '/run-recordings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"sweep"}'::jsonb,
    timeout_milliseconds := 120000);
end;
$$;
REVOKE ALL ON FUNCTION "public"."run_run_recordings_sweep"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_run_recordings_sweep"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_run_recordings_sweep"() TO "service_role";
