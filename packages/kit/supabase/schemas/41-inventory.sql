-- WHAT IS LEFT, AND WHY NONE OF IT IS IN A FILE.
--
-- If the database were deleted and the repository redeployed, the count must NOT come back as
-- five. A file may say a variant is TRACKED; only a row says HOW MANY. That is the project's own
-- declaration rule applied to stock, and it is the whole reason there is no `stock:` frontmatter
-- field for anybody to write.
--
-- Three stored numbers and no fourth. `available` is stocked less reserved, and it is DERIVED
-- every time it is asked for — never a column, because a stored total and the rows it is a total
-- of are two sources that disagree the first time anything goes wrong, and the one that is wrong
-- is the one every page reads. Shopify stores eight names and makes `committed` unwritable even
-- by its own API, which is what owning a derived number costs.
--
-- A reservation is a ROW with an owner and an expiry, not a hidden bucket. Checkout holds nothing
-- for us — Stripe's session has an `expires_at` and emits `checkout.session.expired`, and that is
-- the only hook there is — so the reservation is ours to write when the session is made and ours
-- to release when the event says the session died. Without that, one abandoned basket holds the
-- last unit for a day.
--
-- Every change to a count writes a MOVEMENT saying why. A count that drifted with no record of
-- how is a count nobody can correct with any confidence.

CREATE TABLE IF NOT EXISTS "public"."inventory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    -- the offer and the shape, as the catalog names them: the variant key, empty for an offer
    -- with no options. Never a foreign key — the offers are files, and a row must survive a file
    -- being renamed as every other purchase record does.
    "sku" "text" NOT NULL,
    "variant" "text" DEFAULT ''::"text" NOT NULL,
    "stocked" integer DEFAULT 0 NOT NULL,
    "reserved" integer DEFAULT 0 NOT NULL,
    "incoming" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- NO CHECK ON `stocked`, deliberately. A shop selling past zero (`backorder` on the file)
    -- is owed units by its own supplier, and MINUS THREE is what that is. Refusing to store it
    -- would mean the count read zero while three people waited, which is the number nobody
    -- could act on. Non-negativity is enforced by `inventory_take` instead, where it belongs:
    -- it is a rule about a SALE, not about the number.
    CONSTRAINT "inventory_reserved_check" CHECK (("reserved" >= 0)),
    CONSTRAINT "inventory_incoming_check" CHECK (("incoming" >= 0))
);

-- WHY EVERY CHANGE MOVED, kept as its own row. `reason` is a closed list because a free-text
-- reason is a reason nobody can count.
CREATE TABLE IF NOT EXISTS "public"."inventory_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sku" "text" NOT NULL,
    "variant" "text" DEFAULT ''::"text" NOT NULL,
    "delta" integer NOT NULL,
    "field" "text" DEFAULT 'stocked'::"text" NOT NULL,
    "reason" "text" NOT NULL,
    "note" "text",
    "about" "text",            -- the checkout session, the purchase, the fulfilment: what it was for
    "by" "uuid",               -- the administrator who adjusted it by hand; null for the machine
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inventory_movements_field_check" CHECK (("field" = ANY (ARRAY['stocked'::"text", 'reserved'::"text", 'incoming'::"text"]))),
    CONSTRAINT "inventory_movements_reason_check" CHECK (("reason" = ANY (ARRAY['received'::"text", 'sold'::"text", 'reserved'::"text", 'released'::"text", 'returned'::"text", 'refunded'::"text", 'adjusted'::"text", 'damaged'::"text", 'counted'::"text"])))
);

ALTER TABLE ONLY "public"."inventory" ADD CONSTRAINT "inventory_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."inventory" ADD CONSTRAINT "inventory_sku_variant_key" UNIQUE ("sku", "variant");
ALTER TABLE ONLY "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id");
CREATE INDEX "inventory_movements_what_idx" ON "public"."inventory_movements" USING "btree" ("sku", "variant", "at" DESC);
CREATE INDEX "inventory_movements_about_idx" ON "public"."inventory_movements" USING "btree" ("about") WHERE ("about" IS NOT NULL);
ALTER TABLE ONLY "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_by_fkey" FOREIGN KEY ("by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE "public"."inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."inventory_movements" ENABLE ROW LEVEL SECURITY;

-- A SHOPPER MAY SEE WHAT IS LEFT AND MAY NEVER WRITE IT. Reading is how a card says "sold out"
-- without a round trip through a function; every write is the service role's, through the
-- functions below, because a count a client can set is not a count.
CREATE POLICY "inventory_read" ON "public"."inventory" FOR SELECT USING (true);
CREATE POLICY "inventory_movements_staff" ON "public"."inventory_movements" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

-- available is DERIVED, here, once, so that nothing else is tempted to store it
CREATE OR REPLACE FUNCTION "public"."inventory_available"("p_sku" "text", "p_variant" "text" DEFAULT ''::"text") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select greatest(coalesce(i.stocked, 0) - coalesce(i.reserved, 0), 0)
    from public.inventory i where i.sku = p_sku and i.variant = coalesce(p_variant, '')
$$;

-- THE DECREMENT IS THE SAME STATEMENT AS THE SALE, not a read and then a write. Two sessions
-- buying the last unit at the same instant both read "1 left" and both write "0" if this is two
-- statements; as one UPDATE with the condition in its WHERE, the second matches no row and the
-- sale fails, which is the only correct outcome.
--
-- Returns true where it took the units, false where there were not enough — never an exception,
-- because the caller's job is to refuse the checkout politely, and `allow_backorder` means the
-- caller may not care.
CREATE OR REPLACE FUNCTION "public"."inventory_take"("p_sku" "text", "p_variant" "text", "p_qty" integer, "p_reason" "text", "p_about" "text" DEFAULT NULL, "p_backorder" boolean DEFAULT false)
    RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare took integer;
begin
  if p_qty is null or p_qty <= 0 then return true; end if;
  if p_reason = 'reserved' then
    -- a reservation RAISES reserved, and may not take more than is available
    update public.inventory set reserved = reserved + p_qty, updated_at = now()
     where sku = p_sku and variant = coalesce(p_variant, '')
       and stocked - reserved >= p_qty
    returning 1 into took;
  else
    -- a sale LOWERS stocked and releases the reservation it was holding, in one statement
    -- a sale LOWERS stocked and releases the reservation it was holding, in one statement.
    -- The condition is INSIDE the update, which is the whole point: two sessions racing for
    -- the last unit cannot both match. With backorder on there is no condition — the count
    -- goes negative and that negative is what the shop owes.
    update public.inventory
       set stocked = stocked - p_qty,
           reserved = greatest(reserved - p_qty, 0),
           updated_at = now()
     where sku = p_sku and variant = coalesce(p_variant, '') and (p_backorder or stocked >= p_qty)
    returning 1 into took;
  end if;
  if took is null then return false; end if;
  insert into public.inventory_movements (sku, variant, delta, field, reason, about)
       values (p_sku, coalesce(p_variant, ''), case when p_reason = 'reserved' then p_qty else -p_qty end,
               case when p_reason = 'reserved' then 'reserved' else 'stocked' end, p_reason, p_about);
  return true;
end;
$$;

-- GIVING IT BACK: a released reservation, a refund before dispatch, a return. Always succeeds —
-- putting stock back is never refused — and always says why.
CREATE OR REPLACE FUNCTION "public"."inventory_give"("p_sku" "text", "p_variant" "text", "p_qty" integer, "p_reason" "text", "p_about" "text" DEFAULT NULL)
    RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_qty is null or p_qty <= 0 then return true; end if;
  if p_reason = 'released' then
    update public.inventory set reserved = greatest(reserved - p_qty, 0), updated_at = now()
     where sku = p_sku and variant = coalesce(p_variant, '');
    insert into public.inventory_movements (sku, variant, delta, field, reason, about)
         values (p_sku, coalesce(p_variant, ''), -p_qty, 'reserved', 'released', p_about);
  else
    insert into public.inventory (sku, variant, stocked) values (p_sku, coalesce(p_variant, ''), p_qty)
    on conflict (sku, variant) do update set stocked = public.inventory.stocked + p_qty, updated_at = now();
    insert into public.inventory_movements (sku, variant, delta, field, reason, about)
         values (p_sku, coalesce(p_variant, ''), p_qty, 'stocked', p_reason, p_about);
  end if;
  return true;
end;
$$;

-- AN ADMINISTRATOR SETS A COUNT, and the movement records the difference rather than the new
-- total: a stock take that says "now 40" is useless; "found 3 more" is what can be investigated.
CREATE OR REPLACE FUNCTION "public"."inventory_set"("p_sku" "text", "p_variant" "text", "p_stocked" integer, "p_note" "text" DEFAULT NULL)
    RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare was integer; diff integer;
begin
  if not public.is_admin() then raise exception 'only an administrator may set a count'; end if;
  if p_stocked is null or p_stocked < 0 then raise exception 'a count cannot be negative'; end if;
  select stocked into was from public.inventory where sku = p_sku and variant = coalesce(p_variant, '');
  insert into public.inventory (sku, variant, stocked) values (p_sku, coalesce(p_variant, ''), p_stocked)
  on conflict (sku, variant) do update set stocked = p_stocked, updated_at = now();
  diff := p_stocked - coalesce(was, 0);
  if diff <> 0 then
    insert into public.inventory_movements (sku, variant, delta, field, reason, note, by)
         values (p_sku, coalesce(p_variant, ''), diff, 'stocked', 'counted', p_note, auth.uid());
  end if;
  return diff;
end;
$$;

-- A HOLD THAT NOTHING CAME BACK FOR.
--
-- A reservation is released when Stripe says the checkout expired, and that is the right hook —
-- but it is ONE hook, arriving from outside, and everything about it can fail: the webhook
-- secret unset, the endpoint down past Stripe's retries, the event never configured. A hold
-- that is never released is permanent, and because `available` is stocked less reserved, the
-- shop simply stops selling the thing. Silently, and in the direction nobody notices.
--
-- So the hook is the fast path and this is the floor. A Stripe session lives at most 24 hours,
-- so a hold older than that is dead whatever happened, and giving it back can only ever be
-- right. It writes a movement saying `released` like any other, so a count that moved this way
-- can be read back rather than wondered about.
CREATE OR REPLACE FUNCTION "public"."inventory_sweep"("p_hours" integer DEFAULT 26) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record; n integer := 0;
begin
  for r in
    -- what each dead session still holds: its reservations less anything released or sold
    select m.sku, m.variant, m.about,
           sum(case when m.reason = 'reserved' then m.delta else -abs(m.delta) end) as held
      from public.inventory_movements m
     where m.field = 'reserved' or m.reason in ('reserved', 'released', 'sold')
       and m.about is not null
     group by m.sku, m.variant, m.about
    having sum(case when m.reason = 'reserved' then m.delta else -abs(m.delta) end) > 0
       and max(m.at) < now() - make_interval(hours => p_hours)
  loop
    perform public.inventory_give(r.sku, r.variant, r.held::integer, 'released', r.about);
    n := n + 1;
  end loop;
  return n;
end;
$$;

REVOKE ALL ON FUNCTION "public"."inventory_sweep"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."inventory_sweep"(integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."inventory_sweep"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."inventory_take"("text", "text", integer, "text", "text", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."inventory_take"("text", "text", integer, "text", "text", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."inventory_take"("text", "text", integer, "text", "text", boolean) TO "service_role";
REVOKE ALL ON FUNCTION "public"."inventory_give"("text", "text", integer, "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."inventory_give"("text", "text", integer, "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."inventory_give"("text", "text", integer, "text", "text") TO "service_role";
-- a shopper asks what is left, so this one is open on purpose
GRANT EXECUTE ON FUNCTION "public"."inventory_available"("text", "text") TO "anon", "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."inventory_set"("text", "text", integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."inventory_set"("text", "text", integer, "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."inventory_set"("text", "text", integer, "text") TO "authenticated", "service_role";
