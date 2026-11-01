-- GLUE: what joins the sessions module and the spaces module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- an offering released or taken back, in the moderation record (provider_release, 57-providers.sql)
CREATE OR REPLACE FUNCTION "public"."provider_release_recorded"("p_offering" "uuid", "p_kind" "text", "p_provider" "uuid", "p_note" "text") RETURNS "void"
    LANGUAGE "sql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into public.space_moderation (offering_id, kind, actor_id, subject_id, note)
       values (p_offering, p_kind, auth.uid(), p_provider, p_note);
$$;
