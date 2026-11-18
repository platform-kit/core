-- REPRICINGS: an existing subscriber moved to an offer's new price (openspec: payment-plans).
--
-- A price change leaves whoever already pays an offer on the price they signed up at, as every payment
-- provider does by itself. An offer whose file says `existing: move` moves them instead: each is told
-- `notice_days` ahead, and moved at the first renewal after that, through the ordinary subscription change.
-- This is the record of one such move: the notice sent, the date given, and whether it was made. It has a
-- life of its own (told, then moved, or left when the subscription ended first), so it is a row of its own
-- rather than columns on the subscription it concerns.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."repricings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscription_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- the offer whose price changed, and the change: what they pay now, what they will
    "offer_key" "text" NOT NULL,
    "from_amount" integer NOT NULL,
    "to_amount" integer NOT NULL,
    "currency" "text" NOT NULL,
    "notified_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- the renewal the new price starts at, as the notice said
    "effective_at" timestamp with time zone NOT NULL,
    "applied_at" timestamp with time zone,
    "status" "text" DEFAULT 'notified'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "repricings_pkey" PRIMARY KEY ("id"),
    -- one move per subscription to a given price, however often the job runs
    CONSTRAINT "repricings_once_key" UNIQUE ("subscription_id", "offer_key", "to_amount"),
    CONSTRAINT "repricings_status_check" CHECK (("status" = ANY (ARRAY['notified'::"text", 'applied'::"text", 'dropped'::"text"])))
);

CREATE INDEX IF NOT EXISTS "repricings_user_idx" ON "public"."repricings" USING "btree" ("user_id", "created_at" DESC);

ALTER TABLE ONLY "public"."repricings"
    ADD CONSTRAINT "repricings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."repricings"
    ADD CONSTRAINT "repricings_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE CASCADE;

-- a subscriber reads their own (the billing page says what is coming); only the server writes
ALTER TABLE "public"."repricings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "repricings_select_own" ON "public"."repricings" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));
REVOKE ALL ON TABLE "public"."repricings" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."repricings" FROM "anon", "authenticated";
GRANT SELECT ON TABLE "public"."repricings" TO "authenticated";
GRANT ALL ON TABLE "public"."repricings" TO "service_role";

-- THE DAILY RUN: the memberships module's repricings function decides who is due (the prices are the catalogue's,
-- which the database does not hold), so this only calls it, where there is a subscription to look at
CREATE OR REPLACE FUNCTION "public"."run_repricings"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text;
begin
  if not exists (select 1 from public.subscriptions s where s.status in ('active', 'trialing', 'past_due')) then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := rtrim(url, '/') || '/repricings',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

REVOKE ALL ON FUNCTION "public"."run_repricings"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_repricings"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_repricings"() TO "service_role";
