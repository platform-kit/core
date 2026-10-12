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
    "current_period_start" timestamp with time zone,
    "usage_price_id" "text",
    "usage_meter" "text",
    "usage_unit" "text",
    "usage_rate_micros" bigint,
    "usage_included_micros" bigint DEFAULT 0 NOT NULL,
    "usage_overage_price_micros" bigint,
    "usage_speech_cost_per_second_micros" bigint DEFAULT 0 NOT NULL,
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

CREATE TABLE IF NOT EXISTS "public"."usage_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_ref" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "bot_id" "text",
    "offer_key" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "cost_micros" bigint DEFAULT 0 NOT NULL,
    "seconds_micros" bigint DEFAULT 0 NOT NULL,
    "units_micros" bigint DEFAULT 0 NOT NULL,
    "included_micros" bigint DEFAULT 0 NOT NULL,
    "metered_micros" bigint DEFAULT 0 NOT NULL,
    "period_start" timestamp with time zone,
    "usage_unit" text,
    "rate_micros" bigint,
    "speech_cost_per_second_micros" bigint,
    "meter" text,
    "overage_price_micros" bigint,
    "operation_id" text,
    "sponsor" text,
    "customer_cost_micros" bigint,
    "markup_micros" bigint,
    "retail_value_micros" bigint,
    "retail_currency" text,
    "measurement_status" text,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "usage_events_kind_check" CHECK (("kind" = ANY (ARRAY['model'::"text", 'stt'::"text", 'tts'::"text"]))),
    CONSTRAINT "usage_events_amounts_check" CHECK (("cost_micros" >= 0 AND "seconds_micros" >= 0 AND "units_micros" >= 0 AND "included_micros" >= 0 AND "metered_micros" >= 0)),
    CONSTRAINT "usage_events_units_check" CHECK (("units_micros" = "included_micros" + "metered_micros")),
    CONSTRAINT "usage_events_inference_amounts_check" CHECK (
      ("customer_cost_micros" IS NULL OR "customer_cost_micros" >= 0)
      AND ("markup_micros" IS NULL OR "markup_micros" > 0)
      AND ("retail_value_micros" IS NULL OR "retail_value_micros" >= 0)
      AND ("sponsor" IS NULL OR "sponsor" = ANY (ARRAY['site'::"text", 'reader'::"text"]))
      AND ("measurement_status" IS NULL OR "measurement_status" = ANY (ARRAY['measured'::"text", 'estimated'::"text"]))
    )
);

CREATE TABLE IF NOT EXISTS "public"."usage_inference_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invocation_ref" "text" NOT NULL,
    "attempt_no" integer NOT NULL,
    "user_id" "uuid",
    "operation_id" "text" NOT NULL,
    "bot_id" "text",
    "offer_key" "text",
    "sponsor" "text" NOT NULL,
    "provider_id" "text" NOT NULL,
    "model" "text" NOT NULL,
    "protocol" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "measurement_status" "text" NOT NULL,
    "usage_dimensions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "provider_cost_micros" bigint DEFAULT 0 NOT NULL,
    "markup_micros" bigint,
    "customer_cost_micros" bigint DEFAULT 0 NOT NULL,
    "customer_units_micros" bigint DEFAULT 0 NOT NULL,
    "retail_value_micros" bigint,
    "retail_currency" text,
    "http_status" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "usage_inference_attempts_no_check" CHECK ("attempt_no" > 0),
    CONSTRAINT "usage_inference_attempts_sponsor_check" CHECK ("sponsor" = ANY (ARRAY['site'::"text", 'reader'::"text"])),
    CONSTRAINT "usage_inference_attempts_outcome_check" CHECK ("outcome" = ANY (ARRAY['succeeded'::"text", 'failed'::"text", 'not_sent'::"text"])),
    CONSTRAINT "usage_inference_attempts_measurement_check" CHECK ("measurement_status" = ANY (ARRAY['measured'::"text", 'estimated'::"text", 'not_sent'::"text"])),
    CONSTRAINT "usage_inference_attempts_amounts_check" CHECK (
      "provider_cost_micros" >= 0 AND "customer_cost_micros" >= 0
      AND "customer_units_micros" >= 0
      AND ("retail_value_micros" IS NULL OR "retail_value_micros" >= 0)
      AND (("sponsor" = 'site' AND "offer_key" IS NULL AND "markup_micros" IS NULL
            AND "customer_cost_micros" = 0 AND "customer_units_micros" = 0)
        OR ("sponsor" = 'reader' AND "offer_key" IS NOT NULL
            AND "markup_micros" IS NOT NULL AND "markup_micros" > 0))
      AND (("measurement_status" = 'not_sent' AND "provider_cost_micros" = 0
            AND "customer_cost_micros" = 0 AND "customer_units_micros" = 0)
        OR "measurement_status" <> 'not_sent')
    )
);

CREATE TABLE IF NOT EXISTS "public"."usage_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "offer_key" "text" NOT NULL,
    "source" "text" NOT NULL,
    "source_id" "text" NOT NULL,
    "units_micros" bigint DEFAULT 0 NOT NULL,
    "period_start" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "usage_unit" text,
    "rate_micros" bigint,
    "speech_cost_per_second_micros" bigint,
    "meter" text,
    "overage_price_micros" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "usage_grants_source_check" CHECK (("source" = ANY (ARRAY['purchase'::"text", 'subscription'::"text"]))),
    CONSTRAINT "usage_grants_units_check" CHECK (("units_micros" >= 0))
);

CREATE TABLE IF NOT EXISTS "public"."usage_meter_reports" (
    "usage_event_id" "uuid" NOT NULL,
    "identifier" "text" NOT NULL,
    "event_name" "text" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "value_micros" bigint NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "first_attempt_at" timestamp with time zone,
    "claimed_until" timestamp with time zone,
    "reported_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "usage_meter_reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'reported'::"text", 'expired'::"text"]))),
    CONSTRAINT "usage_meter_reports_value_check" CHECK (("value_micros" > 0))
);

CREATE TABLE IF NOT EXISTS "public"."usage_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reservation_ref" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "offer_key" "text" NOT NULL,
    "reserved_micros" bigint NOT NULL,
    "settled_micros" bigint DEFAULT 0 NOT NULL,
    "mode" "text" NOT NULL,
    "period_start" timestamp with time zone,
    "usage_unit" "text",
    "rate_micros" bigint,
    "speech_cost_per_second_micros" bigint,
    "meter" "text",
    "overage_price_micros" bigint,
    "operation_id" text,
    "markup_micros" bigint,
    "status" "text" DEFAULT 'held'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "usage_reservations_amounts_check" CHECK (("reserved_micros" > 0 AND "settled_micros" >= 0 AND "settled_micros" <= "reserved_micros")),
    CONSTRAINT "usage_reservations_mode_check" CHECK (("mode" = ANY (ARRAY['prepaid'::"text", 'metered'::"text"]))),
    CONSTRAINT "usage_reservations_inference_policy_check" CHECK (
      ("operation_id" IS NULL AND "markup_micros" IS NULL)
      OR ("operation_id" ~ '^[a-z][a-z0-9_.:-]{0,95}$' AND "markup_micros" IS NOT NULL AND "markup_micros" > 0)
    ),
    CONSTRAINT "usage_reservations_status_check" CHECK (("status" = ANY (ARRAY['held'::"text", 'settled'::"text", 'released'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."usage_topup_preferences" (
    "user_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "offer_key" "text",
    "threshold_micros" bigint,
    "monthly_cap_minor" bigint,
    "currency" "text",
    "off_session_consent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "usage_topup_preferences_threshold_check" CHECK (("threshold_micros" IS NULL OR "threshold_micros" >= 0)),
    CONSTRAINT "usage_topup_preferences_cap_check" CHECK (("monthly_cap_minor" IS NULL OR "monthly_cap_minor" > 0)),
    CONSTRAINT "usage_topup_preferences_enabled_check" CHECK (
      NOT "enabled" OR (
        nullif(btrim("offer_key"), '') IS NOT NULL
        AND "threshold_micros" IS NOT NULL
        AND "monthly_cap_minor" IS NOT NULL
        AND "currency" ~ '^[a-z]{3}$'
        AND "off_session_consent_at" IS NOT NULL
      )
    )
);

CREATE TABLE IF NOT EXISTS "public"."usage_topup_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attempt_ref" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "offer_key" "text" NOT NULL,
    "currency" "text" NOT NULL,
    "amount_minor" bigint NOT NULL,
    "units_micros" bigint NOT NULL,
    "usage_unit" "text",
    "rate_micros" bigint,
    "speech_cost_per_second_micros" bigint DEFAULT 0 NOT NULL,
    "period_start" date NOT NULL,
    "stripe_payment_intent_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "usage_topup_attempts_amounts_check" CHECK (("amount_minor" > 0 AND "units_micros" > 0)),
    CONSTRAINT "usage_topup_attempts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'requires_action'::"text", 'failed'::"text", 'succeeded'::"text", 'granted'::"text"]))),
    CONSTRAINT "usage_topup_attempts_currency_check" CHECK (("currency" ~ '^[a-z]{3}$'))
);

ALTER TABLE ONLY "public"."usage_events"
    ADD CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."usage_events"
    ADD CONSTRAINT "usage_events_source_ref_key" UNIQUE ("source_ref");

ALTER TABLE ONLY "public"."usage_inference_attempts"
    ADD CONSTRAINT "usage_inference_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."usage_inference_attempts"
    ADD CONSTRAINT "usage_inference_attempts_invocation_no_key" UNIQUE ("invocation_ref", "attempt_no");

ALTER TABLE ONLY "public"."usage_grants"
    ADD CONSTRAINT "usage_grants_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."usage_grants"
    ADD CONSTRAINT "usage_grants_source_key" UNIQUE ("user_id", "offer_key", "source", "source_id");

ALTER TABLE ONLY "public"."usage_meter_reports"
    ADD CONSTRAINT "usage_meter_reports_pkey" PRIMARY KEY ("usage_event_id");

ALTER TABLE ONLY "public"."usage_meter_reports"
    ADD CONSTRAINT "usage_meter_reports_identifier_key" UNIQUE ("identifier");

ALTER TABLE ONLY "public"."usage_reservations"
    ADD CONSTRAINT "usage_reservations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."usage_reservations"
    ADD CONSTRAINT "usage_reservations_ref_key" UNIQUE ("reservation_ref");

ALTER TABLE ONLY "public"."usage_topup_preferences"
    ADD CONSTRAINT "usage_topup_preferences_pkey" PRIMARY KEY ("user_id");

ALTER TABLE ONLY "public"."usage_topup_attempts"
    ADD CONSTRAINT "usage_topup_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."usage_topup_attempts"
    ADD CONSTRAINT "usage_topup_attempts_ref_key" UNIQUE ("attempt_ref");

ALTER TABLE ONLY "public"."usage_topup_attempts"
    ADD CONSTRAINT "usage_topup_attempts_payment_intent_key" UNIQUE ("stripe_payment_intent_id");

ALTER TABLE ONLY "public"."usage_events"
    ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."usage_inference_attempts"
    ADD CONSTRAINT "usage_inference_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."usage_grants"
    ADD CONSTRAINT "usage_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."usage_meter_reports"
    ADD CONSTRAINT "usage_meter_reports_event_fkey" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."usage_reservations"
    ADD CONSTRAINT "usage_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."usage_topup_preferences"
    ADD CONSTRAINT "usage_topup_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."usage_topup_attempts"
    ADD CONSTRAINT "usage_topup_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE INDEX "usage_events_user_offer_period_idx" ON "public"."usage_events" USING "btree" ("user_id", "offer_key", "period_start", "created_at" DESC);

CREATE INDEX "usage_inference_attempts_created_at_idx" ON "public"."usage_inference_attempts" USING "btree" ("created_at" DESC);

CREATE INDEX "usage_inference_attempts_operation_provider_idx" ON "public"."usage_inference_attempts" USING "btree" ("operation_id", "provider_id", "model", "created_at" DESC);

CREATE INDEX "usage_grants_user_offer_expiry_idx" ON "public"."usage_grants" USING "btree" ("user_id", "offer_key", "expires_at");

CREATE INDEX "usage_meter_reports_pending_idx" ON "public"."usage_meter_reports" USING "btree" ("status", "first_attempt_at");

CREATE INDEX "usage_reservations_user_offer_status_idx" ON "public"."usage_reservations" USING "btree" ("user_id", "offer_key", "status", "expires_at");

CREATE INDEX "usage_topup_attempts_user_month_idx" ON "public"."usage_topup_attempts" USING "btree" ("user_id", "currency", "period_start", "status");

ALTER TABLE "public"."usage_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_events_select_own" ON "public"."usage_events" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."usage_inference_attempts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."usage_grants" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_grants_select_own" ON "public"."usage_grants" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."usage_meter_reports" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."usage_reservations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_reservations_select_own" ON "public"."usage_reservations" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."usage_topup_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_topup_preferences_select_own" ON "public"."usage_topup_preferences" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."usage_topup_attempts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_topup_attempts_select_own" ON "public"."usage_topup_attempts" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));

REVOKE ALL ON TABLE "public"."usage_events" FROM "anon", "authenticated", "service_role";

REVOKE ALL ON TABLE "public"."usage_inference_attempts" FROM "anon", "authenticated", "service_role";

REVOKE ALL ON TABLE "public"."usage_grants" FROM "anon", "authenticated", "service_role";

REVOKE ALL ON TABLE "public"."usage_meter_reports" FROM "anon", "authenticated", "service_role";

REVOKE ALL ON TABLE "public"."usage_reservations" FROM "anon", "authenticated", "service_role";

REVOKE ALL ON TABLE "public"."usage_topup_preferences" FROM "anon", "authenticated", "service_role";

REVOKE ALL ON TABLE "public"."usage_topup_attempts" FROM "anon", "authenticated", "service_role";

GRANT SELECT ON TABLE "public"."usage_events" TO "authenticated";

GRANT SELECT ON TABLE "public"."usage_grants" TO "authenticated";

GRANT SELECT ON TABLE "public"."usage_events" TO "service_role";

GRANT SELECT ON TABLE "public"."usage_inference_attempts" TO "service_role";

GRANT SELECT ON TABLE "public"."usage_grants" TO "service_role";

GRANT SELECT ON TABLE "public"."usage_meter_reports" TO "service_role";

GRANT SELECT ON TABLE "public"."usage_reservations" TO "authenticated", "service_role";

GRANT SELECT ON TABLE "public"."usage_topup_preferences" TO "authenticated", "service_role";

GRANT SELECT ON TABLE "public"."usage_topup_attempts" TO "authenticated", "service_role";

CREATE OR REPLACE VIEW "public"."usage_balances" WITH ("security_invoker"='true') AS
    WITH "periods" AS (
        SELECT DISTINCT "user_id", "offer_key", "period_start"
        FROM "public"."usage_grants"
        WHERE ("expires_at" IS NULL OR "expires_at" > "now"())
        UNION
        SELECT DISTINCT "user_id", "offer_key", "period_start"
        FROM "public"."usage_events"
        UNION
        SELECT DISTINCT "user_id", "offer_key", "period_start"
        FROM "public"."usage_reservations"
        WHERE "mode" = 'prepaid' AND "status" = 'held' AND "expires_at" > "now"()
    ), "grants" AS (
        SELECT "user_id", "offer_key", "period_start", sum("units_micros") AS "granted_micros",
               max("expires_at") AS "expires_at"
        FROM "public"."usage_grants"
        WHERE ("expires_at" IS NULL OR "expires_at" > "now"())
        GROUP BY "user_id", "offer_key", "period_start"
    ), "used" AS (
        SELECT "user_id", "offer_key", "period_start", sum("units_micros") AS "used_micros",
               sum("included_micros") AS "included_used_micros"
        FROM "public"."usage_events"
        GROUP BY "user_id", "offer_key", "period_start"
    ), "reserved" AS (
        SELECT "user_id", "offer_key", "period_start",
               sum("reserved_micros" - "settled_micros") AS "reserved_micros"
        FROM "public"."usage_reservations"
        WHERE "mode" = 'prepaid' AND "status" = 'held' AND "expires_at" > "now"()
        GROUP BY "user_id", "offer_key", "period_start"
    )
    SELECT "periods"."user_id", "periods"."offer_key", "periods"."period_start",
           coalesce("grants"."granted_micros", 0) AS "granted_micros",
           coalesce("used"."used_micros", 0) AS "used_micros",
           coalesce("used"."included_used_micros", 0) AS "included_used_micros",
           coalesce("reserved"."reserved_micros", 0) AS "reserved_micros",
           CASE WHEN "grants"."expires_at" <= "now"() THEN 0
                ELSE greatest(
                  coalesce("grants"."granted_micros", 0)
                  - coalesce("used"."included_used_micros", 0)
                  - coalesce("reserved"."reserved_micros", 0),
                  0
                )
           END AS "remaining_micros"
    FROM "periods"
    LEFT JOIN "grants" ON "grants"."user_id" = "periods"."user_id"
        AND "grants"."offer_key" = "periods"."offer_key"
        AND "grants"."period_start" IS NOT DISTINCT FROM "periods"."period_start"
    LEFT JOIN "used" ON "used"."user_id" = "periods"."user_id"
        AND "used"."offer_key" = "periods"."offer_key"
        AND "used"."period_start" IS NOT DISTINCT FROM "periods"."period_start"
    LEFT JOIN "reserved" ON "reserved"."user_id" = "periods"."user_id"
        AND "reserved"."offer_key" = "periods"."offer_key"
        AND "reserved"."period_start" IS NOT DISTINCT FROM "periods"."period_start";

GRANT SELECT ON TABLE "public"."usage_balances" TO "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."usage_grant"(
    "p_user_id" "uuid",
    "p_offer_key" "text",
    "p_source" "text",
    "p_source_id" "text",
    "p_units_micros" bigint,
    "p_period_start" timestamp with time zone DEFAULT NULL,
    "p_expires_at" timestamp with time zone DEFAULT NULL,
    "p_usage_unit" "text" DEFAULT NULL,
    "p_rate_micros" bigint DEFAULT NULL,
    "p_meter" "text" DEFAULT NULL,
    "p_overage_price_micros" bigint DEFAULT NULL,
    "p_speech_cost_per_second_micros" bigint DEFAULT NULL,
    "p_authorized_period_start" timestamp with time zone DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  added integer;
begin
  if p_user_id is null or nullif(btrim(p_offer_key), '') is null or nullif(btrim(p_source_id), '') is null
     or p_source not in ('purchase', 'subscription') or p_units_micros <= 0
     or (p_expires_at is not null and p_period_start is null) then
    raise exception 'invalid usage grant';
  end if;
  insert into public.usage_grants (
    user_id, offer_key, source, source_id, units_micros, period_start, expires_at,
    usage_unit, rate_micros, speech_cost_per_second_micros, meter, overage_price_micros
  ) values (
    p_user_id, p_offer_key, p_source, p_source_id, p_units_micros, p_period_start, p_expires_at,
    p_usage_unit, p_rate_micros, p_speech_cost_per_second_micros, p_meter, p_overage_price_micros
  )
  on conflict (user_id, offer_key, source, source_id) do nothing;
  get diagnostics added = row_count;
  return added = 1;
end;
$$;

REVOKE ALL ON FUNCTION "public"."usage_grant"("uuid", "text", "text", "text", bigint, timestamp with time zone, timestamp with time zone, text, bigint, text, bigint, bigint, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_grant"("uuid", "text", "text", "text", bigint, timestamp with time zone, timestamp with time zone, text, bigint, text, bigint, bigint, timestamp with time zone) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_grant"("uuid", "text", "text", "text", bigint, timestamp with time zone, timestamp with time zone, text, bigint, text, bigint, bigint, timestamp with time zone) TO "service_role";

CREATE OR REPLACE FUNCTION "public"."usage_admit"("p_user_id" "uuid", "p_offer_key" "text")
RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  period_start timestamptz;
  sub_usage_unit text;
  sub_rate_micros bigint;
  sub_speech_rate_micros bigint;
  sub_meter text;
  sub_overage_price_micros bigint;
  remaining bigint;
begin
  if p_user_id is null or nullif(btrim(p_offer_key), '') is null then
    return jsonb_build_object('admitted', false, 'reason', 'usage_subject_required');
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    return jsonb_build_object('admitted', false, 'reason', 'usage_subject_mismatch');
  end if;
  select s.current_period_start, s.usage_unit, s.usage_rate_micros, s.usage_speech_cost_per_second_micros, s.usage_meter, s.usage_overage_price_micros
    into period_start, sub_usage_unit, sub_rate_micros, sub_speech_rate_micros, sub_meter, sub_overage_price_micros
    from public.subscriptions s
   where s.user_id = p_user_id and s.key = p_offer_key
     and s.status in ('active', 'trialing')
     and s.current_period_start <= now() and s.current_period_end > now()
     and s.usage_meter is not null
   order by s.updated_at desc limit 1;
  if found then
    return jsonb_build_object(
      'admitted', true, 'mode', 'metered', 'usage_unit', sub_usage_unit,
      'rate_micros', sub_rate_micros, 'speech_cost_per_second_micros', sub_speech_rate_micros, 'meter', sub_meter,
      'overage_price_micros', sub_overage_price_micros
    );
  end if;
  select greatest(
    coalesce((select sum(g.units_micros) from public.usage_grants g
      where g.user_id = p_user_id and g.offer_key = p_offer_key
        and g.source = 'purchase' and g.period_start is null
        and (g.expires_at is null or g.expires_at > now())), 0)
    - coalesce((select sum(e.included_micros) from public.usage_events e
      where e.user_id = p_user_id and e.offer_key = p_offer_key
        and e.period_start is null), 0), 0
  ) into remaining;
  return jsonb_build_object(
    'admitted', remaining > 0,
    'mode', 'prepaid',
    'remaining_micros', remaining,
    'reason', case when remaining > 0 then null else 'usage_balance_exhausted' end
  );
end;
$$;

REVOKE ALL ON FUNCTION "public"."usage_admit"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_admit"("uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_admit"("uuid", "text") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."usage_record"(
    "p_source_ref" "text",
    "p_user_id" "uuid",
    "p_bot_id" "text",
    "p_offer_key" "text",
    "p_kind" "text",
    "p_cost_micros" bigint,
    "p_seconds_micros" bigint,
    "p_units_micros" bigint,
    "p_metered" boolean DEFAULT false,
    "p_usage_unit" "text" DEFAULT NULL,
    "p_rate_micros" bigint DEFAULT NULL,
    "p_meter" "text" DEFAULT NULL,
    "p_overage_price_micros" bigint DEFAULT NULL,
    "p_speech_cost_per_second_micros" bigint DEFAULT NULL,
    "p_authorized_period_start" timestamp with time zone DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  sub record;
  customer text;
  v_period_start timestamptz;
  meter_name text;
  granted bigint := 0;
  used bigint := 0;
  included bigint := 0;
  overage bigint := 0;
  event_id uuid;
  report_id text;
  usage_unit_snapshot text := p_usage_unit;
  rate_snapshot bigint := p_rate_micros;
  speech_rate_snapshot bigint := p_speech_cost_per_second_micros;
  meter_snapshot text := p_meter;
  overage_price_snapshot bigint := p_overage_price_micros;
begin
  if nullif(btrim(p_source_ref), '') is null or p_user_id is null
     or nullif(btrim(p_offer_key), '') is null or p_kind not in ('model', 'stt', 'tts')
     or p_cost_micros < 0 or p_seconds_micros < 0 or p_units_micros < 0
     or (p_rate_micros is not null and p_rate_micros <= 0)
     or (p_speech_cost_per_second_micros is not null and p_speech_cost_per_second_micros < 0)
     or (p_overage_price_micros is not null and p_overage_price_micros <= 0) then
    raise exception 'invalid usage record';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_offer_key, 0));

  select id into event_id from public.usage_events where source_ref = p_source_ref;
  if event_id is not null then
    return jsonb_build_object('admitted', true, 'duplicate', true, 'usage_event_id', event_id);
  end if;

  if p_metered then
    if p_authorized_period_start is not null and p_meter is not null then
      meter_name := p_meter;
      v_period_start := p_authorized_period_start;
      usage_unit_snapshot := p_usage_unit;
      rate_snapshot := p_rate_micros;
      speech_rate_snapshot := p_speech_cost_per_second_micros;
      meter_snapshot := p_meter;
      overage_price_snapshot := p_overage_price_micros;
    else
      select s.usage_meter, s.current_period_start, s.usage_included_micros,
             s.usage_unit, s.usage_rate_micros, s.usage_overage_price_micros, s.usage_speech_cost_per_second_micros
        into sub
        from public.subscriptions s
       where s.user_id = p_user_id and s.key = p_offer_key
         and s.status in ('active', 'trialing')
         and s.current_period_start <= now() and s.current_period_end > now()
         and s.usage_meter is not null
       order by s.updated_at desc
       limit 1
       for update;
      if not found then
        return jsonb_build_object('admitted', false, 'reason', 'metered_subscription_required');
      end if;
      meter_name := sub.usage_meter;
      v_period_start := sub.current_period_start;
      usage_unit_snapshot := sub.usage_unit;
      rate_snapshot := sub.usage_rate_micros;
      speech_rate_snapshot := sub.usage_speech_cost_per_second_micros;
      meter_snapshot := sub.usage_meter;
      overage_price_snapshot := sub.usage_overage_price_micros;
    end if;
    select stripe_customer_id into customer from public.profiles where id = p_user_id;
    if nullif(customer, '') is null then
      raise exception 'metered subscription has no Stripe customer';
    end if;
  end if;

  select coalesce(sum(g.units_micros), 0) into granted
    from public.usage_grants g
   where g.user_id = p_user_id and g.offer_key = p_offer_key
     and g.period_start is not distinct from v_period_start
     and (g.expires_at is null or g.expires_at > now());
  select coalesce(sum(e.included_micros), 0) into used
    from public.usage_events e
   where e.user_id = p_user_id and e.offer_key = p_offer_key
     and e.period_start is not distinct from v_period_start;

  included := least(p_units_micros, greatest(granted - used, 0));
  overage := p_units_micros - included;
  if not p_metered then
    included := p_units_micros;
    overage := 0;
  end if;
  insert into public.usage_events (
    source_ref, user_id, bot_id, offer_key, kind, cost_micros, seconds_micros,
    units_micros, included_micros, metered_micros, period_start,
    usage_unit, rate_micros, speech_cost_per_second_micros, meter, overage_price_micros
  ) values (
    p_source_ref, p_user_id, p_bot_id, p_offer_key, p_kind, p_cost_micros, p_seconds_micros,
    p_units_micros, included, overage, v_period_start,
    usage_unit_snapshot, rate_snapshot, speech_rate_snapshot, meter_snapshot, overage_price_snapshot
  ) returning id into event_id;

  if overage > 0 then
    report_id := 'us_' || md5(p_source_ref);
    insert into public.usage_meter_reports (
      usage_event_id, identifier, event_name, stripe_customer_id, value_micros
    ) values (event_id, report_id, meter_name, customer, overage);
  end if;
  return jsonb_build_object(
    'admitted', true, 'duplicate', false, 'usage_event_id', event_id,
    'included_micros', included, 'metered_micros', overage,
    'remaining_micros', greatest(granted - used - included, 0),
    'meter_report_id', report_id
  );
end;
$$;

REVOKE ALL ON FUNCTION "public"."usage_record"("text", "uuid", "text", "text", "text", bigint, bigint, bigint, boolean, text, bigint, text, bigint, bigint, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_record"("text", "uuid", "text", "text", "text", bigint, bigint, bigint, boolean, text, bigint, text, bigint, bigint, timestamp with time zone) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_record"("text", "uuid", "text", "text", "text", bigint, bigint, bigint, boolean, text, bigint, text, bigint, bigint, timestamp with time zone) TO "service_role";

CREATE OR REPLACE FUNCTION "public"."usage_authorize"(
    "p_user_id" "uuid",
    "p_offer_key" "text",
    "p_reservation_ref" "text",
    "p_max_units_micros" bigint,
    "p_expires_at" timestamp with time zone DEFAULT ("now"() + '00:15:00'::interval),
    "p_usage_unit" "text" DEFAULT NULL,
    "p_rate_micros" bigint DEFAULT NULL,
    "p_speech_cost_per_second_micros" bigint DEFAULT NULL,
    "p_meter" "text" DEFAULT NULL,
    "p_overage_price_micros" bigint DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_existing public.usage_reservations%rowtype;
  v_subscription record;
  v_mode text := 'prepaid';
  v_remaining bigint := 0;
  v_period_start timestamptz;
  v_usage_unit text := p_usage_unit;
  v_rate_micros bigint := p_rate_micros;
  v_speech_rate_micros bigint := p_speech_cost_per_second_micros;
  v_meter text := p_meter;
  v_overage_price_micros bigint := p_overage_price_micros;
begin
  if p_user_id is null or nullif(btrim(p_offer_key), '') is null
     or nullif(btrim(p_reservation_ref), '') is null or p_max_units_micros <= 0
     or p_expires_at <= now() or p_expires_at > now() + interval '1 day' then
    raise exception 'invalid usage reservation';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'usage subject mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_offer_key, 0));

  select r.* into v_existing
    from public.usage_reservations r
   where r.reservation_ref = p_reservation_ref
   for update;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.offer_key <> p_offer_key
       or v_existing.reserved_micros <> p_max_units_micros then
      raise exception 'usage reservation reference reused with different terms';
    end if;
    return jsonb_build_object(
      'admitted', v_existing.status = 'held' and v_existing.expires_at > now(),
      'duplicate', true,
      'reason', case
        when v_existing.status <> 'held' then 'reservation_already_closed'
        when v_existing.expires_at <= now() then 'reservation_expired'
        else null end,
      'mode', v_existing.mode,
      'remaining_micros', v_existing.reserved_micros - v_existing.settled_micros,
      'period_start', v_existing.period_start
    );
  end if;

  select s.current_period_start, s.usage_meter, s.usage_unit, s.usage_rate_micros,
         s.usage_speech_cost_per_second_micros, s.usage_overage_price_micros
    into v_subscription
    from public.subscriptions s
   where s.user_id = p_user_id and s.key = p_offer_key
     and s.status in ('active', 'trialing')
     and s.current_period_start <= now() and s.current_period_end > now()
     and s.usage_meter is not null
   order by s.updated_at desc
   limit 1
   for update;
  if found then
    v_mode := 'metered';
    v_period_start := v_subscription.current_period_start;
    v_usage_unit := v_subscription.usage_unit;
    v_rate_micros := v_subscription.usage_rate_micros;
    v_speech_rate_micros := v_subscription.usage_speech_cost_per_second_micros;
    v_meter := v_subscription.usage_meter;
    v_overage_price_micros := v_subscription.usage_overage_price_micros;
  else
    select greatest(
      coalesce((
        select sum(g.units_micros)
          from public.usage_grants g
         where g.user_id = p_user_id and g.offer_key = p_offer_key
           and g.source = 'purchase' and g.period_start is null
           and (g.expires_at is null or g.expires_at > now())
      ), 0)
      - coalesce((
        select sum(e.included_micros)
          from public.usage_events e
         where e.user_id = p_user_id and e.offer_key = p_offer_key
           and e.period_start is null
      ), 0)
      - coalesce((
        select sum(r.reserved_micros - r.settled_micros)
          from public.usage_reservations r
         where r.user_id = p_user_id and r.offer_key = p_offer_key
           and r.status = 'held' and r.expires_at > now()
      ), 0),
      0
    ) into v_remaining;
    if v_remaining < p_max_units_micros then
      return jsonb_build_object(
        'admitted', false, 'duplicate', false, 'mode', 'prepaid',
        'remaining_micros', v_remaining, 'reason', 'usage_balance_exhausted'
      );
    end if;
  end if;

  insert into public.usage_reservations (
    reservation_ref, user_id, offer_key, reserved_micros, mode, period_start,
    usage_unit, rate_micros, speech_cost_per_second_micros, meter, overage_price_micros,
    expires_at
  ) values (
    p_reservation_ref, p_user_id, p_offer_key, p_max_units_micros, v_mode, v_period_start,
    v_usage_unit, v_rate_micros, v_speech_rate_micros, v_meter, v_overage_price_micros,
    p_expires_at
  );
  return jsonb_build_object(
    'admitted', true, 'duplicate', false, 'mode', v_mode,
    'remaining_micros', case when v_mode = 'prepaid' then v_remaining - p_max_units_micros else null end,
    'period_start', v_period_start
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_renew"(
    "p_reservation_ref" "text",
    "p_expires_at" timestamp with time zone
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_updated integer;
begin
  if nullif(btrim(p_reservation_ref), '') is null
     or p_expires_at <= now() or p_expires_at > now() + interval '1 day' then
    raise exception 'invalid usage reservation extension';
  end if;
  update public.usage_reservations r
     set expires_at = p_expires_at, updated_at = now()
   where r.reservation_ref = p_reservation_ref
     and r.status = 'held' and r.expires_at > now()
     and p_expires_at > r.expires_at;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_release"("p_reservation_ref" "text")
RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_updated integer;
begin
  update public.usage_reservations r
     set status = 'released', updated_at = now()
   where r.reservation_ref = p_reservation_ref and r.status = 'held';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_settle"(
    "p_reservation_ref" "text",
    "p_kind" "text",
    "p_cost_micros" bigint,
    "p_seconds_micros" bigint,
    "p_units_micros" bigint,
    "p_bot_id" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_reservation public.usage_reservations%rowtype;
  v_result jsonb;
begin
  select r.* into v_reservation
    from public.usage_reservations r
   where r.reservation_ref = p_reservation_ref
   for update;
  if not found then
    raise exception 'usage reservation not found';
  end if;
  if v_reservation.status = 'settled' then
    select jsonb_build_object(
      'admitted', true, 'duplicate', true, 'usage_event_id', e.id,
      'included_micros', e.included_micros, 'metered_micros', e.metered_micros
    ) into v_result
      from public.usage_events e
     where e.source_ref = p_reservation_ref;
    if v_result is null then
      raise exception 'settled usage reservation has no usage event';
    end if;
    return v_result;
  end if;
  if v_reservation.status <> 'held' or v_reservation.expires_at <= now() then
    raise exception 'usage reservation is not active';
  end if;
  if p_kind not in ('model', 'stt', 'tts')
     or p_cost_micros < 0 or p_seconds_micros < 0
     or p_units_micros < 0 or (p_units_micros = 0 and p_cost_micros > 0)
     or p_units_micros > v_reservation.reserved_micros then
    raise exception 'settled usage exceeds its authorization';
  end if;

  v_result := public.usage_record(
    p_reservation_ref, v_reservation.user_id, p_bot_id, v_reservation.offer_key, p_kind,
    p_cost_micros, p_seconds_micros, p_units_micros, v_reservation.mode = 'metered',
    v_reservation.usage_unit, v_reservation.rate_micros, v_reservation.meter,
    v_reservation.overage_price_micros, v_reservation.speech_cost_per_second_micros,
    case when v_reservation.mode = 'metered' then v_reservation.period_start else null end
  );
  if not coalesce((v_result ->> 'admitted')::boolean, false) then
    raise exception 'usage subscription is no longer eligible';
  end if;
  update public.usage_reservations r
     set status = 'settled', settled_micros = p_units_micros, updated_at = now()
   where r.id = v_reservation.id;
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_authorize_inference"(
    "p_user_id" "uuid",
    "p_offer_key" "text",
    "p_reservation_ref" "text",
    "p_max_units_micros" bigint,
    "p_expires_at" timestamp with time zone,
    "p_usage_unit" "text",
    "p_rate_micros" bigint,
    "p_speech_cost_per_second_micros" bigint,
    "p_meter" "text",
    "p_overage_price_micros" bigint,
    "p_operation_id" "text",
    "p_markup_micros" bigint
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
  v_reservation public.usage_reservations%rowtype;
begin
  if p_operation_id is null or p_operation_id !~ '^[a-z][a-z0-9_.:-]{0,95}$'
     or p_markup_micros is null or p_markup_micros <= 0 then
    raise exception 'invalid inference billing policy';
  end if;
  v_result := public.usage_authorize(
    p_user_id, p_offer_key, p_reservation_ref, p_max_units_micros, p_expires_at,
    p_usage_unit, p_rate_micros, p_speech_cost_per_second_micros, p_meter, p_overage_price_micros
  );
  if not coalesce((v_result ->> 'admitted')::boolean, false) then
    return v_result;
  end if;
  select * into v_reservation from public.usage_reservations
   where reservation_ref = p_reservation_ref for update;
  if not found then raise exception 'inference authorization has no usage reservation'; end if;
  if (v_reservation.operation_id is not null and v_reservation.operation_id <> p_operation_id)
     or (v_reservation.markup_micros is not null and v_reservation.markup_micros <> p_markup_micros) then
    raise exception 'inference reservation replay changed its operation or markup';
  end if;
  update public.usage_reservations
     set operation_id = p_operation_id, markup_micros = p_markup_micros, updated_at = now()
   where id = v_reservation.id;
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_settle_inference"(
    "p_reservation_ref" "text",
    "p_operation_id" "text",
    "p_kind" "text",
    "p_provider_cost_micros" bigint,
    "p_seconds_micros" bigint,
    "p_units_micros" bigint,
    "p_bot_id" "text",
    "p_markup_micros" bigint,
    "p_customer_cost_micros" bigint,
    "p_retail_value_micros" bigint,
    "p_retail_currency" "text",
    "p_measurement_status" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
  v_event public.usage_events%rowtype;
  v_reservation public.usage_reservations%rowtype;
begin
  if p_operation_id is null or p_operation_id !~ '^[a-z][a-z0-9_.:-]{0,95}$'
     or p_kind is distinct from 'model' or p_provider_cost_micros is null or p_provider_cost_micros < 0
     or p_seconds_micros is null or p_units_micros is null or p_units_micros < 0
     or p_markup_micros is null or p_markup_micros <= 0
     or p_customer_cost_micros is null or p_customer_cost_micros < 0
     or (p_retail_value_micros is not null and p_retail_value_micros < 0)
     or (p_retail_currency is not null and p_retail_currency !~ '^[a-z]{3}$')
     or p_measurement_status is null or p_measurement_status not in ('measured', 'estimated') then
    raise exception 'invalid inference usage settlement';
  end if;
  select * into v_reservation from public.usage_reservations
   where reservation_ref = p_reservation_ref for update;
  if not found or v_reservation.operation_id is distinct from p_operation_id
     or v_reservation.markup_micros is distinct from p_markup_micros then
    raise exception 'inference settlement does not match its authorization snapshot';
  end if;
  v_result := public.usage_settle(
    p_reservation_ref, p_kind, p_provider_cost_micros, p_seconds_micros, p_units_micros, p_bot_id
  );
  if not coalesce((v_result ->> 'admitted')::boolean, false) then
    raise exception 'inference usage settlement was not admitted';
  end if;
  select * into v_event from public.usage_events
   where source_ref = p_reservation_ref for update;
  if not found then raise exception 'inference settlement has no usage event'; end if;
  if v_event.cost_micros <> p_provider_cost_micros or v_event.units_micros <> p_units_micros
     or (v_event.measurement_status is not null and (
       v_event.operation_id is distinct from p_operation_id
       or v_event.markup_micros is distinct from p_markup_micros
       or v_event.customer_cost_micros is distinct from p_customer_cost_micros
       or v_event.retail_value_micros is distinct from p_retail_value_micros
       or v_event.retail_currency is distinct from p_retail_currency
       or v_event.measurement_status <> p_measurement_status
     )) then
    raise exception 'inference settlement replay changed its accounting snapshot';
  end if;
  update public.usage_events
     set operation_id = p_operation_id,
         sponsor = 'reader',
         customer_cost_micros = p_customer_cost_micros,
         markup_micros = p_markup_micros,
         retail_value_micros = p_retail_value_micros,
         retail_currency = p_retail_currency,
         measurement_status = p_measurement_status
   where id = v_event.id;
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_inference_attempt_record"(
    "p_invocation_ref" "text",
    "p_attempt_no" integer,
    "p_user_id" "uuid",
    "p_operation_id" "text",
    "p_bot_id" "text",
    "p_offer_key" "text",
    "p_sponsor" "text",
    "p_provider_id" "text",
    "p_model" "text",
    "p_protocol" "text",
    "p_outcome" "text",
    "p_measurement_status" "text",
    "p_usage_dimensions" "jsonb",
    "p_provider_cost_micros" bigint,
    "p_markup_micros" bigint,
    "p_customer_cost_micros" bigint,
    "p_customer_units_micros" bigint,
    "p_retail_value_micros" bigint,
    "p_retail_currency" "text",
    "p_http_status" integer
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_existing public.usage_inference_attempts%rowtype;
  v_reservation public.usage_reservations%rowtype;
begin
  if nullif(btrim(p_invocation_ref), '') is null or p_attempt_no is null or p_attempt_no <= 0
     or p_operation_id is null or p_operation_id !~ '^[a-z][a-z0-9_.:-]{0,95}$'
     or p_provider_id is null or p_provider_id !~ '^[a-z][a-z0-9-]{0,47}$'
     or nullif(btrim(p_model), '') is null
     or p_protocol is null or p_protocol not in ('openai-chat', 'anthropic')
     or p_outcome is null or p_outcome not in ('succeeded', 'failed', 'not_sent')
     or p_measurement_status is null or p_measurement_status not in ('measured', 'estimated', 'not_sent')
     or p_usage_dimensions is null or jsonb_typeof(p_usage_dimensions) <> 'object'
     or p_provider_cost_micros is null or p_provider_cost_micros < 0
     or p_customer_cost_micros is null or p_customer_cost_micros < 0
     or p_customer_units_micros is null or p_customer_units_micros < 0
     or (p_retail_value_micros is not null and p_retail_value_micros < 0)
     or (p_retail_currency is not null and p_retail_currency !~ '^[a-z]{3}$')
     or (p_http_status is not null and (p_http_status < 100 or p_http_status > 599))
     or (p_sponsor = 'reader' and (p_user_id is null or p_offer_key is null
         or p_offer_key !~ '^[0-9a-f]{8}$' or p_markup_micros is null or p_markup_micros <= 0))
     or (p_sponsor = 'site' and (p_offer_key is not null or p_markup_micros is not null
         or p_customer_cost_micros <> 0 or p_customer_units_micros <> 0
         or p_retail_value_micros is not null or p_retail_currency is not null))
     or p_sponsor is null or p_sponsor not in ('reader', 'site')
     or (p_measurement_status = 'not_sent' and (p_provider_cost_micros <> 0
         or p_customer_cost_micros <> 0 or p_customer_units_micros <> 0
         or p_outcome <> 'not_sent'))
     or (p_outcome = 'not_sent' and p_measurement_status <> 'not_sent') then
    raise exception 'invalid inference attempt record';
  end if;
  if p_sponsor = 'reader' then
    select * into v_reservation from public.usage_reservations
     where reservation_ref = p_invocation_ref for update;
    if not found or v_reservation.user_id is distinct from p_user_id
       or v_reservation.offer_key is distinct from p_offer_key
       or v_reservation.operation_id is distinct from p_operation_id
       or v_reservation.markup_micros is distinct from p_markup_micros then
      raise exception 'reader inference attempt does not match its authorization snapshot';
    end if;
  end if;
  select * into v_existing from public.usage_inference_attempts
   where invocation_ref = p_invocation_ref and attempt_no = p_attempt_no;
  if found then
    if v_existing.user_id is distinct from p_user_id
       or v_existing.operation_id <> p_operation_id
       or v_existing.bot_id is distinct from p_bot_id
       or v_existing.offer_key is distinct from p_offer_key
       or v_existing.sponsor <> p_sponsor
       or v_existing.provider_id <> p_provider_id
       or v_existing.model <> p_model
       or v_existing.protocol <> p_protocol
       or v_existing.outcome <> p_outcome
       or v_existing.measurement_status <> p_measurement_status
       or v_existing.usage_dimensions <> p_usage_dimensions
       or v_existing.provider_cost_micros <> p_provider_cost_micros
       or v_existing.markup_micros is distinct from p_markup_micros
       or v_existing.customer_cost_micros <> p_customer_cost_micros
       or v_existing.customer_units_micros <> p_customer_units_micros
       or v_existing.retail_value_micros is distinct from p_retail_value_micros
       or v_existing.retail_currency is distinct from p_retail_currency
       or v_existing.http_status is distinct from p_http_status then
      raise exception 'inference attempt replay changed its accounting snapshot';
    end if;
    return jsonb_build_object('recorded', true, 'duplicate', true, 'id', v_existing.id);
  end if;
  insert into public.usage_inference_attempts (
    invocation_ref, attempt_no, user_id, operation_id, bot_id, offer_key, sponsor,
    provider_id, model, protocol, outcome, measurement_status, usage_dimensions,
    provider_cost_micros, markup_micros, customer_cost_micros, customer_units_micros,
    retail_value_micros, retail_currency, http_status
  ) values (
    p_invocation_ref, p_attempt_no, p_user_id, p_operation_id, p_bot_id, p_offer_key, p_sponsor,
    p_provider_id, p_model, p_protocol, p_outcome, p_measurement_status, p_usage_dimensions,
    p_provider_cost_micros, p_markup_micros, p_customer_cost_micros, p_customer_units_micros,
    p_retail_value_micros, p_retail_currency, p_http_status
  ) returning * into v_existing;
  return jsonb_build_object('recorded', true, 'duplicate', false, 'id', v_existing.id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_topup_save"(
    "p_user_id" "uuid",
    "p_enabled" boolean,
    "p_offer_key" "text",
    "p_threshold_micros" bigint,
    "p_monthly_cap_minor" bigint,
    "p_currency" "text",
    "p_consent_at" timestamp with time zone DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_existing public.usage_topup_preferences%rowtype;
  v_consent_at timestamptz;
begin
  if p_user_id is null or p_threshold_micros < 0 or p_monthly_cap_minor <= 0
     or p_currency !~ '^[a-z]{3}$' or nullif(btrim(p_offer_key), '') is null then
    raise exception 'invalid automatic top-up preference';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'usage preference subject mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('usage-topup:' || p_user_id::text, 0));
  select * into v_existing
    from public.usage_topup_preferences
   where user_id = p_user_id
   for update;
  v_consent_at := case
    when p_enabled then coalesce(p_consent_at, v_existing.off_session_consent_at)
    else null
  end;
  if p_enabled and v_consent_at is null then
    raise exception 'off-session payment consent is required';
  end if;
  insert into public.usage_topup_preferences (
    user_id, enabled, offer_key, threshold_micros, monthly_cap_minor, currency,
    off_session_consent_at, updated_at
  ) values (
    p_user_id, p_enabled, p_offer_key, p_threshold_micros, p_monthly_cap_minor, p_currency,
    v_consent_at, now()
  )
  on conflict (user_id) do update set
    enabled = excluded.enabled,
    offer_key = excluded.offer_key,
    threshold_micros = excluded.threshold_micros,
    monthly_cap_minor = excluded.monthly_cap_minor,
    currency = excluded.currency,
    off_session_consent_at = excluded.off_session_consent_at,
    updated_at = now();
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_topup_begin"(
    "p_user_id" "uuid",
    "p_attempt_ref" "text",
    "p_offer_key" "text",
    "p_currency" "text",
    "p_amount_minor" bigint,
    "p_units_micros" bigint,
    "p_site_enabled" boolean,
    "p_usage_unit" "text",
    "p_rate_micros" bigint,
    "p_speech_cost_per_second_micros" bigint
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_pref public.usage_topup_preferences%rowtype;
  v_existing public.usage_topup_attempts%rowtype;
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_spent bigint := 0;
  v_remaining bigint := 0;
begin
  if p_user_id is null or nullif(btrim(p_attempt_ref), '') is null
     or nullif(btrim(p_offer_key), '') is null or p_amount_minor <= 0
     or p_units_micros <= 0 or p_currency !~ '^[a-z]{3}$'
     or nullif(btrim(p_usage_unit), '') is null or p_rate_micros <= 0
     or p_speech_cost_per_second_micros < 0 then
    raise exception 'invalid automatic top-up attempt';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'usage top-up subject mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('usage-topup:' || p_user_id::text, 0));
  select * into v_pref from public.usage_topup_preferences
   where user_id = p_user_id for update;
  if not found or not p_site_enabled or not v_pref.enabled
     or v_pref.off_session_consent_at is null then
    return jsonb_build_object('started', false, 'reason', 'topup_disabled');
  end if;
  if v_pref.offer_key <> p_offer_key or v_pref.currency <> p_currency then
    return jsonb_build_object('started', false, 'reason', 'topup_offer_mismatch');
  end if;
  select * into v_existing from public.usage_topup_attempts
   where attempt_ref = p_attempt_ref for update;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.offer_key <> p_offer_key then
      raise exception 'automatic top-up reference reused with different terms';
    end if;
    return jsonb_build_object(
      'started', v_existing.status = 'pending',
      'duplicate', true, 'status', v_existing.status,
      'reason', case when v_existing.status in ('pending', 'succeeded') then null else 'topup_attempt_closed' end,
      'attempt', to_jsonb(v_existing)
    );
  end if;
  select * into v_existing from public.usage_topup_attempts a
   where a.user_id = p_user_id and a.offer_key = p_offer_key
     and a.period_start = v_month
     and (
       a.status = 'pending'
       or (
         a.status = 'succeeded'
         and not exists (
           select 1 from public.usage_grants g
            where g.user_id = p_user_id
              and g.offer_key = p_offer_key
              and g.source = 'purchase'
              and g.source_id = 'topup:' || a.stripe_payment_intent_id
         )
       )
     )
   order by a.created_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'started', v_existing.status = 'pending',
      'duplicate', true, 'status', v_existing.status,
      'attempt', to_jsonb(v_existing)
    );
  end if;
  select coalesce(b.remaining_micros, 0) into v_remaining
    from public.usage_balances b
   where b.user_id = p_user_id and b.offer_key = p_offer_key
     and b.period_start is null;
  if v_remaining > v_pref.threshold_micros then
    return jsonb_build_object('started', false, 'reason', 'above_topup_threshold', 'remaining_micros', v_remaining);
  end if;
  select coalesce(sum(a.amount_minor), 0) into v_spent
    from public.usage_topup_attempts a
   where a.user_id = p_user_id and a.currency = p_currency
     and a.period_start = v_month
     and a.status in ('pending', 'requires_action', 'succeeded', 'granted');
  if v_spent + p_amount_minor > v_pref.monthly_cap_minor then
    return jsonb_build_object('started', false, 'reason', 'topup_monthly_cap');
  end if;
  insert into public.usage_topup_attempts (
    attempt_ref, user_id, offer_key, currency, amount_minor, units_micros,
    usage_unit, rate_micros, speech_cost_per_second_micros, period_start
  ) values (
    p_attempt_ref, p_user_id, p_offer_key, p_currency, p_amount_minor, p_units_micros,
    p_usage_unit, p_rate_micros, p_speech_cost_per_second_micros, v_month
  ) returning * into v_existing;
  return jsonb_build_object('started', true, 'duplicate', false, 'period_start', v_month, 'attempt', to_jsonb(v_existing));
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_topup_finish"(
    "p_attempt_ref" "text",
    "p_status" "text",
    "p_payment_intent_id" "text" DEFAULT NULL,
    "p_error" "text" DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_updated integer;
begin
  if p_status not in ('requires_action', 'failed', 'succeeded', 'granted')
     or nullif(btrim(p_attempt_ref), '') is null then
    raise exception 'invalid automatic top-up result';
  end if;
  update public.usage_topup_attempts
     set status = p_status,
         stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
         last_error = left(p_error, 1000),
         updated_at = now()
   where attempt_ref = p_attempt_ref
     and (status = 'pending' or (status = 'succeeded' and p_status = 'granted')
          or (status = 'requires_action' and p_status in ('failed', 'succeeded')));
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return exists (
      select 1 from public.usage_topup_attempts
       where attempt_ref = p_attempt_ref and status = p_status
         and (p_payment_intent_id is null or stripe_payment_intent_id = p_payment_intent_id)
    );
  end if;
  return true;
end;
$$;

REVOKE ALL ON FUNCTION "public"."usage_authorize"("uuid", "text", "text", bigint, timestamp with time zone, "text", bigint, bigint, "text", bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_authorize"("uuid", "text", "text", bigint, timestamp with time zone, "text", bigint, bigint, "text", bigint) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_authorize"("uuid", "text", "text", bigint, timestamp with time zone, "text", bigint, bigint, "text", bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_authorize_inference"("uuid", "text", "text", bigint, timestamp with time zone, "text", bigint, bigint, "text", bigint, "text", bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_authorize_inference"("uuid", "text", "text", bigint, timestamp with time zone, "text", bigint, bigint, "text", bigint, "text", bigint) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_authorize_inference"("uuid", "text", "text", bigint, timestamp with time zone, "text", bigint, bigint, "text", bigint, "text", bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_renew"("text", timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_renew"("text", timestamp with time zone) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_renew"("text", timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_release"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_release"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_release"("text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_settle"("text", "text", bigint, bigint, bigint, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_settle"("text", "text", bigint, bigint, bigint, "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_settle"("text", "text", bigint, bigint, bigint, "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_settle_inference"("text", "text", "text", bigint, bigint, bigint, "text", bigint, bigint, bigint, "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_settle_inference"("text", "text", "text", bigint, bigint, bigint, "text", bigint, bigint, bigint, "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_settle_inference"("text", "text", "text", bigint, bigint, bigint, "text", bigint, bigint, bigint, "text", "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_inference_attempt_record"("text", integer, "uuid", "text", "text", "text", "text", "text", "text", "text", "text", "text", "jsonb", bigint, bigint, bigint, bigint, bigint, "text", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_inference_attempt_record"("text", integer, "uuid", "text", "text", "text", "text", "text", "text", "text", "text", "text", "jsonb", bigint, bigint, bigint, bigint, bigint, "text", integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_inference_attempt_record"("text", integer, "uuid", "text", "text", "text", "text", "text", "text", "text", "text", "text", "jsonb", bigint, bigint, bigint, bigint, bigint, "text", integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_topup_save"("uuid", boolean, "text", bigint, bigint, "text", timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_topup_save"("uuid", boolean, "text", bigint, bigint, "text", timestamp with time zone) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_topup_save"("uuid", boolean, "text", bigint, bigint, "text", timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_topup_begin"("uuid", "text", "text", "text", bigint, bigint, boolean, text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_topup_begin"("uuid", "text", "text", "text", bigint, bigint, boolean, text, bigint, bigint) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_topup_begin"("uuid", "text", "text", "text", bigint, bigint, boolean, text, bigint, bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."usage_topup_finish"("text", "text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_topup_finish"("text", "text", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_topup_finish"("text", "text", "text", "text") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."usage_meter_claim"("p_limit" integer DEFAULT 100)
RETURNS SETOF "public"."usage_meter_reports"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.usage_meter_reports
     set status = 'expired', claimed_until = null,
         last_error = coalesce(last_error, 'automatic retry window expired; reconcile manually')
   where status = 'pending' and first_attempt_at < now() - interval '24 hours';

  return query
    with picked as (
      select r.usage_event_id
        from public.usage_meter_reports r
       where r.status = 'pending'
         and (r.claimed_until is null or r.claimed_until <= now())
         and (r.first_attempt_at is null or r.first_attempt_at >= now() - interval '24 hours')
       order by r.created_at
       limit greatest(1, least(p_limit, 500))
       for update skip locked
    )
    update public.usage_meter_reports r
       set first_attempt_at = coalesce(r.first_attempt_at, now()),
           claimed_until = now() + interval '1 minute'
      from picked
     where r.usage_event_id = picked.usage_event_id
     returning r.*;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."usage_meter_complete"(
    "p_usage_event_id" "uuid",
    "p_reported" boolean,
    "p_error" "text" DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  updated integer;
begin
  update public.usage_meter_reports
     set status = case
           when p_reported then 'reported'
           when first_attempt_at < now() - interval '24 hours' then 'expired'
           else 'pending'
         end,
         reported_at = case when p_reported then now() else reported_at end,
         last_error = case when p_reported then null else left(coalesce(p_error, 'meter report failed'), 1000) end,
         claimed_until = null
   where usage_event_id = p_usage_event_id and status = 'pending';
  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

REVOKE ALL ON FUNCTION "public"."usage_meter_claim"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_meter_claim"(integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_meter_claim"(integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."usage_meter_complete"("uuid", boolean, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."usage_meter_complete"("uuid", boolean, "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."usage_meter_complete"("uuid", boolean, "text") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."run_usage_meter_reports"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text;
begin
  if not exists (select 1 from public.usage_meter_reports where status = 'pending') then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := rtrim(url, '/') || '/usage-meter-report',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := '{}'::jsonb);
end;
$$;

REVOKE ALL ON FUNCTION "public"."run_usage_meter_reports"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_usage_meter_reports"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_usage_meter_reports"() TO "service_role";

CREATE OR REPLACE FUNCTION "public"."admin_usage"("p_days" integer DEFAULT 30)
RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  span_days integer := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not public.is_admin() then
    raise exception 'administrators only';
  end if;

  return jsonb_build_object(
    'usage', coalesce((
      select jsonb_agg(to_jsonb(usage_row) order by usage_row.cost_micros desc)
        from (
          select offer_key, usage_unit, rate_micros,
                 count(*)::integer as events,
                 coalesce(sum(cost_micros), 0)::bigint as cost_micros,
                 coalesce(sum(units_micros), 0)::bigint as units_micros,
                 case when sum(units_micros) > 0
                   then round(sum(cost_micros)::numeric * 1000000 / sum(units_micros))::bigint
                   else null end as measured_rate_micros
            from public.usage_events
           where created_at >= now() - make_interval(days => span_days)
           group by offer_key, usage_unit, rate_micros
           order by sum(cost_micros) desc
        ) usage_row
    ), '[]'::jsonb),
    'inference', coalesce((
      select jsonb_agg(to_jsonb(inference_row) order by inference_row.provider_cost_micros desc)
        from (
          select operation_id, provider_id, model, sponsor, offer_key, markup_micros,
                 retail_currency,
                 count(*)::integer as attempts,
                 coalesce(sum(provider_cost_micros), 0)::bigint as provider_cost_micros,
                 coalesce(sum(customer_cost_micros), 0)::bigint as customer_cost_micros,
                 coalesce(sum(customer_units_micros), 0)::bigint as customer_units_micros,
                 coalesce(sum(retail_value_micros), 0)::bigint as retail_value_micros,
                 count(*) filter (where measurement_status = 'estimated')::integer as estimated_attempts
            from public.usage_inference_attempts
           where created_at >= now() - make_interval(days => span_days)
           group by operation_id, provider_id, model, sponsor, offer_key, markup_micros, retail_currency
           order by sum(provider_cost_micros) desc
        ) inference_row
    ), '[]'::jsonb),
    'unresolved', coalesce((
      select jsonb_agg(jsonb_build_object(
        'usage_event_id', r.usage_event_id,
        'identifier', r.identifier,
        'event_name', r.event_name,
        'value_micros', r.value_micros,
        'status', r.status,
        'first_attempt_at', r.first_attempt_at,
        'last_error', r.last_error,
        'created_at', r.created_at
      ) order by r.created_at desc)
        from (
          select usage_event_id, identifier, event_name, value_micros, status,
                 first_attempt_at, last_error, created_at
            from public.usage_meter_reports
           where status in ('pending', 'expired')
           order by created_at desc
           limit 100
        ) r
    ), '[]'::jsonb)
  );
end;
$$;

REVOKE ALL ON FUNCTION "public"."admin_usage"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admin_usage"(integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_usage"(integer) TO "authenticated", "service_role";
