-- GLUE: what joins every site and the instrument module — declared only while the module is on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- the instrument's readings in the figures: a window's rounds, answers and readers (under the dashboards' audience
-- filter where one is given), each test's, the personality types, and a series a day
CREATE OR REPLACE FUNCTION "public"."admin_readings"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_aud" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'rounds',  (select count(*) from public.results where computed_at >= p_from and computed_at < p_to and (p_aud is null or public.audience_ok(user_id, p_aud))),
    'answers', (select count(*) from public.answers where answered_at >= p_from and answered_at < p_to and (p_aud is null or public.audience_ok(user_id, p_aud))),
    'readers', (select count(distinct user_id) from public.answers where answered_at >= p_from and answered_at < p_to and (p_aud is null or public.audience_ok(user_id, p_aud))));
$$;

CREATE OR REPLACE FUNCTION "public"."admin_reading_tests"("p_since" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object('test', k.t, 'answers', k.a, 'rounds', k.r, 'readers', k.u) order by k.o), '[]'::jsonb)
  from (select u.t, u.o,
               (select count(*) from public.answers a where a.test = u.t and a.answered_at >= p_since) as a,
               (select count(*) from public.results r where r.test = u.t and r.computed_at >= p_since) as r,
               (select count(distinct a.user_id) from public.answers a where a.test = u.t and a.answered_at >= p_since) as u
        from unnest(array['personality', 'diagnostics', 'blockages']) with ordinality as u(t, o)) k;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_reading_types"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object('type', ty, 'readers', n) order by n desc, ty), '[]'::jsonb)
  from (select (latest.payload ->> 'type')::int as ty, count(*) as n
        from (select distinct on (user_id) user_id, payload from public.results where test = 'personality' and payload ? 'type' order by user_id, computed_at desc) latest
        group by 1) x;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_readings_daily"("p_since" "date") RETURNS TABLE("dd" "date", "rounds" bigint, "answers" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select d.dd, coalesce(r.n, 0), coalesce(a.n, 0)
  from (select computed_at::date as dd from public.results where computed_at >= p_since
        union select answered_at::date from public.answers where answered_at >= p_since) d
  left join (select computed_at::date as dd, count(*) as n from public.results where computed_at >= p_since group by 1) r on r.dd = d.dd
  left join (select answered_at::date as dd, count(*) as n from public.answers where answered_at >= p_since group by 1) a on a.dd = d.dd;
$$;
