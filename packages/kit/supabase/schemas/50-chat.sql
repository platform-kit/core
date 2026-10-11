-- coaching chat: one thread per member per coach: conversations, members, messages, reactions
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."bump_conversation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.conversations set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at) where id = new.conversation_id;
  -- the sender has, by sending, read everything up to now
  update public.conversation_members set last_read_at = greatest(last_read_at, new.created_at)
    where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end;
$$;

-- A PAID SESSION'S WEEK OF CHAT, read from the booking itself (openspec: community-access-by-entitlement):
-- a paid session (a credit was spent on it) that is not cancelled opens the chat between its booker and
-- its coach from the booking until a week after the session ends. A move re-dates it and a cancel ends
-- it, because both change the booking. It is not a membership: nothing else asks it.
CREATE OR REPLACE FUNCTION "public"."chat_session_with"("p_member" "uuid", "p_coach" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p_member is not null and p_coach is not null and exists (
    select 1 from public.bookings b
     where b.user_id = p_member and b.provider_id = p_coach
       and b.credit_id is not null and b.status = 'accepted'
       and now() < coalesce(b.end_at, b.start_at) + interval '7 days');
$$;
REVOKE ALL ON FUNCTION "public"."chat_session_with"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."chat_session_with"("uuid", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."chat_session_with"("uuid", "uuid") TO "authenticated", "service_role";

-- the coaches the caller has such a week with: what the client asks to know whether the chat is theirs
CREATE OR REPLACE FUNCTION "public"."chat_session_coaches"() RETURNS "uuid"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(array_agg(distinct b.provider_id), '{}'::uuid[]) from public.bookings b
   where b.user_id = auth.uid() and b.provider_id is not null
     and b.credit_id is not null and b.status = 'accepted'
     and now() < coalesce(b.end_at, b.start_at) + interval '7 days';
$$;
REVOKE ALL ON FUNCTION "public"."chat_session_coaches"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."chat_session_coaches"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."chat_session_coaches"() TO "authenticated", "service_role";

-- WHO MAY WRITE IN A THREAD: a coach always (an administrator, or anybody holding provider — whether or
-- not they hold a membership themselves); a member while the membership is live; and somebody whose
-- paid session with this thread's coach is still inside its week.
CREATE OR REPLACE FUNCTION "public"."chat_may_send"("p_conversation" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or public.is_provider() or public.is_subscribed()
      or exists (select 1 from public.conversations c
                  where c.id = p_conversation and c.member_id = auth.uid()
                    and public.chat_session_with(auth.uid(), c.provider_id));
$$;
REVOKE ALL ON FUNCTION "public"."chat_may_send"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."chat_may_send"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."chat_may_send"("uuid") TO "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."chat_inbox"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as id, public.is_provider() as admin),
  mine as (
    select c.*, case when c.member_id = (select id from me) then c.provider_id else c.member_id end as peer_id
    from public.conversations c
    where c.member_id = (select id from me) or c.provider_id = (select id from me)
  ),
  items as (
    select
      x.id, x.last_message_at, x.created_at,
      jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
        -- WHAT THIS PERSON CALLS THEMSELVES, where they have said: it beats the site's word for the
        -- role wherever a surface names them. Null is not "no title" but "the site's word", which
        -- the client's titleOf() supplies, so this is carried plainly and decided there.
        'title', nullif(p.title, ''),
        'roles', to_jsonb(p.roles),
        'email', case when (select admin from me) then p.email else null end,
        'tiers', coalesce((select jsonb_agg(distinct e.tier) from public.entitlements e
                   where e.user_id = p.id and e.kind = 'class' and e.key = 'subscribed' and e.active
                     and (e.expires_at is null or e.expires_at > now()) and e.tier is not null), '[]'::jsonb),
        'session_chat', public.chat_session_with(p.id, (select id from me))
      ) as peer,
      (select to_jsonb(l) from (
         select m.id, m.kind, m.body, m.sender_id, m.created_at, m.deleted_at
         from public.messages m where m.conversation_id = x.id
         order by m.created_at desc limit 1) l) as last,
      (select count(*) from public.messages m, public.conversation_members cm
        where m.conversation_id = x.id and cm.conversation_id = x.id and cm.user_id = (select id from me)
          and m.sender_id <> (select id from me) and m.deleted_at is null and m.created_at > cm.last_read_at) as unread,
      (select cm.last_read_at from public.conversation_members cm where cm.conversation_id = x.id and cm.user_id = x.peer_id) as peer_read_at,
      -- the peer's unanswered run: its first message after the caller's last word
      (select min(m.created_at) from public.messages m
        where m.conversation_id = x.id and m.deleted_at is null and m.sender_id = x.peer_id
          and m.created_at > coalesce((select max(m2.created_at) from public.messages m2
                                        where m2.conversation_id = x.id and m2.sender_id = (select id from me) and m2.deleted_at is null), '-infinity')) as awaiting_since
    from mine x
    left join public.profiles p on p.id = x.peer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', items.id, 'peer', items.peer, 'last', items.last, 'unread', items.unread,
    'last_message_at', items.last_message_at, 'peer_read_at', items.peer_read_at, 'created_at', items.created_at,
    'awaiting_since', items.awaiting_since
  ) order by coalesce(items.last_message_at, items.created_at) desc), '[]'::jsonb)
  from items;
$$;

CREATE OR REPLACE FUNCTION "public"."chat_members"("q" "text" DEFAULT ''::"text", "lim" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with live as (
    select distinct on (e.user_id) e.user_id, e.tier
    from public.entitlements e
    where e.kind = 'class' and e.key = 'subscribed' and e.active and (e.expires_at is null or e.expires_at > now())
    order by e.user_id, e.created_at desc
  ),
  needle as (select '%' || regexp_replace(coalesce(q, ''), '([%_\\])', '\\\1', 'g') || '%' as pat, coalesce(q, '') = '' as any),
  found as (
    select p.id,
      coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)) as name,
      nullif(p.title, '') as title,
      p.email, live.tier,
      (select c.id from public.conversations c where c.provider_id = auth.uid() and c.member_id = p.id) as conversation_id
    from live join public.profiles p on p.id = live.user_id, needle
    where not public.is_provider(p.id) and p.id <> auth.uid()
      and (needle.any or p.display_name ilike needle.pat or p.email ilike needle.pat)
    order by lower(coalesce(nullif(p.display_name, ''), p.email)), p.email
    limit greatest(1, least(coalesce(lim, 30), 100))
  )
  select case when public.is_provider() then jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(found)) from found), '[]'::jsonb),
    'total', (select count(*) from live join public.profiles p on p.id = live.user_id where not public.is_provider(p.id) and p.id <> auth.uid())
  ) else jsonb_build_object('items', '[]'::jsonb, 'total', 0) end;
$$;

CREATE OR REPLACE FUNCTION "public"."chat_open"("peer" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  me       uuid := auth.uid();
  me_admin boolean;
  peer_admin boolean;
begin
  if me is null then raise exception 'sign in'; end if;
  if peer is null or peer = me then raise exception 'no such person'; end if;
  -- who coaches is a capability, never a comparison against a role's name: an administrator
  -- reaches everything, so they answer as a coach too, and is_provider(uuid) is the one place that says so
  me_admin   := public.is_provider(me);
  select public.is_provider(peer) into peer_admin from public.profiles where id = peer;
  if peer_admin is null then raise exception 'no such person'; end if;
  if coalesce(me_admin, false) then
    return public.conversation_between(peer, me);
  elsif peer_admin and (public.is_subscribed() or public.chat_session_with(me, peer)) then
    return public.conversation_between(me, peer);
  else
    raise exception 'chat is for members';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."chat_people"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as id, public.is_provider() as admin),
  people as (
    select p.id, p.display_name, p.email, p.roles
    from public.profiles p, me
    where p.id <> me.id and (
      (public.is_provider(p.id) and (me.admin or public.is_subscribed() or public.chat_session_with(me.id, p.id)))
      or exists (select 1 from public.conversations c
                 where (c.member_id = me.id and c.provider_id = p.id) or (c.provider_id = me.id and c.member_id = p.id))
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', people.id,
    'name', coalesce(nullif(people.display_name, ''), split_part(coalesce(people.email, ''), '@', 1)),
    'roles', to_jsonb(people.roles),
    'email', case when (select admin from me) then people.email else null end
  ) order by public.is_provider(people.id) desc, people.display_name, people.email), '[]'::jsonb)
  from people;
$$;

CREATE OR REPLACE FUNCTION "public"."chat_unread"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(count(*), 0)::integer
  from public.messages m
  join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.sender_id <> auth.uid() and m.deleted_at is null and m.created_at > cm.last_read_at;
$$;

CREATE OR REPLACE FUNCTION "public"."conversation_between"("p_member" "uuid", "p_provider" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare cid uuid;
begin
  select id into cid from public.conversations
    where (member_id = p_member and provider_id = p_provider) or (member_id = p_provider and provider_id = p_member)
    limit 1;
  if cid is null then
    insert into public.conversations (member_id, provider_id) values (p_member, p_provider)
      on conflict ((least(member_id, provider_id)), (greatest(member_id, provider_id))) do update set member_id = excluded.member_id
      returning id into cid;
  end if;
  insert into public.conversation_members (conversation_id, user_id) values (cid, p_member), (cid, p_provider)
    on conflict do nothing;
  return cid;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."fill_reaction_conversation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  select conversation_id into new.conversation_id from public.messages where id = new.message_id;
  if new.conversation_id is null then
    raise exception 'unknown message';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."guard_message_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if auth.role() in ('anon', 'authenticated') then
    if new.conversation_id is distinct from old.conversation_id
       or new.sender_id is distinct from old.sender_id
       or new.kind is distinct from old.kind
       or new.body is distinct from old.body
       or new.audio_path is distinct from old.audio_path
       or new.seconds is distinct from old.seconds
       or new.reply_to is distinct from old.reply_to
       or new.created_at is distinct from old.created_at then
      raise exception 'a message cannot be edited, only withdrawn';
    end if;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."guard_message_reply"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.reply_to is not null and not exists (
    select 1 from public.messages where id = new.reply_to and conversation_id = new.conversation_id
  ) then
    raise exception 'reply_to must name a message in the same conversation';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."in_conversation"("cid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.conversations
    where id = cid and (member_id = auth.uid() or provider_id = auth.uid())
  );
$$;

CREATE TABLE IF NOT EXISTS "public"."conversation_members" (
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone,
    "notified_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."conversation_members" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "provider_id" "uuid" NOT NULL, -- renamed from: coach_id
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_message_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "public"."message_reactions" (
    "message_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "message_reactions_emoji_check" CHECK ((("char_length"("emoji") >= 1) AND ("char_length"("emoji") <= 16)))
);

ALTER TABLE ONLY "public"."message_reactions" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'text'::"text" NOT NULL,
    "body" "text",
    "audio_path" "text",
    -- a coaching thread takes an attachment as the desk's other queue does: the same four columns,
    -- the same private bucket, the same two people and nobody else
    "attachment_path" "text",
    "attachment_type" "text",
    "attachment_name" "text",
    "attachment_size" integer,
    "seconds" numeric,
    "reply_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "messages_check" CHECK ((("kind" <> 'text'::"text") OR ("body" IS NOT NULL))),
    CONSTRAINT "messages_check1" CHECK ((("kind" <> 'voice'::"text") OR ("audio_path" IS NOT NULL))),
    CONSTRAINT "messages_check2" CHECK ((("kind" <> 'file'::"text") OR ("attachment_path" IS NOT NULL))),
    CONSTRAINT "messages_kind_check" CHECK (("kind" = ANY (ARRAY['text'::"text", 'voice'::"text", 'file'::"text"])))
);

ALTER TABLE ONLY "public"."conversation_members"
    ADD CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("conversation_id", "user_id");

ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_member_id_provider_id_key" UNIQUE ("member_id", "provider_id");

ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."message_reactions"
    ADD CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("message_id", "user_id", "emoji");

ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");

CREATE INDEX "conversations_provider_idx" ON "public"."conversations" USING "btree" ("provider_id", "last_message_at" DESC);

CREATE INDEX "conversations_member_idx" ON "public"."conversations" USING "btree" ("member_id", "last_message_at" DESC);

CREATE UNIQUE INDEX "conversations_pair_idx" ON "public"."conversations" USING "btree" (LEAST("member_id", "provider_id"), GREATEST("member_id", "provider_id"));

CREATE INDEX "message_reactions_conversation_idx" ON "public"."message_reactions" USING "btree" ("conversation_id");

CREATE INDEX "messages_conversation_idx" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);

CREATE OR REPLACE TRIGGER "trg_message_reactions_fill" BEFORE INSERT ON "public"."message_reactions" FOR EACH ROW EXECUTE FUNCTION "public"."fill_reaction_conversation"();

CREATE OR REPLACE TRIGGER "trg_messages_bump" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."bump_conversation"();

CREATE OR REPLACE TRIGGER "trg_messages_guard" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."guard_message_edit"();

CREATE OR REPLACE TRIGGER "trg_messages_reply" BEFORE INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."guard_message_reply"();

ALTER TABLE ONLY "public"."conversation_members"
    ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."conversation_members"
    ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."message_reactions"
    ADD CONSTRAINT "message_reactions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."message_reactions"
    ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."message_reactions"
    ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_reply_to_fkey" FOREIGN KEY ("reply_to") REFERENCES "public"."messages"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."conversation_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversation_members_select_party" ON "public"."conversation_members" FOR SELECT USING ("public"."in_conversation"("conversation_id"));

CREATE POLICY "conversation_members_update_own" ON "public"."conversation_members" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_select_party" ON "public"."conversations" FOR SELECT USING ("public"."in_conversation"("id"));

ALTER TABLE "public"."message_reactions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_reactions_delete_own" ON "public"."message_reactions" FOR DELETE USING (("auth"."uid"() = "user_id"));

CREATE POLICY "message_reactions_insert_own" ON "public"."message_reactions" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."in_conversation"(( SELECT "m"."conversation_id"
   FROM "public"."messages" "m"
  WHERE ("m"."id" = "message_reactions"."message_id")))));

CREATE POLICY "message_reactions_select_party" ON "public"."message_reactions" FOR SELECT USING ("public"."in_conversation"("conversation_id"));

ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_insert_own" ON "public"."messages" FOR INSERT WITH CHECK ((("auth"."uid"() = "sender_id") AND "public"."in_conversation"("conversation_id") AND "public"."chat_may_send"("conversation_id")));

CREATE POLICY "messages_select_party" ON "public"."messages" FOR SELECT USING ("public"."in_conversation"("conversation_id"));

CREATE POLICY "messages_update_own" ON "public"."messages" FOR UPDATE USING (("auth"."uid"() = "sender_id")) WITH CHECK (("auth"."uid"() = "sender_id"));

GRANT ALL ON FUNCTION "public"."bump_conversation"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_conversation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_conversation"() TO "service_role";

GRANT ALL ON FUNCTION "public"."chat_inbox"() TO "anon";
GRANT ALL ON FUNCTION "public"."chat_inbox"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_inbox"() TO "service_role";

GRANT ALL ON FUNCTION "public"."chat_members"("q" "text", "lim" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."chat_members"("q" "text", "lim" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_members"("q" "text", "lim" integer) TO "service_role";

GRANT ALL ON FUNCTION "public"."chat_open"("peer" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."chat_open"("peer" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_open"("peer" "uuid") TO "service_role";

GRANT ALL ON FUNCTION "public"."chat_people"() TO "anon";
GRANT ALL ON FUNCTION "public"."chat_people"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_people"() TO "service_role";

GRANT ALL ON FUNCTION "public"."chat_unread"() TO "anon";
GRANT ALL ON FUNCTION "public"."chat_unread"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_unread"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."conversation_between"("p_member" "uuid", "p_provider" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."conversation_between"("p_member" "uuid", "p_provider" "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."conversation_between"("p_member" "uuid", "p_provider" "uuid") TO "service_role";

GRANT ALL ON FUNCTION "public"."fill_reaction_conversation"() TO "anon";
GRANT ALL ON FUNCTION "public"."fill_reaction_conversation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fill_reaction_conversation"() TO "service_role";

GRANT ALL ON FUNCTION "public"."guard_message_edit"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_message_edit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_message_edit"() TO "service_role";

GRANT ALL ON FUNCTION "public"."guard_message_reply"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_message_reply"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_message_reply"() TO "service_role";

GRANT ALL ON FUNCTION "public"."in_conversation"("cid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."in_conversation"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."in_conversation"("cid" "uuid") TO "service_role";

GRANT ALL ON TABLE "public"."conversation_members" TO "anon";
GRANT ALL ON TABLE "public"."conversation_members" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_members" TO "service_role";

GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";

GRANT ALL ON TABLE "public"."message_reactions" TO "anon";
GRANT ALL ON TABLE "public"."message_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."message_reactions" TO "service_role";

GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";

-- Reachable by the functions alone: the platform's default privileges grant every function to anon and
-- authenticated at creation, so what a role must not call is revoked here, explicitly.
REVOKE ALL ON FUNCTION "public"."conversation_between"("uuid", "uuid") FROM PUBLIC, "anon", "authenticated";

-- Realtime: the threads are live.
ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."messages", "public"."message_reactions", "public"."conversation_members";

-- A voice note and anything else attached to a message live in the private chat bucket (the bucket
-- itself is a row: data.sql), under the conversation, named for the message and nothing else. Both
-- parties put them there and both read them; nobody else does either.
CREATE POLICY "chat parties add voice notes" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (
  bucket_id = 'chat'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp3|png|jpg|jpeg|gif|webp|pdf|txt)$'
  and public.in_conversation(((storage.foldername(name))[1])::uuid)
);
CREATE POLICY "chat parties hear voice notes" ON "storage"."objects" FOR SELECT TO "authenticated" USING (
  bucket_id = 'chat'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp3|png|jpg|jpeg|gif|webp|pdf|txt)$'
  and public.in_conversation(((storage.foldername(name))[1])::uuid)
);
