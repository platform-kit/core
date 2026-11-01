-- GLUE: what joins the courses module and the sessions module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- a session lesson finished: a session of its type booked, and accepted or ended
CREATE OR REPLACE FUNCTION "public"."course_session_booked"("p_user" "uuid", "p_type" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.bookings b where b.user_id = p_user and b.type = p_type and b.status in ('accepted', 'ended'));
$$;
