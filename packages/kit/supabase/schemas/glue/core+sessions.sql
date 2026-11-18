-- GLUE: what joins every site and the sessions module — declared only while the module is on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- a guest's bookings and the session credits their purchases bought, claimed with the account that proved the address
-- (claim_guest_purchases, 40-commerce.sql)
CREATE OR REPLACE FUNCTION "public"."claim_guest_bookings"("p_user" "uuid", "p_addr" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_variable
declare uid uuid := p_user; addr text := p_addr;
begin
    update public.bookings b set user_id = uid
      where b.user_id is null and b.made_by is null and lower(btrim(b.email)) = lower(btrim(addr));
    insert into public.entitlements (user_id, kind, key, source, source_id, active)
    select uid, 'product',
      case when p.sku like 'offering:%' then 'session:' || p.sku else 'session:' || p.key end,
      'purchase', coalesce(p.checkout_identity, p.stripe_checkout_session_id) || ':' || units.i::text,
      not exists (
        select 1 from public.bookings b
        where coalesce(b.checkout_identity, b.stripe_checkout_session_id) = coalesce(p.checkout_identity, p.stripe_checkout_session_id)
          and b.status in ('pending', 'accepted', 'ended')
      )
    from public.purchases p
    cross join lateral generate_series(0, greatest(coalesce(p.quantity, 1), 1) - 1) as units(i)
    where p.user_id = uid and p.kind = 'session' and p.status = 'paid'
      and coalesce(p.checkout_identity, p.stripe_checkout_session_id) is not null and (p.key is not null or p.sku like 'offering:%')
    on conflict (user_id, kind, key, source_id) do nothing;
    update public.bookings b set credit_id = e.id
      from public.purchases p
      join public.entitlements e on e.user_id = uid
        and e.kind = 'product'
        and e.source_id = coalesce(p.checkout_identity, p.stripe_checkout_session_id) || ':0'
      where p.user_id = uid and p.kind = 'session'
        and coalesce(p.checkout_identity, p.stripe_checkout_session_id) = coalesce(b.checkout_identity, b.stripe_checkout_session_id)
        and b.credit_id is null
        and b.status in ('pending', 'accepted', 'ended');
end;
$$;

-- a person's bookings on their page in the admin (admin_person, 10-foundation.sql)
CREATE OR REPLACE FUNCTION "public"."person_bookings"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('uid', b.uid, 'title', b.title,
             'type', coalesce(b.type, b.event), 'start_at', b.start_at, 'status', b.status)
             order by b.start_at desc nulls last)
      from public.bookings b where b.user_id = p_user), '[]'::jsonb);
$$;

-- A MISSED PAYMENT ON A PLAN OR A TERM, AS IT TOUCHES BOOKINGS (openspec: payment-plans). The rule is the sessions
-- module's, so a site without it has none: the hosts of the buyer's upcoming bookings are told once, and where the
-- offer named a grace period, the bookings are cancelled when it has passed with the payment still outstanding.
-- Run every five minutes; it calls the function only when there is something to do.
CREATE OR REPLACE FUNCTION "public"."run_commitment_bookings"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text;
begin
  if not exists (
    select 1 from public.commitments c
     where c.missed_at is not null and c.status in ('active', 'restricted', 'defaulted')
       and (c.hosts_told_at is null
            or (c.cancel_bookings_after_minutes is not null and c.bookings_cancelled_at is null
                and c.missed_at + make_interval(mins => c.cancel_bookings_after_minutes) <= now()))
       and exists (select 1 from public.bookings b where b.user_id = c.user_id and b.status in ('accepted', 'pending') and b.start_at > now())
  ) then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := rtrim(url, '/') || '/commitment-bookings',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

REVOKE ALL ON FUNCTION "public"."run_commitment_bookings"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_commitment_bookings"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_commitment_bookings"() TO "service_role";
