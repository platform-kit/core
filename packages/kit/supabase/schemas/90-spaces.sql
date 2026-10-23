-- spaces: rooms with their own membership — channels read as a stream or a forum, threads, mentions,
-- unread as a counter, search, and the platform's own messages. Visibility is scoped to a space and
-- never to the site: an open channel is open within its space and invisible outside it, which is what
-- lets a staff space, a members' community and a paid server sit in one instance without leaking.
-- The coaching chat's conversations/messages and the support desk's tables are untouched by all of it.
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
--
-- AND SO IS WHAT IS IN IT. A space, its channels, its roles and the grants a site ships are a
-- DECLARATION — part of what the site is, not a record of what anybody did — and they are authored
-- as files (content/spaces/<slug>.md and content/spaces/<slug>/<channel>.md; build/spaces-io.mjs is
-- the grammar, build/spaces.mjs the compile, build/spaces-push.mjs the projection). The four tables
-- below hold a ONE-WAY projection of those files: no client may write them, the projection is the
-- only writer, and everything else here — who joined, who holds which role, what was said, what was
-- read, a grant given to one person by hand — is state and stays rows.
SET check_function_bodies = false;

-- ---------------------------------------------------------------------------------------------
-- the rooms
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."spaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" DEFAULT 'staff'::"text" NOT NULL,
    -- what fills the membership: {"role": ["admin","support"]} | {"tier": "tier-2"} |
    -- {"entitlement": "subscribed"} | {} for invitation only. Read by space_fill_matches.
    "fill" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- WHETHER THIS SPACE HAS DIRECT MESSAGES AT ALL — the space's own decision, the same for
    -- everybody in it, and so a line in its file. A site whose community is rooms rather than
    -- private messages has decided that for everyone, staff included. Whether one PERSON wants to
    -- be written to is a different question and a row of theirs (space_members.dms below).
    "dms" boolean DEFAULT true NOT NULL,
    -- what a space open to people who did not sign a contract says about itself, all three of them
    -- the file's: whether a reader who is not in it is shown that it exists and what it would take,
    -- the one room a new member should read first, and the headings its rooms are gathered under.
    "discoverable" boolean DEFAULT false NOT NULL,
    -- OUT OF THE WAY, NOT OUT OF REACH. A space that exists and is used — the one every embedded
    -- comment thread lands in, say — but which nobody browses to: it is left out of the rail, the
    -- front page and Find a space for an ordinary member, and shown to staff, who need to be able
    -- to moderate what they cannot see a way into.
    --
    -- It is a LISTING rule and not a policy, for the reason the reading horizon is: what is hidden
    -- here is not a secret. Its members read and write in it exactly as before — that is the whole
    -- point, since the comments under an article are its messages — and a policy that hid it would
    -- also hide it from the counts, the search index and the moderation queue, which all have a
    -- legitimate reason to know it is there.
    "hidden" boolean DEFAULT false NOT NULL,
    -- ITS OWN PICTURES. A wall of rooms that are all the same rectangle of type is a wall nobody
    -- reads; a cover gives a space a face on the community's front page and a thumb gives it one in
    -- a list. Both are addresses, resolved like every other file the site names, and both are
    -- optional — a space with neither is drawn from its own name, which is a good answer.
    "cover" "text",
    "thumb" "text",
    "welcome" "text",
    "groups" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    -- and where the SPACE sits in a person's column: the heading it is gathered under and its place
    -- among the others. Both the file's, so every member sees the same arrangement — unlike a
    -- channel's group, which each of them can collapse.
    "group" "text",
    "position" integer DEFAULT 99 NOT NULL,
    -- HOW FAR BACK EACH KIND OF PERSON MAY READ. A list of rules, each naming who (a space role, a
    -- membership tier, an entitlement, or nobody in particular, which means everybody) and how many
    -- days: [{"role":"coach","days":365},{"tier":"inner","days":180},{"days":60}]. The most generous
    -- matching rule wins, 0 means no limit, and an empty list means no limit for anybody — which is
    -- what a space that says nothing gets. The staff are never limited by it: an administrator who
    -- cannot read what was said cannot answer for it, and that is not a rule a file may take away.
    "history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    -- HOW SOMEBODY WHO IS NOT IN IT GETS IN: { how: none | open | request | approve, form: <slug>,
    -- terms: <markdown>, question: <a line asking for a note> }. The default is none — you are in by
    -- the rule or you are not — because a staff space must never grow a Join button by accident.
    "joining" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    CONSTRAINT "spaces_kind_check" CHECK (("kind" = ANY (ARRAY['staff'::"text", 'community'::"text", 'server'::"text"]))),
    CONSTRAINT "spaces_slug_check" CHECK (("slug" ~ '^[a-z0-9][a-z0-9-]{0,48}$'::"text"))
);
ALTER TABLE ONLY "public"."spaces" ADD CONSTRAINT "spaces_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."spaces" ADD CONSTRAINT "spaces_slug_key" UNIQUE ("slug");

CREATE TABLE IF NOT EXISTS "public"."space_members" (
    "space_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- WHETHER THIS PERSON WILL BE WRITTEN TO HERE. Theirs to set and nobody else's, and per SPACE
    -- rather than once for the site: somebody may want their coach's community open and a busy
    -- server closed. Declining stops a NEW conversation and nothing else — every thread already
    -- open keeps working, because a switch that silently removes conversations is not an opt-out.
    "dms" boolean DEFAULT true NOT NULL,
    CONSTRAINT "space_members_source_check" CHECK (("source" = ANY (ARRAY['fill'::"text", 'invite'::"text", 'manual'::"text"])))
);
ALTER TABLE ONLY "public"."space_members" ADD CONSTRAINT "space_members_pkey" PRIMARY KEY ("space_id", "user_id");
ALTER TABLE ONLY "public"."space_members" ADD CONSTRAINT "space_members_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_members" ADD CONSTRAINT "space_members_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_members_user_idx" ON "public"."space_members" USING "btree" ("user_id");

-- A ROLE IS A RECORD, NOT A WORD. It was a word for one day and the word was the whole of it: a set
-- of strings on the membership, checked against a list written into this file, which meant a site
-- could not invent "Founding Member" without editing the kit, and meant a role granted nothing —
-- two names did something only because two names were hardcoded in the client.
--
-- A role belongs to a space, the way it does everywhere anybody has used one, and it carries what it
-- is called, what colour it wears and where it ranks. What it may DO is not here: that is a grant,
-- and a grant already knows how to say "these people, this capability" (space_grants, scope 'role').
-- So there is one answer to "what may this person do", and roles feed it rather than sitting beside
-- it with rules of their own.
CREATE TABLE IF NOT EXISTS "public"."space_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "space_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "colour" "text",
    -- higher runs more of the place: the order they are listed in, and who outranks whom
    "rank" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_roles_slug_check" CHECK (("slug" ~ '^[a-z0-9][a-z0-9-]{0,38}$'::"text"))
);
ALTER TABLE ONLY "public"."space_roles" ADD CONSTRAINT "space_roles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."space_roles" ADD CONSTRAINT "space_roles_slug_key" UNIQUE ("space_id", "slug");
ALTER TABLE ONLY "public"."space_roles" ADD CONSTRAINT "space_roles_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;

-- holding one is a row, so "who holds this" is a query and removing a role takes it off everybody
CREATE TABLE IF NOT EXISTS "public"."space_member_roles" (
    "space_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "given_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "given_by" "uuid"
);
ALTER TABLE ONLY "public"."space_member_roles" ADD CONSTRAINT "space_member_roles_pkey" PRIMARY KEY ("space_id", "user_id", "role_id");
ALTER TABLE ONLY "public"."space_member_roles" ADD CONSTRAINT "space_member_roles_member_fkey" FOREIGN KEY ("space_id", "user_id") REFERENCES "public"."space_members"("space_id", "user_id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_member_roles" ADD CONSTRAINT "space_member_roles_role_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."space_roles"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_member_roles_role_idx" ON "public"."space_member_roles" USING "btree" ("role_id");

CREATE TABLE IF NOT EXISTS "public"."channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "space_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "topic" "text",
    "mode" "text" DEFAULT 'stream'::"text" NOT NULL,
    -- a direct message is a channel like any other, drawn by who is in it rather than by a name;
    -- it is always private, never listed, and opened through space_dm_open so there is exactly one
    -- per set of people.
    "kind" "text" DEFAULT 'channel'::"text" NOT NULL,
    "dm_key" "text",
    "visibility" "text" DEFAULT 'open'::"text" NOT NULL,
    -- THE SAME, FOR ONE ROOM. A channel that is used but not browsed to — the one the comments on
    -- an article land in. Left out of the rail for an ordinary member, shown to staff, and read and
    -- written in by its members exactly as before. Visibility says who MAY be in it; this says
    -- whether it is offered to them.
    "hidden" boolean DEFAULT false NOT NULL,
    -- a room's own pictures: one shown whole where the room is introduced, one beside its name
    "cover" "text",
    "thumb" "text",
    -- where it sits in the sidebar, and under which heading — the file's, both of them
    "position" integer DEFAULT 99 NOT NULL,
    "group" "text",
    -- the channel's own counter: every message takes the next one, so unread is a subtraction and
    -- never a count of rows.
    "last_seq" bigint DEFAULT 0 NOT NULL,
    "last_message_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    -- WHAT THE ROOM TAKES besides words. Reactions on, votes off — a score changes what people
    -- write as well as what they read, so a room opts into that. The space sets the default its
    -- rooms inherit and the projection resolves it, so what is here is the answer and not the
    -- question; a comment subject is set apart from this and inherits nothing from it.
    "reactions" boolean DEFAULT true NOT NULL,
    "votes" boolean DEFAULT false NOT NULL,
    -- A ROOM'S OWN RULE, projected from its file in the space's own grammar. The sweep reads it the
    -- way it reads a space's, so "this room is for tier-3" is a line in a file rather than rows
    -- somebody inserts by hand. It is NARROWER, NEVER WIDER: it never grants the space, because a
    -- room inside a space you are not in has no people, no directory and no way to be mentioned.
    -- {} is what every room has today — open to the space, or private and joined by hand.
    "fill" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- a FEED is the same messages read as a group's feed: each post whole with its pictures, poll or
    -- event and its first replies (the network module; openspec social-network)
    CONSTRAINT "channels_mode_check" CHECK (("mode" = ANY (ARRAY['stream'::"text", 'forum'::"text", 'feed'::"text"]))),
    CONSTRAINT "channels_visibility_check" CHECK (("visibility" = ANY (ARRAY['open'::"text", 'private'::"text"]))),
    CONSTRAINT "channels_slug_check" CHECK (("slug" ~ '^[a-z0-9][a-z0-9-]{0,48}$'::"text"))
);
ALTER TABLE ONLY "public"."channels" ADD CONSTRAINT "channels_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."channels" ADD CONSTRAINT "channels_space_slug_key" UNIQUE ("space_id", "slug");
ALTER TABLE ONLY "public"."channels" ADD CONSTRAINT "channels_dm_key" UNIQUE ("space_id", "dm_key");
ALTER TABLE ONLY "public"."channels" ADD CONSTRAINT "channels_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "public"."channel_members" (
    "channel_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_seq" bigint DEFAULT 0 NOT NULL,
    "mention_count" integer DEFAULT 0 NOT NULL,
    "notify" "text" DEFAULT 'mentions'::"text" NOT NULL,
    "muted_until" timestamp with time zone,
    "starred" boolean DEFAULT false NOT NULL,
    -- when this person was last told by email that something was said here: the same restraint the
    -- chats keep — one per burst, and never while they were just here.
    "notified_at" timestamp with time zone,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- HOW THEY CAME TO BE IN THIS ROOM, so the sweep only ever takes back what it gave. 'fill' is a
    -- rule's and the sweep owns it; 'hand' is somebody's own — they joined an open room, or a
    -- moderator put them in — and a rule must never take that away. Everything already in a room
    -- got there by hand, which is what the default says.
    "source" "text" DEFAULT 'hand'::"text" NOT NULL,
    CONSTRAINT "channel_members_source_check" CHECK (("source" = ANY (ARRAY['fill'::"text", 'hand'::"text"]))),
    CONSTRAINT "channel_members_notify_check" CHECK (("notify" = ANY (ARRAY['mentions'::"text", 'all'::"text", 'none'::"text"])))
);
ALTER TABLE ONLY "public"."channel_members" ADD CONSTRAINT "channel_members_pkey" PRIMARY KEY ("channel_id", "user_id");
ALTER TABLE ONLY "public"."channel_members" ADD CONSTRAINT "channel_members_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."channel_members" ADD CONSTRAINT "channel_members_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "channel_members_user_idx" ON "public"."channel_members" USING "btree" ("user_id");

-- ---------------------------------------------------------------------------------------------
-- what is said
-- ---------------------------------------------------------------------------------------------

-- A post in a forum channel and a line in a stream channel are the same row: a post is a message
-- with a title, a reply is a message carrying its root. The key is the read order.
CREATE TABLE IF NOT EXISTS "public"."space_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "seq" bigint NOT NULL,
    "thread_root_id" "uuid",
    "author_id" "uuid",
    "kind" "text" DEFAULT 'text'::"text" NOT NULL,
    "title" "text",
    "body" "text",
    "attachment" "text",
    "attachment_type" "text",
    -- what a file was called when it was chosen, and how big it was: a chip says both, and neither
    -- can be read off its name in the bucket, which is the message's id and nothing else
    "attachment_name" "text",
    "attachment_size" integer,
    "seconds" numeric,
    -- a feed post's pictures and videos, as a network post carries them (up to ten, each { kind,
    -- path, alt, mime, size, width, height, duration?, poster? }) in the spaces bucket under the
    -- channel's id; a chat message keeps its one attachment
    "media" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- a poll's options ride on meta, which the edit guard makes immutable; being CLOSED is meant to
    -- change, so it is its own column, written only by space_poll_close
    "poll_closed_at" timestamp with time zone,
    -- WHAT A BOT OFFERED, AND WHO TOOK IT. A bot's answer may end in a list, and the list is cut
    -- off the words on the way in (meta.choices, immutable like a poll's options) so that nothing
    -- downstream reparses markdown to know what was offered and no reader is ever shown the
    -- grammar. Being TAKEN is a fact about the room rather than the message, and everybody in the
    -- room shares one offer — so it is its own column, written only by space_choose, and the first
    -- press wins. Without it two people press at once and the bot is summoned twice.
    "choice_at" timestamp with time zone,
    "choice_key" "text",
    "choice_by" "uuid",
    -- a reply sent to the channel as well as to its thread: it shows in both, once each
    "echoed" boolean DEFAULT false NOT NULL,
    "reply_count" integer DEFAULT 0 NOT NULL,
    "last_reply_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    -- WRITTEN WHILE SHADOW-BANNED. Decided once, by a trigger, at the moment the line is written,
    -- and never asked again: the alternative is the same question in the seven places messages are
    -- read, and six of them agreeing is how a shadow-banned troll's lines come back. The author
    -- still sees their own; a moderator sees everything.
    "shadowed" boolean DEFAULT false NOT NULL,
    "fts" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"simple"'::"regconfig", ((((((COALESCE("title", ''::"text") || ' '::"text") || COALESCE("body", ''::"text")) || ' '::"text") || COALESCE("attachment_name", ''::"text")) || ' '::"text") || COALESCE("translate"("attachment_name", '-_./'::"text", '    '::"text"), ''::"text")))) STORED,
    CONSTRAINT "space_messages_kind_check" CHECK (("kind" = ANY (ARRAY['text'::"text", 'voice'::"text", 'file'::"text", 'system'::"text", 'poll'::"text", 'announcement'::"text"]))),
    CONSTRAINT "space_messages_body_check" CHECK ((("kind" <> 'text'::"text") OR ("body" IS NOT NULL))),
    CONSTRAINT "space_messages_file_check" CHECK ((("kind" <> ALL (ARRAY['voice'::"text", 'file'::"text"])) OR ("attachment" IS NOT NULL))),
    CONSTRAINT "space_messages_media_len" CHECK (("jsonb_array_length"("media") <= 10)),
    CONSTRAINT "space_messages_author_check" CHECK ((("kind" = 'system'::"text") OR ("author_id" IS NOT NULL))),
    CONSTRAINT "space_messages_title_check" CHECK ((("title" IS NULL) OR ("thread_root_id" IS NULL)))
);
ALTER TABLE ONLY "public"."space_messages" ADD CONSTRAINT "space_messages_pkey" PRIMARY KEY ("channel_id", "seq");
ALTER TABLE ONLY "public"."space_messages" ADD CONSTRAINT "space_messages_id_key" UNIQUE ("id");
ALTER TABLE ONLY "public"."space_messages" ADD CONSTRAINT "space_messages_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_messages" ADD CONSTRAINT "space_messages_root_fkey" FOREIGN KEY ("thread_root_id") REFERENCES "public"."space_messages"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_messages" ADD CONSTRAINT "space_messages_author_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "space_messages_thread_idx" ON "public"."space_messages" USING "btree" ("thread_root_id", "seq") WHERE ("thread_root_id" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "space_messages_roots_idx" ON "public"."space_messages" USING "btree" ("channel_id", "last_reply_at" DESC NULLS LAST, "seq" DESC) WHERE ("thread_root_id" IS NULL);
CREATE INDEX IF NOT EXISTS "space_messages_stream_idx" ON "public"."space_messages" USING "btree" ("channel_id", "seq" DESC) WHERE (("thread_root_id" IS NULL) OR "echoed");
CREATE INDEX IF NOT EXISTS "space_messages_fts_idx" ON "public"."space_messages" USING "gin" ("fts");
CREATE INDEX IF NOT EXISTS "space_messages_author_idx" ON "public"."space_messages" USING "btree" ("author_id", "created_at" DESC);

-- WHAT A PERSON HAS ASKED NOT TO HEAR. Three things can be muted and they are one table, because
-- the question asked of all three is the same one: does this line reach this person. A CHANNEL that
-- is busy and not theirs; a SPACE, which is every room in it at once and every room it gains later;
-- a PERSON, whose lines stop naming them wherever they are written and whose direct message stops
-- carrying a number. "until" null is for good, a time is until then, and an expired row simply stops
-- applying rather than needing sweeping.
--
-- It is NOT space_moderation's own mute, which is a moderator silencing somebody — that stops them
-- writing, and this stops somebody else hearing. Two different acts that happen to share a word.
--
-- Muting is a person's own, so it is never a reason anything is hidden: a muted room is still read
-- by opening it, and a muted person's lines are still there in the room. What goes is the noise.
-- ---------------------------------------------------------------------------------------------
-- FLAIR: what somebody has done here, worn beside their name.
--
-- A role says what somebody MAY do; flair says what they ARE — Founding member, Finished the
-- course, Answered a hundred questions. The two are different questions and mixing them is how a
-- community ends up granting moderation to whoever read the most books.
--
-- A piece of flair is DECLARED in the space's own file, like its roles: a slug, a name, a colour
-- and a glyph. Who holds one is an ACT and so a row, with a source like every other membership
-- row — `fill` where a rule granted it, `manual` where somebody gave it, `earned` where the
-- platform's own events did. A declaration names classes of people; only a row names a person.
CREATE TABLE IF NOT EXISTS "public"."space_flair" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "space_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "colour" "text",
    -- a glyph by name, from the surface's own set (SpaceIcon) — never an image somebody uploads,
    -- so a wall of flair stays a wall of flair and not a wall of logos
    "icon" "text",
    "note" "text",
    -- where it shows: beside the name in a room, on the member's card, or both
    "inline" boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 99 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_flair_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "space_flair_slug_check" CHECK (("slug" ~ '^[a-z0-9][a-z0-9-]{0,38}$'::"text")),
    CONSTRAINT "space_flair_note_len" CHECK (("note" IS NULL OR "length"("note") <= 140))
);
ALTER TABLE ONLY "public"."space_flair" ADD CONSTRAINT "space_flair_slug_key" UNIQUE ("space_id", "slug");
ALTER TABLE ONLY "public"."space_flair" ADD CONSTRAINT "space_flair_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "public"."space_member_flair" (
    "flair_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- how they came by it: a fill rule, somebody's hand, or the platform's own events
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_member_flair_pkey" PRIMARY KEY ("flair_id", "user_id"),
    CONSTRAINT "space_member_flair_source_check" CHECK (("source" = ANY (ARRAY['fill'::"text", 'manual'::"text", 'earned'::"text"])))
);
ALTER TABLE ONLY "public"."space_member_flair" ADD CONSTRAINT "space_member_flair_flair_fkey" FOREIGN KEY ("flair_id") REFERENCES "public"."space_flair"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_member_flair" ADD CONSTRAINT "space_member_flair_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_member_flair_user_idx" ON "public"."space_member_flair" ("user_id");

ALTER TABLE "public"."space_flair" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."space_member_flair" ENABLE ROW LEVEL SECURITY;
-- what a space's flair IS, is not a secret to anybody who can see the space
DROP POLICY IF EXISTS "space_flair_select" ON "public"."space_flair";
CREATE POLICY "space_flair_select" ON "public"."space_flair" FOR SELECT TO "authenticated"
  USING (EXISTS (SELECT 1 FROM "public"."space_members" m WHERE m."space_id" = "space_flair"."space_id" AND m."user_id" = (SELECT "auth"."uid"())));
-- and who wears it is visible to the people in the room it is worn in: that is the point of it
DROP POLICY IF EXISTS "space_member_flair_select" ON "public"."space_member_flair";
CREATE POLICY "space_member_flair_select" ON "public"."space_member_flair" FOR SELECT TO "authenticated"
  USING (EXISTS (SELECT 1 FROM "public"."space_flair" f JOIN "public"."space_members" m ON m."space_id" = f."space_id"
                  WHERE f."id" = "space_member_flair"."flair_id" AND m."user_id" = (SELECT "auth"."uid"())));
GRANT SELECT ON TABLE "public"."space_flair" TO "authenticated";
GRANT SELECT ON TABLE "public"."space_member_flair" TO "authenticated";
GRANT ALL ON TABLE "public"."space_flair" TO "service_role";
GRANT ALL ON TABLE "public"."space_member_flair" TO "service_role";

-- GIVING AND TAKING IT BACK is a moderator's act, so it goes through a function that checks that
-- and writes the source, rather than a policy that would have to trust a client with the word.
CREATE OR REPLACE FUNCTION "public"."space_give_flair"("p_flair" "uuid", "p_user" "uuid", "p_on" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare sp uuid;
begin
  select space_id into sp from public.space_flair where id = p_flair;
  if sp is null then return jsonb_build_object('error', 'no-such-flair'); end if;
  if not exists (select 1 from public.channels c where c.space_id = sp and public.space_may(c.id, 'moderate'))
    then return jsonb_build_object('error', 'not-allowed'); end if;
  if p_on then
    insert into public.space_member_flair (flair_id, user_id, source) values (p_flair, p_user, 'manual')
      on conflict (flair_id, user_id) do nothing;
  else
    delete from public.space_member_flair where flair_id = p_flair and user_id = p_user;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
REVOKE ALL ON FUNCTION "public"."space_give_flair"("uuid", "uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_give_flair"("uuid", "uuid", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_give_flair"("uuid", "uuid", boolean) TO "authenticated", "service_role";

-- EVERY FLAIR A SPACE HAS, for whoever is giving one out. It is not a secret from a member, but
-- only a moderator has anything to do with the list, so the read is theirs.
CREATE OR REPLACE FUNCTION "public"."space_flairs"("p_space" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(jsonb_build_object(
           'id', f.id, 'slug', f.slug, 'name', f.name, 'colour', f.colour, 'icon', f.icon,
           'note', f.note, 'inline', f.inline,
           'people', (select count(*) from public.space_member_flair mf where mf.flair_id = f.id))
         order by f.position, f.name)
    from public.space_flair f
   where f.space_id = p_space
     and exists (select 1 from public.space_members m where m.space_id = p_space and m.user_id = auth.uid())), '[]'::jsonb);
$$;
REVOKE ALL ON FUNCTION "public"."space_flairs"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_flairs"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_flairs"("uuid") TO "authenticated", "service_role";

-- WHAT SOMEBODY WEARS IN THIS SPACE, in the order the file listed it.
CREATE OR REPLACE FUNCTION "public"."space_flair_of"("p_space" "uuid", "p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(jsonb_build_object(
           'slug', f.slug, 'name', f.name, 'colour', f.colour, 'icon', f.icon, 'note', f.note, 'inline', f.inline)
         order by f.position, f.name)
    from public.space_member_flair mf join public.space_flair f on f.id = mf.flair_id
   where mf.user_id = p_user and f.space_id = p_space), '[]'::jsonb);
$$;
REVOKE ALL ON FUNCTION "public"."space_flair_of"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_flair_of"("uuid", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_flair_of"("uuid", "uuid") TO "authenticated", "service_role";

CREATE TABLE IF NOT EXISTS "public"."space_mutes" (
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "ref" "uuid" NOT NULL,
    "until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_mutes_kind_check" CHECK (("kind" = ANY (ARRAY['channel'::"text", 'space'::"text", 'person'::"text"])))
);
ALTER TABLE ONLY "public"."space_mutes" ADD CONSTRAINT "space_mutes_pkey" PRIMARY KEY ("user_id", "kind", "ref");
ALTER TABLE ONLY "public"."space_mutes" ADD CONSTRAINT "space_mutes_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_mutes_ref_idx" ON "public"."space_mutes" USING "btree" ("kind", "ref");

CREATE TABLE IF NOT EXISTS "public"."space_mentions" (
    "message_id" "uuid" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'user'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_mentions_kind_check" CHECK (("kind" = ANY (ARRAY['user'::"text", 'group'::"text", 'channel'::"text"])))
);
ALTER TABLE ONLY "public"."space_mentions" ADD CONSTRAINT "space_mentions_pkey" PRIMARY KEY ("message_id", "user_id");
ALTER TABLE ONLY "public"."space_mentions" ADD CONSTRAINT "space_mentions_message_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."space_messages"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_mentions" ADD CONSTRAINT "space_mentions_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_mentions_user_idx" ON "public"."space_mentions" USING "btree" ("user_id", "created_at" DESC);

-- WHAT WAS LEFT ON A MESSAGE is no longer a table of this module's own: a reaction answers the
-- same question of a comment, so the pair lives in 99-reactions and this file's rooms are two
-- columns on the channel (below) saying which of them they take. The trigger that wakes the room
-- is still this module's, and still fires.

-- PINNED TO THE CHANNEL. What a room needs everybody to have read: its rules, this week's topic,
-- the link nobody can find again. A pin is the room's, not a person's — which is what makes it
-- different from Saved, two tables down, where the same message kept by one person is theirs and
-- nobody else's. So it is moderators who pin, and a pin outlives whoever made it.
--
-- A pin is a row rather than a column on the message because it has facts of its own: who put it
-- there and when, and a note saying why, which is the thing a room actually reads.
CREATE TABLE IF NOT EXISTS "public"."space_pins" (
    "channel_id" "uuid" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "pinned_by" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_pins_note_check" CHECK (("note" IS NULL) OR ("char_length"("note") <= 200))
);
ALTER TABLE ONLY "public"."space_pins" ADD CONSTRAINT "space_pins_pkey" PRIMARY KEY ("channel_id", "message_id");
ALTER TABLE ONLY "public"."space_pins" ADD CONSTRAINT "space_pins_message_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."space_messages"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_pins" ADD CONSTRAINT "space_pins_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_pins" ADD CONSTRAINT "space_pins_by_fkey" FOREIGN KEY ("pinned_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "space_pins_channel_idx" ON "public"."space_pins" USING "btree" ("channel_id", "created_at" DESC);

-- SENT LATER. Somebody writes now and the room gets it at nine.
--
-- It is not a draft: a draft is something unfinished, kept in a browser, that nobody has decided
-- about. This is a decision already made — the words are final and the only open question is when.
-- So it is a row, on the server, where it will still be at nine whatever happened to the laptop.
--
-- It stays the author's until it goes: nobody else can read it, and cancelling it is deleting the
-- row. Once it is sent it is an ordinary message and this row is gone, which is why there is no
-- "sent" column to filter on — a thing that has happened is the thing, not a record of a plan.
CREATE TABLE IF NOT EXISTS "public"."space_scheduled" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "thread_root_id" "uuid",
    "send_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- why it did not go, when it did not: the room was archived, the person was removed from it.
    -- The row stays so they are told rather than left wondering.
    "failed" "text",
    CONSTRAINT "space_scheduled_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "space_scheduled_body_check" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 8000)))
);
ALTER TABLE ONLY "public"."space_scheduled" ADD CONSTRAINT "space_scheduled_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_scheduled" ADD CONSTRAINT "space_scheduled_author_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_scheduled_due_idx" ON "public"."space_scheduled" USING "btree" ("send_at") WHERE ("failed" IS NULL);
CREATE INDEX IF NOT EXISTS "space_scheduled_mine_idx" ON "public"."space_scheduled" USING "btree" ("author_id", "send_at");

-- a message kept for later, and a channel kept at the top: both are one person's own and nobody
-- else's business, so the policy is simply that they are theirs.
CREATE TABLE IF NOT EXISTS "public"."space_saved" (
    "user_id" "uuid" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "done_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."space_saved" ADD CONSTRAINT "space_saved_pkey" PRIMARY KEY ("user_id", "message_id");
ALTER TABLE ONLY "public"."space_saved" ADD CONSTRAINT "space_saved_message_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."space_messages"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_saved" ADD CONSTRAINT "space_saved_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_saved_user_idx" ON "public"."space_saved" USING "btree" ("user_id", "created_at" DESC);

-- which channel takes which of the platform's own events (a purchase, a failed print order…)
CREATE TABLE IF NOT EXISTS "public"."space_hooks" (
    "space_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."space_hooks" ADD CONSTRAINT "space_hooks_pkey" PRIMARY KEY ("space_id", "event");
ALTER TABLE ONLY "public"."space_hooks" ADD CONSTRAINT "space_hooks_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_hooks" ADD CONSTRAINT "space_hooks_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;

-- What a person may do in a room beyond speaking in it, and where that was granted. Speaking is
-- membership and needs no row here; a voice note and an attached file are capabilities, because
-- they cost storage, are harder to moderate and a site may want to sell them. One row is one grant, and a grant is written
-- at whichever scope the site means it at — everyone, a space, a channel, a membership tier, a
-- thing somebody bought (for a while after they bought it), or one person. Any grant that matches
-- is enough; there is no deny, because a deny that beats a grant is a rule nobody can read off the
-- page. To take something away, remove the grant that gave it.
CREATE TABLE IF NOT EXISTS "public"."space_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "capability" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "space_id" "uuid",
    "channel_id" "uuid",
    "tier" "text",
    "product_key" "text",
    "user_id" "uuid",
    "role_id" "uuid",
    -- a product's grant runs this many days from the purchase (a week of voice with a session); null is for good
    "days" integer,
    "note" "text",
    -- who owns this row. 'file' is the declaration's — written by the projection and removed by it
    -- when the file stops saying so. 'hand' is somebody's: a capability given to ONE PERSON in the
    -- admin, which is an act and not a declaration (a declaration names classes of people, never a
    -- person), and which the projection never touches.
    "source" "text" DEFAULT 'hand'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "space_grants_source_check" CHECK (("source" = ANY (ARRAY['file'::"text", 'hand'::"text"]))),
    CONSTRAINT "space_grants_capability_check" CHECK (("capability" = ANY (ARRAY['voice'::"text", 'file'::"text", 'mention-channel'::"text", 'moderate'::"text", 'invite'::"text", 'announce'::"text"]))),
    CONSTRAINT "space_grants_scope_check" CHECK (("scope" = ANY (ARRAY['site'::"text", 'space'::"text", 'channel'::"text", 'tier'::"text", 'product'::"text", 'user'::"text", 'role'::"text"]))),
    CONSTRAINT "space_grants_target_check" CHECK (
         ("scope" = 'site'::"text")
      OR ("scope" = 'space'::"text"   AND "space_id"    IS NOT NULL)
      OR ("scope" = 'channel'::"text" AND "channel_id"  IS NOT NULL)
      OR ("scope" = 'tier'::"text"    AND "tier"        IS NOT NULL)
      OR ("scope" = 'product'::"text" AND "product_key" IS NOT NULL)
      OR ("scope" = 'user'::"text"    AND "user_id"     IS NOT NULL)
      OR ("scope" = 'role'::"text"    AND "role_id"     IS NOT NULL))
);
ALTER TABLE ONLY "public"."space_grants" ADD CONSTRAINT "space_grants_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."space_grants" ADD CONSTRAINT "space_grants_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_grants" ADD CONSTRAINT "space_grants_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_grants" ADD CONSTRAINT "space_grants_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_grants" ADD CONSTRAINT "space_grants_role_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."space_roles"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_grants_cap_idx" ON "public"."space_grants" USING "btree" ("capability", "scope");

-- ---------------------------------------------------------------------------------------------
-- a community: getting in, and keeping it civil
-- ---------------------------------------------------------------------------------------------

-- HOW SOMEBODY WHO BOUGHT NOTHING GETS IN. A founder, a guest, a beta: a link carrying a token,
-- made by somebody the space granted `invite`, good for so many uses and until so long. Accepting
-- makes a membership with source 'invite', which the fill sweep leaves alone — an invitation is not
-- a rule, and a rule must never take back what a person was invited to.
CREATE TABLE IF NOT EXISTS "public"."space_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "space_id" "uuid" NOT NULL,
    -- the token is the link; only its sha256 is kept, the way the API keys' and the support
    -- contacts' are, and the browser does the hashing — so the token itself is never sent here and
    -- a leak of this table is not a way into anything
    "token_hash" "text" NOT NULL,
    "made_by" "uuid",
    "role_id" "uuid",
    -- 0 is no limit
    "uses" integer DEFAULT 1 NOT NULL,
    "used" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_invites_uses_check" CHECK (("uses" >= 0 AND "used" >= 0))
);
ALTER TABLE ONLY "public"."space_invites" ADD CONSTRAINT "space_invites_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."space_invites" ADD CONSTRAINT "space_invites_token_key" UNIQUE ("token_hash");
ALTER TABLE ONLY "public"."space_invites" ADD CONSTRAINT "space_invites_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_invites" ADD CONSTRAINT "space_invites_role_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."space_roles"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."space_invites" ADD CONSTRAINT "space_invites_by_fkey" FOREIGN KEY ("made_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "space_invites_space_idx" ON "public"."space_invites" USING "btree" ("space_id", "created_at" DESC);

-- EVERY ACT OF MODERATION, WRITTEN DOWN. A report by a member, a message removed, a member muted,
-- a member removed from the space: one row each, saying who did it, to whom or to what, why, when
-- and until when. Nothing here is ever edited or deleted — a record that can be rewritten is not a
-- record — and a member may read what was done to THEM and nothing else.
--
-- A mute is a row of this table and nothing more: the insert policy on space_messages asks it, so a
-- muted member cannot write by any path, including a direct message opened before the mute.
-- Nothing is moderated by a machine: there is no word list, no score and no automatic rule
-- anywhere. A report reaches a person, and a person answers it.
CREATE TABLE IF NOT EXISTS "public"."space_moderation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    -- null for an act on a comment that belongs to no room: the desk's own moderators answer those
    "space_id" "uuid",
    -- the held comment an approve or a refuse was about
    "comment_id" "uuid",
    "kind" "text" NOT NULL,
    -- who did it: a member for a report, a moderator for the rest; null once their account is gone
    "actor_id" "uuid",
    -- who it was done to (a mute, a removal, and the author of a reported or removed message)
    "subject_id" "uuid",
    "message_id" "uuid",
    "channel_id" "uuid",
    -- the reason from the list the words offer, and optionally a line of the reporter's own
    "reason" "text",
    "note" "text",
    -- AND A THIRD THING AN ACT MAY BE ABOUT: what somebody offers to sell. Releasing an offering is
    -- the same decision as releasing a held comment — somebody reads it before anybody else can, and
    -- a quiet refusal is a decision about another person's livelihood. It belongs in the one list of
    -- things staff have done about other people's work, not in a log of its own.
    "offering_id" "uuid",
    -- a mute ends by itself
    "until" timestamp with time zone,
    -- a report is answered or it is not; the other three are acts and are done the moment they exist
    "answered_at" timestamp with time zone,
    "answered_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_moderation_kind_check" CHECK (("kind" = ANY (ARRAY['report'::"text", 'remove-message'::"text", 'mute'::"text", 'remove-member'::"text", 'ban'::"text", 'shadow-ban'::"text", 'lift'::"text", 'approve'::"text", 'refuse'::"text"]))),
    -- A FIFTH ACT, AND THE ONE THAT HAPPENS FIRST. Releasing or refusing a held comment is an act
    -- like the others and is written down like the others — and it is written down precisely because
    -- it happens BEFORE anybody else reads the words: a moderator who quietly declines to release
    -- something has made a decision about somebody's voice, and the record is what makes that
    -- answerable. A comment attached to no room has no space, which is why a row may name one or
    -- the other and must name at least one.
    CONSTRAINT "space_moderation_where_check" CHECK (("space_id" IS NOT NULL) OR ("comment_id" IS NOT NULL) OR ("offering_id" IS NOT NULL))
);
ALTER TABLE ONLY "public"."space_moderation" ADD CONSTRAINT "space_moderation_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."space_moderation" ADD CONSTRAINT "space_moderation_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_moderation" ADD CONSTRAINT "space_moderation_message_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."space_messages"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."space_moderation" ADD CONSTRAINT "space_moderation_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."space_moderation" ADD CONSTRAINT "space_moderation_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."space_moderation" ADD CONSTRAINT "space_moderation_subject_fkey" FOREIGN KEY ("subject_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
-- one report per person per message: reporting twice is one report, not two
CREATE UNIQUE INDEX IF NOT EXISTS "space_moderation_report_once_idx" ON "public"."space_moderation" USING "btree" ("message_id", "actor_id") WHERE ("kind" = 'report'::"text");
CREATE INDEX IF NOT EXISTS "space_moderation_queue_idx" ON "public"."space_moderation" USING "btree" ("space_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "space_moderation_subject_idx" ON "public"."space_moderation" USING "btree" ("subject_id", "created_at" DESC);
-- the live mutes, which the insert policy asks about on every message
CREATE INDEX IF NOT EXISTS "space_moderation_mute_idx" ON "public"."space_moderation" USING "btree" ("subject_id", "space_id", "until") WHERE ("kind" = 'mute'::"text");
-- WHAT A LIFT UNDOES. A moderator ending a ban, a shadow ban or a mute before its time writes a
-- ROW rather than editing one, because this table is a record and a record that can be rewritten is
-- not a record. So an act is live while no lift points at it, and the history says both what was
-- done and that it was undone, by whom and when.
ALTER TABLE "public"."space_moderation" ADD COLUMN IF NOT EXISTS "lifts_id" "uuid";
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_moderation" ADD CONSTRAINT "space_moderation_lifts_fkey" FOREIGN KEY ("lifts_id") REFERENCES "public"."space_moderation"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- one lift per act: lifting twice is lifting once
CREATE UNIQUE INDEX IF NOT EXISTS "space_moderation_lift_once_idx" ON "public"."space_moderation" USING "btree" ("lifts_id") WHERE ("kind" = 'lift'::"text");
-- the live bans and shadow bans, asked on the way in and on the way through
CREATE INDEX IF NOT EXISTS "space_moderation_bar_idx" ON "public"."space_moderation" USING "btree" ("subject_id", "space_id", "kind", "until") WHERE ("kind" = ANY (ARRAY['ban'::"text", 'shadow-ban'::"text"]));

-- A conversation the desk has finished with. Some sources have no idea of "done": a coaching thread
-- is a thread, a mention is a mention, and an external Social conversation belongs to its provider.
-- So the mark is the member of staff's own, kept here by source and by whatever that source
-- calls the thing — and it is only ever a mark. The support desk is the exception and keeps none
-- of these rows: it has a real status that its own inbox reads, so resolving one there resolves it
-- everywhere, which is the whole point of answering through the system that holds it.
CREATE TABLE IF NOT EXISTS "public"."desk_done" (
    "user_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "ref" "text" NOT NULL,
    "resolved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "desk_done_source_check" CHECK (("source" = ANY (ARRAY['coaching'::"text", 'space'::"text", 'social'::"text"])))
);
ALTER TABLE ONLY "public"."desk_done" ADD CONSTRAINT "desk_done_pkey" PRIMARY KEY ("user_id", "source", "ref");
ALTER TABLE ONLY "public"."desk_done" ADD CONSTRAINT "desk_done_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- who may see what: membership, and nothing else
-- ---------------------------------------------------------------------------------------------

-- what fills a space's membership. {} is invitation only and matches nobody.
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

-- A COURSE'S PEOPLE, for a space's rule: enrolled in one of the courses named, and in one of the cohorts where any are.
-- plpgsql, so the query naming the enrolments is only planned where it runs: a site with the courses module off has no
-- such table, and the rule then matches nobody rather than failing every sweep.
CREATE OR REPLACE FUNCTION "public"."space_fill_course"("p_user" "uuid", "p_set" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $f$
begin
  if p_user is null or to_regclass('public.enrollments') is null then return false; end if;
  return exists (select 1 from public.enrollments e
                  where e.user_id = p_user and e.course = any(public.space_fill_values(p_set, 'course'))
                    and (not (p_set ? 'cohort') or e.cohort = any(public.space_fill_values(p_set, 'cohort'))));
end;
$f$;
REVOKE ALL ON FUNCTION "public"."space_fill_course"("uuid", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_fill_course"("uuid", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_fill_course"("uuid", "jsonb") TO "service_role";

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
    -- ENROLLED IN A COURSE (the courses module), and in one of its cohorts where the rule names any: asked through a
    -- function of its own, which answers false where the courses module is off and there are no enrolments to ask
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
    and (not (p_set ? 'booking') or exists (
        select 1 from public.bookings b
        where b.user_id = p_user
          and coalesce(b.type, b.event) = any(public.space_fill_values(p_set, 'booking'))
          and b.status = 'accepted' and b.refused is null
          and (not (p_set ? 'within_last')
               or (b.end_at is not null and b.end_at <= now()
                   and b.end_at > now() - make_interval(mins => (p_set ->> 'within_last')::int)))
          and (not (p_set ? 'within_next')
               or (b.start_at is not null and b.start_at >= now()
                   and b.start_at < now() + make_interval(mins => (p_set ->> 'within_next')::int)))))
  ) end;
$$;

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

-- a member of the channel: joined it, whatever its visibility
CREATE OR REPLACE FUNCTION "public"."in_channel"("p_channel" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.channel_members cm where cm.channel_id = p_channel and cm.user_id = auth.uid());
$$;

-- may read the channel: a member of its space, and either the channel is open within that space or
-- they have joined it. There is no third way in, and none that does not pass through a membership.
CREATE OR REPLACE FUNCTION "public"."can_read_channel"("p_channel" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.channels c
    join public.space_members sm on sm.space_id = c.space_id and sm.user_id = auth.uid()
    where c.id = p_channel
      and (c.visibility = 'open' or exists (
        select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = auth.uid())));
$$;

-- The sets every policy is written against. They are SECURITY DEFINER on purpose, and for two
-- reasons: a policy on space_members that queried space_members would recurse for ever, and a policy
-- that reached another table through its own policy would evaluate a second policy per row. Each is
-- a STABLE set-returning function, so Postgres computes it once per statement and hashes the lookup.
CREATE OR REPLACE FUNCTION "public"."my_space_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select space_id from public.space_members where user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION "public"."my_channel_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select channel_id from public.channel_members where user_id = auth.uid();
$$;

-- every channel the caller may read: a member of its space, and the channel either open within that
-- space or one they have joined. There is no other way in.
CREATE OR REPLACE FUNCTION "public"."my_readable_channel_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.id from public.channels c
  where c.space_id in (select space_id from public.space_members where user_id = auth.uid())
    and (c.visibility = 'open'
         or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = auth.uid()));
$$;

-- and every open channel of their spaces they could join of their own accord
CREATE OR REPLACE FUNCTION "public"."my_joinable_channel_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.id from public.channels c
  where c.visibility = 'open' and c.archived_at is null
    and c.space_id in (select space_id from public.space_members where user_id = auth.uid());
$$;

-- the membership rules re-read: what they now grant is added, what they no longer grant is taken away.
-- Only rows the rule itself put there are ever removed; an invitation and a hand-made membership stay.
--
-- IT SWEEPS ROOMS TOO. A channel may carry a fill of its own, and the same sentence holds one level
-- down: granted the moment somebody matches, removed the moment they stop, and a row somebody joined
-- or was put in by hand never touched. A room's rule is NARROWER, NEVER WIDER — it is asked only of
-- people already in the space, so it can never be a way into the space around it.
CREATE OR REPLACE FUNCTION "public"."space_sync_members"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer := 0; m integer;
begin
  insert into public.space_members (space_id, user_id, source)
  select s.id, p.id, 'fill'
  from public.spaces s
  join public.profiles p on public.space_fill_matches(p.id, s.fill)
  where s.archived_at is null and s.fill <> '{}'::jsonb
  on conflict (space_id, user_id) do nothing;
  get diagnostics m = row_count; n := n + m;

  delete from public.space_members sm
  using public.spaces s
  where s.id = sm.space_id and sm.source = 'fill'
    and (s.archived_at is not null or not public.space_fill_matches(sm.user_id, s.fill));
  get diagnostics m = row_count; n := n + m;

  -- a membership that has gone takes its channel memberships with it
  delete from public.channel_members cm
  using public.channels c
  where c.id = cm.channel_id
    and not exists (select 1 from public.space_members sm
                    where sm.space_id = c.space_id and sm.user_id = cm.user_id);

  -- AND THE ROOMS WITH RULES OF THEIR OWN. Asked only of people already in the space, so a room's
  -- rule never lets anybody into the space; and written with source 'fill', so what somebody joined
  -- by hand is not swept away by a rule that has nothing to do with it.
  insert into public.channel_members (channel_id, user_id, source)
  select c.id, sm.user_id, 'fill'
  from public.channels c
  join public.space_members sm on sm.space_id = c.space_id
  where c.archived_at is null and c.fill <> '{}'::jsonb and c.kind = 'channel'
    and public.space_fill_matches(sm.user_id, c.fill)
  on conflict (channel_id, user_id) do nothing;
  get diagnostics m = row_count; n := n + m;

  delete from public.channel_members cm
  using public.channels c
  where c.id = cm.channel_id and cm.source = 'fill'
    and (c.archived_at is not null or c.fill = '{}'::jsonb
         or not public.space_fill_matches(cm.user_id, c.fill));
  get diagnostics m = row_count; n := n + m;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- the counter, the thread, the mentions, and the wake
-- ---------------------------------------------------------------------------------------------

-- every message takes the channel's next number under a lock on the channel's own row: the order is
-- gapless, and the contention is per channel rather than global.
CREATE OR REPLACE FUNCTION "public"."space_next_seq"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.channels
     set last_seq = last_seq + 1,
         last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at)
   where id = new.channel_id
  returning last_seq into new.seq;
  if new.seq is null then raise exception 'no such channel'; end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_after_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record;
begin
  -- YOU HAVE READ WHAT YOU JUST WROTE. Without this a room you spoke in last counts as unread to
  -- you until the surface happens to say otherwise, which is why a room could sit there with a
  -- badge nobody could clear by reading it, and why the count and the list of what is waiting
  -- could disagree about the same room.
  if new.author_id is not null then
    update public.channel_members
       set last_read_seq = greatest(last_read_seq, new.seq)
     where channel_id = new.channel_id and user_id = new.author_id;
  end if;

  if new.thread_root_id is not null then
    update public.space_messages
       set reply_count = reply_count + 1, last_reply_at = new.created_at
     where id = new.thread_root_id;
  end if;

  -- the composer writes a token, never a name, so this resolves exactly and survives a rename;
  -- an id that is not a member of the channel is simply not a mention.
  if new.body is not null then
    insert into public.space_mentions (message_id, channel_id, user_id, kind)
    select distinct new.id, new.channel_id, cm.user_id, 'user'
    -- the alias is never a name this function declares: plpgsql substitutes its own variables into
    -- the query, and a table aliased r beside a record variable r reads as the record.
    from regexp_matches(new.body, '<@([0-9a-fA-F-]{36})>', 'g') as tok(m)
    join public.channel_members cm on cm.channel_id = new.channel_id and cm.user_id = (tok.m[1])::uuid
    on conflict do nothing;

    -- A ROLE IS A GROUP YOU CAN NAME. `@coaches` reaches whoever holds the role in THIS space and
    -- is in THIS room — not everybody with the role everywhere, and not somebody who holds it but
    -- is not here. The role is named by its slug rather than its name, so renaming the role does
    -- not silently stop the mention working.
    insert into public.space_mentions (message_id, channel_id, user_id, kind)
    select distinct new.id, new.channel_id, cm.user_id, 'group'
    from regexp_matches(new.body, '<@role:([a-z0-9-]{1,48})>', 'g') as tok(m)
    join public.channels c on c.id = new.channel_id
    join public.space_roles sr on sr.space_id = c.space_id and sr.slug = tok.m[1]
    join public.space_member_roles mr on mr.role_id = sr.id and mr.space_id = c.space_id
    join public.channel_members cm on cm.channel_id = new.channel_id and cm.user_id = mr.user_id
    on conflict do nothing;

    if new.body like '%<!channel>%' then
      insert into public.space_mentions (message_id, channel_id, user_id, kind)
      select new.id, new.channel_id, cm.user_id, 'channel'
      from public.channel_members cm where cm.channel_id = new.channel_id
      on conflict do nothing;
    end if;

    update public.channel_members cm
       set mention_count = cm.mention_count + 1
      from public.space_mentions sm
     where sm.message_id = new.id and cm.channel_id = new.channel_id and cm.user_id = sm.user_id
       and cm.user_id is distinct from new.author_id;
  end if;

  -- who is told, and why: the decision is its own function so it can be asked directly, and the
  -- push function is handed the person because the right to this one was decided here.
  for r in select * from public.space_notify_targets(new.id) loop
    perform public.space_mail(r.space_notify_targets, new.channel_id, new.id);
    perform public.push_notify('space-mention', jsonb_build_object(
      'user', r.space_notify_targets, 'channel_id', new.channel_id,
      'channel', (select c.name from public.channels c where c.id = new.channel_id),
      'name', coalesce((select nullif(p.display_name, '') from public.profiles p where p.id = new.author_id), 'Someone'),
      'body', left(coalesce(new.title, new.body, ''), 140)));
  end loop;

  perform public.space_wake(new.channel_id, 'message', jsonb_build_object(
    'id', new.id, 'seq', new.seq, 'channel', new.channel_id, 'root', new.thread_root_id,
    'author', new.author_id, 'kind', new.kind, 'title', new.title,
    'body', case when length(coalesce(new.body, '')) <= 4000 then new.body else null end,
    'attachment', new.attachment, 'attachment_type', new.attachment_type, 'seconds', new.seconds,
    'meta', new.meta, 'at', new.created_at));
  return null;
end;
$$;

-- the database is what sends on a channel's topic, so what a client receives is exactly what was
-- written; the topic is private and the policy below is the same rule as reading.
CREATE OR REPLACE FUNCTION "public"."space_wake"("p_channel" "uuid", "p_event" "text", "p_payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform realtime.send(p_payload, p_event, 'sp:' || p_channel::text, true);
exception when others then
  null; -- a message is never lost because the socket was
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_message_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.space_wake(new.channel_id, case when new.deleted_at is not null then 'withdrawn' else 'edited' end,
    jsonb_build_object('id', new.id, 'seq', new.seq, 'channel', new.channel_id,
      'body', case when new.deleted_at is null then new.body else null end,
      'title', case when new.deleted_at is null then new.title else null end,
      'edited_at', new.edited_at, 'deleted_at', new.deleted_at));
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_reaction_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- never coalesce(new, old): on an insert OLD is not assigned at all, and reading it is an error
  -- rather than a null. The operation says which row there is.
  --
  -- A REACTION ON A COMMENT HAS NO ROOM TO WAKE. The table serves both surfaces now (99-reactions),
  -- and a row that is not a message's carries no channel — waking on it would be waking nobody.
  if tg_op = 'DELETE' then
    if old.surface is distinct from 'message' or old.channel_id is null then return null; end if;
    perform public.space_wake(old.channel_id, 'reaction', jsonb_build_object(
      'message', old.target_id, 'user', old.user_id, 'emoji', old.emoji, 'on', false));
  else
    if new.surface is distinct from 'message' or new.channel_id is null then return null; end if;
    perform public.space_wake(new.channel_id, 'reaction', jsonb_build_object(
      'message', new.target_id, 'user', new.user_id, 'emoji', new.emoji, 'on', true));
  end if;
  return null;
end;
$$;

-- a message is rewritten by whoever wrote it and says that it was; nothing else about it moves.
-- auth.role() reads the request's claim and not the effective database role, so a SECURITY DEFINER
-- trigger of ours still looks like the caller here: the depth is what tells the module's own writes
-- (a thread's reply count) from a client's, and without it the guard refuses the trigger that keeps
-- a thread counted and takes the whole insert down with it.
CREATE OR REPLACE FUNCTION "public"."guard_space_message_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if auth.role() in ('anon', 'authenticated') then
    if new.channel_id is distinct from old.channel_id
       or new.seq is distinct from old.seq
       or new.author_id is distinct from old.author_id
       or new.kind is distinct from old.kind
       or new.thread_root_id is distinct from old.thread_root_id
       or new.attachment is distinct from old.attachment
       or new.seconds is distinct from old.seconds
       or new.meta is distinct from old.meta
       or (new.poll_closed_at is distinct from old.poll_closed_at
           -- only space_poll_close may close one; it says so for its own transaction
           and coalesce(current_setting('app.closing_poll', true), '') <> '1')
       or ((new.choice_at is distinct from old.choice_at
            or new.choice_key is distinct from old.choice_key
            or new.choice_by is distinct from old.choice_by)
           -- and only space_choose may take an offer, the same way
           and coalesce(current_setting('app.taking_choice', true), '') <> '1')
       or new.reply_count is distinct from old.reply_count
       or new.echoed is distinct from old.echoed
       or new.created_at is distinct from old.created_at then
      raise exception 'only the words are yours to change';
    end if;
    if (new.body is distinct from old.body or new.title is distinct from old.title) then
      -- a moderator may take a message back; nobody may put words in somebody else's mouth
      if new.author_id is distinct from auth.uid() then
        raise exception 'the words are the author''s; a moderator may withdraw, never rewrite';
      end if;
      new.edited_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- the reads: a counter, a cursor, a page — never a walk
-- ---------------------------------------------------------------------------------------------

-- the whole unread picture in one question: cost proportional to the channels a person is in, and
-- independent of how much has ever been said in them.
CREATE OR REPLACE FUNCTION "public"."space_unread"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel', c.id, 'space', c.space_id, 'kind', c.kind, 'seq', c.last_seq, 'read', cm.last_read_seq,
    'unread', greatest(c.last_seq - cm.last_read_seq, 0), 'mentions', cm.mention_count,
    'notify', cm.notify, 'muted_until', cm.muted_until, 'last_message_at', c.last_message_at,
    -- quiet by the reader's own mute of this room or of the space it is in. It is a separate fact
    -- from muted_until (which is this membership's own snooze) because a space muted once must not
    -- have to write a row onto every room in it, and must cover the rooms it gains next week.
    'hushed', public.space_hushed(c.id),
    'voice', public.space_may(c.id, 'voice'),
    'file', public.space_may(c.id, 'file'),
    'mention', public.space_may(c.id, 'mention-channel')
  ) order by c.last_message_at desc nulls last, c.id), '[]'::jsonb)
  from public.channel_members cm
  join public.channels c on c.id = cm.channel_id
  where cm.user_id = auth.uid() and c.archived_at is null;
$$;

-- A channel declared after people are already in the space takes them with it, for the same reason:
-- an open room of a space you are in is a room you are in. The projection makes the channel; this
-- is what puts the space's members into it.
CREATE OR REPLACE FUNCTION "public"."space_room_made"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.kind <> 'channel' or new.visibility <> 'open' or new.archived_at is not null then return null; end if;
  insert into public.channel_members (channel_id, user_id)
  select new.id, sm.user_id from public.space_members sm where sm.space_id = new.space_id
  on conflict do nothing;
  return null;
end;
$$;

-- Being in the space is being a member. A space's ROLES are declared in its own file (a template
-- writes the usual three), and this is what hands out the one every member holds: a space that
-- declares a role slugged 'member' gives it on joining, and one that declares none gives nothing.
-- Holding a role is always a row, so every question about one is the same question.
CREATE OR REPLACE FUNCTION "public"."space_joined"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.space_member_roles (space_id, user_id, role_id)
  select new.space_id, new.user_id, r.id from public.space_roles r
   where r.space_id = new.space_id and r.slug = 'member'
  on conflict do nothing;
  -- AND THE OPEN ROOMS ARE THEIRS FROM THE START. An open channel is open within its space, so
  -- somebody in the space is somebody who may be in it; making them find each room and press join
  -- is a chore the word "open" already said they should not have. It belongs here rather than in
  -- whatever made the membership, because there are four of those — the fill sweep, one person's
  -- own sweep when their standing changes, an invitation accepted, and an administrator adding
  -- somebody — and a community where almost everybody arrives by a rule would otherwise open on an
  -- empty rail. A private room is still joined by being put in it.
  insert into public.channel_members (channel_id, user_id)
  select c.id, new.user_id from public.channels c
   where c.space_id = new.space_id and c.kind = 'channel'
     and c.visibility = 'open' and c.archived_at is null
  on conflict do nothing;
  return null;
end;
$$;

-- Does this person hold this role here? A role is asked of by the name a site gave it.
CREATE OR REPLACE FUNCTION "public"."space_holds"("p_space" "uuid", "p_role" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.space_member_roles mr
      join public.space_roles r on r.id = mr.role_id
     where mr.space_id = p_space and mr.user_id = auth.uid() and r.slug = p_role);
$$;

-- May the caller do this in this room? Every scope is read at once and any match is enough. Staff
-- always may: the desk answers in every room there is, and a rule that could lock them out of one
-- would be a rule about the wrong people.
CREATE OR REPLACE FUNCTION "public"."space_may"("p_channel" "uuid", "p_capability" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_staff() or exists (
    select 1
      from public.space_grants g
      left join public.channels c on c.id = p_channel
     where g.capability = p_capability
       -- WHERE it applies: a grant that names a space or a channel applies there and nowhere else,
       -- whatever its scope. Without this a tier's grant declared in one space would be a grant in
       -- every space on the instance, which is not what the file that holds it says.
       and (g.space_id is null or g.space_id = c.space_id)
       and (g.channel_id is null or g.channel_id = p_channel)
       -- and WHO it applies to
       and (
            g.scope in ('site', 'space', 'channel')
         or (g.scope = 'user'    and g.user_id    = auth.uid())
         or (g.scope = 'role'    and exists (
               select 1 from public.space_member_roles mr
                where mr.role_id = g.role_id and mr.user_id = auth.uid()))
         or (g.scope = 'tier'    and exists (
               select 1 from public.entitlements e
                where e.user_id = auth.uid() and e.kind = 'class' and e.key = 'subscribed'
                  and e.active and (e.expires_at is null or e.expires_at > now())
                  and e.tier = g.tier))
         or (g.scope = 'product' and exists (
               select 1 from public.purchases pu
                where pu.user_id = auth.uid() and pu.status = 'paid' and pu.key = g.product_key
                  and (g.days is null or pu.created_at > now() - make_interval(days => g.days))))
       ));
$$;

-- GIVING ONE PERSON A CAPABILITY, AND TAKING IT BACK. The table takes no write from a browser —
-- it holds the declaration's rows beside these — so an administrator's act goes through here: the
-- row is marked 'hand', it names a person, and the projection leaves it alone for ever. A week of
-- voice thrown in with a coaching call is the file's job (bought:<sku> with days); this is the
-- other thing, the one-off nobody could have written down in advance.
CREATE OR REPLACE FUNCTION "public"."space_grant_person"("p_user" "uuid", "p_capability" "text", "p_space" "uuid" DEFAULT NULL::"uuid", "p_channel" "uuid" DEFAULT NULL::"uuid", "p_days" integer DEFAULT NULL::integer, "p_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare gid uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  insert into public.space_grants (capability, scope, user_id, space_id, channel_id, days, note, source, created_by)
  values (p_capability, 'user', p_user, p_space, p_channel, p_days, p_note, 'hand', auth.uid())
  returning id into gid;
  return gid;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_ungrant"("p_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  -- a declared grant is taken back by editing the file that gives it, never from here
  delete from public.space_grants where id = p_id and source = 'hand';
  return found;
end;
$$;

-- Profiles are self-select, so there is no way for an administrator to look somebody up in order to
-- put them in a room. This is that way and nothing more: a name, an address and a role, for admins
-- alone, over a search of at least two characters, capped.
CREATE OR REPLACE FUNCTION "public"."space_find_people"("q" "text" DEFAULT ''::"text", "lim" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_admin() and length(trim(coalesce(q, ''))) >= 2 then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
      'email', p.email, 'roles', to_jsonb(p.roles)) order by p.display_name, p.email)
    from (select * from public.profiles x
           where x.display_name ilike '%' || trim(q) || '%' or x.email ilike '%' || trim(q) || '%'
           order by x.display_name, x.email
           limit greatest(1, least(coalesce(lim, 20), 100))) p
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;

-- The names behind a set of ids, for staff drawing a list of people they administer. Profiles are
-- self-select, so without this an admin screen can show a room full of uuids.
CREATE OR REPLACE FUNCTION "public"."space_people_named"("p_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_staff() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
      'email', p.email, 'roles', to_jsonb(p.roles)))
    from public.profiles p where p.id = any(coalesce(p_ids, '{}'::uuid[]))
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;

-- a client that has been away sends what it last saw per channel and receives only what is newer;
-- a channel further behind than the cap comes back marked, never silently trimmed.
CREATE OR REPLACE FUNCTION "public"."space_catchup"("p_cursors" "jsonb" DEFAULT '{}'::"jsonb", "p_lim" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with lim as (select least(greatest(coalesce(p_lim, 50), 1), 200) as n),
  want as (
    select (e.k)::uuid as channel_id, (e.v #>> '{}')::bigint as seq
    from jsonb_each(coalesce(p_cursors, '{}'::jsonb)) as e(k, v)
  ),
  mine as (
    select c.id, c.last_seq, coalesce(w.seq, 0) as from_seq
    from public.channel_members cm
    join public.channels c on c.id = cm.channel_id
    left join want w on w.channel_id = c.id
    where cm.user_id = auth.uid() and c.archived_at is null
      and c.last_seq > coalesce(w.seq, 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'channel', mine.id, 'from', mine.from_seq,
      'more', (mine.last_seq - mine.from_seq) > (select n from lim),
      'messages', coalesce(m.rows, '[]'::jsonb))), '[]'::jsonb)
  from mine
  left join lateral (
    select jsonb_agg(to_jsonb(x) - 'fts' order by x.seq) as rows
    from (select * from public.space_messages sm
           where sm.channel_id = mine.id and sm.seq > mine.from_seq
             and public.space_sees(sm.shadowed, sm.author_id, sm.channel_id)
           order by sm.seq limit (select n from lim)) x
  ) m on true;
$$;

-- a page of a channel, newest first, by the key and never by an offset
CREATE OR REPLACE FUNCTION "public"."space_history"("p_channel" "uuid", "p_before" bigint DEFAULT NULL::bigint, "p_lim" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.can_read_channel(p_channel) then null else coalesce((
    select jsonb_agg(to_jsonb(x) - 'fts' order by x.seq)
    from (select * from public.space_messages sm
           where sm.channel_id = p_channel
             and public.space_sees(sm.shadowed, sm.author_id, sm.channel_id)
             and (sm.thread_root_id is null or sm.echoed)
             and (p_before is null or sm.seq < p_before)
             -- as far back as this person's plan keeps, and no further
             and sm.created_at >= coalesce(public.space_horizon_in(p_channel), '-infinity')
           order by sm.seq desc limit least(greatest(coalesce(p_lim, 50), 1), 200)) x), '[]'::jsonb) end;
$$;

-- a forum channel's posts, newest reply first
-- A BOARD IS AN INDEX OF CONVERSATIONS, not a list of first lines. What makes one readable at a
-- glance is who is in each and when it last moved, so a post carries three things beyond itself:
--   voices       — up to five people who have said something in it, the most recent first, drawn as
--                  a stack of faces. A row of identical cards tells you nothing; faces tell you
--                  whether this is a conversation or a notice nobody answered.
--   last_reply_by — who spoke last, so the card can say "Ada replied" rather than a bare date.
--   pinned       — what the room has pinned, which the board puts above everything else.
-- All three are read from rows that are already indexed for it; none is a new table and none is
-- written anywhere. A post with no replies simply has one voice, itself.
CREATE OR REPLACE FUNCTION "public"."space_posts"("p_channel" "uuid", "p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_lim" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.can_read_channel(p_channel) then null else coalesce((
    select jsonb_agg(
      (to_jsonb(x) - 'fts')
      || jsonb_build_object(
           'pinned', exists (select 1 from public.space_pins pn where pn.message_id = x.id),
           'last_reply_by', (select r.author_id from public.space_messages r
                              where r.thread_root_id = x.id and r.deleted_at is null
                              order by r.seq desc limit 1),
           'voices', coalesce((
             select jsonb_agg(v.author_id order by v.said desc)
             from (select a.author_id, max(a.seq) as said
                     from (select author_id, seq from public.space_messages
                            where id = x.id
                           union all
                           select author_id, seq from public.space_messages
                            where thread_root_id = x.id and deleted_at is null) a
                    where a.author_id is not null
                    group by a.author_id
                    order by max(a.seq) desc
                    limit 5) v), '[]'::jsonb))
      order by coalesce(x.last_reply_at, x.created_at) desc)
    from (select * from public.space_messages sm
           where sm.channel_id = p_channel and sm.thread_root_id is null and sm.deleted_at is null
             and public.space_sees(sm.shadowed, sm.author_id, sm.channel_id)
             and (p_before is null or coalesce(sm.last_reply_at, sm.created_at) < p_before)
             -- a board is read to the same horizon as a stream: a post older than the plan keeps is
             -- not listed, and its replies are not reachable through it either
             and coalesce(sm.last_reply_at, sm.created_at) >= coalesce(public.space_horizon_in(p_channel), '-infinity')
           order by coalesce(sm.last_reply_at, sm.created_at) desc
           limit least(greatest(coalesce(p_lim, 30), 1), 100)) x), '[]'::jsonb) end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_thread"("p_root" "uuid", "p_after" bigint DEFAULT 0, "p_lim" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with root as (select * from public.space_messages where id = p_root)
  select case when not exists (select 1 from root) or not public.can_read_channel((select channel_id from root))
    then null else jsonb_build_object(
      'root', (select to_jsonb(r) - 'fts' from root r),
      'replies', coalesce((
        select jsonb_agg(to_jsonb(x) - 'fts' order by x.seq)
        from (select * from public.space_messages sm
               where sm.thread_root_id = p_root and sm.seq > coalesce(p_after, 0)
                 and public.space_sees(sm.shadowed, sm.author_id, sm.channel_id)
               order by sm.seq limit least(greatest(coalesce(p_lim, 100), 1), 200)) x), '[]'::jsonb)) end;
$$;

-- read to here: the counter moves, and the mentions left above it are what is still owed
CREATE OR REPLACE FUNCTION "public"."space_read"("p_channel" "uuid", "p_seq" bigint) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.channel_members cm
     set last_read_seq = greatest(cm.last_read_seq, coalesce(p_seq, 0)),
         mention_count = (select count(*) from public.space_mentions sm
                           join public.space_messages m on m.id = sm.message_id
                          where sm.channel_id = p_channel and sm.user_id = auth.uid()
                            and m.seq > greatest(cm.last_read_seq, coalesce(p_seq, 0)))
   where cm.channel_id = p_channel and cm.user_id = auth.uid();
$$;

-- every message the asker may read in their spaces, narrowed by who, where and when. The candidate
-- set is their channels, so no narrowing can widen the reach.
CREATE OR REPLACE FUNCTION "public"."space_search"("p_q" "text", "p_space" "uuid" DEFAULT NULL::"uuid", "p_channel" "uuid" DEFAULT NULL::"uuid", "p_from" "uuid" DEFAULT NULL::"uuid", "p_after" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_lim" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select m.id, m.channel_id, c.space_id, m.seq, m.thread_root_id, m.author_id, m.kind,
           m.title, m.body, m.created_at
    from public.space_messages m
    join public.channels c on c.id = m.channel_id
    join public.channel_members cm on cm.channel_id = m.channel_id and cm.user_id = auth.uid()
    where m.deleted_at is null
      and public.space_sees(m.shadowed, m.author_id, m.channel_id)
      and m.fts @@ websearch_to_tsquery('simple', coalesce(p_q, ''))
      and (p_space is null or c.space_id = p_space)
      and (p_channel is null or m.channel_id = p_channel)
      and (p_from is null or m.author_id = p_from)
      and (p_after is null or m.created_at >= p_after)
      and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit least(greatest(coalesce(p_lim, 30), 1), 100)) x;
$$;

-- who is in a space, and who may be named in one of its channels. Profiles are self-select, so this
-- is the only way a member learns another member's name — and it answers nothing to somebody who is
-- not in the space, whatever they ask for.
-- WHO MAY SEE THE SECOND HALF OF SOMEBODY'S CARD: that person, or a member of staff. It is written
-- here once and nowhere else — every read that answers what somebody has read, scored or bought asks
-- this before answering, including the reads a SITE writes for its own panels, so the rule cannot
-- drift apart between them. STABLE so Postgres evaluates it once per statement.
CREATE OR REPLACE FUNCTION "public"."may_see_member"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p_user is not null and (p_user = auth.uid() or public.is_staff());
$$;

-- THE PRIVATE HALF OF A MEMBER'S CARD: what somebody has read, where the instrument placed them, what they have bought.
-- Each asks may_see_member first (that person, or staff), and a refusal is the same shape as nothing to show, so a peer
-- learns nothing from the difference. The theme draws one panel for each, where its module is on.

-- What they have read: the books and articles they opened, most recent first, from the events their own browser
-- recorded. The title travels on the event, so a book renamed or unpublished since still reads as it was.
CREATE OR REPLACE FUNCTION "public"."member_read"("p_user" "uuid", "p_lim" integer DEFAULT 8) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.may_see_member(p_user) then '[]'::jsonb else coalesce((
    select jsonb_agg(x order by x.last_at desc) from (
      select e.props ->> 'kind' as kind, e.props ->> 'id' as id, e.props ->> 'title' as title,
             max(e.occurred_at) as last_at, count(*) as times
        from public.events e
       where e.user_id = p_user and e.type in ('content_view', 'content_read') and coalesce(e.props ->> 'id', '') <> ''
       group by 1, 2, 3
       order by max(e.occurred_at) desc
       limit least(greatest(coalesce(p_lim, 8), 1), 50)
    ) x
  ), '[]'::jsonb) end
$$;

-- Where they are working: what the instrument's sheet placed them at, as their own browser wrote it to signals — the
-- level, what is secure, the areas taken. A reading of their own result, never a second scoring of it.
CREATE OR REPLACE FUNCTION "public"."member_working"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.may_see_member(p_user) then null else (
    select jsonb_build_object('working', s.working, 'secured', s.secured, 'areas', to_jsonb(s.areas), 'at', s.updated_at)
      from public.signals s where s.user_id = p_user
  ) end
$$;

-- What they have bought: their paid purchases, newest first, from the one source the admin reads too.
CREATE OR REPLACE FUNCTION "public"."member_bought"("p_user" "uuid", "p_lim" integer DEFAULT 8) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.may_see_member(p_user) then '[]'::jsonb
              else public.person_purchases(p_user, coalesce(p_lim, 8), true) end
$$;

GRANT EXECUTE ON FUNCTION "public"."member_read"("uuid", integer) TO "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."member_working"("uuid") TO "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."member_bought"("uuid", integer) TO "authenticated", "service_role";

-- The public half of a person's card: what the directory already says, and the line they wrote about
-- themselves. Refused unless BOTH the caller and the subject are in that space — the fence
-- space_people has, said about a pair rather than a list. Presence is not in it: it is already live
-- on the space's own topic, and asking the database would be a second, staler answer to a question
-- already answered.
CREATE OR REPLACE FUNCTION "public"."space_member_card"("p_space" "uuid", "p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_space is null or p_user is null then null
    when p_space not in (select space_id from public.space_members where user_id = auth.uid()) then null
    when not exists (select 1 from public.space_members where space_id = p_space and user_id = p_user) then null
    else (
      select jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
        'about', nullif(p.about, ''),
        'since', sm.joined_at,
        'roles', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'name', r.name, 'colour', r.colour)
                                       order by r.rank desc, r.name)
                             from public.space_member_roles mr
                             join public.space_roles r on r.id = mr.role_id
                            where mr.space_id = p_space and mr.user_id = p_user), '[]'::jsonb),
        -- how much they have said in THIS space: their own messages that still stand
        'said', (select count(*) from public.space_messages m
                   join public.channels c on c.id = m.channel_id
                  where c.space_id = p_space and m.author_id = p_user and m.deleted_at is null),
        -- the badges this space has given them, in the file's order
        'flair', coalesce((select jsonb_agg(jsonb_build_object('slug', fl.slug, 'name', fl.name, 'colour', fl.colour,
                                                               'icon', fl.icon, 'note', fl.note, 'inline', fl.inline)
                                      order by fl.position, fl.name)
                             from public.space_member_flair mf
                             join public.space_flair fl on fl.id = mf.flair_id
                            where fl.space_id = p_space and mf.user_id = p_user), '[]'::jsonb),
        -- their own picture and the style they chose, so a card draws the face they meant
        'avatar', nullif(p.avatar, ''), 'avatar_style', nullif(p.avatar_style, ''),
        'avatar_seed', coalesce(nullif(p.avatar_seed, ''), md5(lower(coalesce(nullif(p.email, ''), p.id::text)))),
        -- …and the options they drew it with, without which the card draws a different face
        'avatar_options', p.avatar_options,
        -- whether the caller may give a badge out here, so the card need not ask a second time
        'may_flair', exists (select 1 from public.channels c where c.space_id = p_space and public.space_may(c.id, 'moderate')),
        -- whether the caller may be shown the second half at all, so the surface need not guess
        'more', public.may_see_member(p_user)
      )
      from public.profiles p
      join public.space_members sm on sm.user_id = p.id and sm.space_id = p_space
      where p.id = p_user
    )
  end
$$;

CREATE OR REPLACE FUNCTION "public"."space_people"("p_space" "uuid", "p_channel" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_space is null or p_space not in (select space_id from public.space_members where user_id = auth.uid()) then '[]'::jsonb
    when p_channel is not null and not public.can_read_channel(p_channel) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
        'about', nullif(p.about, ''),
        'roles', coalesce((select jsonb_agg(r.slug order by r.rank desc, r.name)
                              from public.space_member_roles mr
                              join public.space_roles r on r.id = mr.role_id
                             where mr.space_id = sm.space_id and mr.user_id = sm.user_id), '[]'::jsonb),
        -- the same roles said the way the site named them, for anywhere a person reads them
        'wearing', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'colour', r.colour) order by r.rank desc, r.name)
                              from public.space_member_roles mr
                              join public.space_roles r on r.id = mr.role_id
                             where mr.space_id = sm.space_id and mr.user_id = sm.user_id), '[]'::jsonb),
        -- and the flair they have been given here, in the order the file listed it. It rides with
        -- the person rather than being asked for one at a time: a directory of two hundred people
        -- would otherwise be two hundred calls to draw one row of badges.
        'flair', coalesce((select jsonb_agg(jsonb_build_object('slug', fl.slug, 'name', fl.name, 'colour', fl.colour,
                                                              'icon', fl.icon, 'note', fl.note, 'inline', fl.inline)
                                     order by fl.position, fl.name)
                              from public.space_member_flair mf
                              join public.space_flair fl on fl.id = mf.flair_id
                             where fl.space_id = sm.space_id and mf.user_id = sm.user_id), '[]'::jsonb),
        -- their own picture, or the style they picked their drawn one from
        'avatar', nullif(p.avatar, ''), 'avatar_style', nullif(p.avatar_style, ''),
        'avatar_seed', coalesce(nullif(p.avatar_seed, ''), md5(lower(coalesce(nullif(p.email, ''), p.id::text)))),
        'avatar_options', p.avatar_options
      ) order by lower(coalesce(nullif(p.display_name, ''), p.email)))
      from public.space_members sm
      join public.profiles p on p.id = sm.user_id
      where sm.space_id = p_space
        and (p_channel is null or exists (
          select 1 from public.channel_members cm where cm.channel_id = p_channel and cm.user_id = sm.user_id))
    ), '[]'::jsonb)
  end;
$$;

-- Who a message notifies. A notification follows a mention, a reply in a thread the person is in,
-- or a channel they asked to hear everything from — never an unread message, never their own, never
-- a muted channel, and never one set to nothing. It is a function of its own so that what decides a
-- notification can be asked, and pinned, rather than only observed.
CREATE OR REPLACE FUNCTION "public"."space_notify_targets"("p_message" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select cm.user_id
  from public.space_messages msg
  join public.channel_members cm on cm.channel_id = msg.channel_id
  where msg.id = p_message
    and msg.deleted_at is null
    and cm.user_id is distinct from msg.author_id
    and cm.notify <> 'none'
    and (cm.muted_until is null or cm.muted_until <= now())
    -- and the three mutes of the reader's own: this room, the space it is in, or whoever wrote it
    and not public.space_hushed(msg.channel_id, cm.user_id)
    and not public.space_hushed_person(msg.author_id, cm.user_id)
    and (
      cm.notify = 'all'
      or exists (select 1 from public.space_mentions sm where sm.message_id = msg.id and sm.user_id = cm.user_id)
      or (msg.thread_root_id is not null and exists (
            select 1 from public.space_messages m
            where (m.id = msg.thread_root_id or m.thread_root_id = msg.thread_root_id)
              and m.id <> msg.id and m.author_id = cm.user_id))
    );
$$;

-- Open the one direct message between these people, making it if there is none. The key is their
-- ids sorted and joined, so the same set of people always finds the same room however they ask for
-- it — which is why a DM is opened through here and never inserted by a client.
-- A DIRECT MESSAGE, OPENED ONCE. Everyone asked for plus the asker, in one order, so there is
-- exactly one conversation per set of people however many times anybody asks for it.
--
-- TWO SWITCHES STAND IN FRONT OF IT, and they are different in kind. The SPACE says whether it has
-- direct messages at all — its own decision, the same for everybody in it, and so a line in its
-- file. A PERSON says whether they will be written to here — theirs alone, per space, and a row.
--
-- Declining stops the OPEN and nothing else. The find below comes first, so a conversation that
-- already exists is handed back exactly as it always was: a switch that silently removed
-- conversations would not be an opt-out, it would be a way to lose things. And STAFF may still
-- open one, or somebody could make themselves unanswerable by the very people answering their
-- questions.
CREATE OR REPLACE FUNCTION "public"."space_dm_open"("p_space" "uuid", "p_with" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare me uuid := auth.uid(); ids uuid[]; k text; cid uuid; u uuid; shut uuid;
begin
  if me is null then raise exception 'sign in'; end if;
  if not public.community_admitted('messages') then raise exception 'not allowed'; end if;
  if p_space is null or p_space not in (select space_id from public.space_members where user_id = me) then
    raise exception 'not your space';
  end if;
  -- everyone asked for, plus the asker, once each, in one order. A null is not a person: it is what a
  -- caller gets for asking about somebody they may not read, and it must never become a membership.
  select array_agg(distinct x) into ids
    from unnest(array_append(coalesce(p_with, '{}'::uuid[]), me)) as x where x is not null;
  if array_length(ids, 1) is null or array_length(ids, 1) < 2 then raise exception 'who with'; end if;
  if exists (select 1 from unnest(ids) as x
             where not exists (select 1 from public.space_members sm where sm.space_id = p_space and sm.user_id = x)) then
    raise exception 'not in this space';
  end if;
  select string_agg(x::text, ',' order by x::text) into k from unnest(ids) as x;

  select id into cid from public.channels where space_id = p_space and dm_key = k;
  -- THE ONE THAT ALREADY EXISTS IS HANDED BACK WHATEVER EITHER SWITCH SAYS. Somebody who declines
  -- keeps every conversation they are in, on both sides, and finds them all where they left them
  -- if they change their mind.
  if cid is not null then return cid; end if;

  -- a space that says it has none has said it for everybody, staff included
  if not (select dms from public.spaces where id = p_space) then
    raise exception 'no direct messages here';
  end if;
  -- and somebody who has declined is not written to by anybody but the people who answer for the
  -- site. The asker is exempt from their own switch: declining is about being written TO.
  if not public.is_staff() then
    select sm.user_id into shut from public.space_members sm
      where sm.space_id = p_space and sm.user_id = any(ids) and sm.user_id <> me and not sm.dms
      limit 1;
    if shut is not null then raise exception 'not taking direct messages'; end if;
  end if;

  insert into public.channels (space_id, slug, name, kind, dm_key, mode, visibility, created_by)
  values (p_space, 'dm-' || substr(md5(k), 1, 12), '', 'dm', k, 'stream', 'private', me)
  on conflict (space_id, dm_key) do update set dm_key = excluded.dm_key
  returning id into cid;
  foreach u in array ids loop
    insert into public.channel_members (channel_id, user_id) values (cid, u) on conflict do nothing;
  end loop;
  return cid;
end;
$$;

-- WHERE THE CALLER MAY WRITE TO SOMEBODY — for a Message button on a person's page: the first space
-- they share in which a direct message between them already exists, or may be opened under exactly
-- the rules space_dm_open keeps (the space has direct messages, and the person has not declined them
-- there, unless the caller answers for the site). Null where there is none; space_dm_open still
-- decides when it is pressed, so this only says whether to offer it.
CREATE OR REPLACE FUNCTION "public"."space_dm_where"("p_with" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select s.id from public.spaces s
  join public.space_members a on a.space_id = s.id and a.user_id = auth.uid()
  join public.space_members b on b.space_id = s.id and b.user_id = p_with
  where auth.uid() is not null and p_with is not null and p_with <> auth.uid() and s.archived_at is null
    and (exists (select 1 from public.channels c
                 where c.space_id = s.id and c.dm_key = (select string_agg(x::text, ',' order by x::text) from unnest(array[auth.uid(), p_with]) as x))
         or (s.dms and (b.dms or public.is_staff())))
  order by s.position, s.name
  limit 1;
$$;
REVOKE ALL ON FUNCTION "public"."space_dm_where"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_dm_where"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_dm_where"("uuid") TO "authenticated", "service_role";

-- WHETHER THIS PERSON WILL BE WRITTEN TO IN THIS SPACE — theirs to set and nobody else's, which is
-- why it is a function and not a column anybody may update: space_members carries counters and a
-- source that a member must never be able to write, so the row is not theirs to update wholesale.
CREATE OR REPLACE FUNCTION "public"."space_set_dms"("p_space" "uuid", "p_on" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  update public.space_members set dms = coalesce(p_on, true)
   where space_id = p_space and user_id = auth.uid();
  if not found then raise exception 'not your space'; end if;
  return coalesce(p_on, true);
end;
$$;
REVOKE ALL ON FUNCTION "public"."space_set_dms"("uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_set_dms"("uuid", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_set_dms"("uuid", boolean) TO "authenticated", "service_role";

-- EVERY DIRECT MESSAGE THE CALLER IS IN, across every space, newest first — the DMs view. It
-- answers with who is in each one BY NAME, because a direct message has no name of its own and the
-- names a page holds belong to the space it has open; a DM in another space would otherwise be
-- addressed to "someone". Profiles are self-select, so this is the security-definer that says who
-- somebody is — and only ever about a person the caller shares a direct message with.
CREATE OR REPLACE FUNCTION "public"."space_dms"("p_lim" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with mine as (
    select c.id, c.space_id, c.last_seq, c.last_message_at,
           cm.last_read_seq, cm.mention_count, cm.muted_until
    from public.channel_members cm
    join public.channels c on c.id = cm.channel_id
    where cm.user_id = auth.uid() and c.kind = 'dm' and c.archived_at is null
      and public.community_admitted('messages')
    order by c.last_message_at desc nulls last, c.id
    limit least(greatest(coalesce(p_lim, 100), 1), 300)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel', d.id,
    'space', d.space_id,
    'space_name', (select s.name from public.spaces s where s.id = d.space_id),
    'members', (select coalesce(jsonb_agg(x.user_id), '[]'::jsonb)
                  from public.channel_members x where x.channel_id = d.id),
    -- everybody but the caller, by name, in the order the title says them
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', pr.id,
                        'name', coalesce(nullif(pr.display_name, ''), split_part(coalesce(pr.email, ''), '@', 1))
                      ) order by pr.display_name, pr.email), '[]'::jsonb)
                  from public.channel_members x
                  join public.profiles pr on pr.id = x.user_id
                  where x.channel_id = d.id and x.user_id <> auth.uid()),
    'unread', greatest(d.last_seq - d.last_read_seq, 0),
    'mentions', d.mention_count,
    'muted_until', d.muted_until,
    'last_message_at', d.last_message_at,
    -- the line itself, trimmed: a list shows a line, never a message
    'last', (select jsonb_build_object('author', m.author_id, 'kind', m.kind,
                                       'body', left(coalesce(m.body, ''), 240), 'at', m.created_at)
               from public.space_messages m
               where m.channel_id = d.id and m.deleted_at is null
               order by m.seq desc limit 1)
  ) order by d.last_message_at desc nulls last, d.id), '[]'::jsonb)
  from mine d;
$$;

-- Every thread the caller is in — they wrote its root or answered it — newest answer first, with
-- the root, who is in it and how many replies. This is the Threads view, and it is a read rather
-- than a walk of anything.
CREATE OR REPLACE FUNCTION "public"."space_threads"("p_lim" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with mine as (
    select distinct coalesce(m.thread_root_id, m.id) as root_id
    from public.space_messages m
    join public.channel_members cm on cm.channel_id = m.channel_id and cm.user_id = auth.uid()
    where m.author_id = auth.uid() and m.deleted_at is null
      and (m.thread_root_id is not null or m.reply_count > 0)
  )
  select coalesce(jsonb_agg(x order by x.last_at desc), '[]'::jsonb) from (
    select r.id, r.channel_id, c.name as channel, c.kind as channel_kind,
           to_jsonb(r) - 'fts' as root,
           coalesce(r.last_reply_at, r.created_at) as last_at,
           r.reply_count,
           (select coalesce(jsonb_agg(distinct p.author_id), '[]'::jsonb)
              from public.space_messages p where p.thread_root_id = r.id and p.author_id is not null) as people,
           (select coalesce(jsonb_agg(to_jsonb(q) - 'fts' order by q.seq), '[]'::jsonb)
              from (select * from public.space_messages z where z.thread_root_id = r.id order by z.seq desc limit 3) q) as tail
    from mine
    join public.space_messages r on r.id = mine.root_id
    join public.channels c on c.id = r.channel_id
    where r.deleted_at is null
    order by coalesce(r.last_reply_at, r.created_at) desc
    limit least(greatest(coalesce(p_lim, 30), 1), 100)) x;
$$;

-- What has been said TO the caller: every mention still unread, newest first. The Activity view.
CREATE OR REPLACE FUNCTION "public"."space_activity"("p_lim" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select m.id, m.channel_id, c.name as channel, c.kind as channel_kind, m.thread_root_id,
           m.author_id, m.body, m.title, m.seq, m.created_at, sm.kind as mention,
           s.name as space, s.slug as space_slug,
           /* who said it, by name: this read crosses spaces, and the names a page holds are the
              open space's, so without this a mention from elsewhere is from "someone" */
           coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)) as author,
           (m.seq > cm.last_read_seq) as unread
    from public.space_mentions sm
    join public.space_messages m on m.id = sm.message_id
    join public.channels c on c.id = m.channel_id
    join public.channel_members cm on cm.channel_id = m.channel_id and cm.user_id = auth.uid()
    join public.spaces s on s.id = c.space_id
    left join public.profiles p on p.id = m.author_id
    where sm.user_id = auth.uid() and m.deleted_at is null
    order by m.created_at desc
    limit least(greatest(coalesce(p_lim, 50), 1), 200)) x;
$$;

-- EVERYTHING THEY HAVE NOT READ, across every room they are in, newest first.
--
-- The rail already counts what is unread per room; this is the other half of the same question —
-- not "how many" but "what". It is the read behind the Unreads place, and it answers in the same
-- shape as the mentions and the saved, so one feed draws all three.
--
-- A room the person has muted is left out: muting is them saying they do not want to be told, and
-- a list that tells them anyway is a list they will stop opening. Their own messages are left out
-- too — nobody has unread themselves.
CREATE OR REPLACE FUNCTION "public"."space_unseen"("p_lim" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select m.id, m.channel_id, c.name as channel, c.kind as channel_kind, m.thread_root_id,
           m.author_id, m.body, m.title, m.seq, m.created_at,
           s.name as space, s.slug as space_slug,
           coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)) as author,
           /* who a direct message is WITH, by name — this list crosses spaces, and the names a page
              holds are the open space's, so without this a room elsewhere is "someone, someone" */
           case when c.kind = 'dm' then (
             select coalesce(jsonb_agg(coalesce(nullif(q.display_name, ''), split_part(coalesce(q.email, ''), '@', 1))), '[]'::jsonb)
               from public.channel_members o
               join public.profiles q on q.id = o.user_id
              where o.channel_id = c.id and o.user_id <> auth.uid())
           else null end as peers,
           true as unread
    from public.channel_members cm
    join public.channels c on c.id = cm.channel_id
    join public.space_messages m on m.channel_id = c.id and m.seq > cm.last_read_seq
    join public.spaces s on s.id = c.space_id
    left join public.profiles p on p.id = m.author_id
    where cm.user_id = auth.uid()
      and c.archived_at is null
      and m.deleted_at is null
      and m.author_id is distinct from auth.uid()
      and (cm.muted_until is null or cm.muted_until < now())
    order by m.created_at desc
    limit least(greatest(coalesce(p_lim, 100), 1), 300)) x;
$$;

-- What the caller kept for later.
CREATE OR REPLACE FUNCTION "public"."space_later"("p_lim" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select s.message_id as id, s.channel_id, c.name as channel, c.kind as channel_kind, s.done_at,
           m.author_id, m.body, m.title, m.seq, m.thread_root_id, s.created_at
    from public.space_saved s
    join public.space_messages m on m.id = s.message_id
    join public.channels c on c.id = s.channel_id
    where s.user_id = auth.uid() and m.deleted_at is null
    order by s.created_at desc
    limit least(greatest(coalesce(p_lim, 50), 1), 200)) x;
$$;

-- ---------------------------------------------------------------------------------------------
-- the platform's own messages
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."space_post"("p_channel" "uuid", "p_body" "text", "p_meta" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare mid uuid;
begin
  insert into public.space_messages (channel_id, kind, body, meta)
  values (p_channel, 'system', p_body, coalesce(p_meta, '{}'::jsonb))
  returning id into mid;
  return mid;
end;
$$;

-- what the site already knows, written where the staff asked for it: no webhook, no third party,
-- nothing to configure but the channel.
CREATE OR REPLACE FUNCTION "public"."space_hook_post"("p_event" "text", "p_body" "text", "p_meta" "jsonb" DEFAULT '{}'::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare h record; b record; n integer := 0;
begin
  for h in select channel_id from public.space_hooks where event = p_event loop
    perform public.space_post(h.channel_id, p_body, coalesce(p_meta, '{}'::jsonb));
    -- AND A BOT THAT LISTENS FOR IT. A bot may say `hears: [{ event: purchase.paid, … }]`, and
    -- this is where that becomes true: the same event that writes the line queues the run, in the
    -- room the line went to, with the facts on it. It is a run like any other from there on — the
    -- loop, the budget, the Stop button — and a bot nobody declared for this event costs nothing.
    for b in select slug, hears from public.bots where published loop
      if b.hears @> jsonb_build_array(jsonb_build_object('kind', 'event', 'event', p_event)) then
        insert into public.agent_runs (bot, surface, channel_id, root_id, status, state)
             values (b.slug, 'spaces', h.channel_id, h.channel_id, 'queued',
                     jsonb_build_object(
                       'messages', jsonb_build_array(jsonb_build_object('role', 'user', 'content',
                         (select coalesce(x->>'ask', 'Something happened: ' || p_event)
                            from jsonb_array_elements(b.hears) x
                           where x->>'kind' = 'event' and x->>'event' = p_event limit 1))),
                       'context', 'The facts: ' || coalesce(p_meta::text, '{}')));
      end if;
    end loop;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- what the platform writes into the channels the staff chose. Each trigger carries the FACTS and
-- never a sentence: a system message's words are markdown like every other reader-facing string,
-- and the surface says them. A site with no hook for an event writes nothing and costs nothing.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."space_on_purchase"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status is distinct from 'paid' then return null; end if;
  perform public.space_hook_post('purchase.paid', null, jsonb_build_object(
    'event', 'purchase-paid', 'sku', new.sku, 'amount', new.amount_total, 'currency', new.currency,
    'email', new.email));
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_on_subscription"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status is distinct from 'active' then return null; end if;
  perform public.space_hook_post('subscription.started', null, jsonb_build_object(
    'event', 'subscription-started', 'sku', new.sku, 'amount', new.plan_amount));
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_on_print_order"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status is distinct from 'failed' or (tg_op = 'UPDATE' and old.status = 'failed') then return null; end if;
  perform public.space_hook_post('print.failed', null, jsonb_build_object(
    'event', 'print-failed', 'book', new.chosen ->> 'book', 'format', new.chosen ->> 'format', 'printer', new.supplier,
    'reason', left(coalesce(new.error, ''), 200), 'order', new.id));
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_on_account"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.space_hook_post('account.new', null, jsonb_build_object(
    'event', 'account-new', 'name', coalesce(nullif(new.display_name, ''), split_part(coalesce(new.email, ''), '@', 1))));
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_on_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.escalated_at is null or old.escalated_at is not null then return null; end if;
  perform public.space_hook_post('support.escalated', null, jsonb_build_object(
    'event', 'support-escalated', 'conversation', new.id));
  return null;
end;
$$;

-- One person's memberships brought to the rules, which is what the hourly sweep does for everybody.
-- It runs the moment their standing changes — they subscribed, their card went through, the
-- membership lapsed — because somebody who has just paid to be in a room should be in the room, not
-- in it within the hour. The whole sweep still runs on the clock, for anything that changed with
-- nobody watching (a membership simply running out of time).
CREATE OR REPLACE FUNCTION "public"."space_sync_one"("p_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- in: every space whose rule now covers them
  insert into public.space_members (space_id, user_id, source)
  select sp.id, p_user, 'fill' from public.spaces sp
   where sp.archived_at is null and public.space_fill_matches(p_user, sp.fill)
  on conflict (space_id, user_id) do nothing;

  -- and out again, but only from what the rule put them in: somebody invited by hand stays
  delete from public.space_members sm
   using public.spaces sp
   where sm.user_id = p_user and sm.space_id = sp.id and sm.source = 'fill'
     and not public.space_fill_matches(p_user, sp.fill);

  -- an open channel of a space they are in is theirs to be in
  insert into public.channel_members (channel_id, user_id)
  select c.id, p_user from public.channels c
   join public.space_members sm on sm.space_id = c.space_id and sm.user_id = p_user
   where c.archived_at is null and c.visibility = 'open' and c.kind <> 'dm'
  on conflict (channel_id, user_id) do nothing;

  delete from public.channel_members cm
   using public.channels c
   where cm.user_id = p_user and cm.channel_id = c.id
     and not exists (select 1 from public.space_members sm where sm.space_id = c.space_id and sm.user_id = p_user);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_on_standing"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.user_id is not null then perform public.space_sync_one(new.user_id); end if;
  return null;
end;
$$;

-- the sweep on the clock: pg_cron asks the spaces function, which asks space_sync_members with the
-- service role. The url and the key are app_settings', as every other runner reads them.
CREATE OR REPLACE FUNCTION "public"."run_spaces_sweep"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then
    perform public.space_sync_members();   -- no function to ask: do it here
    return;
  end if;
  perform net.http_post(
    url := url || '/spaces',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := jsonb_build_object('action', 'sweep'),
    timeout_milliseconds := 120000);
end;
$$;

REVOKE ALL ON FUNCTION "public"."run_spaces_sweep"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_spaces_sweep"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_spaces_sweep"() TO "service_role";

-- a broadcast on any room's topic: the message triggers and the call's end (the server) send it, never a visitor
REVOKE ALL ON FUNCTION "public"."space_wake"("p_channel" "uuid", "p_event" "text", "p_payload" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_wake"("p_channel" "uuid", "p_event" "text", "p_payload" "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_wake"("p_channel" "uuid", "p_event" "text", "p_payload" "jsonb") TO "service_role";

-- Somebody who was not here to see it is told by email, under the restraint the chats keep: one per
-- burst, and never before they have read what the last one was about. The function does the sending;
-- this decides whether there is anything to send and stamps that it was.
CREATE OR REPLACE FUNCTION "public"."space_mail"("p_user" "uuid", "p_channel" "uuid", "p_message" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text; told timestamptz; behind boolean;
begin
  select cm.notified_at, (cm.last_read_seq < c.last_seq) into told, behind
    from public.channel_members cm join public.channels c on c.id = cm.channel_id
   where cm.channel_id = p_channel and cm.user_id = p_user;
  if not coalesce(behind, false) then return; end if;            -- they have read it
  if told is not null and told > now() - interval '1 hour' then return; end if;   -- one per burst
  update public.channel_members set notified_at = now() where channel_id = p_channel and user_id = p_user;

  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/spaces',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := jsonb_build_object('action', 'mail', 'user', p_user, 'channel', p_channel, 'message', p_message),
    timeout_milliseconds := 30000);
end;
$$;

REVOKE ALL ON FUNCTION "public"."space_mail"("uuid", "uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_mail"("uuid", "uuid", "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_mail"("uuid", "uuid", "uuid") TO "service_role";


-- ---------------------------------------------------------------------------------------------
-- a community: the mute, the acts, and the way in
-- ---------------------------------------------------------------------------------------------

-- Is this person silenced in this space just now? A mute is a row with an end, so this is the whole
-- of it: no flag to keep in step, no sweep to run, and it stops being true by itself.
CREATE OR REPLACE FUNCTION "public"."space_muted"("p_space" "uuid", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.space_moderation m
     where m.kind = 'mute' and m.space_id = p_space
       and m.subject_id = coalesce(p_user, auth.uid())
       and (m.until is null or m.until > now()));
$$;

-- ---------------------------------------------------------------------------------------------
-- BARRED, AND BARRED QUIETLY. Two acts, and they are not the same thing.
--
-- A BAN puts somebody out of a space and keeps them out: their membership goes the way
-- remove-member takes it, and — this is the difference — they cannot come back. Remove-member is
-- an eviction, and a rule that filled the space, an open door or a standing invitation would let
-- them straight back in; a ban is a fence, and it is asked in the ONE place every membership is
-- made, so the door, the invitation, the fill sweep and an administrator's own hand all meet it.
-- Reading stops with the membership, because every read in this file is membership and nothing
-- else, so there is nothing further to enforce.
--
-- A SHADOW BAN leaves them where they are and stops anybody else seeing what they say. It exists
-- for the case a ban answers badly — somebody who will simply come back under another name if
-- told — and it is a genuinely nasty instrument, so two things are true about it here: it is never
-- automatic (nothing in this file is), and the person shadow-banned always sees their own lines
-- exactly as before, because a shadow ban that shows somebody their own words missing is not a
-- shadow ban, it is a bug report.
--
-- The decision is made ONCE, when a line is written, and kept on the line as a column. Asking it
-- per row on the way out would mean the same question in the seven places messages are read, and
-- six of them agreeing is how a shadow-banned troll's posts come back.
--
-- Both end by themselves where `until` says so, and either may be lifted early by a row that says
-- so — never by editing the row that did it.

CREATE OR REPLACE FUNCTION "public"."space_barred"("p_space" "uuid", "p_kind" "text", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.space_moderation m
     where m.kind = p_kind and m.space_id = p_space
       and m.subject_id = coalesce(p_user, auth.uid())
       and (m.until is null or m.until > now())
       and not exists (select 1 from public.space_moderation l where l.kind = 'lift' and l.lifts_id = m.id));
$$;

CREATE OR REPLACE FUNCTION "public"."space_banned"("p_space" "uuid", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER SET "search_path" TO 'public'
    AS $$ select public.space_barred(p_space, 'ban', p_user); $$;

CREATE OR REPLACE FUNCTION "public"."space_shadowed"("p_space" "uuid", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER SET "search_path" TO 'public'
    AS $$ select public.space_barred(p_space, 'shadow-ban', p_user); $$;

-- THE ONE FENCE. Every membership — the door (space_ask), an invitation (space_invite_accept), the
-- fill sweep, an administrator by hand — passes through this insert, so the ban is asked here and
-- nowhere else. It SKIPS rather than raises: the sweep inserts for many people at once and an
-- exception would abort the lot, leaving a whole space unfilled because one person is banned. The
-- doors ask first and say so properly; this is the backstop that cannot be walked around.
CREATE OR REPLACE FUNCTION "public"."space_bar_banned"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.space_banned(new.space_id, new.user_id) then return null; end if;
  return new;
end;
$$;
DROP TRIGGER IF EXISTS "trg_space_bar_banned" ON "public"."space_members";
CREATE TRIGGER "trg_space_bar_banned" BEFORE INSERT ON "public"."space_members"
  FOR EACH ROW EXECUTE FUNCTION "public"."space_bar_banned"();

-- A LINE IS MARKED AS IT IS WRITTEN, once, so every read filters a column instead of asking a
-- question. The author still selects their own, and a moderator sees everything.
CREATE OR REPLACE FUNCTION "public"."space_mark_shadowed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare sp uuid;
begin
  select c.space_id into sp from public.channels c where c.id = new.channel_id;
  if sp is not null and public.space_shadowed(sp, new.author_id) then new.shadowed := true; end if;
  return new;
end;
$$;
DROP TRIGGER IF EXISTS "trg_space_mark_shadowed" ON "public"."space_messages";
CREATE TRIGGER "trg_space_mark_shadowed" BEFORE INSERT ON "public"."space_messages"
  FOR EACH ROW EXECUTE FUNCTION "public"."space_mark_shadowed"();

-- MAY I SEE THIS LINE? False only for a shadowed line, written by somebody else, in a room this
-- reader does not moderate. Keyed on the CHANNEL because every message has one and every read has
-- it in scope — so the same call goes in every one of them and none of them has to think about it.
CREATE OR REPLACE FUNCTION "public"."space_sees"("p_shadowed" boolean, "p_author" "uuid", "p_channel" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not coalesce(p_shadowed, false)
      or p_author = (select auth.uid())
      or public.space_may(p_channel, 'moderate');
$$;

-- LIFTING ONE, EARLY. A row that says which act it undoes; whoever may moderate the space may do it.
CREATE OR REPLACE FUNCTION "public"."space_lift"("p_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare act public.space_moderation; rid uuid;
begin
  select * into act from public.space_moderation where id = p_id;
  if not found then raise exception 'no such act'; end if;
  if act.kind not in ('ban', 'shadow-ban', 'mute') then raise exception 'nothing to lift'; end if;
  if not exists (select 1 from public.channels c where c.space_id = act.space_id and public.space_may(c.id, 'moderate'))
    then raise exception 'not allowed'; end if;
  insert into public.space_moderation (space_id, kind, actor_id, subject_id, reason, lifts_id)
       values (act.space_id, 'lift', auth.uid(), act.subject_id, p_reason, act.id)
  on conflict do nothing
  returning id into rid;
  return rid;
end;
$$;

-- HOW FAR BACK THIS PERSON MAY READ IN THIS SPACE — null for no limit, otherwise the moment before
-- which nothing is returned. It is enforced in the READS (space_history, space_catchup, space_posts)
-- rather than in a policy, because a horizon is not a secret: what is past it is not hidden, it is
-- simply not kept for this plan, and a policy that hid it would also hide it from the count, the
-- search index and everything else that has a legitimate reason to know a room is older than today.
CREATE OR REPLACE FUNCTION "public"."space_horizon"("p_space" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with rules as (select jsonb_array_elements(sp.history) r from public.spaces sp where sp.id = p_space),
  mine as (
    select coalesce((r->>'days')::int, 0) as days from rules
     -- every part a rule names must hold; a rule naming none holds for everybody. The brackets are
     -- not decoration: AND binds tighter than OR, and without them a rule that named a role would
     -- have applied to anybody at all.
     where ((r ? 'role') = false or exists (
             select 1 from public.space_member_roles mr
               join public.space_roles sr on sr.id = mr.role_id
              where mr.user_id = auth.uid() and sr.space_id = p_space and sr.slug = r->>'role'))
       and ((r ? 'tier') = false or exists (
             select 1 from public.entitlements e
              where e.user_id = auth.uid() and e.kind = 'class' and e.key = 'subscribed' and e.active
                and (e.expires_at is null or e.expires_at > now()) and e.tier = r->>'tier'))
       and ((r ? 'entitlement') = false or exists (
             select 1 from public.entitlements e
              where e.user_id = auth.uid() and e.kind = 'class' and e.key = r->>'entitlement' and e.active
                and (e.expires_at is null or e.expires_at > now())))
  )
  select case
    when public.is_staff() then null
    -- a list none of whose rules matches this person leaves them unlimited rather than cut off: a
    -- horizon is something a site says out loud, and a rule nobody wrote is not one
    when not exists (select 1 from mine) then null
    when exists (select 1 from mine where days <= 0) then null
    else now() - make_interval(days => (select max(days) from mine))
  end;
$$;

-- the same question asked of a room, which is what every read has in hand
CREATE OR REPLACE FUNCTION "public"."space_horizon_in"("p_channel" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.space_horizon(c.space_id) from public.channels c where c.id = p_channel;
$$;

-- IS THIS QUIET FOR THIS PERSON — the one question the three kinds of mute answer together. A room
-- is quiet when the room is muted, or the space it is in is, and a line is quiet on top of that when
-- the person who wrote it is muted. Both read the same table; neither is a policy, since a mute
-- hides nothing — it only decides whether something arrives with a noise.
CREATE OR REPLACE FUNCTION "public"."space_hushed"("p_channel" "uuid", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.space_mutes m
     join public.channels c on c.id = p_channel
    where m.user_id = coalesce(p_user, auth.uid())
      and (m.until is null or m.until > now())
      and ((m.kind = 'channel' and m.ref = c.id) or (m.kind = 'space' and m.ref = c.space_id)));
$$;

CREATE OR REPLACE FUNCTION "public"."space_hushed_person"("p_who" "uuid", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p_who is not null and exists (
    select 1 from public.space_mutes m
    where m.user_id = coalesce(p_user, auth.uid()) and m.kind = 'person' and m.ref = p_who
      and (m.until is null or m.until > now()));
$$;

-- A PERSON'S OWN MUTES, and the two acts on them. Nothing else may write this table: a mute is the
-- reader's, and a room cannot decide it is quiet for somebody.
CREATE OR REPLACE FUNCTION "public"."space_my_mutes"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'ref', m.ref, 'until', m.until))
                     from public.space_mutes m
                    where m.user_id = auth.uid() and (m.until is null or m.until > now())), '[]'::jsonb);
$$;

CREATE OR REPLACE FUNCTION "public"."space_mute"("p_kind" "text", "p_ref" "uuid", "p_until" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  if p_kind not in ('channel', 'space', 'person') then raise exception 'no such thing to mute'; end if;
  -- muting yourself is the one mute nobody means, and it would silence every room you write in
  if p_kind = 'person' and p_ref = auth.uid() then raise exception 'you cannot mute yourself'; end if;
  insert into public.space_mutes (user_id, kind, ref, until)
  values (auth.uid(), p_kind, p_ref, p_until)
  on conflict (user_id, kind, ref) do update set until = excluded.until, created_at = now();
end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_unmute"("p_kind" "text", "p_ref" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  delete from public.space_mutes where user_id = auth.uid() and kind = p_kind and ref = p_ref;
$$;

-- the same question asked of a room, which is what the insert policy has in hand
CREATE OR REPLACE FUNCTION "public"."space_muted_in"("p_channel" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.channels c
      join public.space_moderation m on m.space_id = c.space_id
     where c.id = p_channel and m.kind = 'mute' and m.subject_id = auth.uid()
       and (m.until is null or m.until > now()));
$$;

-- What a member is told about themselves: every act done to THEM, and nothing done to anybody else.
CREATE OR REPLACE FUNCTION "public"."space_my_record"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'space', m.space_id, 'kind', m.kind, 'reason', m.reason,
      'until', m.until, 'created_at', m.created_at) order by m.created_at desc)
    from public.space_moderation m
   where m.subject_id = auth.uid() and m.kind <> 'report'), '[]'::jsonb);
$$;

-- THE FOUR ACTS. A report is any member's, on a message they can read; the other three belong to
-- whoever the space granted `moderate`. Each writes one row and does the thing, and the row is
-- never edited or deleted afterwards by anybody — which is why they are functions rather than a
-- write policy: a policy that lets somebody insert a record lets them insert a false one.
CREATE OR REPLACE FUNCTION "public"."space_report"("p_message" "uuid", "p_reason" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare ch uuid; sp uuid; auth_id uuid; rid uuid;
begin
  select m.channel_id, c.space_id, m.author_id into ch, sp, auth_id
    from public.space_messages m join public.channels c on c.id = m.channel_id
   where m.id = p_message;
  if ch is null then raise exception 'no such message'; end if;
  if not public.can_read_channel(ch) then raise exception 'not allowed'; end if;
  -- reporting the same message twice is one report, not two
  select id into rid from public.space_moderation
   where kind = 'report' and message_id = p_message and actor_id = auth.uid();
  if rid is not null then return rid; end if;
  insert into public.space_moderation (space_id, kind, actor_id, subject_id, message_id, channel_id, reason, note)
  values (sp, 'report', auth.uid(), auth_id, p_message, ch, p_reason, p_note)
  returning id into rid;
  return rid;
end;
$$;

-- A moderator's three. `moderate` is a capability like any other, so who may do this is a row the
-- site wrote and not a role name in this file.
CREATE OR REPLACE FUNCTION "public"."space_moderate"("p_kind" "text", "p_space" "uuid", "p_message" "uuid" DEFAULT NULL::"uuid", "p_user" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT NULL::"text", "p_minutes" integer DEFAULT NULL::integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare ch uuid; sp uuid; rid uuid; ok boolean;
begin
  if p_kind not in ('remove-message', 'mute', 'remove-member', 'ban', 'shadow-ban') then raise exception 'no such act'; end if;
  -- may they moderate anywhere in this space? asked of one of its rooms, since a grant may be on one
  select exists (
    select 1 from public.channels c
     where c.space_id = p_space and public.space_may(c.id, 'moderate')) into ok;
  if not ok then raise exception 'not allowed'; end if;

  if p_kind = 'remove-message' then
    select m.channel_id, m.author_id into ch, p_user from public.space_messages m where m.id = p_message;
    if ch is null then raise exception 'no such message'; end if;
    -- a direct message is not a room and is never moderated
    if exists (select 1 from public.channels c where c.id = ch and (c.space_id <> p_space or c.kind = 'dm')) then raise exception 'not allowed'; end if;
    -- withdrawn the way an author withdraws one: the placeholder stays, because a hole in a
    -- conversation is worse than a mark
    update public.space_messages set deleted_at = now() where id = p_message;
  elsif p_kind in ('remove-member', 'ban') then
    if p_user is null then raise exception 'nobody named'; end if;
    -- A BAN IS AN EVICTION THAT HOLDS, so the row goes in BEFORE the membership goes: the fence is
    -- then already up, and a fill sweep running in the same second cannot put them straight back.
    if p_kind = 'ban' then
      insert into public.space_moderation (space_id, kind, actor_id, subject_id, reason, until)
      values (p_space, 'ban', auth.uid(), p_user, p_reason,
              case when p_minutes is not null then now() + make_interval(mins => p_minutes) else null end)
      returning id into rid;
    end if;
    delete from public.channel_members cm using public.channels c
     where c.id = cm.channel_id and c.space_id = p_space and cm.user_id = p_user;
    -- what they wrote stays: removing a person is not rewriting the history of a room
    delete from public.space_members where space_id = p_space and user_id = p_user;
  elsif p_kind = 'shadow-ban' then
    -- nothing is done TO them: what changes is what everybody else sees of what they say next.
    -- Their existing lines are left exactly as they are — marking the past would be a different
    -- act, and one nobody asked for.
    if p_user is null then raise exception 'nobody named'; end if;
  else
    if p_user is null then raise exception 'nobody named'; end if;
  end if;

  -- a ban has already written its own row above, for the ordering reason given there
  if rid is null then
    insert into public.space_moderation (space_id, kind, actor_id, subject_id, message_id, channel_id, reason, until)
    values (p_space, p_kind, auth.uid(), p_user, p_message, ch, p_reason,
            case when p_kind in ('mute', 'shadow-ban') and p_minutes is not null then now() + make_interval(mins => p_minutes) else null end)
    returning id into rid;
  end if;

  -- a report about that message is answered by the act
  if p_message is not null then
    update public.space_moderation set answered_at = now(), answered_by = auth.uid()
     where kind = 'report' and message_id = p_message and answered_at is null;
  end if;
  return rid;
end;
$$;

-- a report answered without an act: seen, and nothing to do
CREATE OR REPLACE FUNCTION "public"."space_report_answered"("p_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare sp uuid;
begin
  select space_id into sp from public.space_moderation where id = p_id and kind = 'report';
  if sp is null then return false; end if;
  if not exists (select 1 from public.channels c where c.space_id = sp and public.space_may(c.id, 'moderate')) then raise exception 'not allowed'; end if;
  update public.space_moderation set answered_at = now(), answered_by = auth.uid() where id = p_id and answered_at is null;
  return true;
end;
$$;

-- the queue: every report of the spaces this person may moderate, with what was said and who said it
CREATE OR REPLACE FUNCTION "public"."space_reports"("p_space" "uuid" DEFAULT NULL::"uuid", "p_open" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(row order by row->>'created_at' desc) from (
    select jsonb_build_object(
      'id', r.id, 'space', r.space_id, 'channel', r.channel_id, 'message', r.message_id,
      'reason', r.reason, 'note', r.note, 'created_at', r.created_at,
      'answered_at', r.answered_at,
      'by', coalesce(nullif(pa.display_name, ''), split_part(coalesce(pa.email, ''), '@', 1)),
      'about', coalesce(nullif(ps.display_name, ''), split_part(coalesce(ps.email, ''), '@', 1)),
      'about_id', r.subject_id,
      'body', case when sm.deleted_at is null then sm.body else null end,
      'withdrawn', sm.deleted_at is not null,
      'kind', sm.kind,
      'room', c.name) as row
    from public.space_moderation r
    left join public.space_messages sm on sm.id = r.message_id
    left join public.channels c on c.id = r.channel_id
    left join public.profiles pa on pa.id = r.actor_id
    left join public.profiles ps on ps.id = r.subject_id
   where r.kind = 'report'
     and (p_space is null or r.space_id = p_space)
     and (not p_open or r.answered_at is null)
     and exists (select 1 from public.channels x where x.space_id = r.space_id and public.space_may(x.id, 'moderate'))
   limit 200) q), '[]'::jsonb);
$$;

-- what a space has had done in it, for whoever may moderate it
CREATE OR REPLACE FUNCTION "public"."space_record"("p_space" "uuid", "p_lim" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when exists (select 1 from public.channels x where x.space_id = p_space and public.space_may(x.id, 'moderate'))
    then coalesce((select jsonb_agg(row) from (
      select jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'reason', m.reason, 'until', m.until, 'created_at', m.created_at,
        'by', coalesce(nullif(pa.display_name, ''), split_part(coalesce(pa.email, ''), '@', 1)),
        'about', coalesce(nullif(ps.display_name, ''), split_part(coalesce(ps.email, ''), '@', 1))) as row
      from public.space_moderation m
      left join public.profiles pa on pa.id = m.actor_id
      left join public.profiles ps on ps.id = m.subject_id
     where m.space_id = p_space and m.kind <> 'report'
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_lim, 50), 200))) q), '[]'::jsonb)
    else '[]'::jsonb end;
$$;

-- What has happened lately in a space, for its home: the last lines of the rooms THIS READER can
-- read in it, nothing from a direct message, and nothing from a room they are not in. It is the
-- home's one read and it answers the question the page asks rather than being assembled from four.
CREATE OR REPLACE FUNCTION "public"."space_lately"("p_space" "uuid", "p_lim" integer DEFAULT 8) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(row) from (
    select jsonb_build_object(
      'id', m.id, 'channel', m.channel_id, 'room', c.name, 'kind', m.kind,
      'author', m.author_id, 'title', m.title, 'created_at', m.created_at,
      'body', case when m.deleted_at is null then m.body else null end) as row
    from public.space_messages m
    join public.channels c on c.id = m.channel_id
   where c.space_id = p_space and c.kind = 'channel' and c.archived_at is null
     and m.deleted_at is null and m.kind <> 'system'
     and c.id in (select public.my_readable_channel_ids())
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_lim, 8), 30))) q), '[]'::jsonb);
$$;

-- THE WAY IN. Three reads and two acts, all of them definer because a reader who is not in a space
-- has no policy that reaches it — which is the promise this module made on its first day.

-- Every space a reader could be in, with what it would take. A staff space is never here whatever
-- it says: `discoverable` is a community's word, and the compile only ever sets it on one.
CREATE OR REPLACE FUNCTION "public"."space_discover"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'slug', s.slug, 'name', s.name, 'kind', s.kind, 'fill', s.fill,
      -- the space's own door, and where this person stands at it
      'joining', coalesce(s.joining, '{}'::jsonb),
      'asked', (select r.state from public.space_requests r where r.space_id = s.id and r.user_id = auth.uid()),
      'mine', exists (select 1 from public.space_members sm where sm.space_id = s.id and sm.user_id = auth.uid()),
      'people', (select count(*) from public.space_members sm where sm.space_id = s.id)
    ) order by s.name)
    from public.spaces s
   where s.archived_at is null and s.kind in ('community', 'server')
     -- a space is listed where there is something a person could DO about it: buy their way in,
     -- hold the membership that fills it, or knock on a door the space opened
     and (coalesce((s.fill ? 'tier') or (s.fill ? 'product') or (s.fill ? 'entitlement'), false)
          or coalesce(s.joining->>'how', 'none') <> 'none')), '[]'::jsonb);
$$;

-- An invitation is made by whoever the space granted `invite`. THE TOKEN NEVER REACHES THE
-- DATABASE: the browser makes it and its sha256 the way it makes an API key's, and only the digest
-- is sent — so the token is in one place, the link, and a leak of this table is not a way into
-- anything. Every later call hashes the token from the link the same way.
CREATE OR REPLACE FUNCTION "public"."space_invite"("p_space" "uuid", "p_hash" "text", "p_role" "text" DEFAULT NULL::"text", "p_uses" integer DEFAULT 1, "p_days" integer DEFAULT NULL::integer, "p_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare rid uuid; role_id uuid;
begin
  if not exists (select 1 from public.channels c where c.space_id = p_space and public.space_may(c.id, 'invite')) then raise exception 'not allowed'; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'a token digest is 64 hex characters'; end if;
  if p_role is not null then select id into role_id from public.space_roles where space_id = p_space and slug = p_role; end if;
  insert into public.space_invites (space_id, token_hash, made_by, role_id, uses, expires_at, note)
  values (p_space, p_hash, auth.uid(), role_id,
          greatest(coalesce(p_uses, 1), 0),
          case when p_days is not null then now() + make_interval(days => p_days) else null end, p_note)
  returning id into rid;
  return rid;
end;
$$;

-- What a link says before anybody presses anything: the space, and whether it is any good.
CREATE OR REPLACE FUNCTION "public"."space_invite_look"("p_hash" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_build_object(
      'space', s.slug, 'name', s.name, 'kind', s.kind,
      'mine', exists (select 1 from public.space_members sm where sm.space_id = s.id and sm.user_id = auth.uid()),
      'state', case
        when i.expires_at is not null and i.expires_at <= now() then 'expired'
        when i.uses > 0 and i.used >= i.uses then 'spent'
        else 'good' end)
    from public.space_invites i join public.spaces s on s.id = i.space_id
   where i.token_hash = p_hash and s.archived_at is null),
   jsonb_build_object('state', 'unknown'));
$$;

-- Accepting one. The count is taken under a lock on the row, so two people pressing at the same
-- moment cannot both have the last use.
CREATE OR REPLACE FUNCTION "public"."space_invite_accept"("p_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare inv record; sp record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from public.space_invites
   where token_hash = p_hash for update;
  if inv is null then return jsonb_build_object('state', 'unknown'); end if;
  select * into sp from public.spaces where id = inv.space_id and archived_at is null;
  if sp is null then return jsonb_build_object('state', 'unknown'); end if;
  if exists (select 1 from public.space_members where space_id = inv.space_id and user_id = auth.uid())
    then return jsonb_build_object('state', 'good', 'space', sp.slug, 'name', sp.name); end if;
  if inv.expires_at is not null and inv.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  if inv.uses > 0 and inv.used >= inv.uses then return jsonb_build_object('state', 'spent'); end if;
  -- AN INVITATION DOES NOT OUTRANK A BAN. The fence under space_members would drop the row and
  -- leave them looking at a link that appeared to work, so it is asked here and answered
  if public.space_banned(inv.space_id) then return jsonb_build_object('state', 'barred'); end if;

  -- source 'invite', which the fill sweep leaves alone: an invitation is not a rule
  insert into public.space_members (space_id, user_id, source) values (inv.space_id, auth.uid(), 'invite')
  on conflict do nothing;
  if inv.role_id is not null then
    insert into public.space_member_roles (space_id, user_id, role_id, given_by)
    values (inv.space_id, auth.uid(), inv.role_id, inv.made_by) on conflict do nothing;
  end if;
  -- every open room of the space is theirs to be in from the start
  insert into public.channel_members (channel_id, user_id)
  select c.id, auth.uid() from public.channels c
   where c.space_id = inv.space_id and c.kind = 'channel' and c.visibility = 'open' and c.archived_at is null
  on conflict do nothing;
  update public.space_invites set used = used + 1 where id = inv.id;
  return jsonb_build_object('state', 'joined', 'space', sp.slug, 'name', sp.name);
end;
$$;

-- The invitations a space has out, for whoever may make one. The token is never here.
CREATE OR REPLACE FUNCTION "public"."space_invites_of"("p_space" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when exists (select 1 from public.channels c where c.space_id = p_space and public.space_may(c.id, 'invite'))
    then coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'uses', i.uses, 'used', i.used, 'expires_at', i.expires_at, 'note', i.note,
        'role', r.name, 'created_at', i.created_at,
        'state', case when i.expires_at is not null and i.expires_at <= now() then 'expired'
                      when i.uses > 0 and i.used >= i.uses then 'spent' else 'good' end)
      order by i.created_at desc)
      from public.space_invites i left join public.space_roles r on r.id = i.role_id
     where i.space_id = p_space), '[]'::jsonb)
    else '[]'::jsonb end;
$$;

CREATE OR REPLACE FUNCTION "public"."space_invite_drop"("p_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare sp uuid;
begin
  select space_id into sp from public.space_invites where id = p_id;
  if sp is null then return false; end if;
  if not exists (select 1 from public.channels c where c.space_id = sp and public.space_may(c.id, 'invite')) then raise exception 'not allowed'; end if;
  delete from public.space_invites where id = p_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- the triggers
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER "trg_space_messages_seq" BEFORE INSERT ON "public"."space_messages" FOR EACH ROW EXECUTE FUNCTION "public"."space_next_seq"();
CREATE OR REPLACE TRIGGER "trg_space_messages_after" AFTER INSERT ON "public"."space_messages" FOR EACH ROW EXECUTE FUNCTION "public"."space_after_message"();
CREATE OR REPLACE TRIGGER "trg_space_messages_guard" BEFORE UPDATE ON "public"."space_messages" FOR EACH ROW EXECUTE FUNCTION "public"."guard_space_message_edit"();
CREATE OR REPLACE TRIGGER "trg_space_messages_changed" AFTER UPDATE ON "public"."space_messages" FOR EACH ROW WHEN ((("old"."body" IS DISTINCT FROM "new"."body") OR ("old"."title" IS DISTINCT FROM "new"."title") OR ("old"."deleted_at" IS DISTINCT FROM "new"."deleted_at"))) EXECUTE FUNCTION "public"."space_message_changed"();

CREATE OR REPLACE TRIGGER "trg_space_joined" AFTER INSERT ON "public"."space_members" FOR EACH ROW EXECUTE FUNCTION "public"."space_joined"();
CREATE OR REPLACE TRIGGER "trg_space_room_made" AFTER INSERT ON "public"."channels" FOR EACH ROW EXECUTE FUNCTION "public"."space_room_made"();
CREATE OR REPLACE TRIGGER "trg_space_purchase" AFTER INSERT OR UPDATE OF "status" ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_purchase"();
-- the moment somebody's standing changes, their rooms follow: a membership begun or ended, a
-- purchase paid. The hourly sweep is then only for what changed with nobody watching.
CREATE OR REPLACE TRIGGER "trg_space_standing_entitlement" AFTER INSERT OR UPDATE OF "active", "expires_at", "tier" ON "public"."entitlements" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_standing"();
CREATE OR REPLACE TRIGGER "trg_space_standing_purchase" AFTER INSERT OR UPDATE OF "status" ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_standing"();
CREATE OR REPLACE TRIGGER "trg_space_subscription" AFTER INSERT ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_subscription"();
CREATE OR REPLACE TRIGGER "trg_space_print_order" AFTER INSERT OR UPDATE OF "status" ON "public"."fulfilments" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_print_order"();
CREATE OR REPLACE TRIGGER "trg_space_account" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_account"();
CREATE OR REPLACE TRIGGER "trg_space_escalation" AFTER UPDATE OF "escalated_at" ON "public"."support_conversations" FOR EACH ROW EXECUTE FUNCTION "public"."space_on_escalation"();

-- ---------------------------------------------------------------------------------------------
-- who may read what. Every policy is membership and nothing else: never a role at the site's level,
-- never "signed in". The subquery form is deliberate — Postgres evaluates the membership set once
-- per statement rather than once per row.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "public"."spaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."space_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."channel_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."space_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."space_mentions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."space_mutes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "space_mutes_own" ON "public"."space_mutes" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
ALTER TABLE "public"."space_hooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."space_saved" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spaces_select_member" ON "public"."spaces" FOR SELECT TO "authenticated"
  USING ("id" IN ( SELECT "public"."my_space_ids"() AS "my_space_ids"));

CREATE POLICY "space_members_select_member" ON "public"."space_members" FOR SELECT TO "authenticated"
  USING ("space_id" IN ( SELECT "public"."my_space_ids"() AS "my_space_ids"));

CREATE POLICY "channels_select_reader" ON "public"."channels" FOR SELECT TO "authenticated"
  USING ("id" IN ( SELECT "public"."my_readable_channel_ids"() AS "my_readable_channel_ids"));

CREATE POLICY "channel_members_select_reader" ON "public"."channel_members" FOR SELECT TO "authenticated"
  USING ("channel_id" IN ( SELECT "public"."my_readable_channel_ids"() AS "my_readable_channel_ids"));

-- joining an open channel of a space you are in is yours to do; a private one is not
CREATE POLICY "channel_members_join_own" ON "public"."channel_members" FOR INSERT TO "authenticated"
  WITH CHECK (("user_id" = ( SELECT "auth"."uid"()))
    AND ("channel_id" IN ( SELECT "public"."my_joinable_channel_ids"() AS "my_joinable_channel_ids")));

CREATE POLICY "channel_members_update_own" ON "public"."channel_members" FOR UPDATE TO "authenticated"
  USING ("user_id" = ( SELECT "auth"."uid"())) WITH CHECK ("user_id" = ( SELECT "auth"."uid"()));

CREATE POLICY "channel_members_leave_own" ON "public"."channel_members" FOR DELETE TO "authenticated"
  USING ("user_id" = ( SELECT "auth"."uid"()));

-- and a shadowed line is not read by anybody but its author and whoever moderates the room: this
-- is the net under the reads, and what makes a direct select and a realtime row obey the same rule
CREATE POLICY "space_messages_select_reader" ON "public"."space_messages" FOR SELECT TO "authenticated"
  USING (("channel_id" IN ( SELECT "public"."my_readable_channel_ids"() AS "my_readable_channel_ids"))
    AND "public"."space_sees"("shadowed", "author_id", "channel_id"));

-- You join a channel to speak in it, whatever its visibility; the platform's own lines are not
-- yours. A MUTE IS A FENCE AND NOT A FILTER: it is asked here, which is the one place every
-- message of every kind passes through — a channel, a thread, a direct message opened before the
-- mute, the API — so there is one rule rather than three that must agree.
CREATE POLICY "space_messages_insert_own" ON "public"."space_messages" FOR INSERT TO "authenticated"
  WITH CHECK (("author_id" = ( SELECT "auth"."uid"())) AND ("kind" <> 'system'::"text")
    AND ("channel_id" IN ( SELECT "public"."my_channel_ids"() AS "my_channel_ids"))
    AND (NOT "public"."space_muted_in"("channel_id"))
    -- a direct message is the Messages place, and that place may carry an entry rule
    AND ((NOT EXISTS (SELECT 1 FROM "public"."channels" "c" WHERE "c"."id" = "space_messages"."channel_id" AND "c"."kind" = 'dm'))
         OR "public"."community_admitted"('messages'))
    -- speaking is membership; a voice note and an attached file are capabilities, and this is
    -- where each of them is refused
    AND (("kind" <> 'voice'::"text") OR "public"."space_may"("channel_id", 'voice'))
    AND (("kind" <> 'file'::"text") OR "public"."space_may"("channel_id", 'file'))
    -- AN ANNOUNCEMENT IS A CAPABILITY LIKE THE OTHERS, asked in the same place and in the same
    -- words, so who may make one is a row the site wrote and never a role's name in this file.
    -- It is here rather than in a function because this is the one insert every message of every
    -- kind passes through, and a second door is a door somebody forgets to lock.
    AND (("kind" <> 'announcement'::"text") OR "public"."space_may"("channel_id", 'announce')));

-- ---------------------------------------------------------------------------------------------
-- A QUESTION ASKED OF A ROOM. The poll is the message: its body is the question, and its options
-- ride on `meta`, which the edit guard already refuses every client-side change to — so an option
-- can never be reworded under somebody's vote, for free. Closing it is its own column, and its own
-- function, because that IS meant to change.
--
-- A vote is a row, because a vote is an act by a person. One per person per option by the primary
-- key rather than by a check anybody has to remember; how many options a person may take is the
-- poll's own word, enforced in the policy and not in the browser.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."space_poll_votes" (
    "message_id" "uuid" NOT NULL,
    "option_key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."space_poll_votes" ADD CONSTRAINT "space_poll_votes_pkey" PRIMARY KEY ("message_id", "option_key", "user_id");
ALTER TABLE ONLY "public"."space_poll_votes" ADD CONSTRAINT "space_poll_votes_message_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."space_messages"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_poll_votes" ADD CONSTRAINT "space_poll_votes_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_poll_votes_message_idx" ON "public"."space_poll_votes" USING "btree" ("message_id");

-- the poll a vote is for, and whether it is still open — asked by the policies below
CREATE OR REPLACE FUNCTION "public"."poll_is_open"("p_message" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.space_messages m
     where m.id = p_message and m.kind = 'poll' and m.deleted_at is null and m.poll_closed_at is null);
$$;

-- how many options this poll lets one person take: one, unless it says otherwise
CREATE OR REPLACE FUNCTION "public"."poll_takes_several"("p_message" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select (m.meta -> 'poll' ->> 'multi')::boolean from public.space_messages m where m.id = p_message), false);
$$;

-- the channel a message is in, for the policies that must ask about the room rather than the message
CREATE OR REPLACE FUNCTION "public"."message_channel"("p_message" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select channel_id from public.space_messages where id = p_message;
$$;

-- Closing keeps the result and takes no more votes. The author closes their own; so does anybody
-- the space granted keeping the room — the same grant that answers a report.
CREATE OR REPLACE FUNCTION "public"."space_poll_close"("p_message" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare m record;
begin
  if auth.uid() is null then return false; end if;
  select * into m from public.space_messages where id = p_message and kind = 'poll';
  if m is null then return false; end if;
  if not public.can_read_channel(m.channel_id) then return false; end if;
  if m.author_id is distinct from auth.uid() and not public.space_may(m.channel_id, 'moderate') then
    return false;
  end if;
  perform set_config('app.closing_poll', '1', true);
  update public.space_messages set poll_closed_at = coalesce(poll_closed_at, now()) where id = p_message;
  return true;
end;
$$;

ALTER TABLE "public"."space_poll_votes" ENABLE ROW LEVEL SECURITY;

-- reading the votes is reading the room, and nothing more
CREATE POLICY "space_poll_votes_select_reader" ON "public"."space_poll_votes" FOR SELECT TO "authenticated"
  USING ("public"."can_read_channel"("public"."message_channel"("message_id")));

-- voting is speaking: the room's own membership, not muted, the poll open — and one option unless
-- the poll says it takes several. A row is only ever the voter's own.
CREATE POLICY "space_poll_votes_insert_own" ON "public"."space_poll_votes" FOR INSERT TO "authenticated"
  WITH CHECK (("user_id" = ( SELECT "auth"."uid"()))
    AND "public"."poll_is_open"("message_id")
    AND ("public"."message_channel"("message_id") IN ( SELECT "public"."my_channel_ids"() AS "my_channel_ids"))
    AND (NOT "public"."space_muted_in"("public"."message_channel"("message_id")))
    AND ("public"."poll_takes_several"("message_id")
         OR NOT EXISTS (SELECT 1 FROM "public"."space_poll_votes" v
                         WHERE v."message_id" = "space_poll_votes"."message_id" AND v."user_id" = ( SELECT "auth"."uid"()))));

-- a vote is taken back by whoever cast it, while the poll is open
CREATE POLICY "space_poll_votes_delete_own" ON "public"."space_poll_votes" FOR DELETE TO "authenticated"
  USING (("user_id" = ( SELECT "auth"."uid"())) AND "public"."poll_is_open"("message_id"));

GRANT ALL ON TABLE "public"."space_poll_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."space_poll_votes" TO "service_role";
GRANT ALL ON FUNCTION "public"."space_poll_close"("uuid") TO "authenticated";

-- TAKING AN OFFER. One statement decides it: the update lands only while nothing has been taken,
-- so of two people pressing at the same moment exactly one gets true and the other is told the
-- offer is gone. Doing it as "read, then write" is the same race with a longer gap in it.
--
-- The press is that person's own message, in their own name, carrying the words the button said —
-- so the transcript reads as it would have read if they had typed it, and everything that already
-- works on a message (the mention, the notification, the bot's ear) works on this with no new path.
-- What it returns is the message it made, which is what the room then summons the bot about.
CREATE OR REPLACE FUNCTION "public"."space_choose"("p_message" "uuid", "p_key" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare m record; said text; took boolean; new_id uuid;
begin
  if auth.uid() is null then return null; end if;
  select * into m from public.space_messages where id = p_message;
  if m is null then return null; end if;
  if not public.can_read_channel(m.channel_id) then return null; end if;
  -- speaking is membership, exactly as the insert policy has it — never a capability, or
  -- pressing a button would be refused to everybody but the staff
  if not exists (select 1 from public.channel_members cm
                  where cm.channel_id = m.channel_id and cm.user_id = auth.uid()) then return null; end if;
  if public.space_muted_in(m.channel_id) then return null; end if;
  -- the words are the offer's own: a client saying what it pressed cannot say what that meant
  select c->>'text' into said
    from jsonb_array_elements(coalesce(m.meta->'choices', '[]'::jsonb)) c
   where c->>'key' = p_key;
  if said is null then return null; end if;
  perform set_config('app.taking_choice', '1', true);
  update public.space_messages
     set choice_at = now(), choice_key = p_key, choice_by = auth.uid()
   where id = p_message and choice_at is null;
  get diagnostics took = row_count;
  if not took then return null; end if;
  insert into public.space_messages (channel_id, author_id, kind, body, thread_root_id, meta)
    -- where the bot spoke, not under it: a press is an answer in the conversation, and opening a
    -- thread on it would move the conversation somewhere the room cannot see
    values (m.channel_id, auth.uid(), 'text', said, m.thread_root_id,
            jsonb_build_object('chose', jsonb_build_object('message', p_message, 'key', p_key)))
    returning id into new_id;
  return new_id;
end;
$$;
GRANT ALL ON FUNCTION "public"."space_choose"("uuid", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."poll_is_open"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."poll_takes_several"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."message_channel"("uuid") TO "authenticated";

-- Moderation: an administrator may withdraw what was said in a room they can already read, and
-- that is the whole of it. It buys them no new sight: a private channel stays invisible to anybody
-- who is not in it, an administrator included — which is what this module promised on its first day
-- and is not a promise to take back for the convenience of a screen. A direct message is not a room
-- and is never moderated: two people writing to each other would not be moderated, they would be
-- read. And a moderator may not rewrite anything, only withdraw it, which the edit guard holds.
CREATE POLICY "space_messages_moderate_admin" ON "public"."space_messages" FOR UPDATE TO "authenticated"
  USING ("public"."is_admin"()
    AND "channel_id" IN ( SELECT "public"."my_readable_channel_ids"() AS "my_readable_channel_ids")
    AND EXISTS (SELECT 1 FROM "public"."channels" c WHERE c.id = "channel_id" AND c.kind <> 'dm'))
  WITH CHECK ("public"."is_admin"());

CREATE POLICY "space_messages_update_own" ON "public"."space_messages" FOR UPDATE TO "authenticated"
  USING ("author_id" = ( SELECT "auth"."uid"())) WITH CHECK ("author_id" = ( SELECT "auth"."uid"()));

CREATE POLICY "space_mentions_select_reader" ON "public"."space_mentions" FOR SELECT TO "authenticated"
  USING (("user_id" = ( SELECT "auth"."uid"()))
     OR ("channel_id" IN ( SELECT "public"."my_readable_channel_ids"() AS "my_readable_channel_ids")));

CREATE POLICY "space_saved_own" ON "public"."space_saved" TO "authenticated"
  USING ("user_id" = ( SELECT "auth"."uid"())) WITH CHECK ("user_id" = ( SELECT "auth"."uid"()));

-- which channel hears which of the platform's own events is the CHANNEL's own line (`hears` in its
-- file), so this table is a projection like the rest and nobody writes it from a browser
CREATE POLICY "space_hooks_select_staff" ON "public"."space_hooks" FOR SELECT TO "authenticated"
  USING ("public"."is_staff"());

-- THE STRUCTURE IS A FILE, AND NOBODY WRITES IT FROM A BROWSER. A space, its channels, its roles
-- and the grants it ships are declared under content/spaces and projected here by the build; there
-- is no insert, update or delete policy for them on any signed-in role, and the table grants below
-- say SELECT and nothing else, so the mistake this module made once — an admin screen authoring the
-- declaration straight into the tables — cannot be made again.
--
-- What an administrator still does is the acts: putting somebody in a space or taking them out,
-- giving somebody a role or a capability by hand. Those name a PERSON, so they are rows and not a
-- declaration, and they keep their policies. Reading is membership for everyone, as before; an
-- administrator sees the spaces and who is in them, and deliberately no message they could not
-- already read.
CREATE POLICY "spaces_select_admin" ON "public"."spaces" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

CREATE POLICY "space_members_select_admin" ON "public"."space_members" FOR SELECT TO "authenticated" USING ("public"."is_admin"());
CREATE POLICY "space_members_write_admin" ON "public"."space_members" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());
CREATE POLICY "space_members_edit_admin" ON "public"."space_members" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());
CREATE POLICY "space_members_drop_admin" ON "public"."space_members" FOR DELETE TO "authenticated" USING ("public"."is_admin"());

CREATE POLICY "channel_members_select_admin" ON "public"."channel_members" FOR SELECT TO "authenticated" USING ("public"."is_admin"());
-- An administrator moves people in and out of the rooms they can reach. Not the ones they cannot:
-- otherwise the way into a private channel is to put yourself in it, and the promise that a private
-- channel is invisible to anybody outside it would be a promise to everybody except an administrator,
-- which is no promise at all. A private room is kept by the people in it.
CREATE POLICY "channel_members_write_admin" ON "public"."channel_members" FOR INSERT TO "authenticated"
  WITH CHECK ("public"."is_admin"() AND ("channel_id" IN ( SELECT "public"."my_readable_channel_ids"() AS "my_readable_channel_ids")));
CREATE POLICY "channel_members_drop_admin" ON "public"."channel_members" FOR DELETE TO "authenticated"
  USING ("public"."is_admin"() AND ("channel_id" IN ( SELECT "public"."my_readable_channel_ids"() AS "my_readable_channel_ids")));

-- A role is part of a space and read by anybody in it — people see what each other are called. What
-- roles a space HAS is its file's; handing one to somebody is an act, and that is the table below.
ALTER TABLE "public"."space_roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "space_roles_select_member" ON "public"."space_roles" FOR SELECT TO "authenticated"
  USING (("space_id" IN ( SELECT "public"."my_space_ids"() AS "my_space_ids")) OR "public"."is_admin"());

ALTER TABLE "public"."space_member_roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "space_member_roles_select_member" ON "public"."space_member_roles" FOR SELECT TO "authenticated"
  USING (("space_id" IN ( SELECT "public"."my_space_ids"() AS "my_space_ids")) OR "public"."is_admin"());
CREATE POLICY "space_member_roles_write_admin" ON "public"."space_member_roles" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());
CREATE POLICY "space_member_roles_drop_admin" ON "public"."space_member_roles" FOR DELETE TO "authenticated" USING ("public"."is_admin"());

-- The grants are the staff's to read, and nobody's to write directly: a site's own are declared in
-- the space's or the channel's file (source 'file'), and one given to a single person is an act made
-- through space_grant_person below (source 'hand'), which the projection never touches. What a site
-- sells is not a thing a member may hand themselves, and it is not a thing a browser may insert.
ALTER TABLE "public"."space_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "space_grants_select_staff" ON "public"."space_grants" FOR SELECT TO "authenticated" USING ("public"."is_staff"());

-- An invitation is never read from a browser: it is made, looked at and accepted through the
-- functions above, which is the only way a token can be checked without handing anybody the list.
ALTER TABLE "public"."space_invites" ENABLE ROW LEVEL SECURITY;

-- A record of moderation is read through a function too — a member gets what was done to them
-- (space_my_record), a moderator gets their space's (space_reports, space_record) — and is written
-- by one, so nobody can insert a false one or edit a true one. There is no policy here at all,
-- which is the point.
ALTER TABLE "public"."space_moderation" ENABLE ROW LEVEL SECURITY;

-- what the desk has finished with is the staff member's own and nobody else's business
ALTER TABLE "public"."desk_done" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "desk_done_own" ON "public"."desk_done" TO "authenticated"
  USING (("user_id" = ( SELECT "auth"."uid"())) AND "public"."is_staff"())
  WITH CHECK (("user_id" = ( SELECT "auth"."uid"())) AND "public"."is_staff"());

-- ---------------------------------------------------------------------------------------------
-- live: one private topic per channel, sent by the database. The tables are deliberately NOT in the
-- realtime publication — nothing fans out per row; the topic below is the whole of it, and it is
-- authorised by the same rule as reading, so there is no second gate to keep in step.
-- ---------------------------------------------------------------------------------------------

-- A channel has two topics and one rule: sp:<channel> is what the database sends messages on, and
-- call:<channel> is what a huddle in it signals over. They are apart so that signalling never reaches
-- somebody who is only reading, and they are authorised the same way, because they are the same
-- channel. Anything else is not a topic of ours and is refused.
CREATE OR REPLACE FUNCTION "public"."space_topic_channel"("p_topic" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare u text;
begin
  if p_topic is null then return null; end if;
  if p_topic ~ '^sp:' then u := substring(p_topic from 4);
  elsif p_topic ~ '^call:' then u := substring(p_topic from 6);
  else return null; end if;
  if u !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
  return u::uuid;
exception when others then
  return null;
end;
$$;

-- A space has a topic of its own too: who is here. Presence is the one thing a workspace shows that
-- is nobody's message — it is never written down, it lives on the socket, and it is authorised by
-- membership of the space like everything else.
CREATE OR REPLACE FUNCTION "public"."space_topic_space"("p_topic" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare u text;
begin
  if p_topic is null or p_topic !~ '^here:' then return null; end if;
  u := substring(p_topic from 6);
  if u !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
  return u::uuid;
exception when others then
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."in_space"("p_space" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.space_members sm where sm.space_id = p_space and sm.user_id = auth.uid());
$$;

-- What is attached to a message lives in the private spaces bucket under its channel, and the name
-- is the shape and nothing else: a channel's id, the message's id, and the file's extension. An
-- .mp3 is a voice note and needs that capability; anything else is an attached file and needs the
-- other. Either is read by anybody who may read the room.
CREATE POLICY "space members add voice notes" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (
  bucket_id = 'spaces'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.mp3$'
  and ((storage.foldername(name))[1])::uuid in (select public.my_channel_ids())
  and public.space_may(((storage.foldername(name))[1])::uuid, 'voice')
);
CREATE POLICY "space members attach files" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (
  bucket_id = 'spaces'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}(\.poster)?\.(png|jpg|jpeg|gif|webp|pdf|txt|mp4|webm|mov)$'
  and ((storage.foldername(name))[1])::uuid in (select public.my_channel_ids())
  and public.space_may(((storage.foldername(name))[1])::uuid, 'file')
);
CREATE POLICY "space readers hear voice notes" ON "storage"."objects" FOR SELECT TO "authenticated" USING (
  bucket_id = 'spaces'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}(\.poster)?\.(mp3|png|jpg|jpeg|gif|webp|pdf|txt|mp4|webm|mov)$'
  and ((storage.foldername(name))[1])::uuid in (select public.my_readable_channel_ids())
);

CREATE POLICY "spaces_realtime_receive" ON "realtime"."messages" FOR SELECT TO "authenticated"
  USING (
    CASE
      WHEN ( SELECT "realtime"."topic"()) LIKE 'here:%'
        THEN "public"."in_space"("public"."space_topic_space"(( SELECT "realtime"."topic"())))
      WHEN ( SELECT "realtime"."topic"()) LIKE 'call:%'
        THEN "public"."in_channel"("public"."space_topic_channel"(( SELECT "realtime"."topic"())))
      ELSE "public"."can_read_channel"("public"."space_topic_channel"(( SELECT "realtime"."topic"())))
    END);

-- typing, presence and read receipts are the client's own sends on the same topic, and are never
-- written down anywhere
CREATE POLICY "spaces_realtime_send" ON "realtime"."messages" FOR INSERT TO "authenticated"
  WITH CHECK (
    CASE
      WHEN ( SELECT "realtime"."topic"()) LIKE 'here:%'
        THEN "public"."in_space"("public"."space_topic_space"(( SELECT "realtime"."topic"())))
      ELSE "public"."in_channel"("public"."space_topic_channel"(( SELECT "realtime"."topic"())))
    END);

-- ---------------------------------------------------------------------------------------------
-- the grants
-- ---------------------------------------------------------------------------------------------

GRANT SELECT ON TABLE "public"."spaces" TO "authenticated";
GRANT ALL ON TABLE "public"."spaces" TO "service_role";
GRANT SELECT ON TABLE "public"."space_members" TO "authenticated";
GRANT ALL ON TABLE "public"."space_members" TO "service_role";
GRANT SELECT ON TABLE "public"."channels" TO "authenticated";
GRANT ALL ON TABLE "public"."channels" TO "service_role";
-- A MEMBER'S OWN ROW, BUT NOT ALL OF IT: they choose how the room tells them things; which room it is,
-- whose row it is, and how they came to be there (the sweep takes back only what a rule gave) are
-- never theirs to change, or one update moves them into a private room or past a lapsed membership
REVOKE UPDATE ON TABLE "public"."channel_members" FROM "authenticated";
GRANT SELECT, INSERT, DELETE ON TABLE "public"."channel_members" TO "authenticated";
GRANT UPDATE ("last_read_seq", "mention_count", "notify", "muted_until", "starred") ON TABLE "public"."channel_members" TO "authenticated";
GRANT ALL ON TABLE "public"."channel_members" TO "service_role";
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."space_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."space_messages" TO "service_role";
GRANT SELECT ON TABLE "public"."space_mentions" TO "authenticated";
GRANT ALL ON TABLE "public"."space_mentions" TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."space_saved" TO "authenticated";
GRANT ALL ON TABLE "public"."space_saved" TO "service_role";
GRANT SELECT ON TABLE "public"."space_hooks" TO "authenticated";
GRANT ALL ON TABLE "public"."space_hooks" TO "service_role";
GRANT SELECT ON TABLE "public"."space_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."space_roles" TO "service_role";
GRANT ALL ON TABLE "public"."space_member_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."space_member_roles" TO "service_role";
GRANT SELECT ON TABLE "public"."space_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."desk_done" TO "authenticated";
GRANT ALL ON TABLE "public"."space_invites" TO "service_role";
GRANT ALL ON TABLE "public"."space_moderation" TO "service_role";
GRANT ALL ON TABLE "public"."desk_done" TO "service_role";
GRANT ALL ON TABLE "public"."space_grants" TO "service_role";

REVOKE ALL ON FUNCTION "public"."space_fill_matches"("uuid", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_fill_matches"("uuid", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_fill_matches"("uuid", "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."my_space_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_space_ids"() TO "service_role";
GRANT ALL ON FUNCTION "public"."my_channel_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_channel_ids"() TO "service_role";
GRANT ALL ON FUNCTION "public"."my_readable_channel_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_readable_channel_ids"() TO "service_role";
GRANT ALL ON FUNCTION "public"."my_joinable_channel_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_joinable_channel_ids"() TO "service_role";
GRANT ALL ON FUNCTION "public"."in_channel"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."in_channel"("uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."can_read_channel"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_channel"("uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_topic_channel"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_topic_space"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."in_space"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."in_space"("uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_topic_channel"("text") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_find_people"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_people_named"("uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_holds"("uuid", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_holds"("uuid", "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_may"("uuid", "text") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_grant_person"("uuid", "text", "uuid", "uuid", integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_grant_person"("uuid", "text", "uuid", "uuid", integer, "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_grant_person"("uuid", "text", "uuid", "uuid", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_grant_person"("uuid", "text", "uuid", "uuid", integer, "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_ungrant"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_ungrant"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_ungrant"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_ungrant"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_room_made"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_room_made"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_room_made"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_muted"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_muted"("uuid", "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_muted"("uuid", "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_muted"("uuid", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_muted_in"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_muted_in"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_muted_in"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_muted_in"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_my_record"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_my_record"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_my_record"() TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_report"("uuid", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_report"("uuid", "text", "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_report"("uuid", "text", "text") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_moderate"("text", "uuid", "uuid", "uuid", "text", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_moderate"("text", "uuid", "uuid", "uuid", "text", integer) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_moderate"("text", "uuid", "uuid", "uuid", "text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_moderate"("text", "uuid", "uuid", "uuid", "text", integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_report_answered"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_report_answered"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_report_answered"("uuid") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_reports"("uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_reports"("uuid", boolean) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_reports"("uuid", boolean) TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_record"("uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_record"("uuid", integer) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_record"("uuid", integer) TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_lately"("uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_lately"("uuid", integer) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_lately"("uuid", integer) TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_discover"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_discover"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_discover"() TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_invite"("uuid", "text", "text", integer, integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_invite"("uuid", "text", "text", integer, integer, "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_invite"("uuid", "text", "text", integer, integer, "text") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_invite_look"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_invite_look"("text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_invite_look"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_invite_look"("text") TO "anon";
REVOKE ALL ON FUNCTION "public"."space_invite_accept"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_invite_accept"("text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_invite_accept"("text") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_invites_of"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_invites_of"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_invites_of"("uuid") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_invite_drop"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_invite_drop"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_invite_drop"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_may"("uuid", "text") TO "service_role";
GRANT ALL ON TABLE "public"."space_mutes" TO "authenticated";
GRANT ALL ON TABLE "public"."space_mutes" TO "service_role";
GRANT ALL ON FUNCTION "public"."space_my_mutes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_mute"("text", "uuid", timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_unmute"("text", "uuid") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_barred"("uuid", "text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_barred"("uuid", "text", "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_barred"("uuid", "text", "uuid") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."space_banned"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_banned"("uuid", "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_banned"("uuid", "uuid") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."space_shadowed"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_shadowed"("uuid", "uuid") FROM "anon", "authenticated";
-- whether somebody is shadowed is the moderators' to know (space_mark_shadowed asks it, as the owner): told to anybody, it tells the shadowed
GRANT ALL ON FUNCTION "public"."space_shadowed"("uuid", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_sees"(boolean, "uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_sees"(boolean, "uuid", "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_sees"(boolean, "uuid", "uuid") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."space_lift"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_lift"("uuid", "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_lift"("uuid", "text") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."space_hushed"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_hushed"("uuid", "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_hushed"("uuid", "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_hushed"("uuid", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_hushed_person"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_hushed_person"("uuid", "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_hushed_person"("uuid", "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_hushed_person"("uuid", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_horizon"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_horizon"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_horizon"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_horizon"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_horizon_in"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_horizon_in"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_horizon_in"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_horizon_in"("uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_unread"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_unread"() TO "service_role";
GRANT ALL ON FUNCTION "public"."space_catchup"("jsonb", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_catchup"("jsonb", integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."space_history"("uuid", bigint, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_history"("uuid", bigint, integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."space_posts"("uuid", timestamp with time zone, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_posts"("uuid", timestamp with time zone, integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."space_thread"("uuid", bigint, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_thread"("uuid", bigint, integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."space_read"("uuid", bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_read"("uuid", bigint) TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_notify_targets"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_notify_targets"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_notify_targets"("uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_dm_open"("uuid", "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_dm_open"("uuid", "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."space_dms"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_threads"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_activity"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_unseen"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_later"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_fill_values"("jsonb", "text") TO "authenticated", "anon", "service_role";
-- about any account by id (whether it has paid, which tiers it holds): space_fill_matches asks it, as the owner
REVOKE ALL ON FUNCTION "public"."space_fill_set_matches"("uuid", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_fill_set_matches"("uuid", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_fill_set_matches"("uuid", "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."may_see_member"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."may_see_member"("uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_member_card"("uuid", "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_member_card"("uuid", "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_people"("uuid", "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_people"("uuid", "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."space_search"("text", "uuid", "uuid", "uuid", timestamp with time zone, timestamp with time zone, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_search"("text", "uuid", "uuid", "uuid", timestamp with time zone, timestamp with time zone, integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_joined"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_joined"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_joined"() TO "service_role";
-- ---------------------------------------------------------------------------------------------
-- PINS: what is pinned here, and pinning one.

CREATE OR REPLACE FUNCTION "public"."space_pinned"("p_channel" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.can_read_channel(p_channel) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
        'message_id', p.message_id, 'note', p.note, 'created_at', p.created_at,
        'pinned_by', p.pinned_by,
        'by', (select coalesce(nullif(pr.display_name, ''), split_part(coalesce(pr.email, ''), '@', 1))
                 from public.profiles pr where pr.id = p.pinned_by),
        'author_id', m.author_id, 'kind', m.kind, 'body', m.body, 'title', m.title,
        'meta', m.meta, 'said_at', m.created_at, 'deleted_at', m.deleted_at,
        'thread_root_id', m.thread_root_id)
      order by p.created_at desc)
      from public.space_pins p
      join public.space_messages m on m.id = p.message_id
     where p.channel_id = p_channel and m.deleted_at is null), '[]'::jsonb) end;
$$;

-- Pinning and unpinning are one call, because "is it pinned" is a state and the surface holds a
-- switch. The channel comes from the message rather than from the caller: a client that could name
-- both could pin a message of one room into another.
CREATE OR REPLACE FUNCTION "public"."space_pin"("p_message" "uuid", "p_on" boolean DEFAULT true, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare ch uuid;
begin
  select channel_id into ch from public.space_messages where id = p_message and deleted_at is null;
  if ch is null then return jsonb_build_object('error', 'no-message'); end if;
  if not public.space_may(ch, 'moderate') then return jsonb_build_object('error', 'not-allowed'); end if;
  if p_on then
    insert into public.space_pins (channel_id, message_id, pinned_by, note)
         values (ch, p_message, auth.uid(), nullif(trim(coalesce(p_note, '')), ''))
    on conflict (channel_id, message_id) do update set note = excluded.note;
  else
    delete from public.space_pins where message_id = p_message;
  end if;
  -- the room is told, so a pin appears for everybody looking at it without anybody reloading
  perform public.space_wake(ch, 'pins', jsonb_build_object('channel', ch));
  return jsonb_build_object('ok', true, 'pinned', p_on);
end;
$$;

ALTER TABLE "public"."space_pins" ENABLE ROW LEVEL SECURITY;
-- read by anybody who can read the room; written only through space_pin, which checks the
-- capability and derives the channel — so there is one place a pin can come from
CREATE POLICY "space_pins_select" ON "public"."space_pins" FOR SELECT TO "authenticated"
  USING ("public"."can_read_channel"("channel_id"));

GRANT ALL ON FUNCTION "public"."space_pinned"("uuid") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."space_pin"("uuid", boolean, "text") TO "authenticated", "service_role";
GRANT SELECT ON TABLE "public"."space_pins" TO "authenticated";

-- ---------------------------------------------------------------------------------------------
-- SENDING LATER: putting one down, taking it back, and the minute it goes.

-- Scheduling goes through a function rather than a policy because two things must be true and only
-- the database knows the second: the time is in the future, and this person may write in this room
-- at all. A client that could insert the row could schedule into a room it cannot speak in.
CREATE OR REPLACE FUNCTION "public"."space_schedule"("p_channel" "uuid", "p_body" "text", "p_at" timestamp with time zone, "p_thread" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.space_scheduled;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign-in'); end if;
  if not public.can_read_channel(p_channel) then return jsonb_build_object('error', 'not-yours'); end if;
  if coalesce(trim(p_body), '') = '' then return jsonb_build_object('error', 'empty'); end if;
  if p_at is null or p_at <= now() then return jsonb_build_object('error', 'past'); end if;
  -- a year is the far end of "later"; past that somebody means a reminder, not a message
  if p_at > now() + interval '1 year' then return jsonb_build_object('error', 'too-far'); end if;
  if (select count(*) from public.space_scheduled where author_id = auth.uid() and failed is null) >= 50 then
    return jsonb_build_object('error', 'too-many');
  end if;
  insert into public.space_scheduled (channel_id, author_id, body, thread_root_id, send_at)
       values (p_channel, auth.uid(), trim(p_body), p_thread, p_at)
  returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'send_at', r.send_at);
end;
$$;

-- what this person has waiting, and where. Theirs alone: the policy says so and this agrees.
CREATE OR REPLACE FUNCTION "public"."space_scheduled_mine"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'channel_id', l.channel_id, 'channel', c.name, 'channel_kind', c.kind,
      'space', s.name, 'body', l.body, 'thread_root_id', l.thread_root_id,
      'send_at', l.send_at, 'failed', l.failed) order by l.send_at), '[]'::jsonb)
    from public.space_scheduled l
    join public.channels c on c.id = l.channel_id
    join public.spaces s on s.id = c.space_id
   where l.author_id = auth.uid();
$$;

-- THE MINUTE IT GOES. An ordinary insert, so every trigger that follows a message follows this one
-- too: the sequence, the mentions, the wake, the author's own cursor. A row whose room has gone or
-- whose author is no longer in it is marked rather than dropped, so somebody is told.
CREATE OR REPLACE FUNCTION "public"."run_space_scheduled"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare l record; n integer := 0;
begin
  for l in select * from public.space_scheduled
            where failed is null and send_at <= now()
            order by send_at limit 200 loop
    if not exists (
      select 1 from public.channel_members cm join public.channels c on c.id = cm.channel_id
       where cm.channel_id = l.channel_id and cm.user_id = l.author_id and c.archived_at is null)
    then
      update public.space_scheduled set failed = 'not-in-room' where id = l.id;
      continue;
    end if;
    insert into public.space_messages (channel_id, author_id, kind, body, thread_root_id)
         values (l.channel_id, l.author_id, 'text', l.body, l.thread_root_id);
    delete from public.space_scheduled where id = l.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

ALTER TABLE "public"."space_scheduled" ENABLE ROW LEVEL SECURITY;
-- theirs and nobody else's: not the room's moderators, not the other people in it. A message that
-- has not been sent has not been said.
CREATE POLICY "space_scheduled_mine" ON "public"."space_scheduled" FOR SELECT TO "authenticated"
  USING (("author_id" = "auth"."uid"()));
-- taking one back is deleting it; putting one down goes through the function, which checks the room
CREATE POLICY "space_scheduled_drop" ON "public"."space_scheduled" FOR DELETE TO "authenticated"
  USING (("author_id" = "auth"."uid"()));

GRANT SELECT, DELETE ON TABLE "public"."space_scheduled" TO "authenticated";
GRANT ALL ON FUNCTION "public"."space_schedule"("uuid", "text", timestamp with time zone, "uuid") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."space_scheduled_mine"() TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."run_space_scheduled"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_space_scheduled"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_space_scheduled"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."space_sync_one"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_sync_one"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_sync_one"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_on_standing"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_on_standing"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_on_standing"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_sync_members"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_sync_members"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_sync_members"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_post"("uuid", "text", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_post"("uuid", "text", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_post"("uuid", "text", "jsonb") TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_on_purchase"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_on_purchase"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_on_purchase"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_on_subscription"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_on_subscription"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_on_subscription"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_on_print_order"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_on_print_order"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_on_print_order"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_on_account"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_on_account"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_on_account"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_on_escalation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_on_escalation"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_on_escalation"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."space_hook_post"("text", "text", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_hook_post"("text", "text", "jsonb") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_hook_post"("text", "text", "jsonb") TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- THE FRONT PAGE'S FEED — what has been said lately across every space this person is in.
--
-- space_lately answers for ONE space, which is what a space's home wants. A community's front page
-- wants the other question: what is happening, anywhere, without having to pick a room first. That
-- is the thing a member opens the app to see, and asking it per space and merging in the browser
-- would be one round trip per space and a different order every time.
--
-- Rooms only, nothing withdrawn, nothing the machine said, and only what this person may read —
-- my_readable_channel_ids is the same fence every other read here uses.
CREATE OR REPLACE FUNCTION "public"."space_everywhere"("p_lim" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(row order by (row->>'created_at') desc) from (
    select jsonb_build_object(
      'id', m.id, 'channel', m.channel_id, 'room', c.name, 'room_slug', c.slug,
      'space', s.id, 'space_name', s.name, 'space_slug', s.slug,
      'kind', m.kind, 'title', m.title, 'body', m.body, 'created_at', m.created_at,
      'replies', m.reply_count, 'author', m.author_id,
      'bot', m.meta->>'bot',
      -- the whole of meta, because the platform's own lines are worded FROM it: a system row carries
      -- an event name and its facts rather than a sentence, and a feed given only the body shows an
      -- empty card by nobody. saidIn() turns the two into the line, here as everywhere else.
      'meta', m.meta,
      'name', coalesce(m.meta->>'name',
                       nullif(p.display_name, ''),
                       split_part(coalesce(p.email, ''), '@', 1))) as row
      from public.space_messages m
      join public.channels c on c.id = m.channel_id
      join public.spaces s on s.id = c.space_id
      left join public.profiles p on p.id = m.author_id
     where c.kind = 'channel' and c.archived_at is null and s.archived_at is null
       and m.deleted_at is null and m.thread_root_id is null
       and public.space_sees(m.shadowed, m.author_id, m.channel_id)
       and c.id in (select public.my_readable_channel_ids())
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_lim, 30), 100))) q), '[]'::jsonb);
$$;
REVOKE ALL ON FUNCTION "public"."space_everywhere"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_everywhere"(integer) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_everywhere"(integer) TO "authenticated", "service_role";

-- WHAT THE COMMUNITY HAS BEEN TOLD. An announcement is a message like any other — the same row, the
-- same room, the same moderation — and what makes it one is its kind, which the insert policy only
-- lets through for somebody the space granted `announce`. So there is nothing here to keep in step:
-- this is the ordinary feed asked one question.
--
-- It answers for the WHOLE community when no space is named (the front page) and for one space when
-- one is (that space's own home), because those are the two places a reader looks for "what should
-- I know". Hidden rooms are left out for everybody but staff, as they are everywhere else.
CREATE OR REPLACE FUNCTION "public"."space_announcements"("p_space" "uuid" DEFAULT NULL::"uuid", "p_lim" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(to_jsonb(q.row) order by q.created_at desc) from (
    select m.created_at, jsonb_build_object(
        'id', m.id, 'channel', m.channel_id, 'space', c.space_id, 'space_name', s.name, 'space_slug', s.slug,
        'channel_name', c.name, 'channel_slug', c.slug, 'title', m.title, 'body', m.body,
        'created_at', m.created_at, 'author', m.author_id,
        'author_name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
        'author_title', nullif(p.title, '')) as row
      from public.space_messages m
      join public.channels c on c.id = m.channel_id
      join public.spaces s on s.id = c.space_id
      left join public.profiles p on p.id = m.author_id
     where m.kind = 'announcement'
       and m.deleted_at is null
       and (p_space is null or c.space_id = p_space)
       and c.archived_at is null and s.archived_at is null
       and (not c.hidden or public.is_staff())
       and (not s.hidden or public.is_staff())
       and public.space_sees(m.shadowed, m.author_id, m.channel_id)
       and c.id in (select public.my_readable_channel_ids())
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_lim, 10), 50))) q), '[]'::jsonb);
$$;
REVOKE ALL ON FUNCTION "public"."space_announcements"("uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_announcements"("uuid", integer) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."space_announcements"("uuid", integer) TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- ASKING TO JOIN.
--
-- A space's `fill` says who is a member by rule — a tier, a role, an entitlement — and that has
-- never been the only way people get into places. Somebody sees a community they are not in and
-- wants in. What happens next is the space's own decision, declared in its file:
--
--   none      (the default) nobody asks: you are in by the rule or you are not. A staff space.
--   open      anybody signed in may join, there and then. No row to approve, no waiting.
--   request   they ask and are let in at once — the ask is recorded, not judged. This is how a
--             community keeps a list of who came in by the door rather than by the rule.
--   approve   they ask and somebody says yes. The request waits.
--
-- and either of the last two may also require a FORM to be answered (one of the site's own) and
-- TERMS to be agreed. Both are conditions of the ask, not of the membership: somebody refused
-- still answered honestly, and their answers stay with the request.
--
-- The request is state and the policy is a declaration, which is the line this table is drawn on.
CREATE TABLE IF NOT EXISTS "public"."space_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "space_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "state" "text" DEFAULT 'waiting'::"text" NOT NULL,
    -- what they answered, where the space asks a form of them. The response's own id, so the
    -- answers live where every other form response lives and are read by the same tools.
    "response_id" "uuid",
    -- and that they agreed, with the moment, because "they agreed" without a when is not a record
    "agreed_at" timestamp with time zone,
    "note" "text",
    -- who answered it, and when
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "space_requests_state_check" CHECK (("state" = ANY (ARRAY['waiting'::"text", 'accepted'::"text", 'refused'::"text"]))),
    CONSTRAINT "space_requests_note_len" CHECK (("note" IS NULL OR "length"("note") <= 500))
);
ALTER TABLE ONLY "public"."space_requests" ADD CONSTRAINT "space_requests_one" UNIQUE ("space_id", "user_id");
ALTER TABLE ONLY "public"."space_requests" ADD CONSTRAINT "space_requests_space_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."space_requests" ADD CONSTRAINT "space_requests_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "space_requests_waiting_idx" ON "public"."space_requests" ("space_id", "created_at") WHERE ("state" = 'waiting');

ALTER TABLE "public"."space_requests" ENABLE ROW LEVEL SECURITY;
-- a person sees their own ask; whoever keeps the space sees all of them
DROP POLICY IF EXISTS "space_requests_select" ON "public"."space_requests";
CREATE POLICY "space_requests_select" ON "public"."space_requests" FOR SELECT TO "authenticated"
  USING (("user_id" = (SELECT "auth"."uid"()))
     OR EXISTS (SELECT 1 FROM "public"."channels" c WHERE c."space_id" = "space_requests"."space_id" AND "public"."space_may"(c."id", 'moderate')));
GRANT SELECT ON TABLE "public"."space_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."space_requests" TO "service_role";

-- ASKING. Everything the space's policy requires is checked here, in one place, because a client
-- that could skip the terms is a client that will.
CREATE OR REPLACE FUNCTION "public"."space_ask"("p_space" "uuid", "p_note" "text" DEFAULT NULL,
      "p_response" "uuid" DEFAULT NULL, "p_agreed" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare sp public.spaces; j jsonb; r public.space_requests;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign-in'); end if;
  select * into sp from public.spaces where id = p_space and archived_at is null;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  j := coalesce(sp.joining, '{}'::jsonb);
  if coalesce(j->>'how', 'none') = 'none' then return jsonb_build_object('error', 'not-open'); end if;
  if exists (select 1 from public.space_members where space_id = p_space and user_id = auth.uid())
    then return jsonb_build_object('error', 'already-in'); end if;
  -- the fence under space_members would drop the row silently, which from a door reads as a bug.
  -- Asked here so the answer is a sentence
  if public.space_banned(p_space) then return jsonb_build_object('error', 'barred'); end if;
  -- the conditions of the ask, refused here rather than trusted from the page
  if coalesce(j->>'terms', '') <> '' and not p_agreed then return jsonb_build_object('error', 'terms'); end if;
  if coalesce(j->>'form', '') <> '' and p_response is null then return jsonb_build_object('error', 'form'); end if;

  insert into public.space_requests (space_id, user_id, note, response_id, agreed_at, state)
       values (p_space, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''), p_response,
               case when p_agreed then now() else null end,
               case when j->>'how' = 'approve' then 'waiting' else 'accepted' end)
  on conflict (space_id, user_id) do update
     set note = coalesce(excluded.note, public.space_requests.note),
         response_id = coalesce(excluded.response_id, public.space_requests.response_id),
         agreed_at = coalesce(excluded.agreed_at, public.space_requests.agreed_at)
  returning * into r;

  -- open and request let them in at once; the difference between the two is whether a row is kept
  if r.state = 'accepted' then
    insert into public.space_members (space_id, user_id, source) values (p_space, auth.uid(), 'invite')
      on conflict do nothing;
    update public.space_requests set decided_at = now() where id = r.id;
  end if;
  return jsonb_build_object('ok', true, 'state', r.state);
end;
$$;

-- ANSWERING ONE. A moderator's act, so it is checked here and the row records who and when.
CREATE OR REPLACE FUNCTION "public"."space_answer"("p_request" "uuid", "p_yes" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r public.space_requests;
begin
  select * into r from public.space_requests where id = p_request;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  if not exists (select 1 from public.channels c where c.space_id = r.space_id and public.space_may(c.id, 'moderate'))
    then return jsonb_build_object('error', 'not-allowed'); end if;
  update public.space_requests
     set state = case when p_yes then 'accepted' else 'refused' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_request;
  if p_yes then
    insert into public.space_members (space_id, user_id, source) values (r.space_id, r.user_id, 'invite')
      on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- WHAT IS WAITING, for whoever keeps the space.
CREATE OR REPLACE FUNCTION "public"."space_asks"("p_space" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not exists (select 1 from public.channels c where c.space_id = p_space and public.space_may(c.id, 'moderate'))
    then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'user_id', r.user_id, 'note', r.note, 'created_at', r.created_at,
             'agreed_at', r.agreed_at, 'response_id', r.response_id,
             'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
             'email', p.email)
           order by r.created_at)
      from public.space_requests r left join public.profiles p on p.id = r.user_id
     where r.space_id = p_space and r.state = 'waiting'), '[]'::jsonb) end;
$$;

REVOKE ALL ON FUNCTION "public"."space_ask"("uuid", "text", "uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_ask"("uuid", "text", "uuid", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_ask"("uuid", "text", "uuid", boolean) TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."space_answer"("uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_answer"("uuid", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_answer"("uuid", boolean) TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."space_asks"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_asks"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_asks"("uuid") TO "authenticated", "service_role";
