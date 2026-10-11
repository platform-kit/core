-- WHAT A DISCOUNT HAS COST SO FAR.
--
-- A budget on a promotion is a promise about the future, and a promise nothing counts is a
-- decoration. The declaration says the limit; only a row can say how much of it is gone — if the
-- database were deleted and the repository redeployed, a half-spent campaign must NOT come back
-- with its budget full.
--
-- Two kinds, as Medusa has them (promotion_campaign_budget):
--   spend  — the money given away, summed
--   usage  — how many times it has been allowed, counted
--
-- The check and the increment are the same statement, for the same reason the stock decrement is:
-- two checkouts finishing together must not both be the last one under the limit.

CREATE TABLE IF NOT EXISTS "public"."promotion_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    -- the promotion's file name: its identity, which survives a retitle
    "promotion" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "limit_at" integer,
    "used" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "promotion_usage_kind_check" CHECK (("kind" = ANY (ARRAY['spend'::"text", 'usage'::"text"]))),
    CONSTRAINT "promotion_usage_used_check" CHECK (("used" >= 0))
);

-- and every time one was allowed, so a budget that has drifted can be read back
CREATE TABLE IF NOT EXISTS "public"."promotion_uses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promotion" "text" NOT NULL,
    "amount" integer DEFAULT 0 NOT NULL,
    "about" "text",
    "user_id" "uuid",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."promotion_usage" ADD CONSTRAINT "promotion_usage_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."promotion_usage" ADD CONSTRAINT "promotion_usage_promotion_key" UNIQUE ("promotion");
ALTER TABLE ONLY "public"."promotion_uses" ADD CONSTRAINT "promotion_uses_pkey" PRIMARY KEY ("id");
CREATE INDEX "promotion_uses_what_idx" ON "public"."promotion_uses" USING "btree" ("promotion", "at" DESC);
ALTER TABLE ONLY "public"."promotion_uses" ADD CONSTRAINT "promotion_uses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE "public"."promotion_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."promotion_uses" ENABLE ROW LEVEL SECURITY;

-- A SHOPPER MAY SEE WHETHER A DISCOUNT IS STILL GOING and may never write it: a page that could
-- not ask would have to offer a promotion that the checkout then refuses.
CREATE POLICY "promotion_usage_read" ON "public"."promotion_usage" FOR SELECT USING (true);
CREATE POLICY "promotion_uses_staff" ON "public"."promotion_uses" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

-- IS THERE BUDGET LEFT, AND TAKE IT — one statement, so two checkouts finishing together cannot
-- both be the last one under the limit. Returns true where it was allowed.
CREATE OR REPLACE FUNCTION "public"."promotion_take"("p_promotion" "text", "p_kind" "text", "p_limit" integer, "p_amount" integer DEFAULT 0, "p_about" "text" DEFAULT NULL, "p_user" "uuid" DEFAULT NULL)
    RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $fn$
declare took integer; add integer;
begin
  -- no limit, nothing to enforce: a promotion with no budget is simply always allowed
  if p_limit is null then
    insert into public.promotion_uses (promotion, amount, about, user_id) values (p_promotion, coalesce(p_amount, 0), p_about, p_user);
    return true;
  end if;
  add := case when p_kind = 'spend' then coalesce(p_amount, 0) else 1 end;
  insert into public.promotion_usage (promotion, kind, limit_at, used) values (p_promotion, p_kind, p_limit, 0)
  on conflict (promotion) do update set kind = excluded.kind, limit_at = excluded.limit_at;
  -- the condition is INSIDE the update: the last one under the limit is one of them, not both
  update public.promotion_usage
     set used = used + add, updated_at = now()
   where promotion = p_promotion and used + add <= p_limit
  returning 1 into took;
  if took is null then return false; end if;
  insert into public.promotion_uses (promotion, amount, about, user_id) values (p_promotion, coalesce(p_amount, 0), p_about, p_user);
  return true;
end;
$fn$;

-- and giving it back, when a payment that spent budget is refunded
CREATE OR REPLACE FUNCTION "public"."promotion_give"("p_promotion" "text", "p_kind" "text", "p_amount" integer DEFAULT 0)
    RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $fn$
begin
  update public.promotion_usage
     set used = greatest(used - (case when p_kind = 'spend' then coalesce(p_amount, 0) else 1 end), 0), updated_at = now()
   where promotion = p_promotion;
  return true;
end;
$fn$;

REVOKE ALL ON FUNCTION "public"."promotion_take"("text", "text", integer, integer, "text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."promotion_take"("text", "text", integer, integer, "text", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."promotion_take"("text", "text", integer, integer, "text", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."promotion_give"("text", "text", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."promotion_give"("text", "text", integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."promotion_give"("text", "text", integer) TO "service_role";
