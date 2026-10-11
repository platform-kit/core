-- ---------------------------------------------------------------------------------------------
-- TEAMS
-- ---------------------------------------------------------------------------------------------
--
-- A team is a group of people the site can point work at: the practice, the front desk, the coaches
-- who take discovery calls. It exists so a booking type can be THE TEAM'S rather than one person's,
-- and so who is in it can change without anything that points at it being edited.
--
-- The team itself is a projection of content/teams/*.md — nobody edits these rows; build/teams.mjs
-- compiles the files and build/teams-push.mjs writes them. Who is IN it is not a projection and
-- never could be: a declaration names classes of people and never a person.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."teams" (
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "about" "text",
    "thumb" "text",
    "position" integer DEFAULT 99 NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    -- who it is for, in the grammar a space's membership uses; '{}' is invitation only
    "fill" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("slug")
);

-- WHO IS IN IT, and how they came to be. `fill` is the sweep's; `invite` and `manual` are acts, and
-- the sweep never removes what it did not put there — somebody invited stays through any change to
-- the rule, which is the whole reason the column exists.
CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "team" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team", "user_id"),
    CONSTRAINT "team_members_source_check" CHECK (("source" = ANY (ARRAY['fill'::"text", 'invite'::"text", 'manual'::"text"])))
);
ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_fkey" FOREIGN KEY ("team") REFERENCES "public"."teams"("slug") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "team_members_user_idx" ON "public"."team_members" USING "btree" ("user_id");

ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;

-- A TEAM'S NAME IS PUBLIC, because a booking type carries it and a booking names its hosts. What it
-- is for (the fill) and who is in it are not: a membership list is a directory, and a directory of
-- everybody who works here is not a thing to publish on their behalf.
CREATE POLICY "teams_read" ON "public"."teams" FOR SELECT TO "authenticated", "anon" USING ("published");
-- AND AN ADMINISTRATOR READS EVERY TEAM, published or not — as they do every space. Without it the
-- editor cannot tell a team nobody is in from a team that is not in the database yet, which is the
-- ordinary state in cloud mode: a save is a draft, a publish is a commit, and the projection is the
-- deploy's. An editor told "nobody is in this team" about a team that does not exist yet has been
-- told something false.
CREATE POLICY "teams_read_admin" ON "public"."teams" FOR SELECT TO "authenticated" USING ("public"."is_admin"());
GRANT SELECT ON TABLE "public"."teams" TO "authenticated", "anon";
GRANT ALL ON TABLE "public"."teams" TO "service_role";

-- somebody reads their own membership; a member of a team reads that team's; an administrator all
CREATE POLICY "team_members_read" ON "public"."team_members" FOR SELECT TO "authenticated"
  USING (("user_id" = (SELECT "auth"."uid"()))
     OR "public"."is_admin"()
     OR EXISTS (SELECT 1 FROM "public"."team_members" m
                 WHERE m."team" = "team_members"."team" AND m."user_id" = (SELECT "auth"."uid"())));
GRANT SELECT ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";

-- WHO IS IN A TEAM, for a surface that may know: its own members, and an administrator. It answers
-- the names a booking already shows and nothing more — never an address.
CREATE OR REPLACE FUNCTION "public"."team_people"("p_team" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not (public.is_admin() or exists (
        select 1 from public.team_members m where m.team = p_team and m.user_id = auth.uid())) then null else
    coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'source', m.source, 'joined_at', m.joined_at,
      'name', coalesce(nullif(p.display_name, ''), nullif(p.username, ''), nullif(p.first_name, '')),
      'title', nullif(p.title, ''), 'username', p.username,
      'avatar', nullif(p.avatar, ''), 'avatar_style', nullif(p.avatar_style, ''),
      'avatar_seed', coalesce(nullif(p.avatar_seed, ''), md5(lower(coalesce(nullif(p.email, ''), p.id::text)))),
      'avatar_options', p.avatar_options)
      order by p.display_name), '[]'::jsonb) end
    from public.team_members m join public.profiles p on p.id = m.user_id
   where m.team = p_team;
$$;
REVOKE ALL ON FUNCTION "public"."team_people"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."team_people"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."team_people"("text") TO "authenticated", "service_role";

-- WHICH TEAMS A PERSON GIVES SESSIONS FOR — the published teams they are in, by username, for
-- anybody. It is how somebody's own page works out which MANAGED booking types they hold a copy of,
-- and it says no more than the copy itself does: this person takes this kind of session. It answers
-- nothing for a page that is not public, and nothing about a team that is not published.
--
-- It exists because the browser cannot read team_members — a membership is somebody's, not the
-- public's — and a page that could not derive the copy would have to be given a row per member,
-- which is the thing the whole arrangement avoids.
CREATE OR REPLACE FUNCTION "public"."teams_giving"("p_username" "text") RETURNS "text"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(array_agg(m.team order by m.team), '{}')
    from public.team_members m
    join public.teams t on t.slug = m.team and t.published
    join public.profiles p on p.id = m.user_id
   where p.username = lower(btrim(p_username)) and p.public_profile;
$$;
REVOKE ALL ON FUNCTION "public"."teams_giving"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."teams_giving"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."teams_giving"("text") TO "anon", "authenticated", "service_role";

-- THE TEAMS SOMEBODY IS IN, and how they came to be in each — their own, on their own account.
CREATE OR REPLACE FUNCTION "public"."my_teams"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'about', t.about, 'thumb', t.thumb, 'source', m.source, 'joined_at', m.joined_at)
      order by t.position, t.slug), '[]'::jsonb)
    from public.team_members m join public.teams t on t.slug = m.team
   where m.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION "public"."my_teams"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_teams"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_teams"() TO "authenticated", "service_role";

-- AN ADMINISTRATOR PUTS SOMEBODY IN A TEAM, or takes them out. An invitation is an act, so it is
-- written as one and the sweep leaves it alone; taking somebody out removes whatever put them there,
-- and the sweep will put them back at once if the rule still holds — which is the honest answer, not
-- a bug: to keep somebody out of a filled team, change the rule.
CREATE OR REPLACE FUNCTION "public"."team_invite"("p_team" "text", "p_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  insert into public.team_members (team, user_id, source) values (p_team, p_user, 'invite')
  on conflict (team, user_id) do nothing;
end;
$$;
CREATE OR REPLACE FUNCTION "public"."team_remove"("p_team" "text", "p_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  delete from public.team_members where team = p_team and user_id = p_user;
end;
$$;
REVOKE ALL ON FUNCTION "public"."team_invite"("text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."team_invite"("text", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."team_invite"("text", "uuid") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."team_remove"("text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."team_remove"("text", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."team_remove"("text", "uuid") TO "authenticated", "service_role";

-- THE SWEEP, which is the spaces' sweep one table over: everybody a team's rule matches is in it,
-- and only what the rule put there is ever taken out.
CREATE OR REPLACE FUNCTION "public"."team_sync_members"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer := 0; m integer;
begin
  insert into public.team_members (team, user_id, source)
  select t.slug, p.id, 'fill'
    from public.teams t
    join public.profiles p on public.space_fill_matches(p.id, t.fill)
   where t.published and t.fill <> '{}'::jsonb
  on conflict (team, user_id) do nothing;
  get diagnostics m = row_count; n := n + m;

  delete from public.team_members tm
   using public.teams t
   where t.slug = tm.team and tm.source = 'fill'
     and (not t.published or t.fill = '{}'::jsonb or not public.space_fill_matches(tm.user_id, t.fill));
  get diagnostics m = row_count; n := n + m;
  return n;
end;
$$;
REVOKE ALL ON FUNCTION "public"."team_sync_members"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."team_sync_members"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."team_sync_members"() TO "service_role";
