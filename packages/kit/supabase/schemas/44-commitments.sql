-- COMMITMENTS: a payment plan or a fixed term somebody is in (openspec: payment-plans).
--
-- A commitment is a number of payments owed in full. It rides on what already charges and grants:
-- a subscription for paying monthly, a purchase for paying a term in full, and the entitlements and
-- purchase those wrote. It charges nothing itself. What it adds is the lifecycle a subscription has
-- no word for — committed, restricted after a missed payment, in default with a balance owed,
-- ended — and the access it holds back while a payment is outstanding.
--
-- Access is held back where it is granted, so every gate reading it is unchanged: the entitlements
-- the purchase or subscription wrote go inactive, and a purchase (a course, an event, anything sold
-- once and paid in instalments) is marked suspended. Paying gives both back.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."commitments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- the way of paying bought (a derived offer's sku) and the offer it pays for
    "sku" "text" NOT NULL,
    "of_sku" "text" NOT NULL,
    "plan" "text" NOT NULL,
    "term_months" integer,
    "payments_total" integer NOT NULL,
    "payments_made" integer DEFAULT 0 NOT NULL,
    -- each payment's identity, so a report delivered twice is counted once
    "paid_refs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "amount_minor" integer NOT NULL,
    "currency" "text" NOT NULL,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone,
    "then" "text" DEFAULT 'end'::"text" NOT NULL,
    -- what a missed payment does, as the offer said when it was bought
    "restrict" "text" DEFAULT 'immediately'::"text" NOT NULL,
    "cancel_bookings_after_minutes" integer,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "missed_at" timestamp with time zone,
    "restricted_at" timestamp with time zone,
    "bookings_cancelled_at" timestamp with time zone,
    -- when the hosts of the buyer's upcoming bookings were told of the missed payment (the sessions module)
    "hosts_told_at" timestamp with time zone,
    -- a plan change the offer's policy deferred to the end of the term
    "change_to_sku" "text",
    -- whether it pays for a membership: a plan for anything else is its own subscription, never "the plan"
    "membership" boolean DEFAULT false NOT NULL,
    "reminded_at" timestamp with time zone,
    "owed_minor" integer DEFAULT 0 NOT NULL,
    -- what it rides on and what it holds back: the local subscription, the purchase, and the
    -- source_id of the entitlements they wrote. `opened_by` makes opening one idempotent.
    "subscription_id" "text",
    "purchase_id" "uuid",
    "entitlement_source_id" "text",
    "opened_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commitments_opened_by_key" UNIQUE ("opened_by"),
    CONSTRAINT "commitments_plan_check" CHECK (("plan" = ANY (ARRAY['full'::"text", 'monthly'::"text"]))),
    CONSTRAINT "commitments_then_check" CHECK (("then" = ANY (ARRAY['end'::"text", 'monthly'::"text", 'renew'::"text"]))),
    CONSTRAINT "commitments_restrict_check" CHECK (("restrict" = ANY (ARRAY['immediately'::"text", 'after-retries'::"text", 'never'::"text"]))),
    CONSTRAINT "commitments_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'restricted'::"text", 'defaulted'::"text", 'ended'::"text"]))),
    CONSTRAINT "commitments_payments_check" CHECK ((("payments_total" >= 1) AND ("payments_made" >= 0)))
);

CREATE INDEX IF NOT EXISTS "commitments_user_idx" ON "public"."commitments" USING "btree" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "commitments_subscription_idx" ON "public"."commitments" USING "btree" ("subscription_id", "status");

ALTER TABLE ONLY "public"."commitments"
    ADD CONSTRAINT "commitments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."commitments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commitments_select_own" ON "public"."commitments" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));

-- a buyer reads their own and writes nothing: every change is the server's, from a payment report
REVOKE ALL ON TABLE "public"."commitments" FROM "anon", "authenticated";
GRANT SELECT ON TABLE "public"."commitments" TO "authenticated";
GRANT ALL ON TABLE "public"."commitments" TO "service_role";

-- holding access back, and giving it back: the entitlements the commitment's payment wrote, and its purchase
CREATE OR REPLACE FUNCTION "public"."commitment_access"("c" "public"."commitments", "p_on" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if c.entitlement_source_id is not null then
    -- the source itself, and each credit it granted (a session's or a form's, "<source>:<n>" — ledger-rules.ts)
    update public.entitlements set active = p_on
     where user_id = c.user_id and (source_id = c.entitlement_source_id or source_id like c.entitlement_source_id || ':%') and active <> p_on;
  end if;
  if c.purchase_id is not null then
    update public.purchases set status = case when p_on then 'paid' else 'suspended' end
     where id = c.purchase_id and status = case when p_on then 'suspended' else 'paid' end;
  end if;
end;
$$;

-- the commitment a subscription is paying now (a renewed term leaves its finished one behind it)
CREATE OR REPLACE FUNCTION "public"."commitment_of"("p_subscription" "text") RETURNS "public"."commitments"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select * from public.commitments
   where subscription_id = p_subscription and status in ('active', 'restricted', 'defaulted')
   order by created_at desc limit 1;
$$;

-- OPENING ONE, once: the checkout's confirmation and the provider's report both arrive, in either order
CREATE OR REPLACE FUNCTION "public"."commitment_open"("p" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare out_id uuid;
begin
  insert into public.commitments (
    user_id, sku, of_sku, plan, term_months, payments_total, payments_made, paid_refs, amount_minor, currency,
    starts_at, ends_at, "then", "restrict", cancel_bookings_after_minutes, subscription_id, purchase_id, entitlement_source_id, opened_by, membership
  ) values (
    (p->>'user_id')::uuid, p->>'sku', p->>'of_sku', p->>'plan', nullif(p->>'term_months', '')::integer,
    (p->>'payments_total')::integer, coalesce((p->>'payments_made')::integer, 0),
    coalesce(array(select jsonb_array_elements_text(p->'paid_refs')), '{}'::text[]),
    (p->>'amount_minor')::integer, coalesce(p->>'currency', 'usd'),
    coalesce((p->>'starts_at')::timestamptz, now()), (p->>'ends_at')::timestamptz,
    coalesce(p->>'then', 'end'), coalesce(p->>'restrict', 'immediately'), nullif(p->>'cancel_bookings_after_minutes', '')::integer,
    p->>'subscription_id', nullif(p->>'purchase_id', '')::uuid, p->>'entitlement_source_id', p->>'opened_by',
    coalesce((p->>'membership')::boolean, false)
  )
  on conflict ("opened_by") do update set
    purchase_id = coalesce(public.commitments.purchase_id, excluded.purchase_id),
    subscription_id = coalesce(public.commitments.subscription_id, excluded.subscription_id),
    entitlement_source_id = coalesce(public.commitments.entitlement_source_id, excluded.entitlement_source_id),
    updated_at = now()
  returning id into out_id;
  return out_id;
end;
$$;

-- A PAYMENT MADE. Counted once by its reference; a restricted commitment is restored at once. Answers
-- what the caller must do next: nothing, or (the last payment made) what follows the term.
CREATE OR REPLACE FUNCTION "public"."commitment_paid"("p_subscription" "text", "p_ref" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare c public.commitments; restored boolean := false;
begin
  select * into c from public.commitment_of(p_subscription);
  if c.id is null then return jsonb_build_object('commitment', false); end if;
  if p_ref = any (c.paid_refs) then return jsonb_build_object('commitment', true, 'counted', false, 'id', c.id); end if;
  if c.status in ('restricted', 'defaulted') or c.missed_at is not null then
    perform public.commitment_access(c, true);
    restored := c.status in ('restricted', 'defaulted');
  end if;
  update public.commitments
     set paid_refs = paid_refs || p_ref, payments_made = payments_made + 1,
         status = case when payments_made + 1 >= payments_total then 'ended' else 'active' end,
         missed_at = null, restricted_at = null, hosts_told_at = null, bookings_cancelled_at = null, owed_minor = 0, updated_at = now()
   where id = c.id
   returning * into c;
  return jsonb_build_object('commitment', true, 'counted', true, 'id', c.id, 'restored', restored,
    'finished', c.payments_made >= c.payments_total, 'then', c."then", 'user_id', c.user_id, 'sku', c.sku, 'of_sku', c.of_sku,
    'payments_made', c.payments_made, 'payments_total', c.payments_total);
end;
$$;

-- A PAYMENT MISSED. The first report of it is the one that counts; access stops at once where the offer says so.
CREATE OR REPLACE FUNCTION "public"."commitment_missed"("p_subscription" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare c public.commitments;
begin
  select * into c from public.commitment_of(p_subscription);
  if c.id is null or c.status <> 'active' then return jsonb_build_object('commitment', c.id is not null, 'newly', false); end if;
  if c.missed_at is not null then return jsonb_build_object('commitment', true, 'newly', false, 'id', c.id); end if;
  if c."restrict" = 'immediately' then perform public.commitment_access(c, false); end if;
  update public.commitments
     set missed_at = now(),
         status = case when "restrict" = 'immediately' then 'restricted' else status end,
         restricted_at = case when "restrict" = 'immediately' then now() else restricted_at end,
         updated_at = now()
   where id = c.id returning * into c;
  return jsonb_build_object('commitment', true, 'newly', true, 'id', c.id, 'restricted', c.status = 'restricted',
    'user_id', c.user_id, 'sku', c.sku, 'of_sku', c.of_sku, 'amount_minor', c.amount_minor, 'currency', c.currency);
end;
$$;

-- IN DEFAULT: the provider stopped retrying, or the subscription was ended some other way before the
-- last payment. The rest is owed and recorded; access stays off unless the offer said never.
CREATE OR REPLACE FUNCTION "public"."commitment_default"("p_subscription" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare c public.commitments;
begin
  select * into c from public.commitment_of(p_subscription);
  if c.id is null or c.status not in ('active', 'restricted') then return jsonb_build_object('commitment', c.id is not null, 'newly', false); end if;
  if c.payments_made >= c.payments_total then return jsonb_build_object('commitment', true, 'newly', false, 'id', c.id); end if;
  if c."restrict" <> 'never' then perform public.commitment_access(c, false); end if;
  update public.commitments
     set status = 'defaulted', owed_minor = (payments_total - payments_made) * amount_minor,
         missed_at = coalesce(missed_at, now()), updated_at = now()
   where id = c.id returning * into c;
  return jsonb_build_object('commitment', true, 'newly', true, 'id', c.id, 'user_id', c.user_id, 'sku', c.sku, 'of_sku', c.of_sku,
    'owed_minor', c.owed_minor, 'currency', c.currency);
end;
$$;

-- whether access from this source is being held back — so a provider's later report (a subscription
-- still "past due", which reads as live) cannot quietly give it back
CREATE OR REPLACE FUNCTION "public"."commitment_holds"("p_user" "uuid", "p_source_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.commitments
                  where user_id = p_user and entitlement_source_id = p_source_id
                    and (status = 'restricted' or (status = 'defaulted' and "restrict" <> 'never')));
$$;

-- the cancellation rule refuses while this is true: a commitment with payments still to make
CREATE OR REPLACE FUNCTION "public"."commitment_binding"("p_subscription" "text") RETURNS "public"."commitments"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select * from public.commitments
   where subscription_id = p_subscription and status in ('active', 'restricted') and payments_made < payments_total
   order by created_at desc limit 1;
$$;

REVOKE ALL ON FUNCTION "public"."commitment_access"("public"."commitments", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."commitment_access"("public"."commitments", boolean) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."commitment_of"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."commitment_of"("text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."commitment_open"("jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."commitment_open"("jsonb") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."commitment_paid"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."commitment_paid"("text", "text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."commitment_missed"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."commitment_missed"("text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."commitment_default"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."commitment_default"("text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."commitment_holds"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."commitment_holds"("uuid", "text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."commitment_binding"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."commitment_binding"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."commitment_access"("public"."commitments", boolean) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."commitment_of"("text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."commitment_open"("jsonb") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."commitment_paid"("text", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."commitment_missed"("text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."commitment_default"("text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."commitment_holds"("uuid", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."commitment_binding"("text") TO "service_role";
