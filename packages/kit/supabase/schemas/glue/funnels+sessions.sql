-- GLUE: what joins the funnels module and the sessions module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- an audience's last session: the latest accepted booking that has started and was not missed
CREATE OR REPLACE FUNCTION "public"."email_last_session"("p_user" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select max(bk.start_at) from public.bookings bk
   where bk.user_id = p_user and bk.status = 'accepted' and coalesce(bk.no_show, false) = false and bk.start_at < now();
$$;
