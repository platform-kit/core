--
-- THE SITE'S OWN SOCIAL NETWORK — a page per person, follows, a timeline, and posts each saying who
-- may read them. Served to the site's own pages from these tables, and to Bluesky's app and every
-- other atproto client by the `atproto` function over the same tables, as the person, under the
-- same guards (openspec: social-network, atproto-api).
--
-- WHO MAY READ IS DECIDED HERE AND NOWHERE ELSE. A post is `everyone` or `here` (the site's own
-- signed-in people). A post to a SPACE's members is not a row of this file at all: it is a message
-- in that space's feed channel (90-spaces), under the space's own guards, and the timeline merges
-- it in. So there is one gate per kind of thing, and the protocol surface adds no rule of its own:
-- every method that returns a record runs as the caller and meets these policies.
--
-- WHAT IS PUBLIC TO THE WIDER NETWORK is a projection of the `everyone` rows of a member who has
-- joined it (network_identities.joined_at), and nothing else. A `here` row never leaves the site,
-- because a signed repository is one tree that relays copy whole.
--
-- Everything here is STATE: what people posted, followed, liked and blocked are acts. Nothing is
-- projected from a file.
--
SET check_function_bodies = false;

-- ---------------------------------------------------------------------------------------------
-- the record key
-- ---------------------------------------------------------------------------------------------

-- A TID: atproto's record key, thirteen characters of base32-sortable time (microseconds since
-- the epoch, then ten bits of clock id). Made here so a post written from the site's own pages and
-- one written through the protocol are keyed the same way and sort the same way.
CREATE OR REPLACE FUNCTION "public"."network_tid"() RETURNS "text"
    LANGUAGE "plpgsql" VOLATILE
    SET "search_path" TO 'public'
    AS $$
declare
  alphabet constant text := '234567abcdefghijklmnopqrstuvwxyz';
  v bigint := ((extract(epoch from clock_timestamp()) * 1000000)::bigint << 10) | floor(random() * 1024)::bigint;
  s text := '';
begin
  for i in 1..13 loop
    s := substr(alphabet, (v & 31)::int + 1, 1) || s;
    v := v >> 5;
  end loop;
  return s;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- who somebody is on the wider network
-- ---------------------------------------------------------------------------------------------

-- A member with no row here is on the site's own network only: their identity is a did:web the
-- function derives from their username, and nothing about them is written anywhere outside. A row
-- is made when they JOIN the wider network — their own act — and holds the portable did:plc made
-- for them and where their signing key is kept. Leaving keeps the row (left_at), so joining again
-- is the same identity and not a stranger with their name.
CREATE TABLE IF NOT EXISTS "public"."network_identities" (
    "user_id" "uuid" NOT NULL,
    "did" "text" NOT NULL,
    -- the Vault secret holding the private signing key; never in a column a client can read
    "signing_key_id" "uuid",
    -- the public half, as a did:key multibase, which the DID document names
    "signing_key_public" "text",
    "joined_at" timestamp with time zone,
    "left_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_identities_did_check" CHECK ((("did" ~ '^did:plc:[a-z2-7]{24}') AND ("length"("did") = 32)))
);
ALTER TABLE ONLY "public"."network_identities" ADD CONSTRAINT "network_identities_pkey" PRIMARY KEY ("user_id");
ALTER TABLE ONLY "public"."network_identities" ADD CONSTRAINT "network_identities_did_key" UNIQUE ("did");
ALTER TABLE ONLY "public"."network_identities" ADD CONSTRAINT "network_identities_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."network_identities" ENABLE ROW LEVEL SECURITY;
-- a person sees their own; the function reads the rest as the service role to answer a DID
DROP POLICY IF EXISTS "network_identities_own" ON "public"."network_identities";
CREATE POLICY "network_identities_own" ON "public"."network_identities" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
GRANT SELECT ("user_id", "did", "joined_at", "left_at", "created_at") ON TABLE "public"."network_identities" TO "authenticated";
GRANT ALL ON TABLE "public"."network_identities" TO "service_role";

-- has this person joined the wider network, and not left it
CREATE OR REPLACE FUNCTION "public"."network_joined"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.network_identities i
                 where i.user_id = p_user and i.joined_at is not null and i.left_at is null);
$$;

-- ---------------------------------------------------------------------------------------------
-- the guards
-- ---------------------------------------------------------------------------------------------

-- A SUSPENSION is a moderator's act on the network (network_moderation below), live while no lift
-- points at it and its time has not run out. A suspended person cannot post, and nobody else reads
-- what they wrote.
CREATE OR REPLACE FUNCTION "public"."network_suspended"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.network_moderation m
    where m.kind = 'suspend' and m.subject_id = p_user
      and (m.until is null or m.until > now())
      and not exists (select 1 from public.network_moderation l where l.kind = 'lift' and l.lifts_id = m.id));
$$;

-- A BLOCK IS MUTUAL: either side having blocked the other hides each from each.
CREATE OR REPLACE FUNCTION "public"."network_blocked"("p_a" "uuid", "p_b" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.network_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a));
$$;

-- who moderates the network: an administrator. A space's moderators moderate their space; the
-- network belongs to no space, so it is the site's.
CREATE OR REPLACE FUNCTION "public"."network_moderator"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin();
$$;

-- MAY THE CALLER READ THIS POST. The one sentence, asked by every policy and every read:
--   the author always reads their own;
--   nobody else reads a removed post, a suspended author's post, or across a block;
--   `everyone` is read by any signed-in person, and by a guest only where the author's page is
--   open or they have joined the wider network (where it is public anyway);
--   `here` is read by any signed-in person and by no guest.
-- WHO TAKES PART, where the site sells it or limits it (network.access in the config, projected by the
-- data script into app_settings as 'network_access'): two grants, read and write, each the fill rules a
-- space is filled by (space_fill_matches). Whoever may write may read. With no grants, everyone signed
-- in takes part and a guest reads what is public, as before; the staff always take part.
CREATE OR REPLACE FUNCTION "public"."network_admitted"("p_user" "uuid", "p_grant" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with a as (select (select s.value::jsonb from public.app_settings s where s.key = 'network_access') as rules),
  holds as (
    select
      (select rules from a) as rules,
      (p_user is not null and (select rules from a) ? 'read' and public.space_fill_matches(p_user, (select rules from a) -> 'read')) as in_read,
      (p_user is not null and (select rules from a) ? 'write' and public.space_fill_matches(p_user, (select rules from a) -> 'write')) as in_write
  )
  select case
    when h.rules is null then true
    -- the staff always take part — anybody holding a role, as every other gated place of the community
    -- admits them (community_admitted): a coach who cannot read the feed of the community they coach in
    -- is a coach locked out of their own room
    when p_user is not null and exists (select 1 from public.profiles p where p.id = p_user and (p.role = 'admin' or cardinality(p.roles) > 0)) then true
    when p_grant = 'write' then
      case when h.rules ? 'write' then h.in_write when h.rules ? 'read' then h.in_read else true end
    else (not (h.rules ? 'read')) or h.in_read or h.in_write
  end
  from holds h;
$$;
REVOKE ALL ON FUNCTION "public"."network_admitted"("uuid", "text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."network_admitted"("uuid", "text") TO "authenticated", "anon", "service_role";

CREATE OR REPLACE FUNCTION "public"."network_can_read"("p_author" "uuid", "p_audience" "text", "p_removed" timestamp with time zone) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when auth.uid() is not null and p_author = auth.uid() then true
    when not public.network_admitted(auth.uid(), 'read') then false
    when p_removed is not null and not public.network_moderator() then false
    when public.network_suspended(p_author) and not public.network_moderator() then false
    when public.network_blocked(auth.uid(), p_author) then false
    when p_audience = 'everyone' then
      auth.uid() is not null
      or exists (select 1 from public.profiles p where p.id = p_author and p.public_profile)
      or public.network_joined(p_author)
    when p_audience = 'here' then auth.uid() is not null
    else false
  end;
$$;

-- ---------------------------------------------------------------------------------------------
-- what is posted
-- ---------------------------------------------------------------------------------------------

-- A POST is an app.bsky.feed.post record. The columns are the truth about what it ANSWERS (a reply,
-- a quote) and who may read it; `record` keeps everything else the author wrote in the record's
-- own shape — langs, facets, a link card — so a record written through the protocol comes back
-- byte-for-byte as it was given, and one written from the site's own pages is a record too.
-- The `at://` URI and the CID are never stored: both are computed from the author's identity as it
-- is now, so joining the wider network (which changes the DID) rewrites nothing.
CREATE TABLE IF NOT EXISTS "public"."network_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "rkey" "text" DEFAULT "public"."network_tid"() NOT NULL,
    "text" "text" DEFAULT ''::"text" NOT NULL,
    "audience" "text" DEFAULT 'here'::"text" NOT NULL,
    "record" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- what the post carries, up to ten pictures and videos, each { kind: image|video, path, alt,
    -- mime, size, width, height, duration?, poster? } in the network bucket under the author's own
    -- folder (a video's poster is its first frame, a JPEG beside it); the blob's CID is the
    -- function's to compute, once, from the bytes. An item with no kind is a picture.
    "media" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL, -- renamed from: images
    -- what it answers, on this site…
    "reply_root_id" "uuid",
    "reply_parent_id" "uuid",
    "quote_id" "uuid",
    -- …or elsewhere on the network (a joined member answering somebody on Bluesky)
    "reply_root_uri" "text",
    "reply_parent_uri" "text",
    "quote_uri" "text",
    -- read as counts, never as rows; kept by the triggers below
    "like_count" integer DEFAULT 0 NOT NULL,
    "repost_count" integer DEFAULT 0 NOT NULL,
    "reply_count" integer DEFAULT 0 NOT NULL,
    "quote_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- a moderator's removal; the row stays for the record, read by nobody but its author and the
    -- moderators, and it leaves the wider network at once
    "removed_at" timestamp with time zone,
    "removed_by" "uuid",
    CONSTRAINT "network_posts_audience_check" CHECK (("audience" = ANY (ARRAY['everyone'::"text", 'here'::"text"]))),
    CONSTRAINT "network_posts_text_len" CHECK (("length"("text") <= 3000)),
    CONSTRAINT "network_posts_rkey_check" CHECK ((("rkey" !~ '[^A-Za-z0-9._:~-]') AND ("length"("rkey") BETWEEN 1 AND 512))),
    CONSTRAINT "network_posts_media_len" CHECK (("jsonb_array_length"("media") <= 10)),
    CONSTRAINT "network_posts_says_something" CHECK ((("length"("btrim"("text")) > 0) OR ("jsonb_array_length"("media") > 0) OR ("quote_id" IS NOT NULL) OR ("quote_uri" IS NOT NULL)))
);
ALTER TABLE ONLY "public"."network_posts" ADD CONSTRAINT "network_posts_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."network_posts" ADD CONSTRAINT "network_posts_rkey_key" UNIQUE ("author_id", "rkey");
ALTER TABLE ONLY "public"."network_posts" ADD CONSTRAINT "network_posts_author_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
-- an answer outlives what it answered, as on every network: the thread says the post is gone
ALTER TABLE ONLY "public"."network_posts" ADD CONSTRAINT "network_posts_root_fkey" FOREIGN KEY ("reply_root_id") REFERENCES "public"."network_posts"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."network_posts" ADD CONSTRAINT "network_posts_parent_fkey" FOREIGN KEY ("reply_parent_id") REFERENCES "public"."network_posts"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."network_posts" ADD CONSTRAINT "network_posts_quote_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."network_posts"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "network_posts_author_idx" ON "public"."network_posts" USING "btree" ("author_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "network_posts_parent_idx" ON "public"."network_posts" USING "btree" ("reply_parent_id", "created_at");
CREATE INDEX IF NOT EXISTS "network_posts_root_idx" ON "public"."network_posts" USING "btree" ("reply_root_id", "created_at");
CREATE INDEX IF NOT EXISTS "network_posts_quote_idx" ON "public"."network_posts" USING "btree" ("quote_id");
CREATE INDEX IF NOT EXISTS "network_posts_recent_idx" ON "public"."network_posts" USING "btree" ("created_at" DESC);

ALTER TABLE "public"."network_posts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "network_posts_read" ON "public"."network_posts";
CREATE POLICY "network_posts_read" ON "public"."network_posts" FOR SELECT TO "authenticated", "anon"
  USING ("public"."network_can_read"("author_id", "audience", "removed_at"));
DROP POLICY IF EXISTS "network_posts_write" ON "public"."network_posts";
CREATE POLICY "network_posts_write" ON "public"."network_posts" FOR INSERT TO "authenticated"
  WITH CHECK ((("author_id" = "auth"."uid"()) AND (NOT "public"."network_suspended"("auth"."uid"())) AND "public"."network_admitted"("auth"."uid"(), 'write')));
DROP POLICY IF EXISTS "network_posts_delete" ON "public"."network_posts";
CREATE POLICY "network_posts_delete" ON "public"."network_posts" FOR DELETE TO "authenticated"
  USING (("author_id" = "auth"."uid"()));
-- a post is never edited: what somebody replied to is what was said. Removal is the moderators',
-- through network_remove_post, and the counts are the triggers'.
GRANT SELECT ON TABLE "public"."network_posts" TO "authenticated", "anon";
GRANT INSERT ("author_id", "rkey", "text", "audience", "record", "media", "reply_root_id", "reply_parent_id", "quote_id", "reply_root_uri", "reply_parent_uri", "quote_uri", "created_at") ON TABLE "public"."network_posts" TO "authenticated";
GRANT DELETE ON TABLE "public"."network_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."network_posts" TO "service_role";

-- THE AUDIENCE NEVER WIDENS DOWN A THREAD. A reply or a quote may not be read by more people than
-- the post it answers: rank everyone 2, here 1, and the answer's rank may not exceed the answered's.
-- And what it answers must be something its author can read — answering a post you cannot see is
-- answering a post that, for you, does not exist.
CREATE OR REPLACE FUNCTION "public"."network_posts_before"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rank_new int := case new.audience when 'everyone' then 2 else 1 end;
  other record;
begin
  -- the root is the parent's root, whatever the client said: one rule for every door
  if new.reply_parent_id is not null then
    select id, author_id, audience, removed_at, reply_root_id into other from public.network_posts where id = new.reply_parent_id;
    if not found then raise exception 'network: the post being answered does not exist' using errcode = '23503'; end if;
    if not public.network_can_read(other.author_id, other.audience, other.removed_at) then
      raise exception 'network: the post being answered cannot be read' using errcode = '42501';
    end if;
    if public.network_blocked(new.author_id, other.author_id) then
      raise exception 'network: a block stands between you and this post' using errcode = '42501';
    end if;
    if rank_new > (case other.audience when 'everyone' then 2 else 1 end) then
      raise exception 'network: a reply may not be read by more people than the post it answers' using errcode = '23514';
    end if;
    new.reply_root_id := coalesce(other.reply_root_id, other.id);
  elsif new.reply_root_id is not null then
    raise exception 'network: a reply names the post it answers' using errcode = '23514';
  end if;
  if new.quote_id is not null then
    select id, author_id, audience, removed_at into other from public.network_posts where id = new.quote_id;
    if not found then raise exception 'network: the post being quoted does not exist' using errcode = '23503'; end if;
    if not public.network_can_read(other.author_id, other.audience, other.removed_at) then
      raise exception 'network: the post being quoted cannot be read' using errcode = '42501';
    end if;
    if public.network_blocked(new.author_id, other.author_id) then
      raise exception 'network: a block stands between you and this post' using errcode = '42501';
    end if;
    if rank_new > (case other.audience when 'everyone' then 2 else 1 end) then
      raise exception 'network: a quote may not be read by more people than the post it quotes' using errcode = '23514';
    end if;
  end if;
  -- what is answered elsewhere on the network is public there, so only a joined member answers it,
  -- and only in public
  if (new.reply_parent_uri is not null or new.quote_uri is not null) then
    if not public.network_joined(new.author_id) then
      raise exception 'network: answering somebody elsewhere needs the wider network' using errcode = '42501';
    end if;
  end if;
  new.text := coalesce(new.text, '');
  return new;
end;
$$;
DROP TRIGGER IF EXISTS "network_posts_before" ON "public"."network_posts";
CREATE TRIGGER "network_posts_before" BEFORE INSERT ON "public"."network_posts" FOR EACH ROW EXECUTE FUNCTION "public"."network_posts_before"();

-- the counts a reply and a quote move on what they answer
CREATE OR REPLACE FUNCTION "public"."network_posts_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    if new.reply_parent_id is not null then update public.network_posts set reply_count = reply_count + 1 where id = new.reply_parent_id; end if;
    if new.quote_id is not null then update public.network_posts set quote_count = quote_count + 1 where id = new.quote_id; end if;
    return new;
  end if;
  if old.reply_parent_id is not null then update public.network_posts set reply_count = greatest(reply_count - 1, 0) where id = old.reply_parent_id; end if;
  if old.quote_id is not null then update public.network_posts set quote_count = greatest(quote_count - 1, 0) where id = old.quote_id; end if;
  return old;
end;
$$;
DROP TRIGGER IF EXISTS "network_posts_count" ON "public"."network_posts";
CREATE TRIGGER "network_posts_count" AFTER INSERT OR DELETE ON "public"."network_posts" FOR EACH ROW EXECUTE FUNCTION "public"."network_posts_count"();

-- ---------------------------------------------------------------------------------------------
-- what can be done to a post without writing one
-- ---------------------------------------------------------------------------------------------

-- A LIKE and a REPOST are records of the person who made them (app.bsky.feed.like / .repost), so
-- each has its record key. Either names a post on this site or, for a joined member, one elsewhere.
CREATE TABLE IF NOT EXISTS "public"."network_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "post_id" "uuid",
    "subject_uri" "text",
    "subject_cid" "text",
    "rkey" "text" DEFAULT "public"."network_tid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_likes_subject_check" CHECK ((("post_id" IS NULL) <> ("subject_uri" IS NULL)))
);
CREATE TABLE IF NOT EXISTS "public"."network_reposts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "post_id" "uuid",
    "subject_uri" "text",
    "subject_cid" "text",
    "rkey" "text" DEFAULT "public"."network_tid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_reposts_subject_check" CHECK ((("post_id" IS NULL) <> ("subject_uri" IS NULL)))
);
ALTER TABLE ONLY "public"."network_likes" ADD CONSTRAINT "network_likes_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."network_likes" ADD CONSTRAINT "network_likes_rkey_key" UNIQUE ("author_id", "rkey");
ALTER TABLE ONLY "public"."network_likes" ADD CONSTRAINT "network_likes_author_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."network_likes" ADD CONSTRAINT "network_likes_post_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."network_posts"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "network_likes_once_idx" ON "public"."network_likes" USING "btree" ("author_id", "post_id") WHERE ("post_id" IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "network_likes_once_uri_idx" ON "public"."network_likes" USING "btree" ("author_id", "subject_uri") WHERE ("subject_uri" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "network_likes_post_idx" ON "public"."network_likes" USING "btree" ("post_id", "created_at" DESC);
ALTER TABLE ONLY "public"."network_reposts" ADD CONSTRAINT "network_reposts_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."network_reposts" ADD CONSTRAINT "network_reposts_rkey_key" UNIQUE ("author_id", "rkey");
ALTER TABLE ONLY "public"."network_reposts" ADD CONSTRAINT "network_reposts_author_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."network_reposts" ADD CONSTRAINT "network_reposts_post_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."network_posts"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "network_reposts_once_idx" ON "public"."network_reposts" USING "btree" ("author_id", "post_id") WHERE ("post_id" IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "network_reposts_once_uri_idx" ON "public"."network_reposts" USING "btree" ("author_id", "subject_uri") WHERE ("subject_uri" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "network_reposts_post_idx" ON "public"."network_reposts" USING "btree" ("post_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "network_reposts_author_idx" ON "public"."network_reposts" USING "btree" ("author_id", "created_at" DESC);

-- may the caller act on this post (like it, repost it): they can read it and no block stands. A
-- REPOST also may not widen it — reposting a `here` post is fine, since the repost is read by the
-- same people the post is; a post elsewhere needs the wider network.
CREATE OR REPLACE FUNCTION "public"."network_can_act"("p_post" "uuid", "p_uri" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_post is not null then exists (
      select 1 from public.network_posts p
      where p.id = p_post and public.network_can_read(p.author_id, p.audience, p.removed_at)
        and not public.network_blocked(auth.uid(), p.author_id))
    else public.network_joined(auth.uid())
  end;
$$;

ALTER TABLE "public"."network_likes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."network_reposts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "network_likes_read" ON "public"."network_likes";
CREATE POLICY "network_likes_read" ON "public"."network_likes" FOR SELECT TO "authenticated", "anon"
  USING ((("author_id" = "auth"."uid"()) OR ((NOT "public"."network_blocked"("auth"."uid"(), "author_id")) AND (("post_id" IS NULL) OR EXISTS (SELECT 1 FROM "public"."network_posts" "p" WHERE "p"."id" = "network_likes"."post_id")))));
DROP POLICY IF EXISTS "network_likes_write" ON "public"."network_likes";
CREATE POLICY "network_likes_write" ON "public"."network_likes" FOR INSERT TO "authenticated"
  WITH CHECK ((("author_id" = "auth"."uid"()) AND (NOT "public"."network_suspended"("auth"."uid"())) AND "public"."network_admitted"("auth"."uid"(), 'write') AND "public"."network_can_act"("post_id", "subject_uri")));
DROP POLICY IF EXISTS "network_likes_delete" ON "public"."network_likes";
CREATE POLICY "network_likes_delete" ON "public"."network_likes" FOR DELETE TO "authenticated" USING (("author_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "network_reposts_read" ON "public"."network_reposts";
CREATE POLICY "network_reposts_read" ON "public"."network_reposts" FOR SELECT TO "authenticated", "anon"
  USING ((("author_id" = "auth"."uid"()) OR ((NOT "public"."network_blocked"("auth"."uid"(), "author_id")) AND (("post_id" IS NULL) OR EXISTS (SELECT 1 FROM "public"."network_posts" "p" WHERE "p"."id" = "network_reposts"."post_id")))));
DROP POLICY IF EXISTS "network_reposts_write" ON "public"."network_reposts";
CREATE POLICY "network_reposts_write" ON "public"."network_reposts" FOR INSERT TO "authenticated"
  WITH CHECK ((("author_id" = "auth"."uid"()) AND (NOT "public"."network_suspended"("auth"."uid"())) AND "public"."network_admitted"("auth"."uid"(), 'write') AND "public"."network_can_act"("post_id", "subject_uri")));
DROP POLICY IF EXISTS "network_reposts_delete" ON "public"."network_reposts";
CREATE POLICY "network_reposts_delete" ON "public"."network_reposts" FOR DELETE TO "authenticated" USING (("author_id" = "auth"."uid"()));
GRANT SELECT ON TABLE "public"."network_likes", "public"."network_reposts" TO "authenticated", "anon";
GRANT INSERT ("author_id", "post_id", "subject_uri", "subject_cid", "rkey", "created_at") ON TABLE "public"."network_likes" TO "authenticated";
GRANT INSERT ("author_id", "post_id", "subject_uri", "subject_cid", "rkey", "created_at") ON TABLE "public"."network_reposts" TO "authenticated";
GRANT DELETE ON TABLE "public"."network_likes", "public"."network_reposts" TO "authenticated";
GRANT ALL ON TABLE "public"."network_likes", "public"."network_reposts" TO "service_role";

CREATE OR REPLACE FUNCTION "public"."network_acts_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  col text := case tg_table_name when 'network_likes' then 'like_count' else 'repost_count' end;
  post uuid := case tg_op when 'INSERT' then new.post_id else old.post_id end;
  delta int := case tg_op when 'INSERT' then 1 else -1 end;
begin
  if post is not null then
    execute format('update public.network_posts set %I = greatest(%I + $1, 0) where id = $2', col, col) using delta, post;
  end if;
  return case tg_op when 'INSERT' then new else old end;
end;
$$;
DROP TRIGGER IF EXISTS "network_likes_count" ON "public"."network_likes";
CREATE TRIGGER "network_likes_count" AFTER INSERT OR DELETE ON "public"."network_likes" FOR EACH ROW EXECUTE FUNCTION "public"."network_acts_count"();
DROP TRIGGER IF EXISTS "network_reposts_count" ON "public"."network_reposts";
CREATE TRIGGER "network_reposts_count" AFTER INSERT OR DELETE ON "public"."network_reposts" FOR EACH ROW EXECUTE FUNCTION "public"."network_acts_count"();

-- ---------------------------------------------------------------------------------------------
-- who follows whom, and who has shut whom out
-- ---------------------------------------------------------------------------------------------

-- A FOLLOW is the follower's record (app.bsky.graph.follow). It names somebody on this site, or —
-- for a joined member — somebody elsewhere by their DID.
CREATE TABLE IF NOT EXISTS "public"."network_follows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "follower_id" "uuid" NOT NULL,
    "subject_id" "uuid",
    "subject_did" "text",
    "rkey" "text" DEFAULT "public"."network_tid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_follows_subject_check" CHECK ((("subject_id" IS NULL) <> ("subject_did" IS NULL))),
    CONSTRAINT "network_follows_not_self" CHECK ((("subject_id" IS NULL) OR ("subject_id" <> "follower_id")))
);
ALTER TABLE ONLY "public"."network_follows" ADD CONSTRAINT "network_follows_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."network_follows" ADD CONSTRAINT "network_follows_rkey_key" UNIQUE ("follower_id", "rkey");
ALTER TABLE ONLY "public"."network_follows" ADD CONSTRAINT "network_follows_follower_fkey" FOREIGN KEY ("follower_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."network_follows" ADD CONSTRAINT "network_follows_subject_fkey" FOREIGN KEY ("subject_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "network_follows_once_idx" ON "public"."network_follows" USING "btree" ("follower_id", "subject_id") WHERE ("subject_id" IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "network_follows_once_did_idx" ON "public"."network_follows" USING "btree" ("follower_id", "subject_did") WHERE ("subject_did" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "network_follows_subject_idx" ON "public"."network_follows" USING "btree" ("subject_id", "created_at" DESC);

-- A BLOCK is the blocker's record (app.bsky.graph.block), and public on the wider network as it is
-- on Bluesky; here it is read by the blocker alone. A MUTE is no record at all — it is a private
-- preference, and the muted person is never told.
CREATE TABLE IF NOT EXISTS "public"."network_blocks" (
    "blocker_id" "uuid" NOT NULL,
    "blocked_id" "uuid" NOT NULL,
    "rkey" "text" DEFAULT "public"."network_tid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_blocks_not_self" CHECK (("blocker_id" <> "blocked_id"))
);
ALTER TABLE ONLY "public"."network_blocks" ADD CONSTRAINT "network_blocks_pkey" PRIMARY KEY ("blocker_id", "blocked_id");
ALTER TABLE ONLY "public"."network_blocks" ADD CONSTRAINT "network_blocks_rkey_key" UNIQUE ("blocker_id", "rkey");
ALTER TABLE ONLY "public"."network_blocks" ADD CONSTRAINT "network_blocks_blocker_fkey" FOREIGN KEY ("blocker_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."network_blocks" ADD CONSTRAINT "network_blocks_blocked_fkey" FOREIGN KEY ("blocked_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "network_blocks_blocked_idx" ON "public"."network_blocks" USING "btree" ("blocked_id");

CREATE TABLE IF NOT EXISTS "public"."network_mutes" (
    "muter_id" "uuid" NOT NULL,
    "muted_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_mutes_not_self" CHECK (("muter_id" <> "muted_id"))
);
ALTER TABLE ONLY "public"."network_mutes" ADD CONSTRAINT "network_mutes_pkey" PRIMARY KEY ("muter_id", "muted_id");
ALTER TABLE ONLY "public"."network_mutes" ADD CONSTRAINT "network_mutes_muter_fkey" FOREIGN KEY ("muter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."network_mutes" ADD CONSTRAINT "network_mutes_muted_fkey" FOREIGN KEY ("muted_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."network_follows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."network_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."network_mutes" ENABLE ROW LEVEL SECURITY;
-- A FOLLOW IS SEEN by anybody signed in, unless either end has a block with the reader; by a guest
-- only between two people whose pages are open, since a guest sees no closed page at all.
DROP POLICY IF EXISTS "network_follows_read" ON "public"."network_follows";
CREATE POLICY "network_follows_read" ON "public"."network_follows" FOR SELECT TO "authenticated", "anon"
  USING ((("follower_id" = "auth"."uid"()) OR ("subject_id" = "auth"."uid"()) OR (
    ("auth"."uid"() IS NOT NULL) AND (NOT "public"."network_blocked"("auth"."uid"(), "follower_id")) AND (NOT "public"."network_blocked"("auth"."uid"(), "subject_id"))
  ) OR (
    ("auth"."uid"() IS NULL)
    AND EXISTS (SELECT 1 FROM "public"."profiles" "f" WHERE "f"."id" = "network_follows"."follower_id" AND "f"."public_profile")
    AND (("subject_id" IS NULL) OR EXISTS (SELECT 1 FROM "public"."profiles" "s" WHERE "s"."id" = "network_follows"."subject_id" AND "s"."public_profile"))
  )));
DROP POLICY IF EXISTS "network_follows_write" ON "public"."network_follows";
CREATE POLICY "network_follows_write" ON "public"."network_follows" FOR INSERT TO "authenticated"
  WITH CHECK ((("follower_id" = "auth"."uid"()) AND (NOT "public"."network_suspended"("auth"."uid"())) AND "public"."network_admitted"("auth"."uid"(), 'write')
    AND (("subject_id" IS NULL AND "public"."network_joined"("auth"."uid"())) OR ("subject_id" IS NOT NULL AND NOT "public"."network_blocked"("auth"."uid"(), "subject_id")))));
DROP POLICY IF EXISTS "network_follows_delete" ON "public"."network_follows";
CREATE POLICY "network_follows_delete" ON "public"."network_follows" FOR DELETE TO "authenticated" USING (("follower_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "network_blocks_own" ON "public"."network_blocks";
CREATE POLICY "network_blocks_own" ON "public"."network_blocks" FOR SELECT TO "authenticated" USING (("blocker_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "network_blocks_write" ON "public"."network_blocks";
CREATE POLICY "network_blocks_write" ON "public"."network_blocks" FOR INSERT TO "authenticated" WITH CHECK (("blocker_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "network_blocks_delete" ON "public"."network_blocks";
CREATE POLICY "network_blocks_delete" ON "public"."network_blocks" FOR DELETE TO "authenticated" USING (("blocker_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "network_mutes_own" ON "public"."network_mutes";
CREATE POLICY "network_mutes_own" ON "public"."network_mutes" FOR ALL TO "authenticated" USING (("muter_id" = "auth"."uid"())) WITH CHECK (("muter_id" = "auth"."uid"()));
GRANT SELECT ON TABLE "public"."network_follows" TO "authenticated", "anon";
GRANT INSERT ("follower_id", "subject_id", "subject_did", "rkey", "created_at") ON TABLE "public"."network_follows" TO "authenticated";
GRANT DELETE ON TABLE "public"."network_follows" TO "authenticated";
GRANT SELECT, DELETE ON TABLE "public"."network_blocks" TO "authenticated";
GRANT INSERT ("blocker_id", "blocked_id", "rkey", "created_at") ON TABLE "public"."network_blocks" TO "authenticated";
GRANT SELECT, INSERT, DELETE ON TABLE "public"."network_mutes" TO "authenticated";
GRANT ALL ON TABLE "public"."network_follows", "public"."network_blocks", "public"."network_mutes" TO "service_role";

-- A BLOCK ENDS EVERY FOLLOW BETWEEN THE TWO, both ways, at the moment it is made. It is not undone
-- by lifting the block: following again is a choice each of them makes afresh.
CREATE OR REPLACE FUNCTION "public"."network_blocks_after"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.network_follows
  where (follower_id = new.blocker_id and subject_id = new.blocked_id)
     or (follower_id = new.blocked_id and subject_id = new.blocker_id);
  return new;
end;
$$;
DROP TRIGGER IF EXISTS "network_blocks_after" ON "public"."network_blocks";
CREATE TRIGGER "network_blocks_after" AFTER INSERT ON "public"."network_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."network_blocks_after"();

-- ---------------------------------------------------------------------------------------------
-- a space's feed, pinned to somebody's timeline
-- ---------------------------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------------------------
-- the reads
-- ---------------------------------------------------------------------------------------------

-- THE TIMELINE: one's own posts; the posts of the people one follows, and what they reposted; and
-- the top-level posts of the feed channels of every space one is in (or, where the site has turned
-- pinning on, p_all_spaces false, only the spaces one has pinned) — newest first, each
-- filtered by its own guard (SECURITY INVOKER: the policies above and the space's own do the
-- filtering, so this adds no rule of its own). A reply shows only where the person it answers is
-- also followed, or is the reader — a stranger's half of a conversation is noise. Muted people are
-- left out. `p_before` pages backwards.
CREATE OR REPLACE FUNCTION "public"."network_timeline"("p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 30, "p_all_spaces" boolean DEFAULT true)
    RETURNS TABLE("kind" "text", "post_id" "uuid", "message_id" "uuid", "reposted_by" "uuid", "at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as id),
  followed as (
    select f.subject_id as id from public.network_follows f, me where f.follower_id = me.id and f.subject_id is not null
    union select me.id from me
  ),
  muted as (select m.muted_id as id from public.network_mutes m, me where m.muter_id = me.id),
  posts as (
    select 'post'::text as kind, p.id as post_id, null::uuid as message_id, null::uuid as reposted_by, p.created_at as at
    from public.network_posts p
    where p.author_id in (select id from followed)
      and p.author_id not in (select id from muted)
      and (p.reply_parent_id is null or exists (
        select 1 from public.network_posts parent
        where parent.id = p.reply_parent_id and parent.author_id in (select id from followed)))
      and (p_before is null or p.created_at < p_before)
    order by p.created_at desc limit p_limit
  ),
  reposts as (
    select 'repost'::text, r.post_id, null::uuid, r.author_id, r.created_at
    from public.network_reposts r
    join public.network_posts p on p.id = r.post_id
    where r.author_id in (select id from followed) and r.author_id <> (select id from me)
      and r.author_id not in (select id from muted) and p.author_id not in (select id from muted)
      and (p_before is null or r.created_at < p_before)
    order by r.created_at desc limit p_limit
  ),
  spaced as (
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
  )
  select * from (select * from posts union all select * from reposts union all select * from spaced) t
  order by t.at desc limit p_limit;
$$;
GRANT ALL ON FUNCTION "public"."network_timeline"(timestamp with time zone, integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."network_timeline"(timestamp with time zone, integer, boolean) TO "service_role";

-- WHAT HAS HAPPENED TO ME: a like or repost of my post, a follow of me, a reply to or quote of my
-- post — from people I can see, and not from anybody I have muted. Read as the person, so the
-- guards above decide what is in it.
CREATE OR REPLACE FUNCTION "public"."network_notifications"("p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 50)
    RETURNS TABLE("reason" "text", "actor_id" "uuid", "post_id" "uuid", "subject_post_id" "uuid", "at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as id),
  muted as (select m.muted_id as id from public.network_mutes m, me where m.muter_id = me.id),
  t as (
    select 'like'::text as reason, l.author_id as actor_id, null::uuid as post_id, l.post_id as subject_post_id, l.created_at as at
      from public.network_likes l join public.network_posts p on p.id = l.post_id, me where p.author_id = me.id and l.author_id <> me.id
    union all
    select 'repost', r.author_id, null, r.post_id, r.created_at
      from public.network_reposts r join public.network_posts p on p.id = r.post_id, me where p.author_id = me.id and r.author_id <> me.id
    union all
    select 'follow', f.follower_id, null, null, f.created_at
      from public.network_follows f, me where f.subject_id = me.id
    union all
    select 'reply', p.author_id, p.id, p.reply_parent_id, p.created_at
      from public.network_posts p join public.network_posts parent on parent.id = p.reply_parent_id, me
      where parent.author_id = me.id and p.author_id <> me.id
    union all
    select 'quote', p.author_id, p.id, p.quote_id, p.created_at
      from public.network_posts p join public.network_posts q on q.id = p.quote_id, me
      where q.author_id = me.id and p.author_id <> me.id
  )
  select * from t
  where public.network_admitted(auth.uid(), 'read')
    and public.community_admitted('notifications')
    and t.actor_id not in (select id from muted)
    and not public.network_blocked(auth.uid(), t.actor_id)
    and (p_before is null or t.at < p_before)
  order by t.at desc limit p_limit;
$$;
GRANT ALL ON FUNCTION "public"."network_notifications"(timestamp with time zone, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."network_notifications"(timestamp with time zone, integer) TO "service_role";

-- when somebody last looked at what happened to them, so the unread count is a comparison
CREATE TABLE IF NOT EXISTS "public"."network_seen" (
    "user_id" "uuid" NOT NULL,
    "seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."network_seen" ADD CONSTRAINT "network_seen_pkey" PRIMARY KEY ("user_id");
ALTER TABLE ONLY "public"."network_seen" ADD CONSTRAINT "network_seen_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."network_seen" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "network_seen_own" ON "public"."network_seen";
CREATE POLICY "network_seen_own" ON "public"."network_seen" FOR ALL TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."network_seen" TO "authenticated";
GRANT ALL ON TABLE "public"."network_seen" TO "service_role";

CREATE OR REPLACE FUNCTION "public"."network_unread"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  select count(*)::int from public.network_notifications(null, 500) n
  where n.at > coalesce((select s.seen_at from public.network_seen s where s.user_id = auth.uid()), '-infinity'::timestamptz);
$$;
GRANT ALL ON FUNCTION "public"."network_unread"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."network_unread"() TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- moderation: the same acts as a space's, on the network, and every one of them written down
-- ---------------------------------------------------------------------------------------------

-- report · remove-post · suspend · lift. A record is never edited and never deleted; a lift is a
-- row pointing at what it undoes. Nothing here is decided by a machine.
CREATE TABLE IF NOT EXISTS "public"."network_moderation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "actor_id" "uuid",
    "subject_id" "uuid",
    "post_id" "uuid",
    "reason" "text",
    "note" "text",
    "until" timestamp with time zone,
    "lifts_id" "uuid",
    "answered_at" timestamp with time zone,
    "answered_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_moderation_kind_check" CHECK (("kind" = ANY (ARRAY['report'::"text", 'remove-post'::"text", 'suspend'::"text", 'lift'::"text"]))),
    CONSTRAINT "network_moderation_note_len" CHECK ((("note" IS NULL) OR ("length"("note") <= 1000)))
);
ALTER TABLE ONLY "public"."network_moderation" ADD CONSTRAINT "network_moderation_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."network_moderation" ADD CONSTRAINT "network_moderation_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."network_moderation" ADD CONSTRAINT "network_moderation_subject_fkey" FOREIGN KEY ("subject_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."network_moderation" ADD CONSTRAINT "network_moderation_post_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."network_posts"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."network_moderation" ADD CONSTRAINT "network_moderation_lifts_fkey" FOREIGN KEY ("lifts_id") REFERENCES "public"."network_moderation"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "network_moderation_report_once_idx" ON "public"."network_moderation" USING "btree" ("post_id", "actor_id") WHERE ("kind" = 'report'::"text" AND "post_id" IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "network_moderation_report_person_once_idx" ON "public"."network_moderation" USING "btree" ("subject_id", "actor_id") WHERE ("kind" = 'report'::"text" AND "post_id" IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "network_moderation_lift_once_idx" ON "public"."network_moderation" USING "btree" ("lifts_id") WHERE ("kind" = 'lift'::"text");
CREATE INDEX IF NOT EXISTS "network_moderation_queue_idx" ON "public"."network_moderation" USING "btree" ("kind", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "network_moderation_suspend_idx" ON "public"."network_moderation" USING "btree" ("subject_id", "until") WHERE ("kind" = 'suspend'::"text");
ALTER TABLE "public"."network_moderation" ENABLE ROW LEVEL SECURITY;
-- a reporter sees their own reports; a moderator sees the record whole. Nothing is written here
-- except through the functions below.
DROP POLICY IF EXISTS "network_moderation_read" ON "public"."network_moderation";
CREATE POLICY "network_moderation_read" ON "public"."network_moderation" FOR SELECT TO "authenticated"
  USING ((("actor_id" = "auth"."uid"()) AND ("kind" = 'report'::"text")) OR "public"."network_moderator"());
GRANT SELECT ON TABLE "public"."network_moderation" TO "authenticated";
GRANT ALL ON TABLE "public"."network_moderation" TO "service_role";

-- report a post or a person the caller can see; once each
CREATE OR REPLACE FUNCTION "public"."network_report"("p_post" "uuid", "p_person" "uuid", "p_reason" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  author uuid;
  out_id uuid;
begin
  if auth.uid() is null then raise exception 'network: sign in to report' using errcode = '42501'; end if;
  if p_post is not null then
    select p.author_id into author from public.network_posts p
    where p.id = p_post and public.network_can_read(p.author_id, p.audience, p.removed_at);
    if author is null then raise exception 'network: no such post' using errcode = '42501'; end if;
  else
    author := p_person;
    if author is null then raise exception 'network: a report names a post or a person' using errcode = '23514'; end if;
  end if;
  insert into public.network_moderation (kind, actor_id, subject_id, post_id, reason, note)
  values ('report', auth.uid(), author, p_post, nullif(btrim(p_reason), ''), nullif(btrim(p_note), ''))
  on conflict do nothing
  returning id into out_id;
  if out_id is null then
    select id into out_id from public.network_moderation
    where kind = 'report' and actor_id = auth.uid()
      and ((p_post is not null and post_id = p_post) or (p_post is null and post_id is null and subject_id = author));
  end if;
  return out_id;
end;
$$;

-- remove a post: it reads as removed to everybody but its author and the moderators, and leaves the
-- wider network. Answers the reports on it.
CREATE OR REPLACE FUNCTION "public"."network_remove_post"("p_post" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  author uuid;
  out_id uuid;
begin
  if not public.network_moderator() then raise exception 'network: only a moderator removes a post' using errcode = '42501'; end if;
  update public.network_posts set removed_at = coalesce(removed_at, now()), removed_by = coalesce(removed_by, auth.uid())
  where id = p_post returning author_id into author;
  if author is null then raise exception 'network: no such post' using errcode = '23503'; end if;
  insert into public.network_moderation (kind, actor_id, subject_id, post_id, reason)
  values ('remove-post', auth.uid(), author, p_post, nullif(btrim(p_reason), '')) returning id into out_id;
  update public.network_moderation set answered_at = now(), answered_by = auth.uid()
  where kind = 'report' and post_id = p_post and answered_at is null;
  return out_id;
end;
$$;

-- suspend a person from the network, for good or until a time
CREATE OR REPLACE FUNCTION "public"."network_suspend"("p_person" "uuid", "p_until" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_reason" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  out_id uuid;
begin
  if not public.network_moderator() then raise exception 'network: only a moderator suspends' using errcode = '42501'; end if;
  insert into public.network_moderation (kind, actor_id, subject_id, reason, until)
  values ('suspend', auth.uid(), p_person, nullif(btrim(p_reason), ''), p_until) returning id into out_id;
  update public.network_moderation set answered_at = now(), answered_by = auth.uid()
  where kind = 'report' and subject_id = p_person and answered_at is null;
  return out_id;
end;
$$;

-- undo a suspension, or answer a report with nothing done (a lift of a report closes it)
CREATE OR REPLACE FUNCTION "public"."network_lift"("p_act" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  act record;
  out_id uuid;
begin
  if not public.network_moderator() then raise exception 'network: only a moderator lifts' using errcode = '42501'; end if;
  select * into act from public.network_moderation where id = p_act;
  if not found then raise exception 'network: no such act' using errcode = '23503'; end if;
  if act.kind = 'report' then
    update public.network_moderation set answered_at = coalesce(answered_at, now()), answered_by = coalesce(answered_by, auth.uid()) where id = p_act;
    return p_act;
  end if;
  if act.kind <> 'suspend' then raise exception 'network: only a suspension is lifted' using errcode = '23514'; end if;
  insert into public.network_moderation (kind, actor_id, subject_id, lifts_id, reason)
  values ('lift', auth.uid(), act.subject_id, p_act, nullif(btrim(p_reason), ''))
  on conflict do nothing returning id into out_id;
  return out_id;
end;
$$;

REVOKE ALL ON FUNCTION "public"."network_report"("uuid", "uuid", "text", "text") FROM PUBLIC, "anon";
REVOKE ALL ON FUNCTION "public"."network_remove_post"("uuid", "text") FROM PUBLIC, "anon";
REVOKE ALL ON FUNCTION "public"."network_suspend"("uuid", timestamp with time zone, "text") FROM PUBLIC, "anon";
REVOKE ALL ON FUNCTION "public"."network_lift"("uuid", "text") FROM PUBLIC, "anon";
GRANT ALL ON FUNCTION "public"."network_report"("uuid", "uuid", "text", "text") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."network_remove_post"("uuid", "text") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."network_suspend"("uuid", timestamp with time zone, "text") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."network_lift"("uuid", "text") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."network_can_read"("uuid", "text", timestamp with time zone) TO "authenticated", "anon", "service_role";
GRANT ALL ON FUNCTION "public"."network_can_act"("uuid", "text") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."network_blocked"("uuid", "uuid") TO "authenticated", "anon", "service_role";
GRANT ALL ON FUNCTION "public"."network_suspended"("uuid") TO "authenticated", "anon", "service_role";
GRANT ALL ON FUNCTION "public"."network_joined"("uuid") TO "authenticated", "anon", "service_role";
GRANT ALL ON FUNCTION "public"."network_moderator"() TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."network_tid"() TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- signing in from another app: app passwords and the sessions made with them
-- ---------------------------------------------------------------------------------------------

-- AN APP PASSWORD is what a member gives Bluesky's app, never their own password: a secret the
-- site makes once, shows once, and keeps only as a hash. Revoking it ends every session made with
-- it. Made and revoked through the function, which is why a client may only read and delete.
CREATE TABLE IF NOT EXISTS "public"."network_app_passwords" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    CONSTRAINT "network_app_passwords_name_len" CHECK ((("length"("btrim"("name")) BETWEEN 1 AND 60)))
);
ALTER TABLE ONLY "public"."network_app_passwords" ADD CONSTRAINT "network_app_passwords_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."network_app_passwords" ADD CONSTRAINT "network_app_passwords_name_key" UNIQUE ("user_id", "name");
ALTER TABLE ONLY "public"."network_app_passwords" ADD CONSTRAINT "network_app_passwords_hash_key" UNIQUE ("hash");
ALTER TABLE ONLY "public"."network_app_passwords" ADD CONSTRAINT "network_app_passwords_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."network_app_passwords" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "network_app_passwords_own" ON "public"."network_app_passwords";
CREATE POLICY "network_app_passwords_own" ON "public"."network_app_passwords" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "network_app_passwords_revoke" ON "public"."network_app_passwords";
CREATE POLICY "network_app_passwords_revoke" ON "public"."network_app_passwords" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));
GRANT SELECT ("id", "user_id", "name", "created_at", "last_used_at") ON TABLE "public"."network_app_passwords" TO "authenticated";
GRANT DELETE ON TABLE "public"."network_app_passwords" TO "authenticated";
GRANT ALL ON TABLE "public"."network_app_passwords" TO "service_role";

-- A SESSION of another app, as the Matrix surface keeps them (91-matrix): our tokens, opaque to the
-- client, backed by a session the auth server issued — so a password change, a ban or a sign-out
-- everywhere ends it without this surface being told. Only the function reads or writes here.
CREATE TABLE IF NOT EXISTS "public"."network_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "app_password_id" "uuid" NOT NULL,
    "access_hash" "text" NOT NULL,
    "refresh_hash" "text" NOT NULL,
    "access_expires_at" timestamp with time zone NOT NULL,
    -- the auth server's own refresh token, and the access token it last gave, kept to save a round
    -- trip per request while it is still good
    "gotrue_refresh" "text" NOT NULL,
    "gotrue_access" "text",
    "gotrue_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."network_sessions" ADD CONSTRAINT "network_sessions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."network_sessions" ADD CONSTRAINT "network_sessions_access_key" UNIQUE ("access_hash");
ALTER TABLE ONLY "public"."network_sessions" ADD CONSTRAINT "network_sessions_refresh_key" UNIQUE ("refresh_hash");
ALTER TABLE ONLY "public"."network_sessions" ADD CONSTRAINT "network_sessions_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."network_sessions" ADD CONSTRAINT "network_sessions_password_fkey" FOREIGN KEY ("app_password_id") REFERENCES "public"."network_app_passwords"("id") ON DELETE CASCADE;
ALTER TABLE "public"."network_sessions" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."network_sessions" TO "service_role";

-- the wrong app passwords an address has tried, so the door can be closed on a guesser
CREATE TABLE IF NOT EXISTS "public"."network_login_attempts" (
    "id" bigint GENERATED ALWAYS AS IDENTITY,
    "ip" "text" NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."network_login_attempts" ADD CONSTRAINT "network_login_attempts_pkey" PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "network_login_attempts_ip_idx" ON "public"."network_login_attempts" USING "btree" ("ip", "at" DESC);
ALTER TABLE "public"."network_login_attempts" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."network_login_attempts" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- who somebody is, as the network shows them
-- ---------------------------------------------------------------------------------------------

-- MAY THE CALLER SEE THIS PERSON on the network: not across a block, not a suspended person (but by a
-- moderator), and for a guest only somebody whose page is open or who has joined the wider network.
CREATE OR REPLACE FUNCTION "public"."network_can_see"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_user is null then false
    when auth.uid() is not null and p_user = auth.uid() then true
    when public.network_blocked(auth.uid(), p_user) then false
    when public.network_suspended(p_user) and not public.network_moderator() then false
    when auth.uid() is not null then true
    else exists (select 1 from public.profiles p where p.id = p_user and p.public_profile) or public.network_joined(p_user)
  end;
$$;

-- THE PEOPLE behind a set of posts, as anybody who may read them sees them: a name, a face, and the
-- address of their page only where the page is open. Never an email, never a real name they did not
-- give as their name. A person the caller may not see is simply absent.
CREATE OR REPLACE FUNCTION "public"."network_people"("p_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', nullif(p.display_name, ''),
      'username', case when p.public_profile or public.network_joined(p.id) then p.username end,
      -- THE NAME THEIR HANDLE IS MADE OF, for the protocol: every author of a post needs a DID and a
      -- handle, so a signed-in reader is given it for everybody they can see — their username, or for
      -- somebody who never took one, 'm' and the last twelve hex of their id (the random end of it). A guest sees it only
      -- where the page is open, as the username itself.
      'handle_name', case when auth.uid() is not null or p.public_profile or public.network_joined(p.id)
                          then coalesce(p.username, 'm' || right(replace(p.id::text, '-', ''), 12)) end,
      'plc_did', (select i.did from public.network_identities i where i.user_id = p.id and i.joined_at is not null and i.left_at is null),
      'about', case when auth.uid() is not null or p.public_profile then nullif(p.about, '') end,
      'created_at', p.created_at,
      'page', (p.public_profile and p.username is not null),
      'joined', public.network_joined(p.id),
      'avatar', nullif(p.avatar, ''), 'avatar_style', nullif(p.avatar_style, ''),
      'avatar_seed', coalesce(nullif(p.avatar_seed, ''), md5(lower(coalesce(nullif(p.email, ''), p.id::text)))),
      'avatar_options', p.avatar_options
    )), '[]'::jsonb)
  from public.profiles p
  where p.id = any(p_ids) and public.network_can_see(p.id);
$$;

-- ONE PERSON, as their page shows them on the network: how many follow them and whom they follow,
-- how many posts the caller can read, and where the caller stands with them.
CREATE OR REPLACE FUNCTION "public"."network_person"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.network_can_see(p_user) then null else jsonb_build_object(
    'id', p_user,
    'followers', (select count(*) from public.network_follows f where f.subject_id = p_user and public.network_can_see(f.follower_id)),
    'following', (select count(*) from public.network_follows f where f.follower_id = p_user and (f.subject_id is null or public.network_can_see(f.subject_id))),
    'you_follow', auth.uid() is not null and exists (select 1 from public.network_follows f where f.follower_id = auth.uid() and f.subject_id = p_user),
    'follows_you', auth.uid() is not null and exists (select 1 from public.network_follows f where f.follower_id = p_user and f.subject_id = auth.uid()),
    'you_block', auth.uid() is not null and exists (select 1 from public.network_blocks b where b.blocker_id = auth.uid() and b.blocked_id = p_user),
    'you_mute', auth.uid() is not null and exists (select 1 from public.network_mutes m where m.muter_id = auth.uid() and m.muted_id = p_user)
  ) end;
$$;

-- THE SPACES the caller may post to and pin: every space they are in that has a feed channel, with
-- its first feed channel (where a post to the space's members lands) and whether it is pinned.
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

GRANT ALL ON FUNCTION "public"."network_can_see"("uuid") TO "authenticated", "anon", "service_role";
GRANT ALL ON FUNCTION "public"."network_people"("uuid"[]) TO "authenticated", "anon", "service_role";
GRANT ALL ON FUNCTION "public"."network_person"("uuid") TO "authenticated", "anon", "service_role";
GRANT ALL ON FUNCTION "public"."network_spaces"() TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- the pictures: in the network bucket under the author's own id, read by whoever may read the post
-- ---------------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "network_posts_media_idx" ON "public"."network_posts" USING "gin" ("media" "jsonb_path_ops");

-- may the caller read this picture: it is theirs, or a post they may read names it
CREATE OR REPLACE FUNCTION "public"."network_can_read_image"("p_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select (auth.uid() is not null and split_part(p_name, '/', 1) = auth.uid()::text)
      or exists (select 1 from public.network_posts p
                 where (p.media @> jsonb_build_array(jsonb_build_object('path', p_name)) or p.media @> jsonb_build_array(jsonb_build_object('poster', p_name)))
                   and public.network_can_read(p.author_id, p.audience, p.removed_at));
$$;
GRANT ALL ON FUNCTION "public"."network_can_read_image"("text") TO "authenticated", "anon", "service_role";

DROP POLICY IF EXISTS "network pictures are put by their author" ON "storage"."objects";
CREATE POLICY "network pictures are put by their author" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (
  bucket_id = 'network' and split_part(name, '/', 1) = auth.uid()::text and not public.network_suspended(auth.uid()));
DROP POLICY IF EXISTS "network pictures are read with their post" ON "storage"."objects";
CREATE POLICY "network pictures are read with their post" ON "storage"."objects" FOR SELECT TO "authenticated", "anon" USING (
  bucket_id = 'network' and public.network_can_read_image(name));
DROP POLICY IF EXISTS "network pictures are taken back by their author" ON "storage"."objects";
CREATE POLICY "network pictures are taken back by their author" ON "storage"."objects" FOR DELETE TO "authenticated" USING (
  bucket_id = 'network' and split_part(name, '/', 1) = auth.uid()::text);

-- ---------------------------------------------------------------------------------------------
-- a channel read as a feed: each post whole, with its first answers under it
-- ---------------------------------------------------------------------------------------------

-- THE FIRST ANSWERS of each post a feed shows, oldest first, a few each — the same answers the
-- thread itself would show, under the same guards (can_read_channel, a shadow-banned line seen by
-- its author alone, the plan's horizon), so the feed never shows an answer the thread would not.
CREATE OR REPLACE FUNCTION "public"."space_first_replies"("p_roots" "uuid"[], "p_n" integer DEFAULT 2) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_object_agg(r.id, coalesce((
      select jsonb_agg(to_jsonb(x) - 'fts' order by x.seq)
      from (select * from public.space_messages sm
             where sm.thread_root_id = r.id and sm.deleted_at is null
               and public.space_sees(sm.shadowed, sm.author_id, sm.channel_id)
             order by sm.seq
             limit least(greatest(coalesce(p_n, 2), 1), 10)) x), '[]'::jsonb)), '{}'::jsonb)
  from public.space_messages r
  where r.id = any(p_roots) and r.thread_root_id is null and public.can_read_channel(r.channel_id);
$$;
GRANT ALL ON FUNCTION "public"."space_first_replies"("uuid"[], integer) TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- the protocol's identities: whose handle is whose
-- ---------------------------------------------------------------------------------------------

-- WHOSE IS THIS HANDLE NAME: a username, or the 'm' + last twelve hex a member without one is known by.
-- A username wins. Asked by the atproto function as the service role, to answer handle and DID
-- resolution; never by a client, since a directory of who holds which name is not a thing to hand out.
CREATE OR REPLACE FUNCTION "public"."network_user_of_name"("p_name" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select p.id from public.profiles p where p.username = lower(p_name)),
    (select p.id from public.profiles p
      where lower(p_name) ~ '^m[0-9a-f]{12}' and length(p_name) = 13 and p.username is null
        and replace(p.id::text, '-', '') like '%' || substr(lower(p_name), 2)
      limit 1));
$$;
REVOKE ALL ON FUNCTION "public"."network_user_of_name"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."network_user_of_name"("text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."network_user_of_name"("text") TO "service_role";

-- WHAT AN APP KEEPS FOR SOMEBODY: Bluesky's app stores its own settings on the account (the feeds
-- pinned, what is muted by word, the threads' order) and asks for them on every start. They are the
-- person's own, read and written by them alone, and mean nothing to the site.
CREATE TABLE IF NOT EXISTS "public"."network_prefs" (
    "user_id" "uuid" NOT NULL,
    "prefs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_prefs_small" CHECK (("length"("prefs"::"text") <= 100000))
);
ALTER TABLE ONLY "public"."network_prefs" ADD CONSTRAINT "network_prefs_pkey" PRIMARY KEY ("user_id");
ALTER TABLE ONLY "public"."network_prefs" ADD CONSTRAINT "network_prefs_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."network_prefs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "network_prefs_own" ON "public"."network_prefs";
CREATE POLICY "network_prefs_own" ON "public"."network_prefs" FOR ALL TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."network_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."network_prefs" TO "service_role";

-- FINDING SOMEBODY on the network by what they are called: a signed-in member only, among the people
-- they can see, by display name or username — never by address. A page of ids; the names come from
-- network_people as ever.
CREATE OR REPLACE FUNCTION "public"."network_find"("p_q" "text", "p_limit" integer DEFAULT 25) RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id from public.profiles p
  where auth.uid() is not null and length(btrim(coalesce(p_q, ''))) >= 1
    and (p.display_name ilike '%' || btrim(p_q) || '%' or p.username ilike btrim(p_q) || '%')
    and public.network_can_see(p.id)
  order by (p.username = lower(btrim(p_q))) desc, p.display_name nulls last
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;
GRANT ALL ON FUNCTION "public"."network_find"("text", integer) TO "authenticated", "service_role";

-- WHO TO FOLLOW: people with an open page the reader can see and does not yet follow (nor block or
-- mute), the most followed first — the rail beside the timeline. Read as the person, so the guards
-- above decide who is in it.
CREATE OR REPLACE FUNCTION "public"."network_suggestions"("p_limit" integer DEFAULT 5) RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO public
    AS $$
  select p.id from public.profiles p
  where auth.uid() is not null and p.id <> auth.uid()
    and p.public_profile and p.username is not null
    and public.network_can_see(p.id)
    and not exists (select 1 from public.network_follows f where f.follower_id = auth.uid() and f.subject_id = p.id)
    and not exists (select 1 from public.network_mutes m where m.muter_id = auth.uid() and m.muted_id = p.id)
  order by (select count(*) from public.network_follows f where f.subject_id = p.id) desc, p.display_name nulls last
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;
REVOKE ALL ON FUNCTION "public"."network_suggestions"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."network_suggestions"(integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."network_suggestions"(integer) TO "authenticated", "service_role";

-- =============================================================================================
-- THE WIDER NETWORK: a joined member's public repository, and the stream relays read it from
-- =============================================================================================
--
-- A member who joins (network_identities.joined_at) has a signed repository holding exactly their
-- public records: their `everyone` posts, their likes and reposts of public posts, whom they follow,
-- whom (of the joined) they block, their profile. It is DERIVED: the atproto function makes it from
-- the rows above whenever they change (network_dirty), and could make it again from nothing. What is
-- STATE is the sequence of events relays have been told — a relay keeps its place by number.

-- the blocks of every joined member's repository, by CID: the MST, the records, the commits
CREATE TABLE IF NOT EXISTS "public"."network_repo_blocks" (
    "did" "text" NOT NULL,
    "cid" "text" NOT NULL,
    "bytes" "bytea" NOT NULL
);
ALTER TABLE ONLY "public"."network_repo_blocks" ADD CONSTRAINT "network_repo_blocks_pkey" PRIMARY KEY ("did", "cid");
ALTER TABLE "public"."network_repo_blocks" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."network_repo_blocks" TO "service_role";

-- where each repository stands: its latest commit and revision
CREATE TABLE IF NOT EXISTS "public"."network_commits" (
    "did" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "cid" "text" NOT NULL,
    "rev" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."network_commits" ADD CONSTRAINT "network_commits_pkey" PRIMARY KEY ("did");
ALTER TABLE ONLY "public"."network_commits" ADD CONSTRAINT "network_commits_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."network_commits" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."network_commits" TO "service_role";

-- THE EVENT STREAM, in order: every commit, identity change and account change of a joined member,
-- numbered, so a relay that drops off resumes from the last number it saw and loses nothing.
-- `body` is the event in atproto's JSON shape; `blocks` the CAR a commit carries.
CREATE TABLE IF NOT EXISTS "public"."network_seq" (
    "seq" bigint GENERATED ALWAYS AS IDENTITY,
    "did" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "body" "jsonb" NOT NULL,
    "blocks" "bytea",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "network_seq_kind_check" CHECK (("kind" = ANY (ARRAY['commit'::"text", 'identity'::"text", 'account'::"text", 'sync'::"text"])))
);
ALTER TABLE ONLY "public"."network_seq" ADD CONSTRAINT "network_seq_pkey" PRIMARY KEY ("seq");
CREATE INDEX IF NOT EXISTS "network_seq_did_idx" ON "public"."network_seq" USING "btree" ("did", "seq");
ALTER TABLE "public"."network_seq" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."network_seq" TO "service_role";

-- whose public records have changed since their repository was last made
CREATE TABLE IF NOT EXISTS "public"."network_dirty" (
    "user_id" "uuid" NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."network_dirty" ADD CONSTRAINT "network_dirty_pkey" PRIMARY KEY ("user_id");
ALTER TABLE ONLY "public"."network_dirty" ADD CONSTRAINT "network_dirty_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."network_dirty" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."network_dirty" TO "service_role";

-- the signing keys, in Vault: written and read by the service role alone
CREATE OR REPLACE FUNCTION "public"."network_key_put"("p_secret" "text", "p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_secret is null or p_secret = '' then raise exception 'a non-empty secret is required'; end if;
  return vault.create_secret(p_secret, p_name, 'a network signing key');
end;
$$;
CREATE OR REPLACE FUNCTION "public"."network_key_read"("p_secret_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
declare
  secret text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where id = p_secret_id;
  if secret is null then raise exception 'network signing key was not found'; end if;
  return secret;
end;
$$;
REVOKE ALL ON FUNCTION "public"."network_key_put"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."network_key_put"("text", "text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."network_key_read"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."network_key_read"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."network_key_put"("text", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."network_key_read"("uuid") TO "service_role";

-- A JOINED MEMBER'S PUBLIC RECORDS CHANGED: they are queued, and the atproto function is asked at
-- once over pg_net to make their repository agree (the sweep below catches anything the ask missed).
-- Nothing is asked for a member who has not joined — their records never leave the site.
CREATE OR REPLACE FUNCTION "public"."network_touch"("p_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  if p_user is null or not public.network_joined(p_user) then return; end if;
  insert into public.network_dirty (user_id) values (p_user) on conflict (user_id) do update set at = now();
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/atproto/internal/project',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end;
$$;
REVOKE ALL ON FUNCTION "public"."network_touch"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."network_touch"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."network_touch"("uuid") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."network_touch_row"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record := case tg_op when 'DELETE' then old else new end;
begin
  if tg_table_name = 'network_posts' or tg_table_name = 'network_likes' or tg_table_name = 'network_reposts' then
    perform public.network_touch(r.author_id);
  elsif tg_table_name = 'network_follows' then
    perform public.network_touch(r.follower_id);
  elsif tg_table_name = 'network_blocks' then
    perform public.network_touch(r.blocker_id);
  elsif tg_table_name = 'profiles' then
    perform public.network_touch(r.id);
  end if;
  return null;
end;
$$;
DROP TRIGGER IF EXISTS "network_touch_posts" ON "public"."network_posts";
CREATE TRIGGER "network_touch_posts" AFTER INSERT OR UPDATE OR DELETE ON "public"."network_posts" FOR EACH ROW EXECUTE FUNCTION "public"."network_touch_row"();
DROP TRIGGER IF EXISTS "network_touch_likes" ON "public"."network_likes";
CREATE TRIGGER "network_touch_likes" AFTER INSERT OR DELETE ON "public"."network_likes" FOR EACH ROW EXECUTE FUNCTION "public"."network_touch_row"();
DROP TRIGGER IF EXISTS "network_touch_reposts" ON "public"."network_reposts";
CREATE TRIGGER "network_touch_reposts" AFTER INSERT OR DELETE ON "public"."network_reposts" FOR EACH ROW EXECUTE FUNCTION "public"."network_touch_row"();
DROP TRIGGER IF EXISTS "network_touch_follows" ON "public"."network_follows";
CREATE TRIGGER "network_touch_follows" AFTER INSERT OR DELETE ON "public"."network_follows" FOR EACH ROW EXECUTE FUNCTION "public"."network_touch_row"();
DROP TRIGGER IF EXISTS "network_touch_blocks" ON "public"."network_blocks";
CREATE TRIGGER "network_touch_blocks" AFTER INSERT OR DELETE ON "public"."network_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."network_touch_row"();
DROP TRIGGER IF EXISTS "network_touch_profile" ON "public"."profiles";
CREATE TRIGGER "network_touch_profile" AFTER UPDATE OF "display_name", "about", "avatar", "username" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."network_touch_row"();

-- A SUSPENSION, A REMOVAL OR A LIFT reaches the wider network too: the member is queued, and the
-- function says so on the stream (a takedown, or the account active again) when it next makes them
CREATE OR REPLACE FUNCTION "public"."network_touch_moderation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.kind in ('suspend', 'lift', 'remove-post') then perform public.network_touch(new.subject_id); end if;
  return null;
end;
$$;
DROP TRIGGER IF EXISTS "network_touch_moderation" ON "public"."network_moderation";
CREATE TRIGGER "network_touch_moderation" AFTER INSERT ON "public"."network_moderation" FOR EACH ROW EXECUTE FUNCTION "public"."network_touch_moderation"();

-- the sweep, for whatever an ask missed (the function down, a deploy mid-flight)
CREATE OR REPLACE FUNCTION "public"."run_network_project"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  if not exists (select 1 from public.network_dirty) then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url || '/atproto/internal/project',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
end;
$$;
REVOKE ALL ON FUNCTION "public"."run_network_project"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_network_project"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_network_project"() TO "service_role";

-- a guest reads a joined member's public picture by its CID — the blob of a public post
CREATE OR REPLACE FUNCTION "public"."network_public_blob"("p_user" "uuid", "p_cid" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.network_joined(p_user) and exists (
    select 1 from public.network_posts p
    where p.author_id = p_user and p.audience = 'everyone' and p.removed_at is null
      and p.media @> jsonb_build_array(jsonb_build_object('cid', p_cid)));
$$;
REVOKE ALL ON FUNCTION "public"."network_public_blob"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."network_public_blob"("uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."network_public_blob"("uuid", "text") TO "service_role";

-- the relay asked to crawl the site, once a day, while anybody has joined: a relay forgets a host it
-- has not heard from, and a site that federates should not depend on its first ask being remembered
CREATE OR REPLACE FUNCTION "public"."run_network_crawl"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  if not exists (select 1 from public.network_identities where joined_at is not null and left_at is null) then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url || '/atproto/internal/crawl',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
end;
$$;
REVOKE ALL ON FUNCTION "public"."run_network_crawl"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_network_crawl"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_network_crawl"() TO "service_role";
