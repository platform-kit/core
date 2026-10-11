SET check_function_bodies = false;

-- ---------------------------------------------------------------------------------------------
-- WHAT IS ON. An event is a thing that HAPPENS and that people attend; a booking type is a thing
-- somebody books a slot of. They are not the same shape and neither is the other's special case —
-- a weekly group call happens at seven whether or not you come, while a private session exists
-- only once somebody picks a time. A community shows both, side by side, because that is the
-- question a member is asking: what is on, and what can I book.
--
-- The tables are the CALENDAR rather than the events, because the name events was taken long ago by the
-- analytics — what a page records. An event is a FILE (content/events/*.md). Its occurrences are DERIVED — expanded from the
-- repeat by build/events.mjs over a rolling window and rewritten whenever the file changes, so
-- nobody edits one. What is state, and lives only here: who is coming, and an occurrence called
-- off or moved.

CREATE TABLE IF NOT EXISTS "public"."calendar_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "space_id" "uuid",
    "channel_id" "uuid",
    "title" "text" NOT NULL,
    "sub" "text",
    "body" "text",
    "cover" "text",
    -- who it is for, in the same grammar a space's membership is filled by (any one is enough), so
    -- a site has one way of saying "members of tier two" rather than two
    "audience" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    -- a declaration names classes of people, never a person: an event says which ROLE hosts it and
    -- the database says who that turned out to be
    "host_role" "text",
    -- WHO IS RUNNING IT. One or more people, as the file names them — a role every holder of which
    -- hosts, or a person by their address. host_role above is the older single-role form and is
    -- kept: a file that says `host: coach` still works, and compiles into here as one entry.
    "hosts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    -- where it happens: a huddle on this site, a link, a place, or nowhere in particular
    "place" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "capacity" integer,
    "rsvp" boolean DEFAULT true NOT NULL,
    -- WHICH ANSWERS ARE OFFERED. A class takes yes or no; a D&D night wants maybe, because a table
    -- of five needs to know who is wavering. Empty means the lot.
    "rsvp_answers" text[] DEFAULT '{}'::text[] NOT NULL,
    -- and whether somebody may say WHY, which is the difference between "3 going" and knowing that
    -- two of them are bringing a friend and one cannot make the first half
    "rsvp_reason" boolean DEFAULT false NOT NULL,
    -- WHETHER WHO IS COMING IS PUBLIC: off | going (the list of people going) | hosts.
    -- Where it is shown it is FIRST NAME AND LAST INITIAL and nothing else — never a full name and
    -- never an address. "Who else is coming" is a fair thing to want to know; a roster of everybody
    -- who turned up to a recovery meeting, with their surnames, is not a thing to publish by
    -- default, and a default is what most sites will keep.
    "rsvp_list" "text" DEFAULT 'off'::"text" NOT NULL,
    -- WHO MAY SAY SOMETHING ON IT: off | everyone | members | hosts
    "comments" "text" DEFAULT 'members'::"text" NOT NULL,
    -- WHAT IT COSTS, where it costs anything: { price, currency, sku }. An event with a cost is a
    -- thing somebody buys, and what it takes to turn up — the address, the link — is not shown
    -- until they have. A listing anybody can read is not the same as a door anybody can walk through.
    "cost" "jsonb",
    -- the picture on a card, one smaller for a dense row, more of them to look through, and one
    -- track or a playlist — the same `media` an article carries, played by the same component
    "thumb" "text",
    "gallery" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "media" "jsonb",
    -- the repeat, exactly as the file wrote it (lib/recurrence.js is the one thing that reads it)
    "repeats" "jsonb",
    "starts_at" timestamp with time zone,   -- a one-off; null where it repeats
    "ends_at" timestamp with time zone,
    "zone" "text",
    "order" integer DEFAULT 0 NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "calendar_events_when_check" CHECK ((("repeats" IS NOT NULL) OR ("starts_at" IS NOT NULL))),
    CONSTRAINT "calendar_events_capacity_check" CHECK ((("capacity" IS NULL) OR ("capacity" > 0)))
);

CREATE TABLE IF NOT EXISTS "public"."calendar_occurrences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    -- one occurrence called off, or moved: an act, kept here because no file says it
    "cancelled_at" timestamp with time zone,
    "note" "text",
    -- the huddle this occurrence opens in, minted when the first person arrives
    "room" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."calendar_rsvps" (
    "occurrence_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "state" "text" DEFAULT 'going'::"text" NOT NULL,
    "guests" integer DEFAULT 0 NOT NULL,
    "reminded_at" timestamp with time zone,
    "attended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- what they said about it, where the event asks: "bringing a friend", "only the second half"
    "reason" "text",
    CONSTRAINT "calendar_rsvps_state_check" CHECK (("state" = ANY (ARRAY['going'::"text", 'interested'::"text", 'out'::"text"]))),
    CONSTRAINT "calendar_rsvps_guests_check" CHECK ((("guests" >= 0) AND ("guests" <= 10)))
);

ALTER TABLE ONLY "public"."calendar_events" ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."calendar_events" ADD CONSTRAINT "calendar_events_slug_key" UNIQUE ("slug");
ALTER TABLE ONLY "public"."calendar_occurrences" ADD CONSTRAINT "calendar_occurrences_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."calendar_occurrences" ADD CONSTRAINT "calendar_occurrences_once" UNIQUE ("event_id", "starts_at");
ALTER TABLE ONLY "public"."calendar_rsvps" ADD CONSTRAINT "calendar_rsvps_pkey" PRIMARY KEY ("occurrence_id", "user_id");

ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."calendar_occurrences"
    ADD CONSTRAINT "calendar_occurrences_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."calendar_rsvps"
    ADD CONSTRAINT "calendar_rsvps_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "public"."calendar_occurrences"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."calendar_rsvps"
    ADD CONSTRAINT "calendar_rsvps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "calendar_events_space_idx" ON "public"."calendar_events" USING "btree" ("space_id") WHERE ("published" = true);
CREATE INDEX IF NOT EXISTS "calendar_occurrences_when_idx" ON "public"."calendar_occurrences" USING "btree" ("starts_at");
CREATE INDEX IF NOT EXISTS "calendar_rsvps_user_idx" ON "public"."calendar_rsvps" USING "btree" ("user_id");

ALTER TABLE ONLY "public"."calendar_occurrences" REPLICA IDENTITY FULL;
ALTER TABLE ONLY "public"."calendar_rsvps" REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------------------------
-- WHO IT IS FOR. The same predicate a space's membership is filled by, asked of one audience:
-- a list of ways in, any one of which is enough. An empty audience is everybody.

CREATE OR REPLACE FUNCTION "public"."event_for_me"("p_audience" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    -- the Events place may carry an entry rule of its own (community.access.events), before any audience
    when not public.community_admitted('events') then false
    when coalesce(jsonb_array_length(coalesce(p_audience, '[]'::jsonb)), 0) = 0 then true
    when auth.uid() is null then false
    -- WHOEVER RUNS THE PLACE SEES WHAT IS ON IN IT. An audience says who an event is FOR; it was
    -- never meant to hide the calendar from the people arranging it, and a community home that is
    -- empty for its own staff is a community home nobody on the staff ever opens. The same escape
    -- the capabilities have (space_may), for the same reason.
    when public.is_staff() then true
    else exists (
      select 1 from jsonb_array_elements(p_audience) one
       where public.space_fill_matches(auth.uid(), one))
  end;
$$;

-- ---------------------------------------------------------------------------------------------
-- WHAT IS ON, for a person: every occurrence of every event they may attend, in a window, with
-- what it is, where it is, who is coming and what they themselves said. One read, because a
-- community's home asks this question on every visit.

CREATE OR REPLACE FUNCTION "public"."events_upcoming"("p_space" "uuid" DEFAULT NULL::"uuid", "p_days" integer DEFAULT 60, "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', o.id, 'event', e.id, 'slug', e.slug, 'title', e.title, 'sub', e.sub, 'cover', e.cover,
      'space', e.space_id, 'channel', e.channel_id, 'body', e.body,
      'starts_at', o.starts_at, 'ends_at', o.ends_at, 'cancelled_at', o.cancelled_at, 'note', o.note,
      'place', e.place, 'capacity', e.capacity, 'rsvp', e.rsvp, 'host_role', e.host_role,
      'zone', e.zone, 'repeats', e.repeats,
      'going', (select count(*) from public.calendar_rsvps r where r.occurrence_id = o.id and r.state = 'going'),
      'interested', (select count(*) from public.calendar_rsvps r where r.occurrence_id = o.id and r.state = 'interested'),
      'mine', (select r.state from public.calendar_rsvps r where r.occurrence_id = o.id and r.user_id = auth.uid()),
      -- who is coming, by name, for the faces a community shows: the people of a space are already
      -- known to each other, so this discloses nothing the directory does not
      'who', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1))))
                         from public.calendar_rsvps r join public.profiles p on p.id = r.user_id
                        where r.occurrence_id = o.id and r.state = 'going' limit 8), '[]'::jsonb)
    ) as x
    from public.calendar_occurrences o
    join public.calendar_events e on e.id = o.event_id
   where e.published
     and (p_space is null or e.space_id = p_space)
     and o.starts_at >= now() - interval '2 hours'
     and o.starts_at < now() + make_interval(days => greatest(p_days, 1))
     and public.event_for_me(e.audience)
     and (e.space_id is null or public.in_space(e.space_id))
   order by o.starts_at
   limit greatest(p_limit, 1)) t;
$$;

-- what somebody has said they are coming to, wherever it is: the "your events" list
CREATE OR REPLACE FUNCTION "public"."events_mine"("p_days" integer DEFAULT 90) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'event', e.id, 'slug', e.slug, 'title', e.title, 'space', e.space_id,
      'starts_at', o.starts_at, 'ends_at', o.ends_at, 'cancelled_at', o.cancelled_at,
      'place', e.place, 'state', r.state
    ) order by o.starts_at), '[]'::jsonb)
    from public.calendar_rsvps r
    join public.calendar_occurrences o on o.id = r.occurrence_id
    join public.calendar_events e on e.id = o.event_id
   where r.user_id = auth.uid() and r.state <> 'out'
     and o.starts_at < now() + make_interval(days => greatest(p_days, 1))
     and o.starts_at >= now() - interval '2 hours';
$$;

-- ---------------------------------------------------------------------------------------------
-- SAYING YOU ARE COMING. Through a function rather than a policy, because three things have to be
-- true at once and only the database knows all of them: the event is for this person, the
-- occurrence has not been called off, and the room is not already full. A full event answers
-- `full` rather than refusing silently.

CREATE OR REPLACE FUNCTION "public"."event_rsvp"("p_occurrence" "uuid", "p_state" "text" DEFAULT 'going'::"text", "p_guests" integer DEFAULT 0, "p_reason" "text" DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare e public.calendar_events; o public.calendar_occurrences; n integer;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign-in'); end if;
  if p_state not in ('going', 'interested', 'out') then return jsonb_build_object('error', 'state'); end if;
  select * into o from public.calendar_occurrences where id = p_occurrence;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  select * into e from public.calendar_events where id = o.event_id and published;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  if not public.event_for_me(e.audience) then return jsonb_build_object('error', 'not-for-you'); end if;
  if o.cancelled_at is not null and p_state = 'going' then return jsonb_build_object('error', 'cancelled'); end if;
  if e.capacity is not null and p_state = 'going' then
    select count(*) + coalesce(sum(guests), 0) into n from public.calendar_rsvps
     where occurrence_id = p_occurrence and state = 'going' and user_id <> auth.uid();
    if n + 1 + greatest(p_guests, 0) > e.capacity then return jsonb_build_object('error', 'full', 'going', n); end if;
  end if;
  -- the reason rides on the answer rather than being a second thing to press. A file that does not
  -- ask for one never sends one, and an answer given with no reason does not wipe one already there.
  insert into public.calendar_rsvps (occurrence_id, user_id, state, guests, reason)
       values (p_occurrence, auth.uid(), p_state, greatest(coalesce(p_guests, 0), 0), nullif(trim(coalesce(p_reason, '')), ''))
  on conflict (occurrence_id, user_id) do update set state = excluded.state, guests = excluded.guests,
       reason = coalesce(excluded.reason, public.calendar_rsvps.reason), updated_at = now();
  return jsonb_build_object('ok', true, 'state', p_state,
    'going', (select count(*) from public.calendar_rsvps where occurrence_id = p_occurrence and state = 'going'));
end;
$$;

-- an occurrence called off, or a word about it: whoever keeps the space, and nobody else
CREATE OR REPLACE FUNCTION "public"."event_occurrence_set"("p_occurrence" "uuid", "p_cancelled" boolean DEFAULT NULL::boolean, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare sp uuid;
begin
  select e.space_id into sp from public.calendar_occurrences o join public.calendar_events e on e.id = o.event_id where o.id = p_occurrence;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  if not (public.is_staff() or (sp is not null and public.space_may(
      (select id from public.channels where space_id = sp limit 1), 'moderate'))) then
    return jsonb_build_object('error', 'not-yours');
  end if;
  update public.calendar_occurrences
     set cancelled_at = case when p_cancelled is null then cancelled_at when p_cancelled then now() else null end,
         note = coalesce(p_note, note)
   where id = p_occurrence;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- WHO MAY READ WHAT. An event is as open as its audience says; an occurrence goes with its event;
-- an RSVP is the person's own, and the counts everybody sees come from the reads above.

ALTER TABLE "public"."calendar_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."calendar_occurrences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."calendar_rsvps" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_events_select" ON "public"."calendar_events" FOR SELECT TO "authenticated", "anon"
  USING (("published" = true) AND "public"."event_for_me"("audience")
    AND (("space_id" IS NULL) OR "public"."in_space"("space_id")));
CREATE POLICY "calendar_occurrences_select" ON "public"."calendar_occurrences" FOR SELECT TO "authenticated", "anon"
  USING (EXISTS (SELECT 1 FROM "public"."calendar_events" e WHERE e."id" = "event_id" AND e."published"
    AND "public"."event_for_me"(e."audience") AND ((e."space_id" IS NULL) OR "public"."in_space"(e."space_id"))));
CREATE POLICY "calendar_rsvps_select_own" ON "public"."calendar_rsvps" FOR SELECT TO "authenticated"
  USING (("user_id" = ( SELECT "auth"."uid"())) OR "public"."is_staff"());
-- writing one goes through event_rsvp(), which is the only thing that knows all three rules
CREATE POLICY "calendar_rsvps_delete_own" ON "public"."calendar_rsvps" FOR DELETE TO "authenticated"
  USING ("user_id" = ( SELECT "auth"."uid"()));

-- the projection is written by the build alone (service role); a client never writes one
GRANT SELECT ON TABLE "public"."calendar_events" TO "anon", "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";
GRANT SELECT ON TABLE "public"."calendar_occurrences" TO "anon", "authenticated";
GRANT ALL ON TABLE "public"."calendar_occurrences" TO "service_role";
GRANT SELECT, DELETE ON TABLE "public"."calendar_rsvps" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_rsvps" TO "service_role";

GRANT ALL ON FUNCTION "public"."event_for_me"("jsonb") TO "anon", "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."events_upcoming"("uuid", integer, integer) TO "anon", "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."events_mine"(integer) TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."event_rsvp"("uuid", "text", integer, "text") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."event_occurrence_set"("uuid", boolean, "text") TO "authenticated", "service_role";


-- ---------------------------------------------------------------------------------------------
-- ONE EVENT, WHOLE — for its own page. What it is, when it next runs, where, who is running it,
-- who is coming, and what has been said about it. One read, because a page asks all of it at once.
-- A PERSON, NAMED AS LITTLE AS THE PLACE ALLOWS: "Ada L." — a first name and a last initial.
-- Used wherever a list of people is shown to people who are not the staff: who is coming to an
-- event, and anywhere else a file says a list is public. Somebody who says they are coming to a
-- yoga class has not agreed to appear in a published list of people who go to it, and a first
-- name with an initial is enough for a member to recognise a friend and not enough for a stranger
-- to find them.
CREATE OR REPLACE FUNCTION "public"."short_name"("p_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when coalesce(trim(p_name), '') = '' then null
    when array_length(regexp_split_to_array(trim(p_name), '\s+'), 1) = 1 then trim(p_name)
    else (regexp_split_to_array(trim(p_name), '\s+'))[1] || ' '
      || upper(left((regexp_split_to_array(trim(p_name), '\s+'))[array_length(regexp_split_to_array(trim(p_name), '\s+'), 1)], 1)) || '.'
  end;
$$;

-- WHAT A PERSON SEES ON AN EVENT'S OWN PAGE.
--
-- Everything the page draws, in one read, and two fences inside it:
--
--   WHO MAY SEE IT AT ALL is the event's audience (event_for_me) — the same list of ways in a
--   space's fill takes, so an event is public, or for members, or for one tier, by saying so.
--
--   WHO MAY SEE WHAT IT TAKES TO TURN UP is a second question. An event with a COST is a thing
--   somebody buys, and the address or the joining link is the thing they are buying: a listing
--   anybody can read is not the same as a door anybody can walk through. So the place is returned
--   as its KIND and nothing else until they have paid, and `paid` says which it is. The fence is
--   here, in the read, and not in the component — a page that hid it in the template would still
--   have sent it to the browser.
--
-- The RSVP list is the same shape of decision: a file says whether who is coming is public
-- (rsvp.list), and where it is, a person is a FIRST NAME AND A LAST INITIAL. Never a full name,
-- never an address. Somebody who says they are coming to a yoga class has not agreed to be in a
-- published list of people who go to it.
CREATE OR REPLACE FUNCTION "public"."event_page"("p_slug" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with e as (
    select * from public.calendar_events
     where slug = p_slug and published and public.event_for_me(audience)
  ),
  -- has this person paid for it? An event with no cost is free and everybody has.
  paid as (
    select case
      when (select cost from e) is null then true
      when auth.uid() is null then false
      else exists (
        select 1 from public.purchases pu
         where pu.user_id = auth.uid() and pu.status = 'paid'
           and pu.sku = coalesce((select cost->>'sku' from e), 'event-' || p_slug))
    end as ok
  )
  select case when not exists (select 1 from e) then null else (
    select jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'title', e.title, 'sub', e.sub, 'body', e.body,
      -- the pictures and the players: a cover, a small one for a list, a gallery, and whatever
      -- else it carries (a film, a recording) — drawn by the same blocks an article's are
      'cover', e.cover, 'thumb', e.thumb, 'gallery', coalesce(e.gallery, '[]'::jsonb), 'media', e.media,
      'capacity', e.capacity, 'rsvp', e.rsvp, 'zone', e.zone,
      'rsvp_answers', to_jsonb(coalesce(e.rsvp_answers, '{}'::text[])),
      'rsvp_reason', coalesce(e.rsvp_reason, false),
      'rsvp_list', coalesce(e.rsvp_list, 'off'),
      'comments_allow', coalesce(e.comments, 'members'),
      -- what it costs, and whether this person has paid
      'cost', e.cost,
      'paid', (select ok from paid),
      -- THE PLACE, behind the paywall. Its kind is always said — an event is online or it is
      -- somewhere, and that is part of deciding whether to come; the address, the link and the
      -- directions are not returned at all until it is theirs.
      'place', case
        when e.cost is null or (select ok from paid)
          then e.place
        else jsonb_build_object('kind', coalesce(e.place->>'kind', 'none'), 'locked', true)
      end,
      'hosts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', coalesce(
            h->>'name',
            (select coalesce(nullif(pr.display_name, ''), split_part(coalesce(pr.email, ''), '@', 1))
               from public.profiles pr where lower(pr.email) = lower(h->>'email')),
            initcap(replace(coalesce(h->>'role', ''), '-', ' '))),
          'email', h->>'email', 'role', h->>'role'))
          from jsonb_array_elements(coalesce(e.hosts, '[]'::jsonb)) h), '[]'::jsonb),
      'space', e.space_id, 'channel', e.channel_id,
      'occurrences', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', o.id, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
                 'cancelled_at', o.cancelled_at, 'note', o.note,
                 'going', (select count(*) from public.calendar_rsvps r
                            where r.occurrence_id = o.id and r.state = 'going'),
                 'mine', (select r.state from public.calendar_rsvps r
                           where r.occurrence_id = o.id and r.user_id = auth.uid()),
                 'reason', (select r.reason from public.calendar_rsvps r
                             where r.occurrence_id = o.id and r.user_id = auth.uid()),
                 -- WHO IS COMING, where the file says that is public: a first name and a last
                 -- initial, and nothing else. Never an address, never a full name, never an id.
                 'who', case when coalesce(e.rsvp_list, 'off') = 'off' then '[]'::jsonb else coalesce((
                   select jsonb_agg(public.short_name(coalesce(nullif(pr.display_name, ''), split_part(coalesce(pr.email, ''), '@', 1))))
                     from public.calendar_rsvps r
                     join public.profiles pr on pr.id = r.user_id
                    where r.occurrence_id = o.id and r.state = 'going'), '[]'::jsonb) end)
               order by o.starts_at)
          from public.calendar_occurrences o
         where o.event_id = e.id and o.starts_at > now() - interval '1 day'), '[]'::jsonb),
      -- the comments are the platform's own, keyed on this event like anything else that takes them
      'comments', public.comments_on('event', e.slug))
      from e
  ) end;
$$;

GRANT EXECUTE ON FUNCTION "public"."short_name"("text") TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."event_page"("text") TO "authenticated", "anon", "service_role";



-- ---------------------------------------------------------------------------------------------
-- REMINDING THE PEOPLE WHO SAID THEY WERE COMING.
--
-- An RSVP with no consequence is a button, not an invitation: somebody presses "I'll be there" and
-- then forgets, which is the thing the press was for. So at each of the policy's hours
-- (`event-reminders`, largest first) everybody who said they are going gets one email.
--
-- The row is written BEFORE the send and is unique per occurrence, person and hour, so a rerun
-- never repeats one — the same shape session_reminders has, for the same reason.
CREATE TABLE IF NOT EXISTS "public"."event_reminders" (
    "occurrence_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "hours" integer NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_reminders_pkey" PRIMARY KEY ("occurrence_id", "user_id", "hours")
);
ALTER TABLE ONLY "public"."event_reminders"
    ADD CONSTRAINT "event_reminders_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "public"."calendar_occurrences"("id") ON DELETE CASCADE;
ALTER TABLE "public"."event_reminders" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."event_reminders" TO "service_role";

-- every five minutes, what is owed — posted to the function with the service key, as every other
-- runner here does
CREATE OR REPLACE FUNCTION "public"."run_event_reminders"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/event-reminders',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := jsonb_build_object('action', 'send'));
end;
$$;
REVOKE ALL ON FUNCTION "public"."run_event_reminders"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_event_reminders"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_event_reminders"() TO "service_role";

-- what is owed right now: every occurrence inside the window with somebody going who has not been
-- told at that hour yet. The function asks this rather than assembling it itself, because who is
-- coming and who has been told are both the database's to know.
CREATE OR REPLACE FUNCTION "public"."event_reminders_due"("p_hours" integer[], "p_late_minutes" integer DEFAULT 15)
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'occurrence', o.id, 'event', e.id, 'slug', e.slug, 'title', e.title, 'sub', e.sub,
      'starts_at', o.starts_at, 'zone', e.zone, 'place', e.place, 'space', s.slug,
      'hours', h, 'user_id', r.user_id, 'email', p.email,
      'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)))), '[]'::jsonb)
    from unnest(p_hours) h
    join public.calendar_occurrences o
      on o.starts_at between now() + make_interval(mins => h * 60 - p_late_minutes)
                         and now() + make_interval(mins => h * 60)
     and o.cancelled_at is null
    join public.calendar_events e on e.id = o.event_id and e.published
    left join public.spaces s on s.id = e.space_id
    join public.calendar_rsvps r on r.occurrence_id = o.id and r.state = 'going'
    join public.profiles p on p.id = r.user_id and coalesce(p.email, '') <> ''
   where not exists (select 1 from public.event_reminders x
                      where x.occurrence_id = o.id and x.user_id = r.user_id and x.hours = h);
$$;
REVOKE ALL ON FUNCTION "public"."event_reminders_due"(integer[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."event_reminders_due"(integer[], integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."event_reminders_due"(integer[], integer) TO "service_role";
