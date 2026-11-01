-- GLUE: what joins the network module and the spaces module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- the network in the community's notifications: its own, read as the person, and when they last looked
CREATE OR REPLACE FUNCTION "public"."community_network_items"("p_before" timestamp with time zone, "p_limit" integer) RETURNS TABLE("reason" "text", "actor_id" "uuid", "post_id" "uuid", "subject_post_id" "uuid", "at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  select n.reason, n.actor_id, n.post_id, n.subject_post_id, n.at from public.network_notifications(p_before, p_limit) n;
$$;

CREATE OR REPLACE FUNCTION "public"."community_seen_at"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  select s.seen_at from public.network_seen s where s.user_id = auth.uid();
$$;

-- a feed room's posts with pictures or video in For You, weighted 1.2 for being in a space the reader is in
CREATE OR REPLACE FUNCTION "public"."network_spaced_posts"() RETURNS TABLE("kind" "text", "id" "uuid", "author_id" "uuid", "at" timestamp with time zone, "heat" double precision, "near" numeric)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  select 'space'::text, m.id, m.author_id, m.created_at,
         ((select count(*) from public.reactions r where r.surface = 'message' and r.target_id = m.id and r.emoji = '❤️') + 2 * m.reply_count + 1)::double precision,
         1.2
    from public.space_messages m join public.channels c on c.id = m.channel_id
   where c.mode = 'feed' and jsonb_array_length(m.media) > 0 and m.deleted_at is null and m.thread_root_id is null
     and m.created_at > now() - interval '30 days'
     and public.can_read_channel(c.id);
$$;

-- a space's feed, pinned to somebody's timeline
-- A member may pin a space they belong to; its feed channels then run through their timeline. The
-- pin is theirs; what they read through it is still the space's to decide (can_read_channel).
CREATE TABLE IF NOT EXISTS "public"."network_pins" (
    "user_id" "uuid" NOT NULL,
    "space_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."network_pins" ADD CONSTRAINT "network_pins_pkey" PRIMARY KEY ("user_id", "space_id");
ALTER TABLE ONLY "public"."network_pins" ADD CONSTRAINT "network_pins_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."network_pins" ADD CONSTRAINT "network_pins_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
ALTER TABLE "public"."network_pins" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "network_pins_own" ON "public"."network_pins";
CREATE POLICY "network_pins_own" ON "public"."network_pins" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "network_pins_write" ON "public"."network_pins";
CREATE POLICY "network_pins_write" ON "public"."network_pins" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."in_space"("space_id") AND "public"."network_admitted"("auth"."uid"(), 'write')));
DROP POLICY IF EXISTS "network_pins_delete" ON "public"."network_pins";
CREATE POLICY "network_pins_delete" ON "public"."network_pins" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));
GRANT SELECT, INSERT, DELETE ON TABLE "public"."network_pins" TO "authenticated";
GRANT ALL ON TABLE "public"."network_pins" TO "service_role";

-- the spaces' feed posts in the timeline: every space one is in, or only those pinned where pinning is on
CREATE OR REPLACE FUNCTION "public"."network_timeline_spaced"("p_before" timestamp with time zone, "p_limit" integer, "p_all_spaces" boolean) RETURNS TABLE("kind" "text", "post_id" "uuid", "message_id" "uuid", "reposted_by" "uuid", "at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as id),
  muted as (select m.muted_id as id from public.network_mutes m, me where m.muter_id = me.id)
  select 'space'::text, null::uuid, m.id, null::uuid, m.created_at
  from (
    select sm.space_id from public.space_members sm, me where p_all_spaces and sm.user_id = me.id
    union
    select pin.space_id from public.network_pins pin, me where not p_all_spaces and pin.user_id = me.id
  ) pin
  join public.channels c on c.space_id = pin.space_id and c.mode = 'feed' and c.archived_at is null
  join public.space_messages m on m.channel_id = c.id
  where m.thread_root_id is null and m.deleted_at is null and m.kind <> 'system'
    and public.can_read_channel(c.id)
    and (m.author_id is null or m.author_id not in (select id from muted))
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc limit p_limit
;
$$;

CREATE OR REPLACE FUNCTION "public"."network_spaces"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'space_id', s.id, 'slug', s.slug, 'name', s.name,
      'channel_id', (select c.id from public.channels c
                     where c.space_id = s.id and c.mode = 'feed' and c.archived_at is null and public.can_read_channel(c.id)
                     order by c.position, c.name limit 1),
      'pinned', exists (select 1 from public.network_pins pin where pin.user_id = auth.uid() and pin.space_id = s.id)
    ) order by s.position, s.name), '[]'::jsonb)
  from public.spaces s
  join public.space_members sm on sm.space_id = s.id and sm.user_id = auth.uid()
  where s.archived_at is null
    and exists (select 1 from public.channels c where c.space_id = s.id and c.mode = 'feed' and c.archived_at is null and public.can_read_channel(c.id));
$$;
