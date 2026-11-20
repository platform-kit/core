-- CHECKOUTS SOMEBODY OPENED AND DID NOT FINISH (openspec: offer-checkout-page).
--
-- A buyer who opens checkout and closes it is the warmest person a site has, and until this the site
-- could not tell them from somebody who never looked. One row per checkout a signed-in person opens,
-- written by create-checkout-session. Whether it was LEFT is not stored: it is worked out from what
-- the person has since paid for — a purchase, a subscription or a commitment for that offer after the
-- row — so it holds for every payment provider alike and needs no webhook to say "expired".
--
-- A funnel reaches these people with `abandoned-checkout: <span>` (and `abandoned-offer:` to name the
-- offers), and the checkout page at /checkout with no offer named opens the reader's own latest one.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."checkouts_started" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- the way of paying chosen (a plan's or a term's own sku, or the offer's) and the offer it pays for
    "sku" "text" NOT NULL,
    "offer_sku" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checkouts_started_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "checkouts_started_user_idx" ON "public"."checkouts_started" USING "btree" ("user_id", "started_at" DESC);

ALTER TABLE ONLY "public"."checkouts_started"
    ADD CONSTRAINT "checkouts_started_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."checkouts_started" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkouts_started_select_own" ON "public"."checkouts_started" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));

REVOKE ALL ON TABLE "public"."checkouts_started" FROM "anon", "authenticated";
GRANT SELECT ON TABLE "public"."checkouts_started" TO "authenticated";
GRANT ALL ON TABLE "public"."checkouts_started" TO "service_role";

-- the person's checkouts still unfinished, the latest per offer: nothing paid for that offer since it was opened
CREATE OR REPLACE FUNCTION "public"."checkouts_left"("uid" "uuid") RETURNS TABLE("offer_sku" "text", "sku" "text", "started_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select distinct on (c.offer_sku) c.offer_sku, c.sku, c.started_at
    from public.checkouts_started c
   where c.user_id = uid
     and not exists (select 1 from public.purchases pu where pu.user_id = uid and pu.status = 'paid'
                       and pu.sku in (c.sku, c.offer_sku) and pu.created_at >= c.started_at)
     and not exists (select 1 from public.subscriptions s where s.user_id = uid
                       and s.sku in (c.sku, c.offer_sku) and s.created_at >= c.started_at)
     and not exists (select 1 from public.commitments m where m.user_id = uid
                       and m.of_sku = c.offer_sku and m.created_at >= c.started_at)
   order by c.offer_sku, c.started_at desc
$$;
REVOKE ALL ON FUNCTION "public"."checkouts_left"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."checkouts_left"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."checkouts_left"("uuid") TO "service_role";

-- the signed-in reader's own latest unfinished checkout, for the page that picks it up again
CREATE OR REPLACE FUNCTION "public"."my_checkout_left"() RETURNS TABLE("offer_sku" "text", "sku" "text", "started_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select l.offer_sku, l.sku, l.started_at from public.checkouts_left(auth.uid()) l
   where auth.uid() is not null
   order by l.started_at desc limit 1
$$;
REVOKE ALL ON FUNCTION "public"."my_checkout_left"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_checkout_left"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_checkout_left"() TO "authenticated", "service_role";
