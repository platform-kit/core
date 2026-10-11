-- push: the staff's browsers and the triggers that ask the push function
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."push_notify"("topic" "text", "data" "jsonb") RETURNS "void"
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
    url := url || '/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := jsonb_build_object('action', 'notify', 'topic', topic, 'data', data),
    timeout_milliseconds := 30000);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."push_on_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status <> 'accepted' or (tg_op = 'UPDATE' and old.status = 'accepted') then return null; end if;
  perform public.push_notify('bookings', jsonb_build_object('title', new.title, 'name', new.name, 'email', new.email, 'start_at', new.start_at));
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."push_on_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.push_notify('users', jsonb_build_object('email', new.email, 'name', coalesce(nullif(new.display_name, ''), split_part(coalesce(new.email, ''), '@', 1))));
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."push_on_purchase"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status <> 'paid' then return null; end if;
  perform public.push_notify('purchases', jsonb_build_object('sku', new.sku, 'amount', new.amount_total, 'currency', new.currency, 'email', new.email));
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."push_on_subscription"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  addr text;
begin
  select email into addr from public.profiles where id = new.user_id;
  perform public.push_notify('subscriptions', jsonb_build_object('sku', new.sku, 'amount', new.plan_amount, 'email', addr));
  return null;
end;
$$;

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

CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "topics" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "ua" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_sent_at" timestamp with time zone,
    "failures" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");

CREATE INDEX "push_subscriptions_topics_idx" ON "public"."push_subscriptions" USING "gin" ("topics");

CREATE INDEX "push_subscriptions_user_idx" ON "public"."push_subscriptions" USING "btree" ("user_id");

CREATE OR REPLACE TRIGGER "trg_push_booking" AFTER INSERT OR UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."push_on_booking"();

CREATE OR REPLACE TRIGGER "trg_push_profile" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."push_on_profile"();

CREATE OR REPLACE TRIGGER "trg_push_purchase" AFTER INSERT ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."push_on_purchase"();

CREATE OR REPLACE TRIGGER "trg_push_subscription" AFTER INSERT ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."push_on_subscription"();

CREATE OR REPLACE TRIGGER "trg_push_support_message" AFTER INSERT ON "public"."support_messages" FOR EACH ROW EXECUTE FUNCTION "public"."push_on_support_message"();

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subscriptions_own_delete" ON "public"."push_subscriptions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));

CREATE POLICY "push_subscriptions_own_insert" ON "public"."push_subscriptions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_staff"()));

CREATE POLICY "push_subscriptions_own_select" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));

CREATE POLICY "push_subscriptions_own_update" ON "public"."push_subscriptions" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_staff"()));

GRANT ALL ON FUNCTION "public"."push_notify"("topic" "text", "data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."push_notify"("topic" "text", "data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."push_notify"("topic" "text", "data" "jsonb") TO "service_role";

GRANT ALL ON FUNCTION "public"."push_on_booking"() TO "anon";
GRANT ALL ON FUNCTION "public"."push_on_booking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."push_on_booking"() TO "service_role";

GRANT ALL ON FUNCTION "public"."push_on_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."push_on_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."push_on_profile"() TO "service_role";

GRANT ALL ON FUNCTION "public"."push_on_purchase"() TO "anon";
GRANT ALL ON FUNCTION "public"."push_on_purchase"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."push_on_purchase"() TO "service_role";

GRANT ALL ON FUNCTION "public"."push_on_subscription"() TO "anon";
GRANT ALL ON FUNCTION "public"."push_on_subscription"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."push_on_subscription"() TO "service_role";

GRANT ALL ON FUNCTION "public"."push_on_support_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."push_on_support_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."push_on_support_message"() TO "service_role";

GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";
