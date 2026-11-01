-- GLUE: what joins every site and the store module — declared only while the module is on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- a guest's orders, claimed with the purchases they were paid by (claim_guest_purchases, 40-commerce.sql)
CREATE OR REPLACE FUNCTION "public"."claim_guest_orders"("p_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_variable
declare uid uuid := p_user;
begin
    update public.orders o set user_id = uid
      where o.user_id is null and o.checkout_session in (
        select coalesce(p.checkout_identity, p.stripe_checkout_session_id) from public.purchases p where p.user_id = uid
      );
end;
$$;
