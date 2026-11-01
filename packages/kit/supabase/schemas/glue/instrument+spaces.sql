-- GLUE: what joins the instrument module and the spaces module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."member_working"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.may_see_member(p_user) then null else (
    select jsonb_build_object('working', s.working, 'secured', s.secured, 'areas', to_jsonb(s.areas), 'at', s.updated_at)
      from public.signals s where s.user_id = p_user
  ) end
$$;
