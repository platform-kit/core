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


-- THE NETWORK'S PART, AND THE ONE "SEEN" MARKER, are the network module's, which may be off: its notifications and
-- the moment the person last looked are functions declared here answering nothing, and again, reading the network,
-- in the glue it shares with the spaces (glue/network+spaces.sql). The events' part is the events module's own
-- (events_soon_for_me, 95-events.sql; nothing, declared in 90-spaces.sql, where there are no events)
-- (openspec: module-switch-removes-backend).
CREATE OR REPLACE FUNCTION "public"."community_network_items"("p_before" timestamp with time zone, "p_limit" integer) RETURNS TABLE("reason" "text", "actor_id" "uuid", "post_id" "uuid", "subject_post_id" "uuid", "at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    AS $$ select null::text, null::uuid, null::uuid, null::uuid, null::timestamptz where false $$;
CREATE OR REPLACE FUNCTION "public"."community_seen_at"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    AS $$ select null::timestamptz $$;
REVOKE ALL ON FUNCTION "public"."community_network_items"(timestamp with time zone, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."community_network_items"(timestamp with time zone, integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."community_network_items"(timestamp with time zone, integer) TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."community_seen_at"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."community_seen_at"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."community_seen_at"() TO "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."community_notifications"("p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 50)
    RETURNS TABLE("source" "text", "reason" "text", "actor_id" "uuid", "post_id" "uuid", "subject_post_id" "uuid", "item" "jsonb", "at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with t as (
    select 'network'::text as source, n.reason, n.actor_id, n.post_id, n.subject_post_id, null::jsonb as item, n.at
      from public.community_network_items(p_before, p_limit) n
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
  where n.at > coalesce(public.community_seen_at(), '-infinity'::timestamptz);
$$;

GRANT ALL ON FUNCTION "public"."space_replies_to_me"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."community_notifications"(timestamp with time zone, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."community_unread"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_replies_to_me"(integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."community_notifications"(timestamp with time zone, integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."community_unread"() TO "service_role";

