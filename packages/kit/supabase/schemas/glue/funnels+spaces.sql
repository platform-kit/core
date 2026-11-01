-- GLUE: what joins the funnels module and the spaces module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- an audience granted a capability: by the site, to them, to a role, space or channel they hold, a tier or a product
CREATE OR REPLACE FUNCTION "public"."email_granted"("p_user" "uuid", "p_caps" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.space_grants g
     where g.capability = any(array(select jsonb_array_elements_text(p_caps)))
       and (g.scope = 'site'
         or (g.scope = 'user' and g.user_id = p_user)
         or (g.scope = 'role' and exists (select 1 from public.space_member_roles mr where mr.user_id = p_user and mr.role_id = g.role_id))
         or (g.scope = 'space' and exists (select 1 from public.space_members m where m.user_id = p_user and m.space_id = g.space_id))
         or (g.scope = 'channel' and exists (select 1 from public.channel_members cm where cm.user_id = p_user and cm.channel_id = g.channel_id))
         or (g.scope = 'tier' and exists (select 1 from public.entitlements e where e.user_id = p_user and e.active and e.tier = g.tier))
         or (g.scope = 'product' and exists (select 1 from public.purchases pu where pu.user_id = p_user and pu.status = 'paid' and pu.key = g.product_key))));
$$;
