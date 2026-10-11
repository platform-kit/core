-- ---------------------------------------------------------------------------------------------
-- WHAT SOMEBODY HAS DONE, AND WHAT THAT SAYS ABOUT THEM
--
-- Two things out of one stream. The site already records what people do — every reader-facing act
-- is an event (`public.events`), and has been since the first analytics — so nothing here invents a
-- second way of noticing. Both of these read that stream and nothing else:
--
--   AN ACHIEVEMENT is a thing somebody has done that is worth saying out loud. It has a page of its
--   own, it is shown on their profile where they have made one public, and it is theirs for good.
--
--   A TRAIT is something the site has come to believe about somebody — that they keep reading about
--   money, that they have looked at the coaching page four times. It is never shown to another
--   member. It is the site's own note, and it is visible to the people the declaration says.
--
-- THE RULE IS A DECLARATION; WHAT SOMEBODY HAS EARNED IS AN ACT. The rules are files
-- (content/achievements/*.md, content/traits.md) projected into the two tables below; who holds
-- what is a row nobody edits by hand. Delete the database and redeploy: every rule comes back and
-- nobody's badges do, which is the honest answer — a badge is a fact about a person, and the facts
-- about people live where the people do.
--
-- NOTHING IS AWARDED BY A CLIENT. One trigger on the event stream, running as the definer, decides;
-- a browser cannot ask for a badge any more than it can ask for a role.

-- THE RULES, projected from the files. `event` is the event type that could satisfy it; `match` is
-- the props that must agree (a subset match, so a rule may say nothing about props at all); `count`
-- is how many it takes, and `distinct` counts distinct values of one prop rather than rows — which
-- is the difference between "finished a book eleven times" and "finished eleven books".
CREATE TABLE IF NOT EXISTS "public"."achievements" (
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "sub" "text",
    "icon" "text",
    "colour" "text",
    "cover" "text",
    -- who may open its page: the same ladder the rest of the library is gated by; empty is everyone
    "access" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    -- the trigger
    "event" "text" NOT NULL,
    "match" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "count" integer DEFAULT 1 NOT NULL,
    "distinct_key" "text",
    -- whether it is shown on a public profile at all (some are private to the site)
    "shown" boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 99 NOT NULL,
    CONSTRAINT "achievements_pkey" PRIMARY KEY ("slug"),
    CONSTRAINT "achievements_count_check" CHECK (("count" >= 1))
);

-- WHO HAS EARNED WHAT. One row per person per achievement, written once and never edited: an
-- achievement taken back is a thing that did not happen, and this table is a record of things that
-- did. `seen_at` is the only column that moves — whether they have been told.
CREATE TABLE IF NOT EXISTS "public"."user_achievements" (
    "user_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "awarded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "seen_at" timestamp with time zone,
    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("user_id", "slug")
);
ALTER TABLE ONLY "public"."user_achievements" ADD CONSTRAINT "user_achievements_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_achievements" ADD CONSTRAINT "user_achievements_slug_fkey" FOREIGN KEY ("slug") REFERENCES "public"."achievements"("slug") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "user_achievements_user_idx" ON "public"."user_achievements" ("user_id", "awarded_at" DESC);

-- THE TRAIT RULES, projected from content/traits.md. A trait is a key and a value — `interest` and
-- `manifestation` — because "interest:manifestation" as one string is a string somebody will parse.
CREATE TABLE IF NOT EXISTS "public"."trait_rules" (
    "id" "text" NOT NULL,
    "event" "text" NOT NULL,
    "match" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "key" "text" NOT NULL,
    -- the value, or `prop:<name>` to take it from the event's own props (a topic, a book's slug)
    "value" "text" NOT NULL,
    "position" integer DEFAULT 99 NOT NULL,
    CONSTRAINT "trait_rules_pkey" PRIMARY KEY ("id")
);

-- WHAT THE SITE HAS COME TO BELIEVE ABOUT SOMEBODY. Never shown to another member; read by the
-- staff the declaration names, through one function that checks the role. `n` is how many times it
-- has been seen, which is the difference between a glance and an interest.
CREATE TABLE IF NOT EXISTS "public"."user_traits" (
    "user_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "n" integer DEFAULT 1 NOT NULL,
    "first_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_traits_pkey" PRIMARY KEY ("user_id", "key", "value")
);
ALTER TABLE ONLY "public"."user_traits" ADD CONSTRAINT "user_traits_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "user_traits_key_idx" ON "public"."user_traits" ("key", "value");

ALTER TABLE "public"."achievements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_achievements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."trait_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_traits" ENABLE ROW LEVEL SECURITY;

-- WHAT THE ACHIEVEMENTS ARE is public: they are pages on the site, and a page nobody can read
-- before they have earned it is a page nobody knows to try for.
DROP POLICY IF EXISTS "achievements_read" ON "public"."achievements";
CREATE POLICY "achievements_read" ON "public"."achievements" FOR SELECT TO "anon", "authenticated" USING (true);
GRANT SELECT ON TABLE "public"."achievements" TO "anon", "authenticated";
GRANT ALL ON TABLE "public"."achievements" TO "service_role";

-- WHO HAS EARNED ONE is their own to read. Anybody else asks through `public_profile`, which
-- answers only for a profile its owner has made public and only for the ones marked shown.
DROP POLICY IF EXISTS "user_achievements_own" ON "public"."user_achievements";
CREATE POLICY "user_achievements_own" ON "public"."user_achievements" FOR SELECT TO "authenticated"
  USING ("user_id" = (SELECT "auth"."uid"()));
GRANT SELECT ON TABLE "public"."user_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."user_achievements" TO "service_role";

-- THE TRAIT RULES AND WHAT ANYBODY HOLDS are the site's own and reach no client at all: not the
-- person they are about, and certainly not anybody else. The staff read them through a function
-- that checks the role, and that is the only door.
GRANT ALL ON TABLE "public"."trait_rules" TO "service_role";
GRANT ALL ON TABLE "public"."user_traits" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- THE ONE TRIGGER. Every event that names a person is looked at once: the achievements whose rule
-- it could satisfy, and the traits it sets. It runs as the definer, so nothing a client can say
-- decides anything — the client says what happened, and this says what that means.
--
-- It is deliberately cheap. A rule is matched on the event's TYPE first (indexed, and most events
-- match no rule at all), and only a rule that got that far counts anything.
CREATE OR REPLACE FUNCTION "public"."note_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare a public.achievements; r public.trait_rules; got integer; v text;
begin
  if new.user_id is null then return new; end if;

  -- what they have now earned
  for a in select * from public.achievements where event = new.type loop
    if not (new.props @> a.match) then continue; end if;
    if exists (select 1 from public.user_achievements ua where ua.user_id = new.user_id and ua.slug = a.slug) then continue; end if;
    if a.count <= 1 then
      got := 1;
    elsif a.distinct_key is not null then
      -- how many DIFFERENT things: eleven books, not one book eleven times
      select count(distinct e.props ->> a.distinct_key) into got from public.events e
       where e.user_id = new.user_id and e.type = a.event and e.props @> a.match and (e.props ->> a.distinct_key) is not null;
    else
      select count(*) into got from public.events e
       where e.user_id = new.user_id and e.type = a.event and e.props @> a.match;
    end if;
    if got >= a.count then
      insert into public.user_achievements (user_id, slug) values (new.user_id, a.slug) on conflict do nothing;
    end if;
  end loop;

  -- and what the site now believes about them
  for r in select * from public.trait_rules where event = new.type loop
    if not (new.props @> r.match) then continue; end if;
    -- a value of `prop:<name>` is taken from the event itself, which is how one rule tags every topic
    if r.value like 'prop:%' then v := new.props ->> substr(r.value, 6); else v := r.value; end if;
    if v is null or v = '' then continue; end if;
    insert into public.user_traits (user_id, key, value) values (new.user_id, r.key, v)
      on conflict (user_id, key, value) do update set n = public.user_traits.n + 1, last_at = now();
  end loop;
  return new;
end;
$$;
CREATE OR REPLACE TRIGGER "trg_events_note" AFTER INSERT ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."note_event"();

-- WHAT SOMEBODY HAS EARNED, for their own page and for anybody looking at a public one. The rule is
-- the profile's: a page that is not public answers nothing, and an achievement marked `shown: false`
-- is the site's own note and is never on anybody's page.
CREATE OR REPLACE FUNCTION "public"."achievements_of"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_user is null then '[]'::jsonb
    when p_user <> auth.uid() and not coalesce((select public_profile from public.profiles where id = p_user), false) then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
           'slug', a.slug, 'title', a.title, 'sub', a.sub, 'icon', a.icon, 'colour', a.colour,
           'cover', a.cover, 'awarded_at', ua.awarded_at) order by ua.awarded_at desc)
      from public.user_achievements ua join public.achievements a on a.slug = ua.slug
     where ua.user_id = p_user and (a.shown or p_user = auth.uid())), '[]'::jsonb)
  end;
$$;
GRANT EXECUTE ON FUNCTION "public"."achievements_of"("uuid") TO "anon", "authenticated", "service_role";

-- WHAT THE SITE BELIEVES ABOUT SOMEBODY, for the staff the declaration names. `may_see_traits()`
-- reads that list out of app_settings, where the projection writes it — so who may look is part of
-- the declaration and not a role name hard-coded in a policy.
CREATE OR REPLACE FUNCTION "public"."may_see_traits"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.roles && coalesce((select array(select jsonb_array_elements_text(value::jsonb))
                                   from public.app_settings where key = 'traits_visible_to'), array['admin'])
            or 'admin' = any(p.roles)));
$$;
REVOKE ALL ON FUNCTION "public"."may_see_traits"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."may_see_traits"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."may_see_traits"() TO "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."traits_of"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.may_see_traits() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('key', t.key, 'value', t.value, 'n', t.n,
                                        'first_at', t.first_at, 'last_at', t.last_at)
           order by t.n desc, t.last_at desc)
      from public.user_traits t where t.user_id = p_user), '[]'::jsonb) end;
$$;
REVOKE ALL ON FUNCTION "public"."traits_of"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."traits_of"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."traits_of"("uuid") TO "authenticated", "service_role";

-- EVERYBODY WHO CARRIES A TRAIT, for the desk: who is interested in what, and how many of them.
CREATE OR REPLACE FUNCTION "public"."trait_counts"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.may_see_traits() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('key', k, 'value', v, 'people', p) order by p desc, k, v)
      from (select key as k, value as v, count(*)::int as p from public.user_traits group by 1, 2) x), '[]'::jsonb) end;
$$;
REVOKE ALL ON FUNCTION "public"."trait_counts"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."trait_counts"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."trait_counts"() TO "authenticated", "service_role";
