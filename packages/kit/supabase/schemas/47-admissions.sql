-- ADMISSIONS: WHERE A PERSON STANDS WITH AN OFFER THAT GATES ITS CHECKOUT (openspec: applications-and-intro-calls).
--
-- An offer's `before` block may require an application, a call, or both before checkout opens. One row per
-- person per offer they are working through. It is its own record because it has its own lifecycle, which a
-- form response (what someone wrote), a booking (a time) and a purchase do not: it is the decision that lets
-- them pay. Every change goes through admission_move, so the status can only move along the paths below; the
-- service role writes, a person reads their own rows and an administrator reads all of them. A host of an
-- offer's call reads the applications through the admin function, which checks the catalog's hosts.
--
--   applied  → approved | open | declined          (a reviewer decides; `open` straight away under review: none)
--   approved → booked | open | declined | closed   (a required call follows an approval)
--   booked   → open | closed                       (the call is held, or the host says not a fit)
--   open     → used | closed | expired             (they pay; a reviewer closes it; an offer's open-for runs out)
--   declined | closed | expired → open | applied   (a reviewer reopens it)
--
-- An open admission stays open until it is used or closed; only an offer that sets `open-for` gives it an
-- open_until, and admission_live reads one past its time as expired whether or not the sweep has run.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."admissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- the offer's own sku (a term or a plan pays for it, and is admitted by it)
    "sku" "text" NOT NULL,
    "status" "text" NOT NULL,
    -- the application, when there is one; the call's booking uid, when one was booked
    "response_id" "uuid",
    "booking_id" "text",
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    -- the reviewer's note, sent with the decision email when written
    "note" "text",
    "open_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admissions_one_per_offer" UNIQUE ("user_id", "sku"),
    CONSTRAINT "admissions_status_check" CHECK (("status" = ANY (ARRAY['applied'::"text", 'approved'::"text", 'declined'::"text", 'booked'::"text", 'open'::"text", 'closed'::"text", 'used'::"text", 'expired'::"text"])))
);

CREATE INDEX IF NOT EXISTS "admissions_status_idx" ON "public"."admissions" USING "btree" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "admissions_sku_idx" ON "public"."admissions" USING "btree" ("sku");

ALTER TABLE ONLY "public"."admissions"
    ADD CONSTRAINT "admissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."admissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admissions_select_own" ON "public"."admissions" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));

REVOKE ALL ON TABLE "public"."admissions" FROM "anon", "authenticated";
GRANT SELECT ON TABLE "public"."admissions" TO "authenticated";
GRANT ALL ON TABLE "public"."admissions" TO "service_role";

-- the status as it stands now: an open admission past its own open_until is expired, swept or not
CREATE OR REPLACE FUNCTION "public"."admission_live"("a" "public"."admissions") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select case when a.status = 'open' and a.open_until is not null and a.open_until <= now() then 'expired' else a.status end
$$;
REVOKE ALL ON FUNCTION "public"."admission_live"("public"."admissions") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admission_live"("public"."admissions") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admission_live"("public"."admissions") TO "authenticated", "service_role";

-- the one way a status moves. Refuses a move off the paths above; `open_days` sets open_until when it opens.
CREATE OR REPLACE FUNCTION "public"."admission_move"("p_id" "uuid", "p_to" "text", "p_by" "uuid" DEFAULT NULL, "p_note" "text" DEFAULT NULL, "p_open_days" integer DEFAULT 0) RETURNS "public"."admissions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  a public.admissions;
  was text;
  ok boolean;
begin
  select * into a from public.admissions where id = p_id for update;
  if not found then raise exception 'no such admission' using errcode = 'P0002'; end if;
  was := public.admission_live(a);
  ok := case was
    when 'applied'  then p_to in ('approved', 'open', 'declined')
    when 'approved' then p_to in ('booked', 'open', 'declined', 'closed')
    when 'booked'   then p_to in ('open', 'closed')
    when 'open'     then p_to in ('used', 'closed', 'expired')
    when 'declined' then p_to in ('open', 'applied')
    when 'closed'   then p_to in ('open', 'applied')
    when 'expired'  then p_to in ('open', 'applied')
    else false end;
  if not ok then raise exception 'an admission that is % cannot become %', was, p_to using errcode = '22023'; end if;
  update public.admissions set
      status = p_to,
      decided_by = case when p_to in ('approved', 'declined', 'closed', 'open') and p_by is not null then p_by else decided_by end,
      decided_at = case when p_to in ('approved', 'declined', 'closed', 'open') and p_by is not null then now() else decided_at end,
      note = case when p_note is not null then nullif(p_note, '') else note end,
      open_until = case when p_to = 'open' then (case when coalesce(p_open_days, 0) > 0 then now() + make_interval(days => p_open_days) else null end) else open_until end,
      updated_at = now()
    where id = p_id
    returning * into a;
  return a;
end
$$;
REVOKE ALL ON FUNCTION "public"."admission_move"("uuid", "text", "uuid", "text", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admission_move"("uuid", "text", "uuid", "text", integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admission_move"("uuid", "text", "uuid", "text", integer) TO "service_role";

-- a person's application arrives: their admission for the offer starts (`applied`, or `open` under review:
-- none). One per person per offer: an application to an offer they already have an admission for only
-- refreshes the answers while it is still waiting; a declined, closed or used one is not reopened by applying.
CREATE OR REPLACE FUNCTION "public"."admission_apply"("p_user" "uuid", "p_sku" "text", "p_response" "uuid", "p_open" boolean DEFAULT false, "p_open_days" integer DEFAULT 0) RETURNS "public"."admissions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  a public.admissions;
begin
  select * into a from public.admissions where user_id = p_user and sku = p_sku for update;
  if not found then
    insert into public.admissions (user_id, sku, status, response_id, open_until)
      values (p_user, p_sku, case when p_open then 'open' else 'applied' end, p_response,
              case when p_open and coalesce(p_open_days, 0) > 0 then now() + make_interval(days => p_open_days) else null end)
      returning * into a;
  elsif a.status = 'applied' then
    update public.admissions set response_id = p_response, updated_at = now() where id = a.id returning * into a;
  end if;
  return a;
end
$$;
REVOKE ALL ON FUNCTION "public"."admission_apply"("uuid", "text", "uuid", boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admission_apply"("uuid", "text", "uuid", boolean, integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admission_apply"("uuid", "text", "uuid", boolean, integer) TO "service_role";

-- a call booked for an offer: kept on the admission. Under a required call an approved admission becomes
-- booked; under an optional one the status is left as it is.
CREATE OR REPLACE FUNCTION "public"."admission_booked"("p_user" "uuid", "p_sku" "text", "p_booking" "text", "p_required" boolean) RETURNS "public"."admissions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  a public.admissions;
begin
  select * into a from public.admissions where user_id = p_user and sku = p_sku for update;
  if not found then
    -- a required call with no application before it: booking it is the start
    if p_required then
      insert into public.admissions (user_id, sku, status, booking_id) values (p_user, p_sku, 'booked', p_booking) returning * into a;
    end if;
    return a;
  end if;
  update public.admissions set booking_id = p_booking,
      status = case when p_required and status = 'approved' then 'booked' else status end,
      updated_at = now()
    where id = a.id returning * into a;
  return a;
end
$$;
REVOKE ALL ON FUNCTION "public"."admission_booked"("uuid", "text", "text", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admission_booked"("uuid", "text", "text", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admission_booked"("uuid", "text", "text", boolean) TO "service_role";

-- whether this person may check out this offer now
CREATE OR REPLACE FUNCTION "public"."admission_open"("p_user" "uuid", "p_sku" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.admissions a where a.user_id = p_user and a.sku = p_sku and public.admission_live(a) = 'open')
$$;
REVOKE ALL ON FUNCTION "public"."admission_open"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admission_open"("uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admission_open"("uuid", "text") TO "service_role";

-- the signed-in reader's own admissions, each with its status as it stands now (the pricing card and the offer page)
CREATE OR REPLACE FUNCTION "public"."my_admissions"() RETURNS TABLE("sku" "text", "status" "text", "note" "text", "open_until" timestamp with time zone, "booked" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select a.sku, public.admission_live(a), a.note, a.open_until, a.booking_id is not null
    from public.admissions a where a.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION "public"."my_admissions"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_admissions"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_admissions"() TO "authenticated", "service_role";

-- paying uses the admission up: a purchase or a subscription for the offer, or a commitment (a term or a plan) for it
CREATE OR REPLACE FUNCTION "public"."admissions_used"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  s text;
begin
  if TG_TABLE_NAME = 'commitments' then s := NEW.of_sku;
  elsif TG_TABLE_NAME = 'purchases' and NEW.status is distinct from 'paid' then return NEW;
  else s := NEW.sku; end if;
  if NEW.user_id is null or s is null then return NEW; end if;
  update public.admissions set status = 'used', updated_at = now()
    where user_id = NEW.user_id and sku = s and status = 'open';
  return NEW;
end
$$;
REVOKE ALL ON FUNCTION "public"."admissions_used"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admissions_used"() FROM "anon", "authenticated";

DROP TRIGGER IF EXISTS "admissions_used_purchase" ON "public"."purchases";
CREATE TRIGGER "admissions_used_purchase" AFTER INSERT ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."admissions_used"();
DROP TRIGGER IF EXISTS "admissions_used_subscription" ON "public"."subscriptions";
CREATE TRIGGER "admissions_used_subscription" AFTER INSERT ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."admissions_used"();
DROP TRIGGER IF EXISTS "admissions_used_commitment" ON "public"."commitments";
CREATE TRIGGER "admissions_used_commitment" AFTER INSERT ON "public"."commitments" FOR EACH ROW EXECUTE FUNCTION "public"."admissions_used"();

-- the hourly sweep's half: an open admission past its open_until is marked expired (admission_live already reads it so)
CREATE OR REPLACE FUNCTION "public"."admissions_expire"() RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with x as (update public.admissions set status = 'expired', updated_at = now()
              where status = 'open' and open_until is not null and open_until <= now() returning 1)
  select count(*)::int from x
$$;
REVOKE ALL ON FUNCTION "public"."admissions_expire"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admissions_expire"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admissions_expire"() TO "service_role";
