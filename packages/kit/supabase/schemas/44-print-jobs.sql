-- SETTING A BOOK AS A JOB THAT OUTLIVES ITS REQUEST (openspec: print-production).
--
-- print-render sets a book in one Edge Function call when it can, but a call has two seconds of CPU and a cold worker
-- can spend most of that loading the compiler. So a set is a job: a row per request, leased to one worker at a time,
-- with what it has already finished. A call that is cut off mid-way leaves the lease to lapse; the sweep (pg_cron, every
-- minute) posts to print-render again, and the next worker carries on from what is finished — the interior, each
-- cover — rather than from the start. An administrator cancels one between steps, and its part-made files are removed.
--
-- Nothing here is a client's to write: print-render, with the service key, is the only writer, and an administrator
-- reads the jobs to see where a book is.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."print_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "book" "text" NOT NULL,
    "contents" "text" NOT NULL,
    -- the request as asked ({ draft, typ, parts }), so a later worker answers it the same way
    "request" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "requested_by" "uuid",
    "state" "text" DEFAULT 'queued'::"text" NOT NULL,
    -- what is finished, by step: { edition, interior: { pages, … }, covers: { key: name }, … }
    "done" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- the answer, once there is one: what print-render returns for a set
    "result" "jsonb",
    "error" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "lease_until" timestamp with time zone,
    "leased_by" "text",
    "cancel_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "print_jobs_state_check" CHECK (("state" = ANY (ARRAY['queued'::"text", 'running'::"text", 'done'::"text", 'failed'::"text", 'cancelled'::"text"])))
);
ALTER TABLE ONLY "public"."print_jobs" ADD CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id");
-- one set of a book's edition at a time: a second request for the same one joins the first
CREATE UNIQUE INDEX IF NOT EXISTS "print_jobs_one_open" ON "public"."print_jobs" USING "btree" ("book", "contents") WHERE ("state" = ANY (ARRAY['queued'::"text", 'running'::"text"]));
CREATE INDEX IF NOT EXISTS "print_jobs_due" ON "public"."print_jobs" USING "btree" ("lease_until") WHERE ("state" = ANY (ARRAY['queued'::"text", 'running'::"text"]));

ALTER TABLE "public"."print_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "print_jobs_admin_read" ON "public"."print_jobs" FOR SELECT TO "authenticated" USING ("public"."is_admin"());
GRANT SELECT ON TABLE "public"."print_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."print_jobs" TO "service_role";

-- THE LEASE: a job is a worker's for p_seconds, and nobody else's while it holds it. A cancelled one is claimed too: the
-- worker's first act is to see the cancel and take its part-made files away. One statement, so two workers
-- asking at once cannot both have it. A job past its attempts is failed rather than tried for ever.
CREATE OR REPLACE FUNCTION "public"."print_job_claim"("p_id" "uuid", "p_worker" "text", "p_seconds" integer DEFAULT 120, "p_max_attempts" integer DEFAULT 5) RETURNS SETOF "public"."print_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.print_jobs set state = 'failed', error = coalesce(error, 'it was tried ' || attempts || ' times and never finished'),
         finished_at = now(), updated_at = now(), lease_until = null
   where id = p_id and state in ('queued', 'running') and attempts >= p_max_attempts and (lease_until is null or lease_until < now());
  return query
  update public.print_jobs set state = 'running', leased_by = p_worker, lease_until = now() + make_interval(secs => p_seconds),
         attempts = attempts + 1, updated_at = now()
   where id = p_id and state in ('queued', 'running') and (lease_until is null or lease_until < now())
   returning *;
end;
$$;

-- THE SWEEP (pg_cron, every minute, as the owner): a job whose lease lapsed is asked for again, with the service secret
CREATE OR REPLACE FUNCTION "public"."run_print_jobs"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text; j record;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  for j in select id from public.print_jobs
            where state in ('queued', 'running') and (lease_until is null or lease_until < now())
            order by created_at limit 5 loop
    perform net.http_post(
      url := url || '/print-render',
      headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
      body := jsonb_build_object('job', j.id));
  end loop;
end;
$$;

REVOKE ALL ON FUNCTION "public"."print_job_claim"("uuid", "text", integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."print_job_claim"("uuid", "text", integer, integer) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."print_job_claim"("uuid", "text", integer, integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."run_print_jobs"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_print_jobs"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_print_jobs"() TO "service_role";
