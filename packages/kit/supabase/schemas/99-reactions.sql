--
-- WHAT CAN BE DONE TO SOMETHING WITHOUT WRITING A REPLY, and why it is two tables and not one.
--
-- A REACTION is expressive: an emoji, several per person, saying how something landed. A VOTE is a
-- judgement: up or down, one per person, saying whether it was worth reading. They are not the same
-- act and they do not have the same arithmetic, so they are not one table with a nullable column
-- pretending otherwise.
--
-- They ask the same two questions of a comment and of a message in a room, so each is ONE table
-- keyed by (surface, target, person) rather than a pair per surface — and the rule for who may cast
-- one is a single function taking the surface and the id, so the sentence "who may vote" exists
-- once. Where the two surfaces must differ they differ in what is passed to the rule, never in a
-- second copy of it.
--
-- TWO DEFAULTS, BOTH DELIBERATE. Reactions on, votes off. A score changes what people write as well
-- as what they read, so a site opts into that rather than finding it already running. And a comment
-- subject and a channel are set apart, neither inheriting from the other: wanting a scored forum
-- says nothing about wanting scored book chapters.
--
-- A DOWNVOTE HIDES NOTHING. Nothing here orders, dims or collapses anything by score; a comment
-- below any number is still readable, and removing something is an act of moderation with a
-- person's name on it (90-spaces). What a community rewards is a decision about that community, and
-- a platform that sorts by score everywhere has made it for them.
--
SET check_function_bodies = false;

-- This is space_reactions grown a surface. Every emoji anybody has ever left in a room is in here,
-- under the surface it was left on; nothing was dropped to make room for comments.
CREATE TABLE IF NOT EXISTS "public"."reactions" (    -- renamed from: space_reactions
    "surface" "text" DEFAULT 'message'::"text" NOT NULL,
    "target_id" "uuid" NOT NULL,                     -- renamed from: message_id
    "user_id" "uuid" NOT NULL,
    "emoji" "text" NOT NULL,
    -- the room a message is in, for the wake below and for the read policy; null for a comment,
    -- which has no room and is gated by its subject instead
    "channel_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reactions_surface_check" CHECK (("surface" = ANY (ARRAY['comment'::"text", 'message'::"text"]))),
    CONSTRAINT "reactions_emoji_check" CHECK ((("char_length"("emoji") >= 1) AND ("char_length"("emoji") <= 16)))
);
ALTER TABLE ONLY "public"."reactions" ADD CONSTRAINT "reactions_pkey" PRIMARY KEY ("surface", "target_id", "user_id", "emoji");
ALTER TABLE ONLY "public"."reactions" ADD CONSTRAINT "reactions_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."reactions" ADD CONSTRAINT "reactions_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
-- the tallies, read for a whole thread at once
CREATE INDEX IF NOT EXISTS "reactions_target_idx" ON "public"."reactions" USING "btree" ("surface", "target_id");

-- ONE PER PERSON, and changing your mind is the same row: casting the opposite replaces it, casting
-- the same again withdraws it. Never two rows, and never a count that drifts.
CREATE TABLE IF NOT EXISTS "public"."votes" (
    "surface" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vote" smallint NOT NULL,
    "channel_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "votes_surface_check" CHECK (("surface" = ANY (ARRAY['comment'::"text", 'message'::"text"]))),
    CONSTRAINT "votes_vote_check" CHECK (("vote" = ANY (ARRAY[(-1)::smallint, 1::smallint])))
);
ALTER TABLE ONLY "public"."votes" ADD CONSTRAINT "votes_pkey" PRIMARY KEY ("surface", "target_id", "user_id");
ALTER TABLE ONLY "public"."votes" ADD CONSTRAINT "votes_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."votes" ADD CONSTRAINT "votes_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "votes_target_idx" ON "public"."votes" USING "btree" ("surface", "target_id");

ALTER TABLE "public"."reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."votes" ENABLE ROW LEVEL SECURITY;

-- DOES THIS SURFACE TAKE THEM? The channel says so for a message, the comment subject for a
-- comment, and neither reaches the other. `p_what` is 'votes' or 'reactions': one question asked
-- twice rather than two questions.
CREATE OR REPLACE FUNCTION "public"."signal_takes"("p_surface" "text", "p_target" "uuid", "p_what" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case p_surface
    when 'message' then coalesce((
      select case when p_what = 'votes' then c.votes else c.reactions end
        from public.space_messages m join public.channels c on c.id = m.channel_id
       where m.id = p_target), false)
    when 'comment' then coalesce((
      select case when p_what = 'votes' then s.votes else s.reactions end
        from public.comments k
        join public.comment_subjects s on s.kind = k.kind and s.subject = k.subject
       where k.id = p_target), false)
    else false end;
$$;

-- WHO MAY CAST ONE IS WHO MAY BE IN THE ROOM. Reacting or voting asks the same standing as saying
-- something on that surface: somebody who may not comment may not vote, and somebody who cannot
-- read a channel cannot react in it. Never somebody with no account, because a vote from nobody is
-- not a signal — it is a number anybody can move.
CREATE OR REPLACE FUNCTION "public"."signal_may"("p_surface" "text", "p_target" "uuid", "p_what" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select auth.uid() is not null
     and public.signal_takes(p_surface, p_target, p_what)
     and case p_surface
       -- speaking in a room is membership, and it is muting that takes it away; the same two
       -- questions the insert policy on a message asks, asked here rather than copied
       when 'message' then coalesce((
         select m.channel_id in (select public.my_channel_ids())
            and not public.space_muted_in(m.channel_id)
           from public.space_messages m where m.id = p_target), false)
       when 'comment' then coalesce((
         select public.comment_may_write(k.kind, k.subject) from public.comments k where k.id = p_target), false)
       else false end;
$$;

-- and whether it may be SEEN, which is the weaker question: whoever may read the thing may read
-- what was left on it, including a reader with no account under a public article
CREATE OR REPLACE FUNCTION "public"."signal_visible"("p_surface" "text", "p_target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case p_surface
    when 'message' then coalesce((
      select public.can_read_channel(m.channel_id) from public.space_messages m where m.id = p_target), false)
    when 'comment' then coalesce((
      select public.comment_may_read(k.kind, k.subject) from public.comments k where k.id = p_target), false)
    else false end;
$$;

CREATE POLICY "reactions_select" ON "public"."reactions" FOR SELECT TO "authenticated", "anon"
  USING ("public"."signal_visible"("surface", "target_id"));
CREATE POLICY "reactions_insert_own" ON "public"."reactions" FOR INSERT TO "authenticated"
  WITH CHECK (("user_id" = (SELECT "auth"."uid"())) AND "public"."signal_may"("surface", "target_id", 'reactions'));
CREATE POLICY "reactions_delete_own" ON "public"."reactions" FOR DELETE TO "authenticated"
  USING ("user_id" = (SELECT "auth"."uid"()));

CREATE POLICY "votes_select" ON "public"."votes" FOR SELECT TO "authenticated", "anon"
  USING ("public"."signal_visible"("surface", "target_id"));
CREATE POLICY "votes_insert_own" ON "public"."votes" FOR INSERT TO "authenticated"
  WITH CHECK (("user_id" = (SELECT "auth"."uid"())) AND "public"."signal_may"("surface", "target_id", 'votes'));
-- changing your mind is an update of the one row, not a second one
CREATE POLICY "votes_update_own" ON "public"."votes" FOR UPDATE TO "authenticated"
  USING ("user_id" = (SELECT "auth"."uid"()))
  WITH CHECK (("user_id" = (SELECT "auth"."uid"())) AND "public"."signal_may"("surface", "target_id", 'votes'));
CREATE POLICY "votes_delete_own" ON "public"."votes" FOR DELETE TO "authenticated"
  USING ("user_id" = (SELECT "auth"."uid"()));

GRANT SELECT, INSERT, DELETE ON TABLE "public"."reactions" TO "authenticated";
GRANT SELECT ON TABLE "public"."reactions" TO "anon";
GRANT ALL ON TABLE "public"."reactions" TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."votes" TO "authenticated";
GRANT SELECT ON TABLE "public"."votes" TO "anon";
GRANT ALL ON TABLE "public"."votes" TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."signal_takes"("text", "uuid", "text") TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."signal_may"("text", "uuid", "text") TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."signal_visible"("text", "uuid") TO "authenticated", "anon", "service_role";

-- the room hears a reaction land, exactly as it did when the table was its own
CREATE OR REPLACE TRIGGER "trg_reactions_on" AFTER INSERT ON "public"."reactions" FOR EACH ROW EXECUTE FUNCTION "public"."space_reaction_changed"();
CREATE OR REPLACE TRIGGER "trg_reactions_off" AFTER DELETE ON "public"."reactions" FOR EACH ROW EXECUTE FUNCTION "public"."space_reaction_changed"();

-- NOTHING POINTS AT THE TARGET, because it may be either of two tables and a key cannot say "one of
-- these". So what a key would have done is done here: when a line is really gone — not withdrawn,
-- which leaves the placeholder, but deleted — what was left on it goes with it.
CREATE OR REPLACE FUNCTION "public"."signals_gone"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare surf text := case when tg_table_name = 'comments' then 'comment' else 'message' end;
begin
  delete from public.reactions where surface = surf and target_id = old.id;
  delete from public.votes where surface = surf and target_id = old.id;
  return null;
end;
$$;
CREATE OR REPLACE TRIGGER "trg_comments_signals_gone" AFTER DELETE ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."signals_gone"();
CREATE OR REPLACE TRIGGER "trg_messages_signals_gone" AFTER DELETE ON "public"."space_messages" FOR EACH ROW EXECUTE FUNCTION "public"."signals_gone"();
