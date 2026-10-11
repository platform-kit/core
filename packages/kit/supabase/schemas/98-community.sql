-- ---------------------------------------------------------------------------------------------
-- THE COMMUNITY'S ONE NOTIFICATION LIST (community-layouts): what has happened to a person, from
-- wherever it happened — the network's likes, reposts, follows, replies and quotes, a space's
-- mentions, the answers in the threads they are in, and the events they said they are coming to,
-- as they come near — one list, newest first, under one "seen" marker, so one count says how much
-- is new and opening the list clears all of it.
--
-- Each part is read under its own module's rules and nothing here widens them: the network's part
-- IS network_notifications (read as the person, so its guards decide), the mentions ARE
-- space_activity, the replies and the events are read through the caller's membership of the room
-- and their own answer to the event. The file sits after every module it reads (90 spaces, 93
-- network, 95 events), because a SQL function's body is checked against the tables when it is made.
-- ---------------------------------------------------------------------------------------------

-- the answers in a thread somebody is in — they wrote its root, or answered it before this one —
-- from anybody else, in a room they are still a member of; a reply that also names them is a
-- mention and is left to the mentions
CREATE OR REPLACE FUNCTION "public"."space_replies_to_me"("p_lim" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select m.id, m.channel_id, c.name as channel, c.kind as channel_kind, m.thread_root_id,
           m.author_id, m.body, m.seq, m.created_at, s.name as space, s.slug as space_slug,
           coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)) as author
    from public.space_messages m
    join public.space_messages r on r.id = m.thread_root_id and r.deleted_at is null
    join public.channels c on c.id = m.channel_id
    join public.channel_members cm on cm.channel_id = m.channel_id and cm.user_id = auth.uid()
    join public.spaces s on s.id = c.space_id
    left join public.profiles p on p.id = m.author_id
    where m.thread_root_id is not null and m.deleted_at is null
      and m.author_id is not null and m.author_id <> auth.uid()
      and (r.author_id = auth.uid() or exists (
            select 1 from public.space_messages mine
             where mine.thread_root_id = m.thread_root_id and mine.author_id = auth.uid()
               and mine.deleted_at is null and mine.created_at < m.created_at))
      and not exists (select 1 from public.space_mentions sm where sm.message_id = m.id and sm.user_id = auth.uid())
    order by m.created_at desc
    limit least(greatest(coalesce(p_lim, 50), 1), 200)) x;
$$;

-- the events somebody said they are going to, from a day before each starts until it has been on an
-- hour: the reminder, kept in the list. Its moment is when it came near (or when they said yes, if
-- that was later), so it lands in the list as new once and stays where it fell.
CREATE OR REPLACE FUNCTION "public"."events_soon_for_me"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (
    select o.id, e.slug, e.title, e.space_id, sp.name as space, sp.slug as space_slug, o.starts_at, e.place,
           greatest(o.starts_at - interval '24 hours', r.created_at) as at
    from public.calendar_rsvps r
    join public.calendar_occurrences o on o.id = r.occurrence_id
    join public.calendar_events e on e.id = o.event_id
    left join public.spaces sp on sp.id = e.space_id
    where r.user_id = auth.uid() and r.state = 'going'
      and e.published and o.cancelled_at is null
      and o.starts_at > now() - interval '1 hour'
      and o.starts_at <= now() + interval '24 hours'
      and (e.space_id is null or public.in_space(e.space_id))) x;
$$;

CREATE OR REPLACE FUNCTION "public"."community_notifications"("p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 50)
    RETURNS TABLE("source" "text", "reason" "text", "actor_id" "uuid", "post_id" "uuid", "subject_post_id" "uuid", "item" "jsonb", "at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with t as (
    select 'network'::text as source, n.reason, n.actor_id, n.post_id, n.subject_post_id, null::jsonb as item, n.at
      from public.network_notifications(p_before, p_limit) n
    union all
    select 'mention', 'mention-' || (j->>'mention'), (j->>'author_id')::uuid, null, null, j, (j->>'created_at')::timestamptz
      from jsonb_array_elements(public.space_activity(200)) j
    union all
    select 'reply', 'thread-reply', (j->>'author_id')::uuid, null, null, j, (j->>'created_at')::timestamptz
      from jsonb_array_elements(public.space_replies_to_me(200)) j
    union all
    select 'event', 'event-soon', null, null, null, j, (j->>'at')::timestamptz
      from jsonb_array_elements(public.events_soon_for_me()) j
  )
  select * from t
  where t.at <= now() and (p_before is null or t.at < p_before)
  order by t.at desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- how many of them are newer than the last look — the one count beside Notifications
CREATE OR REPLACE FUNCTION "public"."community_unread"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  select count(*)::int from public.community_notifications(null, 200) n
  where n.at > coalesce((select s.seen_at from public.network_seen s where s.user_id = auth.uid()), '-infinity'::timestamptz);
$$;

GRANT ALL ON FUNCTION "public"."space_replies_to_me"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."events_soon_for_me"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."community_notifications"(timestamp with time zone, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."community_unread"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_replies_to_me"(integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."events_soon_for_me"() TO "service_role";
GRANT ALL ON FUNCTION "public"."community_notifications"(timestamp with time zone, integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."community_unread"() TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- FOR YOU (community.forYou): the posts with pictures or video the reader may read, from the last
-- thirty days, ranked by what people did with them over time — (likes + 2·replies + 3·reposts + 1)
-- over (hours + 2)^1.5 — and weighted toward who they are close to: 1.5 for someone they follow, 1.3
-- for someone they answered in the last thirty days, 1.2 for a post in a space they are in. Read as
-- the person, so the read rules of both modules decide what is in it; the "two in six" spread is the
-- browser's (spread in network/model.js), so a page is ranked here and arranged there.
CREATE OR REPLACE FUNCTION "public"."network_for_you"("p_offset" integer DEFAULT 0, "p_limit" integer DEFAULT 30)
    RETURNS TABLE("kind" "text", "id" "uuid", "author_id" "uuid", "score" double precision, "at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as id),
  follows as (select f.subject_id as id from public.network_follows f, me where f.follower_id = me.id),
  answered as (
    select distinct parent.author_id as id
      from public.network_posts p join public.network_posts parent on parent.id = p.reply_parent_id, me
     where p.author_id = me.id and p.created_at > now() - interval '30 days'),
  posts as (
    select 'post'::text as kind, p.id, p.author_id, p.created_at as at,
           (p.like_count + 2 * p.reply_count + 3 * p.repost_count + 1)::double precision as heat,
           case when p.author_id in (select id from follows) then 1.5
                when p.author_id in (select id from answered) then 1.3 else 1.0 end as near
      from public.network_posts p
     where jsonb_array_length(p.media) > 0 and p.removed_at is null and p.reply_parent_id is null
       and p.created_at > now() - interval '30 days'
       and public.network_admitted(auth.uid(), 'read')),
  spaced as (
    select 'space'::text, m.id, m.author_id, m.created_at,
           ((select count(*) from public.reactions r where r.surface = 'message' and r.target_id = m.id and r.emoji = '❤️') + 2 * m.reply_count + 1)::double precision,
           1.2
      from public.space_messages m join public.channels c on c.id = m.channel_id
     where c.mode = 'feed' and jsonb_array_length(m.media) > 0 and m.deleted_at is null and m.thread_root_id is null
       and m.created_at > now() - interval '30 days'
       and public.can_read_channel(c.id))
  select t.kind, t.id, t.author_id, t.heat / power(extract(epoch from (now() - t.at)) / 3600 + 2, 1.5) * t.near as score, t.at
    from (select * from posts union all select * from spaced) t
   order by score desc, t.id
   offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 30), 1), 60);
$$;
GRANT ALL ON FUNCTION "public"."network_for_you"(integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."network_for_you"(integer, integer) TO "service_role";
