-- GLUE: what joins every site and the spaces module — declared only while the module is on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- the act's record points at the comment it was about; the comments table is declared here, so the
-- key is too rather than in the spaces file that declares the record
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_moderation"
    ADD CONSTRAINT "space_moderation_comment_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE TRIGGER "trg_messages_signals_gone" AFTER DELETE ON "public"."space_messages" FOR EACH ROW EXECUTE FUNCTION "public"."signals_gone"();

ALTER TABLE ONLY "public"."votes" ADD CONSTRAINT "votes_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."reactions" ADD CONSTRAINT "reactions_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;

-- what a message in a room allows: the room takes votes or reactions, the person may cast one, or may see them
CREATE OR REPLACE FUNCTION "public"."signal_message"("p_target" "uuid", "p_what" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case p_what
    when 'may' then coalesce((
         select m.channel_id in (select public.my_channel_ids())
            and not public.space_muted_in(m.channel_id)
           from public.space_messages m where m.id = p_target), false)
    when 'visible' then coalesce((
      select public.can_read_channel(m.channel_id) from public.space_messages m where m.id = p_target), false)
    else coalesce((
      select case when p_what = 'votes' then c.votes else c.reactions end
        from public.space_messages m join public.channels c on c.id = m.channel_id
       where m.id = p_target), false) end;
$$;

-- the room hears a reaction land, exactly as it did when the table was its own
CREATE OR REPLACE TRIGGER "trg_reactions_on" AFTER INSERT ON "public"."reactions" FOR EACH ROW EXECUTE FUNCTION "public"."space_reaction_changed"();
CREATE OR REPLACE TRIGGER "trg_reactions_off" AFTER DELETE ON "public"."reactions" FOR EACH ROW EXECUTE FUNCTION "public"."space_reaction_changed"();

-- A COMMENT KEPT IN A ROOM (97-comments.sql): moderated by whoever moderates the room, read as the post's replies,
-- counted, said and withdrawn there, recorded in the room's moderation record, and linked to from the page
CREATE OR REPLACE FUNCTION "public"."comment_room_moderates"("p_channel" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select public.space_may(p_channel, 'moderate') $$;

CREATE OR REPLACE FUNCTION "public"."comment_room_lines"("p_post" "uuid", "p_limit" integer) RETURNS TABLE("id" "uuid", "body" "text", "created_at" timestamp with time zone, "parent" "uuid", "author_id" "uuid", "deleted_at" timestamp with time zone, "state" "text", "flagged" "text", "ord" numeric, "surface" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.id, m.body, m.created_at, nullif(m.meta->>'parent', '')::uuid, m.author_id,
         m.deleted_at, case when m.deleted_at is not null then 'removed' else 'live' end,
         null::text, m.seq::numeric, 'message'::text
    from public.space_messages m
   where m.thread_root_id = p_post
   order by m.seq limit p_limit;
$$;

CREATE OR REPLACE FUNCTION "public"."comment_room_count"("p_post" "uuid") RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select count(*) from public.space_messages m where m.thread_root_id = p_post and m.deleted_at is null;
$$;

CREATE OR REPLACE FUNCTION "public"."comment_room_say"("p_kind" "text", "p_subject" "text", "p_body" "text", "p_parent" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s public.comment_subjects; root uuid; m public.space_messages;
begin
  select * into s from public.comment_subjects where kind = p_kind and subject = p_subject;
  if not found or s.channel_id is null then return null; end if;
  root := s.post_id;
  -- the first comment opens the post. Its title is the thing's own, so the board reads as a list
  -- of what is being talked about rather than a list of first sentences, and its body is the
  -- address of the page the conversation is on — a way back for whoever answers from the board.
  if root is null then
    insert into public.space_messages (channel_id, author_id, title, body, kind)
         values (s.channel_id, auth.uid(), coalesce(s.title, p_subject),
                 coalesce(s.href, ''), 'text')
      returning * into m;
    root := m.id;
    update public.comment_subjects set post_id = root where kind = p_kind and subject = p_subject;
  end if;
  -- a room is flat, so who a reply answers rides on the message's own meta, which the edit guard
  -- holds immutable. The room ignores it; a comment thread drawn from these lines does not.
  insert into public.space_messages (channel_id, author_id, body, kind, thread_root_id, meta)
       values (s.channel_id, auth.uid(), left(btrim(p_body), 4000), 'text', root,
               case when p_parent is null then '{}'::jsonb
                    else jsonb_build_object('parent', p_parent::text) end)
    returning * into m;
  return jsonb_build_object('id', m.id, 'body', m.body, 'created_at', m.created_at,
    'author_id', m.author_id, 'mine', true, 'in_channel', true, 'state', 'live');
end;
$$;

CREATE OR REPLACE FUNCTION "public"."comment_room_unsay"("p_comment" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.space_messages set deleted_at = now()
   where id = p_comment and deleted_at is null
     and (author_id = auth.uid() or public.is_staff());
  return found;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."comment_room_record"("p_comment" "uuid", "p_kind" "text", "p_reason" "text") RETURNS "void"
    LANGUAGE "sql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into public.space_moderation (space_id, comment_id, kind, actor_id, subject_id, reason)
  select c.space_id, k.id, p_kind, auth.uid(), k.author_id, p_reason
    from public.comments k
    left join public.comment_subjects s on s.kind = k.kind and s.subject = k.subject
    left join public.channels c on c.id = s.channel_id
   where k.id = p_comment;
$$;

CREATE OR REPLACE FUNCTION "public"."comment_room_thread"("p_channel" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select '/spaces/' || sp.slug || '/' || c.slug
    from public.channels c join public.spaces sp on sp.id = c.space_id
   where c.id = p_channel;
$$;
