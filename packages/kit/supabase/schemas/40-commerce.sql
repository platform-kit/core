-- commerce: purchases, subscriptions, entitlements, Stripe's events and the print orders
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."claim_guest_purchases"("uid" "uuid", "addr" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  n integer := 0;
  verified boolean := false;
begin
  if addr is null or btrim(addr) = '' then return 0; end if;
  if auth.uid() is not null and auth.uid() <> uid then return 0; end if;
  select email_verified_at is not null into verified
    from public.profiles where id = uid and lower(btrim(email)) = lower(btrim(addr));
  if not found then return 0; end if;
  update public.purchases set user_id = uid
    where user_id is null and lower(btrim(email)) = lower(btrim(addr))
      and (kind is distinct from 'session' or verified);
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.entitlements (user_id, kind, key, source, source_id)
    select uid, 'class', 'paid', 'purchase', p.stripe_checkout_session_id
    from public.purchases p where p.user_id = uid and p.status = 'paid'
      and p.kind is distinct from 'session' and p.stripe_checkout_session_id is not null
    on conflict (user_id, kind, key, source_id) do nothing;
    update public.orders o set user_id = uid
      where o.user_id is null and o.checkout_session in (
        select p.stripe_checkout_session_id from public.purchases p where p.user_id = uid
      );
  end if;
  if verified then
    update public.bookings b set user_id = uid
      where b.user_id is null and b.made_by is null and lower(btrim(b.email)) = lower(btrim(addr));
    insert into public.entitlements (user_id, kind, key, source, source_id, active)
    select uid, 'product',
      case when p.sku like 'offering:%' then 'session:' || p.sku else 'session:' || p.key end,
      'purchase', p.stripe_checkout_session_id || ':' || units.i::text,
      not exists (
        select 1 from public.bookings b
        where b.stripe_checkout_session_id = p.stripe_checkout_session_id
          and b.status in ('pending', 'accepted', 'ended')
      )
    from public.purchases p
    cross join lateral generate_series(0, greatest(coalesce(p.quantity, 1), 1) - 1) as units(i)
    where p.user_id = uid and p.kind = 'session' and p.status = 'paid'
      and p.stripe_checkout_session_id is not null and (p.key is not null or p.sku like 'offering:%')
    on conflict (user_id, kind, key, source_id) do nothing;
    update public.bookings b set credit_id = e.id
      from public.purchases p
      join public.entitlements e on e.user_id = uid
        and e.kind = 'product'
        and e.source_id = p.stripe_checkout_session_id || ':0'
      where p.user_id = uid and p.kind = 'session'
        and p.stripe_checkout_session_id = b.stripe_checkout_session_id
        and b.credit_id is null
        and b.status in ('pending', 'accepted', 'ended');
  end if;
  return n;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_my_entitlements"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with live as (
    select * from public.entitlements
    where user_id = auth.uid()
      and active
      and (expires_at is null or expires_at > now())
  ), sub as (
    select sku, key, next_sku, next_key, next_at from public.subscriptions
    where user_id = auth.uid() and status in ('active', 'trialing', 'past_due')
    order by updated_at desc limit 1
  )
  select jsonb_build_object(
    'class', case
      when exists (select 1 from live where kind = 'class' and key = 'subscribed') then 'subscribed'
      when exists (select 1 from live where kind = 'class' and key = 'paid')       then 'paid'
      when auth.uid() is not null                                                   then 'authenticated'
      else 'guest'
    end,
    'products',      coalesce((select jsonb_agg(distinct key)  from live where kind = 'product' and key not like 'session:%'), '[]'::jsonb),
    'credits',       coalesce((select jsonb_object_agg(key, n) from (select key, count(*) as n from live where kind = 'product' and key like 'session:%' group by key) c), '{}'::jsonb),
    'tiers',         coalesce((select jsonb_agg(distinct tier) from live where kind = 'class' and key = 'subscribed' and tier is not null), '[]'::jsonb),
    'plan',          (select sku      from sub),
    'plan_key',      (select key      from sub),
    'plan_next',     (select next_sku from sub),
    'plan_next_key', (select next_key from sub),
    'plan_next_at',  (select next_at  from sub),
    'plan_amount',   (select max(plan_amount) from live where kind = 'class' and key = 'subscribed'),
    'expires_at',    (select max(expires_at)  from live where kind = 'class' and key = 'subscribed')
  );
$$;

CREATE TABLE IF NOT EXISTS "public"."entitlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "key" "text" NOT NULL,
    "source" "text" NOT NULL,
    "source_id" "text" DEFAULT ''::"text" NOT NULL,
    "tier" "text",
    "plan_amount" integer,
    "active" boolean DEFAULT true NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "entitlements_kind_check" CHECK (("kind" = ANY (ARRAY['class'::"text", 'product'::"text"]))),
    CONSTRAINT "entitlements_source_check" CHECK (("source" = ANY (ARRAY['purchase'::"text", 'subscription'::"text", 'grant'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "email" "text",
    "stripe_checkout_session_id" "text",
    "stripe_payment_intent_id" "text",
    "price_id" "text",
    "product_id" "text",
    "amount_total" integer,
    "currency" "text",
    "status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sku" "text",
    "key" "text",
    "kind" "text",
    "variant" "text",
    -- WHAT WAS BOUGHT, AS IT READ AT THE TIME. A sale must still make sense a year later, when
    -- the offer has been renamed, re-priced, had a value reworded or been unpublished. The sku
    -- and the key were already kept for that reason; these finish the job, so a row can be shown
    -- to a buyer or an accountant without asking the catalog anything.
    "title" "text",
    "variant_title" "text",
    "options" "jsonb",
    "unit_price" integer,
    "quantity" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "purchases_status_check" CHECK (("status" = ANY (ARRAY['paid'::"text", 'refunded'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."stripe_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "price_id" "text",
    "plan_amount" integer,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sku" "text",
    "next_sku" "text",
    "next_at" timestamp with time zone,
    "key" "text",
    "next_key" "text",
    -- WHETHER THIS SUBSCRIPTION EVER HAD A TRIAL, so one person cannot have a tier's trial twice by
    -- cancelling and rejoining. Sticky: set the first time Stripe says trialing (or hands back a
    -- trial_end) and never cleared, because the question is "has this person ever trialled this
    -- tier", and a cancelled subscription's row is the only record that it happened. The tier is
    -- not stored beside it: it is the offer's, read from the catalogue through the key column, so
    -- a tier renamed in a file does not strand the fact.
    "trialed" boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_user_id_kind_key_source_id_key" UNIQUE ("user_id", "kind", "key", "source_id");

ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");

-- ONE ROW PER LINE OF A CHECKOUT, and no constraint at all on a purchase that had no checkout.
--
-- A partial index rather than a table constraint, for a reason each half of which was got wrong
-- once on the way here:
--
--   NULLS NOT DISTINCT, because Postgres counts two NULLs as different in a unique index — so a
--   line written with no price_id could be written twice and one payment became two purchases.
--
--   WHERE the session is not null, because with NULLS NOT DISTINCT over both columns every
--   purchase that never came from a Stripe checkout collided with every other one. There are
--   such rows — a hand-written sale, a fixture — and they are not lines of anything.
--
-- So: within one checkout session a line is written once, and a purchase outside a checkout is
-- not a line and is not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS "purchases_session_price_key"
    ON "public"."purchases" USING "btree" ("stripe_checkout_session_id", "price_id")
    NULLS NOT DISTINCT
    WHERE ("stripe_checkout_session_id" IS NOT NULL);

-- WRITING A LINE OF A PAYMENT, in one named place.
--
-- The index above is PARTIAL, and Postgres will not infer a partial index from `ON CONFLICT
-- (columns)` — the predicate has to be given too, and PostgREST has no way to send one. So the
-- upsert cannot be done from a client at all, and pretending otherwise is how it silently
-- became an insert that throws on the webhook retry.
--
-- Both writers run: `confirm-checkout` when the buyer lands, and the webhook when Stripe gets
-- round to it, in either order and sometimes twice. Whichever is second updates.
CREATE OR REPLACE FUNCTION "public"."purchase_write"("p" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $fn$
declare out_id uuid;
begin
  insert into public.purchases (
    user_id, email, stripe_checkout_session_id, stripe_payment_intent_id, price_id, product_id,
    sku, key, kind, variant, title, variant_title, options, unit_price, quantity, amount_total, currency, status
  )
  select (p->>'user_id')::uuid, p->>'email', p->>'stripe_checkout_session_id', p->>'stripe_payment_intent_id',
         p->>'price_id', p->>'product_id', p->>'sku', p->>'key', p->>'kind', p->>'variant', p->>'title', p->>'variant_title',
         p->'options', (p->>'unit_price')::integer, coalesce((p->>'quantity')::integer, 1),
         (p->>'amount_total')::integer, p->>'currency', coalesce(p->>'status', 'paid')
  on conflict ("stripe_checkout_session_id", "price_id") where ("stripe_checkout_session_id" is not null)
  do update set
    user_id = coalesce(excluded.user_id, public.purchases.user_id),
    email = coalesce(excluded.email, public.purchases.email),
    stripe_payment_intent_id = coalesce(excluded.stripe_payment_intent_id, public.purchases.stripe_payment_intent_id),
    product_id = excluded.product_id, sku = excluded.sku, key = excluded.key, kind = excluded.kind, variant = excluded.variant,
    title = excluded.title, variant_title = excluded.variant_title, options = excluded.options,
    unit_price = excluded.unit_price, quantity = excluded.quantity,
    amount_total = excluded.amount_total, currency = excluded.currency, status = excluded.status
  returning id into out_id;
  return out_id;
end;
$fn$;

REVOKE ALL ON FUNCTION "public"."purchase_write"("jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."purchase_write"("jsonb") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."purchase_write"("jsonb") TO "service_role";
-- ONE ROW PER LINE, NOT PER SESSION. The constraint was on the session alone while the ledger
-- upserted onto it inside a loop over the session lines, so a basket holding two things wrote
-- ONE row: the last line sku, with the whole session total beside it. Every aggregate that sums
-- a purchase read that total once for an order of any size, and printOrdered asked for the
-- session's purchase with maybeSingle. A line's identity is its price — Stripe merges a repeated
-- price into one line with a quantity, so (session, price) is both unique and total — and
-- amount_total on a row is now THAT LINE total, which leaves a single-line order reading exactly
-- as it always did and makes a multi-line one correct for the first time.

ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");

CREATE INDEX "entitlements_user_active_idx" ON "public"."entitlements" USING "btree" ("user_id", "active");

CREATE INDEX "purchases_key_idx" ON "public"."purchases" USING "btree" ("key");

CREATE INDEX "purchases_user_idx" ON "public"."purchases" USING "btree" ("user_id", "created_at" DESC);

CREATE INDEX "subscriptions_user_idx" ON "public"."subscriptions" USING "btree" ("user_id");

ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."entitlements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entitlements_select_own" ON "public"."entitlements" FOR SELECT USING (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;

-- a buyer reads their own; an administrator every row (the desk's Orders page)
CREATE POLICY "purchases_select_own" ON "public"."purchases" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));

ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));

REVOKE ALL ON FUNCTION "public"."claim_guest_purchases"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."claim_guest_purchases"("uuid", "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."claim_guest_purchases"("uid" "uuid", "addr" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."get_my_entitlements"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_entitlements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_entitlements"() TO "service_role";

GRANT ALL ON TABLE "public"."entitlements" TO "anon";
GRANT ALL ON TABLE "public"."entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."entitlements" TO "service_role";

GRANT ALL ON TABLE "public"."purchases" TO "anon";
GRANT ALL ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";

GRANT ALL ON TABLE "public"."stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_events" TO "service_role";

GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";

-- the desk's Orders page follows purchases as they land
ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."purchases";
