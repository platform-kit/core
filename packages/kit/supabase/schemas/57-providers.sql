--
-- THE OTHER SIDE OF THE BUSINESS: people who sell their own time, and what they are owed for it.
--
-- A site's booking types are FILES, because what the business sells is part of what the business
-- is. A provider's own offering cannot be: a declaration names classes of people and never a
-- person, so a file saying "Ada's ninety minutes" would be a declaration about Ada — committed to
-- publish, and a merge conflict the moment two providers edit at once in a repository neither of
-- them has.
--
-- So it is a ROW, and being a row it needs what a file gets for free: an owner and a policy, a
-- surface of its own, an approval path where the site wants one, and a merge at the point of
-- reading, because the booking surface now has two sources. That is the whole shape of this file.
--
-- WHAT IS OWED is the same question asked of a provider selling their time and a member of staff on
-- a retainer — something happened, somebody is owed an amount — so it is one set of rules, one
-- ledger and one way of paying, and nothing here knows which of the two a person is. It is
-- deliberately apart from the store: the store is what a customer PAYS, this is what the business
-- OWES afterwards, and joining them would make every refund a question about two systems at once.
--
SET check_function_bodies = false;

-- ---------------------------------------------------------------------------------------------
-- the terms, and who has signed which version
-- ---------------------------------------------------------------------------------------------

-- A VERSION IS NEVER EDITED ONCE ANYBODY HAS SIGNED IT. A signature against text that has since
-- changed is not a signature — so a new wording is a new version, and the guard below refuses the
-- alternative rather than trusting everybody to remember. Projected from content/providers.md,
-- whose body IS the current text.
CREATE TABLE IF NOT EXISTS "public"."provider_terms" (
    "version" "text" NOT NULL,
    "body" "text" NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provider_terms_pkey" PRIMARY KEY ("version")
);

-- SIGNING IS AN ACT, so it is a row: who, which version, when. One per person per version, and a
-- person who signs v1 and later v2 has two — the history of what they agreed to, which is the whole
-- reason to keep any of this.
CREATE TABLE IF NOT EXISTS "public"."provider_terms_signed" (
    "user_id" "uuid" NOT NULL,
    "version" "text" NOT NULL,
    "signed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provider_terms_signed_pkey" PRIMARY KEY ("user_id", "version")
);
ALTER TABLE ONLY "public"."provider_terms_signed"
    ADD CONSTRAINT "provider_terms_signed_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."provider_terms_signed"
    ADD CONSTRAINT "provider_terms_signed_version_fkey" FOREIGN KEY ("version") REFERENCES "public"."provider_terms"("version") ON DELETE CASCADE;

-- the words of a version nobody has signed may still be corrected; one somebody has is frozen
CREATE OR REPLACE FUNCTION "public"."guard_terms_frozen"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.body is distinct from old.body
     and exists (select 1 from public.provider_terms_signed s where s.version = old.version) then
    raise exception 'these terms have been signed — publish a new version rather than changing this one';
  end if;
  return new;
end;
$$;
CREATE OR REPLACE TRIGGER "trg_provider_terms_frozen" BEFORE UPDATE ON "public"."provider_terms"
  FOR EACH ROW EXECUTE FUNCTION "public"."guard_terms_frozen"();

-- ---------------------------------------------------------------------------------------------
-- what a provider offers
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."provider_offerings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid" NOT NULL,
    -- its address under the person's own: /p/<username>/<slug>
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "sub" "text",
    "about" "text",
    "minutes" integer DEFAULT 60 NOT NULL,
    -- WHICH OF THEIR SETS OF HOURS this is bookable in, by name; null is their default. A name they
    -- do not keep falls back to the default rather than offering nothing, because an offering that
    -- silently stops being bookable is worse than one offered at the ordinary times.
    "schedule" "text",
    -- what it costs, in the smallest unit, as every other price in this database is held
    "price_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text" NOT NULL,
    -- where it happens, in the words the booking types already use
    "where" "text" DEFAULT 'none'::"text" NOT NULL,
    "place" "text",
    -- DRAFT is theirs alone; WAITING is a site that reads new ones first; LIVE can be bought;
    -- RETIRED can not be bought again and leaves every booking already made exactly where it is.
    "state" "text" DEFAULT 'draft'::"text" NOT NULL,
    "released_at" timestamp with time zone,
    "released_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provider_offerings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_offerings_slug_check" CHECK (("slug" ~ '^[a-z0-9][a-z0-9-]{0,48}$'::"text")),
    CONSTRAINT "provider_offerings_state_check" CHECK (("state" = ANY (ARRAY['draft'::"text", 'waiting'::"text", 'live'::"text", 'retired'::"text"]))),
    -- THE SAME FIVE WORDS A BOOKING TYPE USES (`where` in content/sessions/*.md), because an offering
    -- IS a booking type as far as everything downstream is concerned. This said 'room' once, which
    -- meant an offering in a video room came out as happening nowhere.
    CONSTRAINT "provider_offerings_where_check" CHECK (("where" = ANY (ARRAY['none'::"text", 'video'::"text", 'link'::"text", 'place'::"text", 'phone'::"text"]))),
    CONSTRAINT "provider_offerings_sane" CHECK ((("minutes" > 0) AND ("minutes" <= 1440) AND ("price_cents" >= 0)))
);
ALTER TABLE ONLY "public"."provider_offerings"
    ADD CONSTRAINT "provider_offerings_provider_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."provider_offerings"
    ADD CONSTRAINT "provider_offerings_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
-- one slug per person, so their own page has no two things at one address
CREATE UNIQUE INDEX IF NOT EXISTS "provider_offerings_slug_idx" ON "public"."provider_offerings" USING "btree" ("provider_id", "slug");
CREATE INDEX IF NOT EXISTS "provider_offerings_live_idx" ON "public"."provider_offerings" USING "btree" ("provider_id") WHERE ("state" = 'live'::"text");

-- ---------------------------------------------------------------------------------------------
-- what the business owes
-- ---------------------------------------------------------------------------------------------

-- A RULE IS A TRIGGER AND AN AMOUNT, and they mix. A person may hold any number and they all apply,
-- so "a retainer plus a share of every call" is two rows rather than a third kind of rule.
--
-- A SHARE ON A PERIOD IS REFUSED: there is no single payment for a week to be a share of, and a
-- percentage of nothing is a number nobody could explain.
CREATE TABLE IF NOT EXISTS "public"."payout_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- what fires it: every week, every month, or a booking of a named type once it has been held
    "trigger" "text" NOT NULL,
    "booking_type" "text",
    -- what it comes to: a fixed amount in the smallest unit, or a percentage of what was collected
    "amount_kind" "text" NOT NULL,
    "amount" integer NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "payout_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payout_rules_trigger_check" CHECK (("trigger" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'booking'::"text"]))),
    CONSTRAINT "payout_rules_amount_kind_check" CHECK (("amount_kind" = ANY (ARRAY['fixed'::"text", 'share'::"text"]))),
    CONSTRAINT "payout_rules_amount_check" CHECK ((("amount" > 0) AND (("amount_kind" <> 'share'::"text") OR ("amount" <= 10000)))),
    -- a booking rule names a type; a period rule does not
    CONSTRAINT "payout_rules_booking_check" CHECK ((("trigger" <> 'booking'::"text") OR ("booking_type" IS NOT NULL))),
    -- and a share of a week is refused where it is written, not discovered later
    CONSTRAINT "payout_rules_share_check" CHECK ((("amount_kind" <> 'share'::"text") OR ("trigger" = 'booking'::"text")))
);
ALTER TABLE ONLY "public"."payout_rules"
    ADD CONSTRAINT "payout_rules_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."payout_rules"
    ADD CONSTRAINT "payout_rules_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "payout_rules_user_idx" ON "public"."payout_rules" USING "btree" ("user_id") WHERE "active";

-- EVERY AMOUNT OWED IS A LINE, written when the rule fires, with the rule and the reason on it.
--
-- It would be possible to compute what somebody is owed on demand by walking bookings and rules and
-- never storing it — until a rule changes, or a price changes, or a refund lands, and last month's
-- number quietly becomes a different number. A line is written at the moment, so the past stays the
-- past and "why is this number what it is" has an answer that is a list rather than a re-derivation.
--
-- It is also why the ledger is not read out of the payment processor. The processor knows what was
-- sent. It does not know that £45 of it was a share of a call on the 4th under a rule set in
-- January.
--
-- NOTHING IS EVER EDITED. What happens to a line — it becomes payable, it is paid, it is reversed —
-- is its own stamp or its own line, so the history reads as what happened rather than as what
-- somebody last decided.
CREATE TABLE IF NOT EXISTS "public"."payout_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rule_id" "uuid",
    "amount" integer NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text" NOT NULL,
    -- what it was for, in words the person is owed can read: "Your weekly 1-on-1, 4 October"
    "about" "text" NOT NULL,
    -- and what it was for in ids, so it can be traced rather than believed
    "booking_uid" "text",
    "purchase_id" "uuid",
    "earned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- WHEN IT MAY BE SENT: the site's delay after the money was collected, so a refund inside the
    -- window reverses a line instead of chasing money already gone
    "payable_at" timestamp with time zone NOT NULL,
    "paid_at" timestamp with time zone,
    "payout_ref" "text",
    -- a reversal points at what it undoes; the line it points at is left exactly as it was
    "reverses" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payout_lines_pkey" PRIMARY KEY ("id")
);
ALTER TABLE ONLY "public"."payout_lines"
    ADD CONSTRAINT "payout_lines_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."payout_lines"
    ADD CONSTRAINT "payout_lines_rule_fkey" FOREIGN KEY ("rule_id") REFERENCES "public"."payout_rules"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."payout_lines"
    ADD CONSTRAINT "payout_lines_reverses_fkey" FOREIGN KEY ("reverses") REFERENCES "public"."payout_lines"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "payout_lines_user_idx" ON "public"."payout_lines" USING "btree" ("user_id", "earned_at" DESC);
CREATE INDEX IF NOT EXISTS "payout_lines_due_idx" ON "public"."payout_lines" USING "btree" ("payable_at") WHERE ("paid_at" IS NULL);
-- one line per rule per booking: a sweep that runs twice must not pay twice
CREATE UNIQUE INDEX IF NOT EXISTS "payout_lines_once_idx" ON "public"."payout_lines" USING "btree" ("rule_id", "booking_uid")
  WHERE ("booking_uid" IS NOT NULL AND "reverses" IS NULL);

-- WHERE THE MONEY GOES. An account of THEIR own, connected by them; the site keeps a reference and
-- never their bank details. `kind` is which of the two arrangements it was connected under — the
-- managed account the processor onboards, or an account they already had.
CREATE TABLE IF NOT EXISTS "public"."payout_accounts" (
    "user_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'stripe'::"text" NOT NULL,
    "account_id" "text" NOT NULL,
    "kind" "text" DEFAULT 'managed'::"text" NOT NULL,
    -- whether the processor says they may actually be paid yet: connecting is not the same as
    -- having finished, and somebody half way through should be told which
    "ready" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "payout_accounts_kind_check" CHECK (("kind" = ANY (ARRAY['managed'::"text", 'own'::"text"])))
);
ALTER TABLE ONLY "public"."payout_accounts"
    ADD CONSTRAINT "payout_accounts_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- who may see and who may write
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "public"."provider_terms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_terms_signed" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_offerings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payout_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payout_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payout_accounts" ENABLE ROW LEVEL SECURITY;

-- MAY PROVIDERS OFFER ANYTHING AT ALL, and does a new one wait for a person? The site's own two
-- answers, projected from content/providers.md into app_settings, which no client reads directly.
CREATE OR REPLACE FUNCTION "public"."provider_policy"("p_key" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select value from public.app_settings where key = 'provider_' || p_key;
$$;
CREATE OR REPLACE FUNCTION "public"."providers_may_offer"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(public.provider_policy('offerings'), 'off') = 'on';
$$;

-- CAN THIS PERSON SELL TODAY? Three things, and the page says which is missing rather than a single
-- no: the site allows offerings at all, they hold the role, and they have signed the CURRENT terms.
-- Where the site keeps no terms, the third is nothing to satisfy.
CREATE OR REPLACE FUNCTION "public"."provider_may_sell"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with who as (select coalesce(p_user, auth.uid()) as id),
  current as (select version from public.provider_terms order by published_at desc limit 1)
  select public.providers_may_offer()
     and exists (select 1 from public.profiles p, who
                  where p.id = who.id and ('provider' = any(p.roles) or 'coach' = any(p.roles) or 'admin' = any(p.roles)))
     and (not exists (select 1 from current)
          or exists (select 1 from public.provider_terms_signed s, who, current
                      where s.user_id = who.id and s.version = current.version));
$$;

-- the terms are public: somebody deciding whether to become a provider reads them first
CREATE POLICY "provider_terms_read" ON "public"."provider_terms" FOR SELECT TO "authenticated", "anon" USING (true);
GRANT SELECT ON TABLE "public"."provider_terms" TO "authenticated", "anon";
GRANT ALL ON TABLE "public"."provider_terms" TO "service_role";

-- a signature is the person's own act: theirs to make, theirs and the staff's to read, nobody's to
-- unmake — a signature somebody can delete is not a record of anything
CREATE POLICY "provider_signed_read" ON "public"."provider_terms_signed" FOR SELECT TO "authenticated"
  USING (("user_id" = (SELECT "auth"."uid"())) OR "public"."is_admin"());
CREATE POLICY "provider_signed_sign" ON "public"."provider_terms_signed" FOR INSERT TO "authenticated"
  WITH CHECK ("user_id" = (SELECT "auth"."uid"()));
GRANT SELECT, INSERT ON TABLE "public"."provider_terms_signed" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_terms_signed" TO "service_role";

-- AN OFFERING IS THEIRS. A reader sees the live ones; the person whose it is sees all of theirs and
-- writes them; an administrator sees everything, because somebody has to be able to answer for a
-- page with the site's name on it. The site's switch is asked on the WRITE: where a site has not
-- turned this on, no offering can be made, whatever a surface offers.
CREATE POLICY "provider_offerings_read" ON "public"."provider_offerings" FOR SELECT TO "authenticated", "anon"
  USING (("state" = 'live'::"text") OR ("provider_id" = (SELECT "auth"."uid"())) OR "public"."is_admin"());
CREATE POLICY "provider_offerings_make" ON "public"."provider_offerings" FOR INSERT TO "authenticated"
  WITH CHECK (("provider_id" = (SELECT "auth"."uid"())) AND "public"."providers_may_offer"()
    AND ("public"."has_role"('provider') OR "public"."has_role"('coach') OR "public"."is_admin"()));
CREATE POLICY "provider_offerings_edit" ON "public"."provider_offerings" FOR UPDATE TO "authenticated"
  USING (("provider_id" = (SELECT "auth"."uid"())) OR "public"."is_admin"())
  WITH CHECK (("provider_id" = (SELECT "auth"."uid"())) OR "public"."is_admin"());
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."provider_offerings" TO "authenticated";
GRANT SELECT ON TABLE "public"."provider_offerings" TO "anon";
GRANT ALL ON TABLE "public"."provider_offerings" TO "service_role";

-- AN OFFERING IS NEVER DELETED, it is retired: somebody has booked it, and a row that vanishes takes
-- the answer to "what did I pay for" with it.
CREATE OR REPLACE FUNCTION "public"."guard_offering_edit"() RETURNS "trigger"
    -- DEFINER because the guard reads the site's policy, which is not a reader's to read: provider_policy
    -- is revoked from authenticated on purpose (it is app_settings), and a guard that cannot ask it
    -- refuses every edit with a permission error instead of the rule it exists to hold.
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  /* AN OFFERING MADE LIVE is held to the same rules as one moved there: the insert is guarded too,
     or a provider could skip the reading and the terms by creating it already on sale */
  was_live boolean := tg_op = 'UPDATE' and old.state = 'live';
begin
  if auth.role() in ('anon', 'authenticated') then
    /* whose it is never moves, and releasing is an act with a name on it (provider_release) */
    if tg_op = 'UPDATE' and new.provider_id is distinct from old.provider_id then raise exception 'an offering belongs to one person'; end if;
    if (case when tg_op = 'UPDATE' then new.released_by is distinct from old.released_by or new.released_at is distinct from old.released_at
             else new.released_by is not null or new.released_at is not null end)
       and coalesce(current_setting('app.releasing', true), '') <> '1' then
      raise exception 'releasing is an act, and goes through provider_release';
    end if;
    /* a provider may put their own into any state but LIVE; a site that reads new ones first is
       read by a person, and letting the author set it would be letting them approve themselves */
    if new.state = 'live' and not was_live and not public.is_admin()
       and coalesce(public.provider_policy('approve'), 'off') = 'on' then
      raise exception 'this site reads a new offering before it can be bought';
    end if;
    /* AND NOTHING GOES ON SALE UNDER TERMS NOBODY HAS AGREED TO. This is the only thing failing to
       sign stops: a draft stays editable, what is live stays live, earnings are still paid, and calls
       already booked still happen — what cannot be done is put something NEW on sale. */
    if new.state = 'live' and not was_live and not public.provider_may_sell(new.provider_id) then
      raise exception 'the current terms have not been agreed to';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
CREATE OR REPLACE TRIGGER "trg_provider_offerings_guard" BEFORE INSERT OR UPDATE ON "public"."provider_offerings"
  FOR EACH ROW EXECUTE FUNCTION "public"."guard_offering_edit"();

-- RELEASING ONE IS AN ACT, recorded like every other act a person takes about somebody else's work.
CREATE OR REPLACE FUNCTION "public"."provider_release"("p_offering" "uuid", "p_live" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare o public.provider_offerings;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'not-yours'); end if;
  /* the guard refuses a client writing released_at or released_by, which is the point of it; this is
     the one path allowed to, and it says so for the length of the transaction alone */
  perform set_config('app.releasing', '1', true);
  select * into o from public.provider_offerings where id = p_offering;
  if not found then return jsonb_build_object('error', 'no-offering'); end if;
  update public.provider_offerings
     set state = case when p_live then 'live' else 'draft' end,
         released_at = case when p_live then now() else null end,
         released_by = case when p_live then auth.uid() else null end
   where id = p_offering;
  insert into public.space_moderation (offering_id, kind, actor_id, subject_id, note)
       values (o.id, case when p_live then 'approve' else 'refuse' end, auth.uid(), o.provider_id, o.title);
  perform set_config('app.releasing', '', true);
  return jsonb_build_object('ok', true, 'state', case when p_live then 'live' else 'draft' end);
end;
$$;
REVOKE ALL ON FUNCTION "public"."provider_release"("uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."provider_release"("uuid", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."provider_release"("uuid", boolean) TO "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."providers_may_offer"() TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."provider_may_sell"("uuid") TO "authenticated", "anon", "service_role";
REVOKE ALL ON FUNCTION "public"."provider_policy"("text") FROM PUBLIC, "authenticated", "anon";
REVOKE ALL ON FUNCTION "public"."provider_policy"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."provider_policy"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."provider_policy"("text") TO "service_role";

-- NOBODY SETS THEIR OWN PAY. The rules are an administrator's; a person reads their own and nothing
-- else, because what somebody else is paid is not their business.
CREATE POLICY "payout_rules_read" ON "public"."payout_rules" FOR SELECT TO "authenticated"
  USING (("user_id" = (SELECT "auth"."uid"())) OR "public"."is_admin"());
CREATE POLICY "payout_rules_admin" ON "public"."payout_rules" TO "authenticated"
  USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."payout_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_rules" TO "service_role";

-- THE LEDGER IS READ AND NEVER WRITTEN BY A CLIENT. Every line is written by the sweep that fires
-- the rules, under the service role; a person reads their own so they can answer "why is this
-- number what it is" for themselves.
CREATE POLICY "payout_lines_read" ON "public"."payout_lines" FOR SELECT TO "authenticated"
  USING (("user_id" = (SELECT "auth"."uid"())) OR "public"."is_admin"());
GRANT SELECT ON TABLE "public"."payout_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_lines" TO "service_role";

-- the account is theirs to see and the processor's to fill: connecting happens over there, and what
-- comes back is written by the function that handled it
CREATE POLICY "payout_accounts_read" ON "public"."payout_accounts" FOR SELECT TO "authenticated"
  USING (("user_id" = (SELECT "auth"."uid"())) OR "public"."is_admin"());
GRANT SELECT ON TABLE "public"."payout_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_accounts" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- the sweep that fires the rules, and the refund that reverses them
-- ---------------------------------------------------------------------------------------------

-- how long the money is held, in minutes, as the policy said it
CREATE OR REPLACE FUNCTION "public"."payout_delay"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select value::int from public.app_settings where key = 'provider_delay'), 43200);
$$;

-- WHAT A BOOKING EARNED THE PERSON WHO HELD IT. One line per rule, written the moment the call has
-- ended — never before, because a call that has not happened has not been earned, and a call that
-- is cancelled must leave nothing behind.
--
-- The unique index does the rest: a sweep that runs twice writes nothing the second time, which is
-- the whole reason it can be run from a cron and by hand and after a fault without anybody having
-- to think about whether it already ran.
CREATE OR REPLACE FUNCTION "public"."payouts_sweep"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer := 0; m integer; wait integer := public.payout_delay();
begin
  insert into public.payout_lines (user_id, rule_id, amount, currency, about, booking_uid, purchase_id, earned_at, payable_at)
  select r.user_id, r.id,
         case when r.amount_kind = 'share'
              then round((coalesce(pay.collected, 0) * r.amount) / 10000.0)
              else r.amount end,
         r.currency,
         coalesce(b.title, coalesce(b.type, b.event)) || ' · ' || to_char(b.end_at, 'DD Mon YYYY'),
         b.uid, pay.id, b.end_at,
         coalesce(pay.at, b.end_at) + make_interval(mins => wait)
    from public.payout_rules r
    join public.bookings b
      on coalesce(b.type, b.event) = r.booking_type
     and b.provider_id = r.user_id
     -- A CALL THAT HAPPENED. 'ended' is what a room or the webhook writes when it is over;
     -- 'accepted' is a session nothing reported the end of, whose time has simply passed. A call the
     -- PROVIDER did not come to earns nothing — one the client missed does, because the provider was
     -- there and holding the hour is the work.
     and b.status in ('accepted', 'ended') and b.refused is null
     and not (b.no_show and b.no_show_by is not distinct from b.provider_id)
     and b.end_at is not null and b.end_at <= now()
    -- WHICH PAYMENT IT WAS A SHARE OF, followed rather than guessed. A paid session grants one
    -- credit per unit and the booking records the credit it spent, so the chain from a call to the
    -- money is booking → credit → purchase and there is exactly one answer. Matching a payment to a
    -- booking by how close together they happened was tried and is wrong: two calls a client books
    -- in one afternoon both sit beside the one payment and both would claim it.
    left join lateral (
      select pu.id, pu.amount_total as collected, pu.created_at as at, pu.status
        from public.entitlements e
        join public.purchases pu
          on left(e.source_id, length(coalesce(pu.checkout_identity, pu.stripe_checkout_session_id)) + 1)
             = coalesce(pu.checkout_identity, pu.stripe_checkout_session_id) || ':'
       where e.id = b.credit_id
       order by pu.created_at desc limit 1) pay on true
    -- A PAYMENT ALREADY GIVEN BACK EARNS NOTHING. The refund landed before the call was ever
    -- swept, so there is nothing to reverse and nothing to write: writing a line and undoing it
    -- in the same breath is bookkeeping theatre. A booking that was free or came with a
    -- membership has no payment at all, and a share of it is nothing — said as a line, because
    -- the call still happened and a flat rule on it is still earned.
   where r.active and r.trigger = 'booking'
     and coalesce(pay.status, 'paid') = 'paid'
  on conflict do nothing;
  get diagnostics m = row_count; n := n + m;
  return n;
end;
$$;

-- A REFUND REVERSES WHAT IT EARNED, whenever it lands.
--
-- Inside the window the line simply never becomes payable — nothing was sent, so there is nothing
-- to put right. After it, a reversing line is written and stands against what is earned next. It is
-- in proportion, so half the payment back is half the amount back; and it is never a demand, which
-- is why nothing here writes a balance and the reading (balanceOf) floors at nothing.
CREATE OR REPLACE FUNCTION "public"."payouts_reverse"("p_purchase" "uuid", "p_refunded" integer DEFAULT NULL) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare pu public.purchases; n integer := 0; l record; back integer; part integer;
begin
  select * into pu from public.purchases where id = p_purchase;
  if not found then return 0; end if;
  back := coalesce(p_refunded, pu.amount_total, 0);
  for l in
    select pl.* from public.payout_lines pl
     where pl.purchase_id = pu.id and pl.reverses is null
       and not exists (select 1 from public.payout_lines r where r.reverses = pl.id)
  loop
    -- NOT YET PAYABLE: it never becomes so. Nothing was sent and nothing is owed back.
    if l.paid_at is null and l.payable_at > now() then
      update public.payout_lines set payable_at = 'infinity'::timestamptz where id = l.id;
      n := n + 1;
      continue;
    end if;
    part := case when coalesce(pu.amount_total, 0) <= 0 or back >= pu.amount_total then l.amount
                 else least(l.amount, round((l.amount::numeric * back) / pu.amount_total)) end;
    if part <= 0 then continue; end if;
    insert into public.payout_lines (user_id, rule_id, amount, currency, about, booking_uid, purchase_id, earned_at, payable_at, reverses)
         values (l.user_id, l.rule_id, -part, l.currency,
                 'Reversed · ' || l.about, l.booking_uid, l.purchase_id, now(), now(), l.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

REVOKE ALL ON FUNCTION "public"."payout_delay"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."payout_delay"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."payout_delay"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."payouts_sweep"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."payouts_sweep"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."payouts_sweep"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."payouts_reverse"("uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."payouts_reverse"("uuid", integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."payouts_reverse"("uuid", integer) TO "service_role";

-- WHAT SOMEBODY IS OWED, as their own page reads it and as the desk reads it about anybody. The
-- arithmetic is the same arithmetic src/lib/payouts.js does, and that is on purpose: this answers
-- the totals in one read where a list of two thousand lines would be silly, and the pure module
-- answers them again over whatever lines a page has in hand.
CREATE OR REPLACE FUNCTION "public"."payout_balance"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with who as (select coalesce(p_user, auth.uid()) as id)
  select case when (select id from who) is null
              or ((select id from who) <> auth.uid() and not public.is_admin()) then null else (
    select jsonb_build_object(
      /* A LINE A REFUND CAUGHT INSIDE THE WINDOW is not earned either: the money went back. Counted
         as earned and then nowhere else, it is a figure with no home. It is still in the lines. */
      'earned', coalesce(sum(l.amount) filter (where l.paid_at is not null or l.payable_at <> 'infinity'::timestamptz), 0),
      'payable', greatest(0, coalesce(sum(l.amount) filter (where l.paid_at is null and l.payable_at <= now()), 0)),
      'waiting', coalesce(sum(l.amount) filter (where l.paid_at is null and l.payable_at > now() and l.payable_at <> 'infinity'::timestamptz), 0),
      'sent', coalesce(sum(l.amount) filter (where l.paid_at is not null), 0),
      'currency', coalesce(min(l.currency), 'usd'),
      /* and whether anything CAN be sent: earning and being paid are two different states, and
         somebody who has not connected an account should be told which of them they are in */
      'connected', exists (select 1 from public.payout_accounts a, who where a.user_id = who.id and a.ready))
      from public.payout_lines l, who where l.user_id = who.id) end;
$$;
REVOKE ALL ON FUNCTION "public"."payout_balance"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."payout_balance"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."payout_balance"("uuid") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- a new version of the terms, and everybody who is on the old one
-- ---------------------------------------------------------------------------------------------

-- WHO NEEDS TO SIGN, and what they signed last. This is the letter's list and the surface's own
-- question in one read: a provider (or a coach, or an administrator) who has not signed the current
-- version. Somebody with no address cannot be written to and is left out of the letter, never out of
-- the list — the surface still asks them.
CREATE OR REPLACE FUNCTION "public"."provider_terms_owed"("p_version" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with want as (
    select coalesce(p_version, (select version from public.provider_terms order by published_at desc limit 1)) as version)
  select case when not public.is_admin() and auth.role() <> 'service_role' then null else
    coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'email', p.email,
      'name', coalesce(nullif(p.first_name, ''), nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
      'signed', (select s.version from public.provider_terms_signed s
                  where s.user_id = p.id order by s.signed_at desc limit 1))), '[]'::jsonb) end
    from public.profiles p, want
   where ('provider' = any(p.roles) or 'coach' = any(p.roles))
     and want.version is not null
     and not exists (select 1 from public.provider_terms_signed s where s.user_id = p.id and s.version = want.version);
$$;
REVOKE ALL ON FUNCTION "public"."provider_terms_owed"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."provider_terms_owed"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."provider_terms_owed"("text") TO "authenticated", "service_role";

-- A NEW VERSION TELLS EVERYBODY ON THE OLD ONE, the moment it lands. The projection writes the row;
-- the row asks the function; the function sends one letter each. It is a trigger rather than
-- something the projection does itself because a version may also be published from the admin, and
-- two places sending the same letter is how somebody gets it twice.
CREATE OR REPLACE FUNCTION "public"."provider_terms_published"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return null; end if;
  perform net.http_post(
    url := url || '/providers',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := jsonb_build_object('action', 'terms', 'version', new.version),
    timeout_milliseconds := 30000);
  return null;
end;
$$;
DROP TRIGGER IF EXISTS "provider_terms_published" ON "public"."provider_terms";
CREATE TRIGGER "provider_terms_published" AFTER INSERT ON "public"."provider_terms"
  FOR EACH ROW EXECUTE FUNCTION "public"."provider_terms_published"();

-- ---------------------------------------------------------------------------------------------
-- what can be booked from a provider, and whose it is
-- ---------------------------------------------------------------------------------------------

-- WHOSE AN OFFERING IS, DISCLOSED BECAUSE IT MUST BE. A profile is private until its owner says
-- otherwise, and that rule is right: a directory of everybody who ever signed up is not a thing to
-- publish on somebody's behalf. But an offering IS published — by its author and then by a person
-- who released it — and "an hour with somebody" that will not say who is not a thing anybody can
-- buy. So this names the provider of a LIVE offering whatever their profile setting says, and names
-- nothing else about them: the name they chose, the word they use for what they do, their address on
-- this site and their face. Never their email, never what they have bought, never what they earn.
--
-- It also answers the two questions a client cannot: whether the site allows offerings at all, and
-- whether each provider is on terms they have agreed to — which is why a surface asks this instead
-- of reading the table and guessing.
CREATE OR REPLACE FUNCTION "public"."provider_offerings_live"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.providers_may_offer() then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'slug', o.slug, 'title', o.title, 'sub', o.sub, 'about', o.about,
      'minutes', o.minutes, 'price_cents', o.price_cents, 'currency', o.currency, 'schedule', o.schedule,
      'where', o."where", 'place', o.place,
      'by', jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(p.display_name, ''), nullif(p.username, ''), nullif(p.first_name, '')),
        'title', nullif(p.title, ''),
        'username', p.username,
        'avatar', nullif(p.avatar, ''),
        'avatar_style', nullif(p.avatar_style, ''),
        'avatar_seed', coalesce(nullif(p.avatar_seed, ''), md5(lower(coalesce(nullif(p.email, ''), p.id::text)))),
        'avatar_options', p.avatar_options)
    ) order by p.display_name, o.title), '[]'::jsonb) end
    from public.provider_offerings o
    join public.profiles p on p.id = o.provider_id
   where o.state = 'live' and public.provider_may_sell(o.provider_id);
$$;
REVOKE ALL ON FUNCTION "public"."provider_offerings_live"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."provider_offerings_live"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."provider_offerings_live"() TO "anon", "authenticated", "service_role";

-- THE SAME, FOR ONE PERSON'S PAGE. What they have on sale, in their own order, for anybody reading
-- their page — and nothing when they have none, which is not the same as their page not existing.
CREATE OR REPLACE FUNCTION "public"."provider_offerings_of"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.providers_may_offer() then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'slug', o.slug, 'title', o.title, 'sub', o.sub, 'about', o.about,
      'minutes', o.minutes, 'price_cents', o.price_cents, 'currency', o.currency,
      'where', o."where", 'place', o.place) order by o.title), '[]'::jsonb) end
    from public.provider_offerings o
    join public.profiles p on p.id = o.provider_id
   where lower(p.username) = lower(btrim(p_username))
     and o.state = 'live' and public.provider_may_sell(o.provider_id);
$$;
REVOKE ALL ON FUNCTION "public"."provider_offerings_of"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."provider_offerings_of"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."provider_offerings_of"("text") TO "anon", "authenticated", "service_role";

-- WHERE A PROVIDER STANDS, in one read, because a surface needs all of it at once and none of it is
-- a client's to work out: whether the site allows offerings at all, whether it reads new ones first,
-- the current terms and whether they have signed them, and so whether they may sell today. The
-- policy itself (app_settings) stays unreadable to a browser; this answers the questions, not the
-- settings.
CREATE OR REPLACE FUNCTION "public"."provider_standing"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as id),
  current as (select version, body from public.provider_terms order by published_at desc limit 1)
  select case when (select id from me) is null then null else jsonb_build_object(
    'offerings', public.providers_may_offer(),
    'approve', coalesce(public.provider_policy('approve'), 'off') = 'on',
    'provider', exists (select 1 from public.profiles p, me
                         where p.id = me.id and ('provider' = any(p.roles) or 'coach' = any(p.roles) or 'admin' = any(p.roles))),
    'may_sell', public.provider_may_sell(),
    'terms', (select case when c.version is null then null else jsonb_build_object(
        'version', c.version, 'body', c.body,
        'signed', (select s.signed_at from public.provider_terms_signed s, me where s.user_id = me.id and s.version = c.version),
        /* what they last agreed to, so the ask can say what changed rather than starting from nothing */
        'signed_before', (select s.version from public.provider_terms_signed s, me where s.user_id = me.id order by s.signed_at desc limit 1))
      end from current c)) end;
$$;
REVOKE ALL ON FUNCTION "public"."provider_standing"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."provider_standing"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."provider_standing"() TO "authenticated", "service_role";
