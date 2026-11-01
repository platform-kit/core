-- GLUE: what joins the funnels module and the instrument module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- an audience's readings: when they last answered, where they are working, what they read about, what they answered
CREATE OR REPLACE FUNCTION "public"."email_last_answer"("p_user" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select max(a.answered_at) from public.answers a where a.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION "public"."email_working"("p_user" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select s.working from public.signals s where s.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION "public"."email_interest_read"("p_user" "uuid", "p_topic" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.answers a where a.user_id = p_user and a.test = 'diagnostics' and a.value->>'d' = p_topic)
      or exists (select 1 from public.signals s where s.user_id = p_user and p_topic = any(s.areas));
$$;

CREATE OR REPLACE FUNCTION "public"."email_answered"("p_user" "uuid", "p_rule" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.answers a where a.user_id = p_user and a.item_id = p_rule->>'item'
      and (p_rule->>'truth' is null or a.value->>'truth' = p_rule->>'truth')
      and (p_rule->>'charge' is null or coalesce(a.value->>'charge', 'clear') = p_rule->>'charge'));
$$;
