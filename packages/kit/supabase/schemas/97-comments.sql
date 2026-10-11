--
-- COMMENTS, ONCE, FOR ANYTHING.
--
-- This started as event_comments — a table, two functions and a policy that knew the word "event".
-- Which is the mistake this project keeps catching: a narrow solution to a question nobody asked
-- narrowly. People want to say something under an article, a wiki page, a book, a product and an
-- event, and five tables would be five sets of policies to get subtly different.
--
-- So a comment names a SUBJECT — a kind and an id — and nothing here knows what those kinds are.
-- Adding one is a row in comment_subjects, which the build projects, and no change here at all.
--
-- WHO MAY READ AND WHO MAY SAY are the subject's own business, not the comment's, and they are two
-- different questions: a members-only article may take comments from members, a public one may
-- take them from anybody signed in, and a book may show them and take none. Both live on the
-- projected row, so a policy asks one table whatever the kind.
--

-- A vote and a reaction are one pair of tables for the whole site (99-reactions), declared after
-- this file because they answer both a comment and a message in a room; the reads below name them,
-- so bodies are not checked as they are written here, exactly as in the spaces file.
SET check_function_bodies = false;

-- what can be commented on, projected from the content and the events. Nobody edits this.
CREATE TABLE IF NOT EXISTS "public"."comment_subjects" (
    "kind" "text" NOT NULL,                       -- event | article | wiki | doc | book | product | …
    "subject" "text" NOT NULL,                    -- the thing's own id or slug
    "title" "text",
    "href" "text",
    -- who may SEE it: the same canAccess ladder the rest of the library is gated by
    "access" text[] DEFAULT '{}'::text[] NOT NULL,
    -- who may SAY something: off | everyone (anybody signed in) | members (who may see it) | hosts
    "allow" "text" DEFAULT 'members'::"text" NOT NULL,
    -- A CONVERSATION IN TWO PLACES AT ONCE. Where a subject names a forum channel, its comments
    -- ARE a post in that channel: one thread, reachable from the book's page and from the board,
    -- so nothing anybody says is stranded somewhere only one route reaches. The moderation comes
    -- free with it — a comment is a space message, so reports, removals and the queue already
    -- cover it, and the desk does not need a second set of tools for a second kind of talk.
    -- A subject with no channel keeps its comments in the table below, which is what a site with
    -- no community wants and what an embed on somebody else's domain gets.
    "channel_id" "uuid",
    -- the post, once somebody has said the first thing. Written by comment_say, never by hand.
    "post_id" "uuid",
    -- DOES WHAT SOMEBODY SAYS APPEAR AT ONCE? none — yes; all — everything waits for a person;
    -- trusted — everything waits except from somebody this site already trusts (staff, a live
    -- membership, a paid purchase, an author a moderator has released before). Trust is a fact about
    -- the PERSON, true before they typed anything; nothing here judges what they wrote. The one
    -- thing that reads the words is the flagged list, and all it does is queue a click (below).
    "approval" "text" DEFAULT 'none'::"text" NOT NULL,
    -- HOW DEEP THE INDENT GOES and how long a run may get before it folds. A reply may answer any
    -- reply to any depth — who somebody was answering is part of what they said — and it is the
    -- DRAWING that is bounded: indent to `depth`, then one flat run, each saying who it answers,
    -- and more than `collapse` of them behind a control that says how many. An embed on somebody
    -- else's page sets depth 1, because a narrow column plus indents is a comment eight words wide.
    "depth" integer DEFAULT 3 NOT NULL,
    "collapse" integer DEFAULT 5 NOT NULL,
    -- WHAT MAY BE DONE TO A COMMENT WITHOUT WRITING ONE. Reactions on, votes off: a score changes
    -- what people write as well as what they read, so a site opts into that rather than finding it
    -- already running. A channel is set apart from this (90-spaces): wanting a scored forum says
    -- nothing about wanting scored book chapters.
    "votes" boolean DEFAULT false NOT NULL,
    "reactions" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comment_subjects_pkey" PRIMARY KEY ("kind", "subject"),
    CONSTRAINT "comment_subjects_allow_check" CHECK (("allow" = ANY (ARRAY['off'::"text", 'everyone'::"text", 'members'::"text", 'hosts'::"text"]))),
    CONSTRAINT "comment_subjects_approval_check" CHECK (("approval" = ANY (ARRAY['none'::"text", 'all'::"text", 'trusted'::"text"]))),
    CONSTRAINT "comment_subjects_depth_check" CHECK (("depth" BETWEEN 1 AND 10)),
    CONSTRAINT "comment_subjects_collapse_check" CHECK (("collapse" BETWEEN 1 AND 200))
);
ALTER TABLE "public"."comment_subjects" ENABLE ROW LEVEL SECURITY;
-- a subject's existence is not a secret; what it is attached to is gated where that thing is
DROP POLICY IF EXISTS "comment_subjects_select" ON "public"."comment_subjects";
CREATE POLICY "comment_subjects_select" ON "public"."comment_subjects" FOR SELECT TO "authenticated", "anon" USING (true);
GRANT SELECT ON TABLE "public"."comment_subjects" TO "authenticated", "anon";
GRANT ALL ON TABLE "public"."comment_subjects" TO "service_role";

CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    -- A REPLY TO ANOTHER COMMENT, to any depth. This was capped at one level, with a reason next to
    -- it — a thread that nests forever is a thread nobody reads to the end of — and the reason was
    -- right about READING and was answered by forbidding the REPLY, which are not the same thing.
    -- Somebody answering the third comment in a run is answering THAT comment, and flattening it to
    -- the top loses who they were talking to. So the depth is kept here and bounded in the drawing:
    -- comment_subjects.depth and .collapse, and src/lib/comments/model.js works out the shape.
    "parent_id" "uuid",
    "body" "text" NOT NULL,
    -- HAS A PERSON LET THIS THROUGH. `waiting` is held: visible to its author, marked as waiting,
    -- and to nobody else but whoever may moderate it. `live` is everything else. There is no third
    -- value here because removal is the withdrawal every message already has — deleted_at — and
    -- two columns that can disagree about whether something is gone is one too many; the reads
    -- join them into the three words the admin filters by (waiting · live · removed).
    "state" "text" DEFAULT 'live'::"text" NOT NULL,
    -- WHO LET IT THROUGH AND WHEN, which is also the whole of "an author the site has trusted":
    -- somebody with an approved comment is trusted, and there is no second copy of that fact on
    -- their profile to fall out of step with this one.
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    -- the word from the site's flagged list that held it, for the moderator alone. The author is
    -- never told which word caught them: a list somebody can probe is a list somebody can walk
    -- around. Null when nothing matched, which is almost always.
    "flagged" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comments_body_check" CHECK (("char_length"("body") BETWEEN 1 AND 4000)),
    CONSTRAINT "comments_state_check" CHECK (("state" = ANY (ARRAY['waiting'::"text", 'live'::"text"])))
);
ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "comments_subject_idx" ON "public"."comments" USING "btree" ("kind", "subject", "created_at");
-- the queue: everything still waiting, newest first, across every subject at once
CREATE INDEX IF NOT EXISTS "comments_waiting_idx" ON "public"."comments" USING "btree" ("created_at" DESC) WHERE ("state" = 'waiting'::"text");
-- "has this person been approved before", asked on the way in for every comment on a trusted surface
CREATE INDEX IF NOT EXISTS "comments_approved_author_idx" ON "public"."comments" USING "btree" ("author_id") WHERE ("approved_at" IS NOT NULL);

ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;

-- A KIND MAY BE OPEN-ENDED. Everything of the site's own is projected — an article, a chapter, a
-- product — because the site knows what it has. A page on SOMEBODY ELSE'S site is not: an embed on
-- a blog with two hundred posts cannot have two hundred rows projected for it, and Disqus creates
-- a thread the first time anybody comments.
--
-- So a kind may carry a row with subject '*': the site declaring "this kind is open — here is who
-- may read it, who may say something, and which channel it belongs in". A concrete subject is then
-- made the first time somebody comments, from that row, with the title the embed passed. It is
-- still a DECLARATION: the site says the kind is open, and nobody can invent a kind.
CREATE OR REPLACE FUNCTION "public"."comment_open_kind"("p_kind" "text") RETURNS "public"."comment_subjects"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select * from public.comment_subjects where kind = p_kind and subject = '*';
$$;

-- MAY I SEE THIS THING? The subject's own bar, on the same ladder as everything else. A subject
-- nobody has projected is not commentable at all — unless its KIND is open, and then the wildcard
-- row answers for it. That is the safe default for a new kind either way: a site says so or it is not.
CREATE OR REPLACE FUNCTION "public"."comment_may_read"("p_kind" "text", "p_subject" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.comment_subjects s
     where s.kind = p_kind and s.subject in (p_subject, '*')
       and public.access_allows(s.access, public.my_class()));
$$;

-- AND MAY I SAY SOMETHING? A different question, and the subject answers it separately: showing a
-- conversation and joining one are not the same permission.
CREATE OR REPLACE FUNCTION "public"."comment_may_write"("p_kind" "text", "p_subject" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when auth.uid() is null then false
    else coalesce((
      select case s.allow
        when 'off' then false
        when 'hosts' then public.is_staff()
        when 'everyone' then true
        else public.access_allows(s.access, public.my_class())   -- members: whoever may see it
      end
        from public.comment_subjects s
       where s.kind = p_kind and s.subject in (p_subject, '*')
       order by case when s.subject = p_subject then 0 else 1 end
       limit 1), false)
  end;
$$;

-- MAY I MODERATE IT? Staff always; and where the subject's conversation lives in a forum room, whoever
-- moderates that room, because a comment there IS a post there and a second set of moderators for the
-- same words would be two answers to one question. A subject attached to no room has no room's
-- moderators, so it falls to the desk — which is exactly why the desk grew a Comments queue.
CREATE OR REPLACE FUNCTION "public"."comment_may_moderate"("p_kind" "text", "p_subject" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_staff() or exists (
    select 1 from public.comment_subjects s
     where s.kind = p_kind and s.subject = p_subject
       and s.channel_id is not null and public.space_may(s.channel_id, 'moderate'));
$$;

-- IS THIS PERSON SOMEBODY THE SITE ALREADY TRUSTS — asked of standings that were true before they
-- typed anything: they run part of the site, they pay for a membership, they have bought something,
-- or a moderator has released a comment of theirs before. Nothing here reads a word they wrote.
--
-- The fourth is not a column on their profile: it is the approval stamp on the comment that was
-- released. One fact, one place — a copy on the profile is a copy that can fall out of step.
CREATE OR REPLACE FUNCTION "public"."comment_trusted"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with who as (select coalesce(p_user, auth.uid()) as id)
  select case when (select id from who) is null then false else (
    select exists (select 1 from public.profiles p
                    where p.id = (select id from who) and cardinality(p.roles) > 0)
        or exists (select 1 from public.entitlements e
                    where e.user_id = (select id from who)
                      and e.kind = 'class' and e.key = 'subscribed' and e.active
                      and (e.expires_at is null or e.expires_at > now()))
        or exists (select 1 from public.purchases pu
                    where pu.user_id = (select id from who) and pu.status = 'paid')
        or exists (select 1 from public.comments c
                    where c.author_id = (select id from who) and c.approved_at is not null)
  ) end;
$$;

-- THE SITE'S FLAGGED WORDS. One list for the whole site, projected from content/comments.md into
-- app_settings, which no browser can read — and it must stay that way: an author who can see the
-- list can walk around it.
--
-- A machine may FLAG; only a person decides. A match holds the comment and names the word to the
-- moderator, who may disagree with the list. It never removes, refuses, edits or scores anything.
-- Matching is on WHOLE words (\y…\y), case-insensitively, because substring matching is how
-- "Scunthorpe" and "assassin" get held and a filter that cries wolf is one nobody reads.
CREATE OR REPLACE FUNCTION "public"."comment_flagged_word"("p_body" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select w from (
    select btrim(jsonb_array_elements_text(
             case when jsonb_typeof(coalesce(s.value, '[]')::jsonb) = 'array'
                  then coalesce(s.value, '[]')::jsonb else '[]'::jsonb end)) as w
      from public.app_settings s where s.key = 'comment_flagged'
  ) words
   where w <> '' and p_body ~* ('\y' || regexp_replace(w, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g') || '\y')
   limit 1;
$$;

-- WHERE THE EMBED MAY BE DRAWN. Projected from the site's comment policy, and unlike the flagged
-- words this is NOT a secret: the embed itself reads it, from a page of ours inside somebody else's
-- frame, and there is nothing in a list of domains worth hiding. A site with none named has not
-- decided against anywhere, so the embed works anywhere — which is the right default for a thing
-- whose whole point is being pasted into a page.
--
-- It is not a fence either, and nothing here pretends otherwise: a determined person can always
-- comment by visiting the site. What it prevents is a site's comments appearing under pages it did
-- not agree to, and the real enforcement is the `frame-ancestors` header the host serves.
CREATE OR REPLACE FUNCTION "public"."comment_domains"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select case when jsonb_typeof(s.value::jsonb) = 'array' then s.value::jsonb else '[]'::jsonb end
      from public.app_settings s where s.key = 'comment_domains'), '[]'::jsonb);
$$;
GRANT EXECUTE ON FUNCTION "public"."comment_domains"() TO "authenticated", "anon", "service_role";

-- DOES THIS COMMENT WAIT? Two reasons, and neither of them decides anything: WHO wrote it, against
-- the surface's approval setting; and WHAT it says, against the list above — which holds a comment
-- whoever wrote it, including somebody otherwise trusted, since the list exists for the times trust
-- is misplaced. Returns the word that matched, an empty string for a hold on standing alone, or null
-- for a comment that goes straight up.
CREATE OR REPLACE FUNCTION "public"."comment_holds"("p_approval" "text", "p_body" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(public.comment_flagged_word(p_body),
    case when p_approval = 'all' then ''
         when p_approval = 'trusted' and not public.comment_trusted() then ''
         else null end);
$$;

-- A HELD COMMENT IS NOT A HIDDEN ONE — not from the person who wrote it. They see it, marked as
-- waiting, because a comment that vanishes on posting is how somebody decides the site is broken
-- and says the same thing twice.
DROP POLICY IF EXISTS "comments_select" ON "public"."comments";
CREATE POLICY "comments_select" ON "public"."comments" FOR SELECT TO "authenticated", "anon"
  USING ("public"."comment_may_read"("kind", "subject")
    AND ("state" = 'live'::"text"
      OR "author_id" = (SELECT "auth"."uid"())
      OR "public"."comment_may_moderate"("kind", "subject")));
DROP POLICY IF EXISTS "comments_insert" ON "public"."comments";
CREATE POLICY "comments_insert" ON "public"."comments" FOR INSERT TO "authenticated"
  WITH CHECK ("author_id" = (SELECT "auth"."uid"()) AND "public"."comment_may_write"("kind", "subject"));
DROP POLICY IF EXISTS "comments_update" ON "public"."comments";
CREATE POLICY "comments_update" ON "public"."comments" FOR UPDATE TO "authenticated"
  USING ("author_id" = (SELECT "auth"."uid"()) OR "public"."is_staff"());

GRANT SELECT, INSERT, UPDATE ON TABLE "public"."comments" TO "authenticated";
GRANT SELECT ON TABLE "public"."comments" TO "anon";
GRANT ALL ON TABLE "public"."comments" TO "service_role";

-- THE THREAD, as a page or an embed reads it: oldest first, replies carrying the id of what they
-- answer, a withdrawn one kept as a placeholder because a conversation with holes in it reads as a
-- conversation somebody has tampered with. The ORDER a reader asked for is not applied here — the
-- arithmetic for top, best and controversial is pure and lives in src/lib/comments/model.js, so it
-- is the same arithmetic in a test as on a page, and one read serves every order.
--
-- What comes back with each line: how many of each reaction, which of them are this reader's, the
-- two vote tallies and this reader's own vote. They are AGGREGATED — two grouped scans over the
-- ids in hand, not a subquery per line — because a thread of two hundred comments asking two
-- hundred times is the thing that makes a comment system feel slow, and it is invisible until it is.
--
-- Two places it may live, and the caller never knows which. A subject that names a forum CHANNEL
-- keeps its comments as a post in that channel — one thread, reachable from the book's page and
-- from the board — and this returns that post's replies in the same shape. A subject with no
-- channel keeps them in public.comments, which is what a site with no community wants. A room is
-- flat, so a reply there carries who it answers on the message's own meta rather than in a column
-- the room has no use for.
CREATE OR REPLACE FUNCTION "public"."comments_on"("p_kind" "text", "p_subject" "text", "p_limit" integer DEFAULT 200)
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with s as (select * from public.comment_subjects where kind = p_kind and subject = p_subject),
  may as (select public.comment_may_read(p_kind, p_subject) as read, public.comment_may_moderate(p_kind, p_subject) as moderate),
  lim as (select greatest(1, least(coalesce(p_limit, 200), 500)) as n),
  -- the lines themselves, from whichever of the two places this subject keeps them
  lines as (
    (select m.id, m.body, m.created_at, nullif(m.meta->>'parent', '')::uuid as parent, m.author_id,
           m.deleted_at, case when m.deleted_at is not null then 'removed' else 'live' end as state,
           null::text as flagged, m.seq::numeric as ord, 'message'::text as surface
      from public.space_messages m
     where (select read from may) and (select post_id from s) is not null
       and m.thread_root_id = (select post_id from s)
     order by m.seq limit (select n from lim))
    union all
    (select k.id, k.body, k.created_at, k.parent_id, k.author_id,
           k.deleted_at, case when k.deleted_at is not null then 'removed' else k.state end,
           k.flagged, extract(epoch from k.created_at)::numeric, 'comment'
      from public.comments k
     where (select read from may) and (select post_id from s) is null
       and k.kind = p_kind and k.subject = p_subject
       -- held is not hidden from its author, and never shown to anybody else
       and (k.state = 'live' or k.author_id = auth.uid() or (select moderate from may))
     order by k.created_at limit (select n from lim))),
  re as (
    select g.target_id, jsonb_object_agg(g.emoji, g.n) as tally,
           array_remove(array_agg(case when g.mine then g.emoji end), null) as mine
      from (select r.target_id, r.emoji, count(*) as n, bool_or(r.user_id = auth.uid()) as mine
              from public.reactions r join lines l on l.id = r.target_id and l.surface = r.surface
             group by r.target_id, r.emoji) g
     group by g.target_id),
  vt as (
    select v.target_id,
           count(*) filter (where v.vote = 1) as up,
           count(*) filter (where v.vote = -1) as down,
           max(v.vote) filter (where v.user_id = auth.uid()) as mine
      from public.votes v join lines l on l.id = v.target_id and l.surface = v.surface
     group by v.target_id)
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'body', case when l.deleted_at is null then l.body else null end,
             'created_at', l.created_at, 'parent', l.parent,
             'author_id', l.author_id, 'deleted_at', l.deleted_at,
             -- three words from two columns: whether a person has let it through, and whether it is
             -- withdrawn. The flagged word goes to whoever may moderate and to nobody else — least
             -- of all its author, since a list you can probe is a list you can walk around.
             'state', l.state,
             'flagged', case when (select moderate from may) then l.flagged else null end,
             'mine', l.author_id = auth.uid(),
             'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
             're', coalesce(re.tally, '{}'::jsonb), 'mine_re', coalesce(re.mine, '{}'::text[]),
             'up', coalesce(vt.up, 0), 'down', coalesce(vt.down, 0), 'my_vote', coalesce(vt.mine, 0))
           order by l.ord)
      from lines l
      left join public.profiles p on p.id = l.author_id
      left join re on re.target_id = l.id
      left join vt on vt.target_id = l.id), '[]'::jsonb);
$$;

-- HOW MANY, which is all a count badge on a listing needs and is cheap enough to ask for fifty
-- things at once. Disqus's comment-count script asks exactly this, and so does ours. What is waiting
-- for a person is not counted: a badge saying 4 under a page showing 3 is a badge nobody believes.
CREATE OR REPLACE FUNCTION "public"."comment_counts"("p_kind" "text", "p_subjects" text[])
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_object_agg(x.subject, x.n), '{}'::jsonb) from (
    select s.subject,
      case when s.post_id is not null
        then (select count(*) from public.space_messages m
               where m.thread_root_id = s.post_id and m.deleted_at is null)
        else (select count(*) from public.comments c
               where c.kind = s.kind and c.subject = s.subject
                 and c.deleted_at is null and c.state = 'live') end as n
      from public.comment_subjects s
     where s.kind = p_kind and s.subject = any(p_subjects)
       and public.comment_may_read(s.kind, s.subject)) x;
$$;

-- SAYING SOMETHING. Where the subject names a channel this writes a space message, opening the
-- post on the first comment — so the thread exists only once somebody has said something, and the
-- board is not full of empty posts for every book in the library.
--
-- WHAT AN EMBED DECLARES, and why it is three things rather than one. The SLUG is the subject: two
-- pages carrying the same slug are one conversation, and a page that changes its address keeps its
-- comments. The TITLE is what the conversation is called wherever it is read — in the board, in the
-- desk's queue — because a board listing /content/articles/listening-back is a board nobody scans.
-- The canonical URL is where the page actually is, shown in the space as a link back, so somebody
-- answering from the community can see what is being discussed. Until now the title was passed and
-- the url was not, and a thread started from an embed arrived with nothing to click.
CREATE OR REPLACE FUNCTION "public"."comment_say"("p_kind" "text", "p_subject" "text", "p_body" "text",
      "p_parent" "uuid" DEFAULT NULL, "p_title" "text" DEFAULT NULL, "p_href" "text" DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare k public.comments; s public.comment_subjects; root uuid; m public.space_messages;
        held text; parent uuid;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign-in'); end if;
  if not public.comment_may_write(p_kind, p_subject) then return jsonb_build_object('error', 'not-open'); end if;
  select * into s from public.comment_subjects where kind = p_kind and subject = p_subject;
  -- an open kind makes its subject the first time anybody says something under it, from the
  -- wildcard row: the same access, the same allow, the same settings, the same channel, and the
  -- title and address the embed passed. Those two are the only things the caller decides, and they
  -- are only ever the name of a thread and the page it is on.
  if not found then
    select * into s from public.comment_subjects where kind = p_kind and subject = '*';
    if not found then return jsonb_build_object('error', 'not-open'); end if;
    insert into public.comment_subjects (kind, subject, title, href, access, allow, channel_id,
                                         approval, depth, collapse, votes, reactions)
         values (p_kind, p_subject, nullif(btrim(coalesce(p_title, '')), ''),
                 coalesce(nullif(btrim(coalesce(p_href, '')), ''), s.href),
                 s.access, s.allow, s.channel_id,
                 s.approval, s.depth, s.collapse, s.votes, s.reactions)
      on conflict (kind, subject) do nothing;
    select * into s from public.comment_subjects where kind = p_kind and subject = p_subject;
  -- a page that has told us its name or moved house: the first of those facts wins, and a later
  -- one only fills what was missing. A caller may name a thread; it may not rename one.
  elsif coalesce(s.title, '') = '' or coalesce(s.href, '') = '' then
    update public.comment_subjects
       set title = coalesce(nullif(btrim(coalesce(title, '')), ''), nullif(btrim(coalesce(p_title, '')), '')),
           href  = coalesce(nullif(btrim(coalesce(href, '')), ''),  nullif(btrim(coalesce(p_href, '')), ''))
     where kind = p_kind and subject = p_subject
    returning * into s;
  end if;

  if s.channel_id is not null then
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
  end if;

  -- DOES IT WAIT? On who wrote it, against this surface's setting; and on the site's flagged words,
  -- which hold a comment whoever wrote it. Neither decides anything: a held comment is a click
  -- queued for a person, and the person decides.
  held := public.comment_holds(s.approval, p_body);
  -- a reply keeps the real depth it was written at. It was capped at one level here, which lost who
  -- somebody was answering; the cap now lives in the drawing, where the reason for it was always about.
  select c.id into parent from public.comments c
   where c.id = p_parent and c.kind = p_kind and c.subject = p_subject;
  insert into public.comments (kind, subject, author_id, body, parent_id, state, flagged)
       values (p_kind, p_subject, auth.uid(), left(btrim(p_body), 4000), parent,
               case when held is null then 'live' else 'waiting' end, nullif(held, ''))
    returning * into k;
  -- the author is told it is waiting, and never which word caught them
  return to_jsonb(k) - 'flagged';
end;
$$;

-- WITHDRAWING ONE, wherever it lives. A space message is withdrawn the way every space message is,
-- so the moderation the community already has applies to a comment without knowing it is one.
CREATE OR REPLACE FUNCTION "public"."comment_unsay"("p_comment" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.comments set deleted_at = now()
   where id = p_comment and deleted_at is null
     and (author_id = auth.uid() or public.is_staff());
  if found then return jsonb_build_object('ok', true); end if;
  update public.space_messages set deleted_at = now()
   where id = p_comment and deleted_at is null
     and (author_id = auth.uid() or public.is_staff());
  if found then return jsonb_build_object('ok', true); end if;
  return jsonb_build_object('error', 'not-yours');
end;
$$;

-- THE FIFTH ACT, both halves of it. Releasing a held comment and refusing one are moderation acts
-- like a removal: a person's name, a moment, a reason where one is given, and a row in the record
-- that nobody can edit afterwards. The release is also the whole of "an author the site trusts" —
-- there is no second copy of that fact anywhere to fall out of step with this one.
CREATE OR REPLACE FUNCTION "public"."comment_approve"("p_comment" "uuid", "p_reason" "text" DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare k public.comments; sp uuid;
begin
  select * into k from public.comments where id = p_comment;
  if not found then return jsonb_build_object('error', 'no-comment'); end if;
  if not public.comment_may_moderate(k.kind, k.subject) then return jsonb_build_object('error', 'not-yours'); end if;
  if k.state = 'live' and k.approved_at is not null then return jsonb_build_object('ok', true, 'state', 'live'); end if;
  update public.comments
     set state = 'live', approved_at = now(), approved_by = auth.uid()
   where id = p_comment returning * into k;
  select c.space_id into sp from public.comment_subjects s
    join public.channels c on c.id = s.channel_id
   where s.kind = k.kind and s.subject = k.subject;
  insert into public.space_moderation (space_id, comment_id, kind, actor_id, subject_id, reason)
       values (sp, k.id, 'approve', auth.uid(), k.author_id, p_reason);
  return jsonb_build_object('ok', true, 'state', 'live');
end;
$$;

-- REFUSING ONE. It is removed as any message is — the placeholder stays, the record is written, and
-- its author can see that it was refused rather than find it silently gone.
CREATE OR REPLACE FUNCTION "public"."comment_refuse"("p_comment" "uuid", "p_reason" "text" DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare k public.comments; sp uuid;
begin
  select * into k from public.comments where id = p_comment;
  if not found then return jsonb_build_object('error', 'no-comment'); end if;
  if not public.comment_may_moderate(k.kind, k.subject) then return jsonb_build_object('error', 'not-yours'); end if;
  update public.comments set deleted_at = coalesce(deleted_at, now())
   where id = p_comment returning * into k;
  select c.space_id into sp from public.comment_subjects s
    join public.channels c on c.id = s.channel_id
   where s.kind = k.kind and s.subject = k.subject;
  insert into public.space_moderation (space_id, comment_id, kind, actor_id, subject_id, reason)
       values (sp, k.id, 'refuse', auth.uid(), k.author_id, p_reason);
  return jsonb_build_object('ok', true, 'state', 'removed');
end;
$$;

-- EVERY COMMENT ON THE SITE, for the one page that is responsible for all of them and for the desk's
-- queue of the ones no room owns. Narrowed by state, by kind and by author, newest first, each with
-- what it is attached to — the title a person reads, never a slug, because a queue listing
-- /content/articles/listening-back is a queue nobody scans.
--
-- `p_attached` is how the desk asks its own question: false for the conversations that belong to no
-- room, which would otherwise be conversations nobody is responsible for.
CREATE OR REPLACE FUNCTION "public"."comment_queue"("p_state" "text" DEFAULT NULL, "p_kind" "text" DEFAULT NULL,
      "p_author" "uuid" DEFAULT NULL, "p_attached" boolean DEFAULT NULL, "p_limit" integer DEFAULT 100)
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', k.id, 'kind', k.kind, 'subject', k.subject,
             'title', coalesce(nullif(s.title, ''), k.subject), 'href', s.href,
             'attached', s.channel_id is not null,
             'body', case when k.deleted_at is null then k.body else null end,
             'state', case when k.deleted_at is not null then 'removed' else k.state end,
             'flagged', k.flagged, 'created_at', k.created_at,
             'author_id', k.author_id,
             'author', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
             'trusted', public.comment_trusted(k.author_id))
           order by k.created_at desc)
      from (select * from public.comments c
             where (p_state is null
                    or (p_state = 'removed' and c.deleted_at is not null)
                    or (p_state <> 'removed' and c.deleted_at is null and c.state = p_state))
               and (p_kind is null or c.kind = p_kind)
               and (p_author is null or c.author_id = p_author)
               and public.comment_may_moderate(c.kind, c.subject)
             order by c.created_at desc
             limit greatest(1, least(coalesce(p_limit, 100), 500))) k
      join public.comment_subjects s on s.kind = k.kind and s.subject = k.subject
      left join public.profiles p on p.id = k.author_id
     where p_attached is null or (s.channel_id is not null) = p_attached), '[]'::jsonb);
$$;

-- WHAT THIS CONVERSATION IS, before its lines: whether it exists at all, whether this reader may
-- join it, what it is shaped like — how far the indent goes, how long a run may get, whether it
-- takes votes and reactions — and, where it is also a post in the community, the address of that
-- post. One read, so a page asks once rather than six times, and so the component that draws a
-- thread needs to know nothing about kinds, channels or policies.
CREATE OR REPLACE FUNCTION "public"."comment_subject"("p_kind" "text", "p_subject" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.comment_may_read(p_kind, p_subject) then null else (
    select jsonb_build_object(
      'kind', s.kind, 'subject', s.subject, 'title', s.title, 'href', s.href, 'allow', s.allow,
      'may_write', public.comment_may_write(p_kind, p_subject),
      'may_moderate', public.comment_may_moderate(p_kind, p_subject),
      -- what the surface takes, and how it is drawn. The reader's ORDER is not here: it is theirs,
      -- it is remembered in their own browser, and it never changes what anybody else sees.
      'approval', s.approval, 'depth', s.depth, 'collapse', s.collapse,
      'votes', s.votes, 'reactions', s.reactions,
      -- the same conversation, read in the community. Null until somebody has said something,
      -- because a link to a thread that does not exist yet is a link to nothing.
      'thread', case when s.post_id is null then null else (
        select '/spaces/' || sp.slug || '/' || c.slug
          from public.channels c join public.spaces sp on sp.id = c.space_id
         where c.id = s.channel_id) end)
      from public.comment_subjects s
     where s.kind = p_kind and s.subject = p_subject) end;
$$;

-- the act's record points at the comment it was about; the comments table is declared here, so the
-- key is too rather than in the spaces file that declares the record
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_moderation"
    ADD CONSTRAINT "space_moderation_comment_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT EXECUTE ON FUNCTION "public"."comment_subject"("text", "text") TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."comment_open_kind"("text") TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."comment_may_read"("text", "text") TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."comment_may_write"("text", "text") TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."comment_may_moderate"("text", "text") TO "authenticated", "anon", "service_role";
REVOKE ALL ON FUNCTION "public"."comment_trusted"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."comment_trusted"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."comment_trusted"("uuid") TO "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."comments_on"("text", "text", integer) TO "authenticated", "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."comment_counts"("text", text[]) TO "authenticated", "anon", "service_role";
REVOKE ALL ON FUNCTION "public"."comment_say"("text", "text", "text", "uuid", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."comment_say"("text", "text", "text", "uuid", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."comment_say"("text", "text", "text", "uuid", "text", "text") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."comment_unsay"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."comment_unsay"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."comment_unsay"("uuid") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."comment_approve"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."comment_approve"("uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."comment_approve"("uuid", "text") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."comment_refuse"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."comment_refuse"("uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."comment_refuse"("uuid", "text") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."comment_queue"("text", "text", "uuid", boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."comment_queue"("text", "text", "uuid", boolean, integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."comment_queue"("text", "text", "uuid", boolean, integer) TO "authenticated", "service_role";
-- the flagged list and what it matched are the moderator's business, and are never granted to a
-- browser: an author who can read the list is an author who can walk around it
REVOKE ALL ON FUNCTION "public"."comment_flagged_word"("text") FROM PUBLIC, "authenticated", "anon";
REVOKE ALL ON FUNCTION "public"."comment_holds"("text", "text") FROM PUBLIC, "authenticated", "anon";
REVOKE ALL ON FUNCTION "public"."comment_flagged_word"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."comment_flagged_word"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."comment_flagged_word"("text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."comment_holds"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."comment_holds"("text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."comment_holds"("text", "text") TO "service_role";
