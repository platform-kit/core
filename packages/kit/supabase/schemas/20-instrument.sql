-- instrument: the readings — every answer, result and signal a reader's account holds
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."touch_answers"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

CREATE TABLE IF NOT EXISTS "public"."answers" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "test" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "latency_ms" integer,
    "answered_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "answers_test_check" CHECK (("test" = ANY (ARRAY['personality'::"text", 'diagnostics'::"text", 'blockages'::"text", 'books'::"text"])))
);

ALTER TABLE "public"."answers" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."answers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."results" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "test" "text" NOT NULL,
    "engine_version" "text" NOT NULL,
    "answered" integer DEFAULT 0 NOT NULL,
    "payload" "jsonb" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "results_test_check" CHECK (("test" = ANY (ARRAY['personality'::"text", 'diagnostics'::"text", 'blockages'::"text", 'books'::"text"])))
);

ALTER TABLE "public"."results" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."results_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."signals" (
    "user_id" "uuid" NOT NULL,
    "working" "text",
    "secured" "text",
    "areas" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "types" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_user_id_test_item_id_answered_at_key" UNIQUE ("user_id", "test", "item_id", "answered_at");

ALTER TABLE ONLY "public"."results"
    ADD CONSTRAINT "results_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."signals"
    ADD CONSTRAINT "signals_pkey" PRIMARY KEY ("user_id");

CREATE INDEX "answers_user_test_at" ON "public"."answers" USING "btree" ("user_id", "test", "answered_at");

CREATE INDEX "results_user_test_at" ON "public"."results" USING "btree" ("user_id", "test", "computed_at" DESC);

CREATE OR REPLACE TRIGGER "trg_answers_touch" BEFORE UPDATE ON "public"."answers" FOR EACH ROW EXECUTE FUNCTION "public"."touch_answers"();

ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."results"
    ADD CONSTRAINT "results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."signals"
    ADD CONSTRAINT "signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."answers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "answers_delete_own" ON "public"."answers" FOR DELETE USING (("auth"."uid"() = "user_id"));

CREATE POLICY "answers_insert_own" ON "public"."answers" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "answers_select_own" ON "public"."answers" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));

CREATE POLICY "answers_update_own" ON "public"."answers" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."results" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "results_delete_own" ON "public"."results" FOR DELETE USING (("auth"."uid"() = "user_id"));

CREATE POLICY "results_insert_own" ON "public"."results" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "results_select_own" ON "public"."results" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));

ALTER TABLE "public"."signals" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signals_own_insert" ON "public"."signals" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));

CREATE POLICY "signals_own_select" ON "public"."signals" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));

CREATE POLICY "signals_own_update" ON "public"."signals" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));

GRANT ALL ON FUNCTION "public"."touch_answers"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_answers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_answers"() TO "service_role";

GRANT ALL ON TABLE "public"."answers" TO "anon";
GRANT ALL ON TABLE "public"."answers" TO "authenticated";
GRANT ALL ON TABLE "public"."answers" TO "service_role";

GRANT ALL ON SEQUENCE "public"."answers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."answers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."answers_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."results" TO "anon";
GRANT ALL ON TABLE "public"."results" TO "authenticated";
GRANT ALL ON TABLE "public"."results" TO "service_role";

GRANT ALL ON SEQUENCE "public"."results_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."results_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."results_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."signals" TO "anon";
GRANT ALL ON TABLE "public"."signals" TO "authenticated";
GRANT ALL ON TABLE "public"."signals" TO "service_role";
