-- forms: a form's responses — a row per person per form, an answer per field as it is given, the files in a bucket
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

-- every slide a form posts lands here through the `form` function (the service role): a response per
-- person — a reader by user_id, a guest by the browser's anonymous id — per form; started when the first
-- slide lands, completed when the last does (`_end`), with a quiz's score beside it; the webhook's
-- delivery, when the form names one, recorded on the row
CREATE TABLE IF NOT EXISTS "public"."form_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "form" "text" NOT NULL,
    "user_id" "uuid",
    "anon_id" "text",
    "origin" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "score" integer,
    "total" integer,
    "passed" boolean,
    "webhook_at" timestamp with time zone,
    "webhook_error" "text",
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "form_responses_who_check" CHECK ((("user_id" IS NOT NULL) OR ("anon_id" IS NOT NULL)))
);

-- an answer per field of a response; given again, it replaces the earlier one (the unique index), its time kept
CREATE TABLE IF NOT EXISTS "public"."form_answers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "response_id" "uuid" NOT NULL,
    "field" "text" NOT NULL,
    "value" "jsonb",
    "file_path" "text",
    "file_name" "text",
    "file_type" "text",
    "file_size" integer,
    "slide" integer,
    "latency_ms" integer,
    "answered_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."form_answers"
    ADD CONSTRAINT "form_answers_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."form_answers"
    ADD CONSTRAINT "form_answers_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "form_answers_field_idx" ON "public"."form_answers" USING "btree" ("response_id", "field");

CREATE INDEX "form_responses_form_idx" ON "public"."form_responses" USING "btree" ("form", "started_at" DESC);

-- one open response per person per form: a return finds it; a form that allows one response keeps the completed one too
CREATE UNIQUE INDEX "form_responses_user_open_idx" ON "public"."form_responses" USING "btree" ("form", "user_id") WHERE (("user_id" IS NOT NULL) AND ("completed_at" IS NULL));

CREATE UNIQUE INDEX "form_responses_anon_open_idx" ON "public"."form_responses" USING "btree" ("form", "anon_id") WHERE (("anon_id" IS NOT NULL) AND ("user_id" IS NULL) AND ("completed_at" IS NULL));

CREATE OR REPLACE FUNCTION "public"."touch_form_response"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

CREATE OR REPLACE TRIGGER "trg_form_responses_touch" BEFORE UPDATE ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "public"."touch_form_response"();

-- the admin's numbers per form over the last `days`: started, finished, completion, the drop-off per slide
-- (how many responses got as far as each slide), and each field's answers counted by value (a choice's
-- distribution; free text is counted, never listed here — the responses page has the rows)
CREATE OR REPLACE FUNCTION "public"."admin_forms"("days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  since timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'form', f.form,
    'started', f.started,
    'finished', f.finished,
    'completion', case when f.started > 0 then round(100.0 * f.finished / f.started) else 0 end,
    'passed', f.passed,
    'avg_seconds', f.avg_seconds,
    'last_at', f.last_at,
    -- started and finished a day, for the form's own line
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'started', d.started, 'finished', d.finished) order by d.day), '[]'::jsonb)
      from (select date_trunc('day', started_at)::date as day, count(*) as started, count(*) filter (where completed_at is not null) as finished
            from public.form_responses where form = f.form and started_at >= since group by 1) d),
    'slides', (
      select coalesce(jsonb_agg(jsonb_build_object('slide', s.slide, 'reached', s.n) order by s.slide), '[]'::jsonb)
      from (select a.slide, count(distinct a.response_id) as n
            from public.form_answers a join public.form_responses r on r.id = a.response_id
            where r.form = f.form and r.started_at >= since and a.slide is not null group by a.slide) s),
    'fields', (
      select coalesce(jsonb_agg(jsonb_build_object('field', x.field, 'answered', x.answered, 'values', x.values) order by x.field), '[]'::jsonb)
      from (select a.field, count(*) as answered,
                   (select coalesce(jsonb_agg(jsonb_build_object('value', v.value, 'n', v.n) order by v.n desc), '[]'::jsonb)
                    from (select v1.value, count(*) as n
                          from public.form_answers b join public.form_responses r2 on r2.id = b.response_id,
                               lateral (select case when jsonb_typeof(b.value) = 'array' then e.value else b.value #>> '{}' end as value
                                        from jsonb_array_elements_text(case when jsonb_typeof(b.value) = 'array' then b.value else '[null]'::jsonb end) e) v1
                          where r2.form = f.form and r2.started_at >= since and b.field = a.field and b.value is not null
                            and (jsonb_typeof(b.value) <> 'string' or length(b.value #>> '{}') <= 60)
                          group by 1 order by 2 desc limit 12) v) as values
            from public.form_answers a join public.form_responses r on r.id = a.response_id
            where r.form = f.form and r.started_at >= since group by a.field) x)
  ) order by f.started desc), '[]'::jsonb)
  into result
  from (select form, count(*) as started, count(*) filter (where completed_at is not null) as finished, count(*) filter (where passed) as passed,
               round(avg(extract(epoch from completed_at - started_at)) filter (where completed_at is not null)) as avg_seconds,
               max(started_at) as last_at
        from public.form_responses where started_at >= since group by form) f;
  return result;
end;
$$;

ALTER TABLE "public"."form_answers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."form_responses" ENABLE ROW LEVEL SECURITY;

-- a reader reads their own responses; an administrator reads every one (the Forms section is theirs; the
-- desk reads a ticket's through ticket_answers); nothing is written from a client (the function writes).
-- Not is_staff(): that is any role, and a provider or an analyst is not who a customer answered.
CREATE POLICY "form_responses_own_select" ON "public"."form_responses" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));

CREATE POLICY "form_answers_own_select" ON "public"."form_answers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."form_responses" "r"
  WHERE (("r"."id" = "form_answers"."response_id") AND (("r"."user_id" = "auth"."uid"()) OR "public"."is_admin"())))));

CREATE POLICY "form_responses_staff_delete" ON "public"."form_responses" FOR DELETE TO "authenticated" USING ("public"."is_admin"());

GRANT ALL ON FUNCTION "public"."admin_forms"("days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_forms"("days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_forms"("days" integer) TO "service_role";

GRANT ALL ON FUNCTION "public"."touch_form_response"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_form_response"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_form_response"() TO "service_role";

GRANT ALL ON TABLE "public"."form_answers" TO "anon";
GRANT ALL ON TABLE "public"."form_answers" TO "authenticated";
GRANT ALL ON TABLE "public"."form_answers" TO "service_role";

GRANT ALL ON TABLE "public"."form_responses" TO "anon";
GRANT ALL ON TABLE "public"."form_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."form_responses" TO "service_role";

-- the files a form's answers carry, read by the staff alone (a reader's are handed back through the function, signed)
CREATE POLICY "forms staff read files" ON "storage"."objects" FOR SELECT TO "authenticated" USING (bucket_id = 'forms' and public.is_admin());

-- webhook subscriptions on a form, as the Forms API (Typeform's Webhooks API) keeps them: any number per form, each
-- a tag and a url with the secret that signs its deliveries (kept whole, since it is what signs; the service role's
-- alone — the API writes and never answers it back). Administrators read them under RLS; the `form` function
-- delivers every completed response to each enabled one (forms-api).
CREATE TABLE IF NOT EXISTS "public"."form_webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "form" "text" NOT NULL,
    "tag" "text" NOT NULL,
    "url" "text" NOT NULL,
    "secret" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "verify_ssl" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_at" timestamp with time zone,
    "last_error" "text",
    CONSTRAINT "form_webhooks_tag_check" CHECK (("tag" ~ '^[a-zA-Z0-9_.-]{1,64}$')),
    -- A subscription a deployment SHIPS is declared (platformkit.config.js `webhooks`) and is the
    -- projection's to replace; one somebody made through the API is theirs and is never touched.
    "source" "text" DEFAULT 'hand'::"text" NOT NULL,
    CONSTRAINT "form_webhooks_source_check" CHECK (("source" = ANY (ARRAY['file'::"text", 'hand'::"text"])))
);
ALTER TABLE ONLY "public"."form_webhooks" ADD CONSTRAINT "form_webhooks_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "form_webhooks_form_tag_idx" ON "public"."form_webhooks" USING "btree" ("form", "tag");
ALTER TABLE "public"."form_webhooks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "form_webhooks_staff_select" ON "public"."form_webhooks" FOR SELECT TO "authenticated" USING ("public"."is_staff"());
GRANT SELECT ON TABLE "public"."form_webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."form_webhooks" TO "service_role";
