-- ---------------------------------------------------------------------------------------------
-- WHO A RULE ADMITS — the one grammar every audience is written in.
--
-- A space is filled by a rule, and so is an event's audience, a bot's, an assistant's, a team's, the
-- entry to a place of the community and the network's. One grammar, read here: signed in, has paid,
-- holds a role, a tier, an entitlement, bought a product, enrolled in a course, booked a session.
-- It is every site's, so it lives in core rather than in the spaces that first needed it.
--
-- TWO OF ITS CONDITIONS ARE ANOTHER MODULE'S. Enrolments are the courses module's and bookings the
-- sessions module's, and either may be switched off. Each is asked through a function of its own,
-- declared here answering false — nobody is enrolled where there are no courses — and declared again
-- by the module that holds the table, whose file loads after this one and replaces it. Switching the
-- module off takes its declaration away, and the rule matches nobody rather than failing every read.
-- (openspec: module-switch-removes-backend)
--
-- The declared schema of core. Declarative: the file says what exists, and a plan brings a database to it.
SET check_function_bodies = false;

-- What fills a space's membership. {} is invitation only and matches nobody.
-- WHAT ONE KEY ADMITS. A key may be given one value or several, and several means ANY OF THEM —
-- `tier: inner` is that tier, `tier: [inner, outer]` is either. It reads a scalar and a list the
-- same way, so the grammar is one rule rather than a rule per key. (`role` has always worked this
-- way; `tier`, `entitlement` and `product` compared a scalar, so a list written there silently
-- matched nobody — which is worse than refusing it.)
--
-- Tiers are NOT a ladder here. A fill says which tiers it admits and nothing is implied: a rule
-- that means all three says all three. What ranks mean — an upgrade, the price you pay, what a
-- session includes — is the pricing model's business and is decided where that lives.
CREATE OR REPLACE FUNCTION "public"."space_fill_values"("p_set" "jsonb", "p_key" "text") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case jsonb_typeof(p_set -> p_key)
    when 'array' then (select coalesce(array_agg(v), '{}') from jsonb_array_elements_text(p_set -> p_key) v)
    when 'string' then array[p_set ->> p_key]
    else '{}'::text[] end;
$$;

GRANT ALL ON FUNCTION "public"."space_fill_values"("jsonb", "text") TO "authenticated", "anon", "service_role";

-- ENROLLED IN A COURSE, for a rule naming one: nobody, until the courses module declares it (46-courses.sql).
CREATE OR REPLACE FUNCTION "public"."space_fill_course"("p_user" "uuid", "p_set" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$ select false $$;
REVOKE ALL ON FUNCTION "public"."space_fill_course"("uuid", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_fill_course"("uuid", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_fill_course"("uuid", "jsonb") TO "service_role";

-- BOOKED A SESSION, for a rule naming a booking type: nobody, until the sessions module declares it (55-sessions.sql).
CREATE OR REPLACE FUNCTION "public"."space_fill_booking"("p_user" "uuid", "p_set" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$ select false $$;
REVOKE ALL ON FUNCTION "public"."space_fill_booking"("uuid", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_fill_booking"("uuid", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_fill_booking"("uuid", "jsonb") TO "service_role";

-- A WINDOW ON A CONDITION. `within_last` and `within_next` are whole minutes, written by the compile
-- from the file's own `withinLast: 7d` / `withinNext: 7d`. They are QUALIFIERS: a set carrying one
-- and nothing to hang it on is refused at the compile, so by the time a rule is here the window
-- always has a purchase or a booking under it.
--
-- Two of them rather than one because a span against a future event and a span against a past one
-- are different questions: a session a week from now and a session a week ago are both "within 7
-- days" and they are opposite rules. Written together on two alternatives they compose into one
-- continuous window round a call — in a week before, out a week after — and nobody presses anything.
--
-- A window is only ever as sharp as the sweep that asks this, which runs on a schedule. That is
-- right for access to a room and would be wrong for a licence; nothing here promises finer.
CREATE OR REPLACE FUNCTION "public"."space_fill_set_matches"("p_user" "uuid", "p_set" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when coalesce("p_set", '{}'::jsonb) = '{}'::jsonb then false else (
      -- SIGNED IN, AND NOTHING MORE. `for: authenticated` used to compile to an 'account'
      -- entitlement, which nothing has ever granted — so the one switch a site would reach for to
      -- keep anonymous visitors away from a paid model matched NOBODY. Having an id is the whole
      -- of the test.
      (not (p_set ? 'signed_in') or p_user is not null)
    and
      -- HAS EVER PAID. The ledger grants class/paid on every paid purchase and to a guest's account
      -- when it is claimed, so this needs no new data — only a name. Distinct from `product`,
      -- which asks for one particular thing.
      (not (p_set ? 'paid') or exists (
        select 1 from public.entitlements e
        where e.user_id = p_user and e.kind = 'class' and e.key = 'paid' and e.active
          and (e.expires_at is null or e.expires_at > now())))
    and
      (not (p_set ? 'role') or exists (
        select 1 from public.profiles p
        where p.id = p_user and p.roles && public.space_fill_values(p_set, 'role')))
    -- ENROLLED IN A COURSE (the courses module), and in one of its cohorts where the rule names any
    and (not (p_set ? 'course') or public.space_fill_course(p_user, p_set))
    and (not (p_set ? 'tier') or exists (
        select 1 from public.entitlements e
        where e.user_id = p_user and e.kind = 'class' and e.key = 'subscribed' and e.active
          and (e.expires_at is null or e.expires_at > now())
          and e.tier = any(public.space_fill_values(p_set, 'tier'))))
    and (not (p_set ? 'entitlement') or exists (
        select 1 from public.entitlements e
        where e.user_id = p_user and e.key = any(public.space_fill_values(p_set, 'entitlement')) and e.active
          and (e.expires_at is null or e.expires_at > now())))
    -- bought once and in for good, unless the set puts a window on it: the paid server, where the
    -- way in is a purchase rather than a subscription. The key is the offer's, which is what every
    -- purchase is attributed by. A purchase has no future, so only `within_last` applies and the
    -- compile refuses the other.
    and (not (p_set ? 'product') or exists (
        select 1 from public.purchases pu
        where pu.user_id = p_user and pu.status = 'paid' and pu.key = any(public.space_fill_values(p_set, 'product'))
          and (not (p_set ? 'within_last')
               or pu.created_at > now() - make_interval(mins => (p_set ->> 'within_last')::int))))
    -- A BOOKING, WHICH IS THE ONE CONDITION THAT LOOKS FORWARD. A booking of that type belonging to
    -- this person that was neither cancelled nor refused: `within_last` matches one that has ENDED
    -- inside the span, `within_next` one that STARTS inside it. With neither, any such booking ever.
    -- A cancelled booking is not a booking, which is why `refused` and the status are both asked.
    and (not (p_set ? 'booking') or public.space_fill_booking(p_user, p_set))
  ) end;
$$;

REVOKE ALL ON FUNCTION "public"."space_fill_set_matches"("uuid", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_fill_set_matches"("uuid", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_fill_set_matches"("uuid", "jsonb") TO "service_role";

-- A FILL MAY OFFER ALTERNATIVES, and any one of them is enough: a list of sets, true when any set
-- is. A mapping is one set and means exactly what it always meant, so nothing already written
-- changes — and an empty list, like an empty mapping, fills nobody.
--
-- It is decided here rather than at the compile because the compile writes a rule once and walks
-- away, while the sweep asks this every hour, for ever, as people's standing changes.
CREATE OR REPLACE FUNCTION "public"."space_fill_matches"("p_user" "uuid", "p_fill" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_fill is null then false
    when jsonb_typeof(p_fill) = 'array' then exists (
      select 1 from jsonb_array_elements(p_fill) s where public.space_fill_set_matches(p_user, s))
    else public.space_fill_set_matches(p_user, p_fill)
  end;
$$;

REVOKE ALL ON FUNCTION "public"."space_fill_matches"("uuid", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_fill_matches"("uuid", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_fill_matches"("uuid", "jsonb") TO "service_role";


-- AN AUDIENCE, ASKED OF THE PERSON READING: a list of ways in, any one of which is enough. An empty
-- audience is everybody; nobody signed out is in a non-empty one; the staff are always in, since an
-- audience says who a thing is FOR and was never meant to hide it from the people running it. An
-- event's audience is this and its place's entry rule (event_for_me); a bot's is this alone.
CREATE OR REPLACE FUNCTION "public"."audience_for_me"("p_audience" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when coalesce(jsonb_array_length(coalesce(p_audience, '[]'::jsonb)), 0) = 0 then true
    when auth.uid() is null then false
    when public.is_staff() then true
    else exists (select 1 from jsonb_array_elements(p_audience) one where public.space_fill_matches(auth.uid(), one))
  end;
$$;
GRANT ALL ON FUNCTION "public"."audience_for_me"("jsonb") TO "anon", "authenticated", "service_role";

-- WHO ENTERS EACH PLACE OF THE COMMUNITY (community.access and a registered place's access, projected
-- by the data script into app_settings as 'community_access': { place: [fill rule…] }). A place with
-- no rule is open to anyone signed in, as before; the staff always enter; anybody else enters when one
-- of the place's rules holds for them (space_fill_matches, the grammar a space is filled by). The
-- reads and writes of events, direct messages and notifications ask it, and a site's own place may.
-- (Here, beside the fill it asks, so every later file — the spaces' own reads below, the network,
-- the events — finds it defined.)
CREATE OR REPLACE FUNCTION "public"."community_admitted"("p_place" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare rules jsonb;
begin
  select s.value::jsonb -> p_place into rules from public.app_settings s where s.key = 'community_access';
  if rules is null or jsonb_typeof(rules) <> 'array' then return true; end if;
  if auth.uid() is null then return false; end if;
  if public.is_staff() then return true; end if;
  return exists (select 1 from jsonb_array_elements(rules) one where public.space_fill_matches(auth.uid(), one));
end;
$$;

REVOKE ALL ON FUNCTION "public"."community_admitted"("text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."community_admitted"("text") TO "authenticated", "anon", "service_role";

