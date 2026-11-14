-- api: the keys that open the content API's doors (content-api) — a delivery key reads published content, a preview key
-- drafts and unpublished entries too, a management key writes (the management change); `gated` lets a key read a gated
-- entry's body. A key is made in the admin (Settings → API): the browser makes the random key and keeps only its sha256
-- here with the first characters to show, so the key itself is seen once and never stored; the functions find it by the
-- hash with the service role and stamp its last use. Administrators read and write their rows under RLS; nothing else.
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "gated" boolean DEFAULT false NOT NULL,
    "prefix" "text" NOT NULL,
    "hash" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "api_keys_kind_check" CHECK (("kind" = ANY (ARRAY['delivery'::"text", 'preview'::"text", 'management'::"text", 'forms'::"text", 'scheduling'::"text", 'storefront'::"text", 'support'::"text", 'matrix'::"text"]))),
    CONSTRAINT "api_keys_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 80)))
);

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_hash_key" UNIQUE ("hash");

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_keys_admin_select" ON "public"."api_keys" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

CREATE POLICY "api_keys_admin_insert" ON "public"."api_keys" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"() AND ("created_by" = "auth"."uid"()));

CREATE POLICY "api_keys_admin_update" ON "public"."api_keys" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";

-- the content webhooks (content-management-api): Contentful's webhook definitions as rows — a name, a url, the topics
-- (Entry.publish, Asset.*, *.*…), the headers sent with every delivery (a secret among them; never answered back whole),
-- whether it is active, the last delivery and the last error. Made through the Management API under a management key;
-- administrators read them under RLS (Settings → API lists them); the functions deliver with the service role.
CREATE TABLE IF NOT EXISTS "public"."content_webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "url" "text" NOT NULL,
    "topics" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "headers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_at" timestamp with time zone,
    "last_error" "text",
    -- A subscription a deployment SHIPS is declared (platformkit.config.js `webhooks`) and is the
    -- projection's to replace; one somebody made through the API is theirs and is never touched.
    "source" "text" DEFAULT 'hand'::"text" NOT NULL,
    CONSTRAINT "content_webhooks_source_check" CHECK (("source" = ANY (ARRAY['file'::"text", 'hand'::"text"])))
);
ALTER TABLE ONLY "public"."content_webhooks" ADD CONSTRAINT "content_webhooks_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."content_webhooks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_webhooks_admin_select" ON "public"."content_webhooks" FOR SELECT TO "authenticated" USING ("public"."is_admin"());
GRANT SELECT ON TABLE "public"."content_webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."content_webhooks" TO "service_role";

-- the uploads' sweep (content-management-api): an Upload made through the Management API lasts a day, and an asset made
-- from one but never processed goes with it — pg_cron asks the content function once a day (sweep-uploads, in data.sql),
-- with the same url and key the other runners read; the library itself is never swept.
CREATE OR REPLACE FUNCTION "public"."sweep_uploads"() RETURNS "void"
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
    url := url || '/content/sweep-uploads',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
end;
$$;

REVOKE ALL ON FUNCTION "public"."sweep_uploads"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."sweep_uploads"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."sweep_uploads"() TO "service_role";

-- the Store API's carts (store-api-shopify): a cart a headless storefront made through Shopify's Storefront API — its
-- lines as the bag keeps them (a sku, a variant, a quantity, attributes), the buyer's identity (email, country, phone),
-- attributes and a note — under a random token that is its checkout url's secret; the service role alone; thirty days,
-- then the nightly sweep clears it (sweep_uploads asks the content function, which sweeps these too).
CREATE TABLE IF NOT EXISTS "public"."storefront_carts" (
    "id" "text" NOT NULL,
    "lines" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "buyer" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "attributes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "note" "text",
    "key_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."storefront_carts" ADD CONSTRAINT "storefront_carts_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."storefront_carts" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."storefront_carts" TO "service_role";
