--
-- WHAT THE SITE HAS PUBLISHED, SEARCHABLE — the one index anything on the server may ask.
--
-- The palette searches in the browser, over rows the build embeds; that works because a reader's
-- browser has the whole library anyway. Nothing on the SERVER had an index at all, which is how a
-- bot came to be given a search_site tool that called a function nobody had written: it answered
-- "Could not find the function public.search_content" to every question about the site, twice per
-- run, and the bot then apologised for a technical fault to whoever had asked.
--
-- This is a PROJECTION and nobody edits it: build/search-push.mjs writes it from the compiled
-- collections after every build, one way, and a row no collection has is removed. Everything in it
-- is published content, so it is readable by anyone — an unpublished record never reaches velite's
-- output and so never reaches here (see "Nothing unpublished reaches the bundle").
--

CREATE TABLE IF NOT EXISTS "public"."content_search" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,                     -- article · wiki · doc · book · product
  "ref" text NOT NULL,                      -- the record's own id or slug, as its collection knows it
  "title" text NOT NULL,
  "sub" text,
  "href" text NOT NULL,
  "image" text,
  "date" date,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,   -- as given back to whatever asked
  -- the same tags as one string, written by the push. It is here because array_to_string is only
  -- STABLE (an element's output function may be), and a generated column must be IMMUTABLE — so
  -- the joining is done once, on the way in, rather than in the expression.
  "tag_text" text DEFAULT '' NOT NULL,
  -- what the search MATCHES on: everything the document says, including the whole of a book.
  -- It is never selected, only indexed. Nothing reads this column back out.
  "body" text DEFAULT '' NOT NULL,
  --
  -- WHAT MAY BE SHOWN BACK, which for a paywalled document is not the same thing at all.
  --
  -- A book's body is the product. The reader app gives away a few chapters and gates the rest; an
  -- index that returns forty words of any book for any query is a way of reading the whole library
  -- for nothing, one search at a time, by anybody, with no account — and a bot that quotes from it
  -- hands a free reader what a paying one bought. So the excerpt comes from HERE, and for a book
  -- this holds its description and nothing more (lib/search-rows.js, FREE_TO_QUOTE).
  --
  "quote" text DEFAULT '' NOT NULL,
  -- THE BAR THIS RECORD ALREADY DECLARES. canAccess in its frontmatter: a minimum rung on the class
  -- ladder (guest < authenticated < paid < subscribed), empty meaning everyone. The same field the
  -- reader's own page is gated by, so a bot cannot quote a members-only article at a guest — and it
  -- is the record's own word rather than a second gate invented for bots to disagree with.
  "access" text[] DEFAULT '{}'::text[] NOT NULL,
  -- the title matters most, then what it says it is, then what it says. Weighted rather than
  -- concatenated, so a book called "Money" beats one that mentions money eighty times.
  --
  -- ::regconfig is not decoration. to_tsvector(text, text) is only STABLE — it would read the
  -- session default — and a generated column must be IMMUTABLE, so without the cast the table
  -- simply will not be created.
  "tsv" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce("sub", '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce("tag_text", '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce("body", '')), 'D')
  ) STORED,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_search_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_search_one" UNIQUE ("kind", "ref")
);

CREATE INDEX IF NOT EXISTS "content_search_tsv_idx" ON "public"."content_search" USING gin ("tsv");

ALTER TABLE "public"."content_search" ENABLE ROW LEVEL SECURITY;

-- No policy for anybody. The table holds the body column — the whole of every book — so it is read
-- through search_content and by nothing else. RLS with no permissive policy denies every role but
-- the service role, which bypasses it; the grants below are what PostgREST needs to exist at all.
GRANT ALL ON TABLE "public"."content_search" TO "service_role";

--
-- One search. `websearch_to_tsquery` is the forgiving parser — it takes what a person (or a model)
-- actually types, quotes and OR and all, and never throws on punctuation the way to_tsquery does.
-- A query that reduces to nothing returns nothing rather than everything.
--
-- The excerpt is ts_headline over the body, so what comes back is the sentence that matched rather
-- than the head of the document: the thing asking is going to quote it.
--
CREATE OR REPLACE FUNCTION "public"."search_content"("p_q" text, "p_limit" integer DEFAULT 5,
      "p_kinds" text[] DEFAULT NULL, "p_class" text DEFAULT 'guest')
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
declare
  n int := greatest(1, least(coalesce(p_limit, 5), 10));
  tq tsquery;
  out jsonb;
begin
  -- the forgiving parser: it takes what a person (or a model) actually types, quotes and OR and
  -- all, and never throws on punctuation the way to_tsquery does
  tq := websearch_to_tsquery('english', coalesce(p_q, ''));
  if tq is null or tq::text = '' then return '[]'::jsonb; end if;

  out := public.search_content_by(tq, n, p_kinds, p_class);

  --
  -- AND FIRST, THEN OR. websearch_to_tsquery joins every word with AND, so a caller who asks for
  -- "a site offerings services programs" is asking for a document containing all four, and gets
  -- nothing — which reads as "this site has no offerings" rather than "that was four words".
  -- A language model asking on somebody's behalf types exactly like that, every time.
  --
  -- So: the precise query first, because when it matches it is the better answer; and only when it
  -- matches nothing at all, the same words OR'd, ranked, so the best of them still comes back.
  -- Nothing is mixed — a result set is one or the other.
  --
  if out = '[]'::jsonb then
    tq := replace(plainto_tsquery('english', coalesce(p_q, ''))::text, '&', '|')::tsquery;
    if tq is null or tq::text = '' then return '[]'::jsonb; end if;
    out := public.search_content_by(tq, n, p_kinds, p_class);
  end if;

  return out;
end;
$$;

-- the search itself, once, so the two passes above cannot drift apart
CREATE OR REPLACE FUNCTION "public"."search_content_by"("p_tq" tsquery, "p_limit" integer,
      "p_kinds" text[] DEFAULT NULL, "p_class" text DEFAULT 'guest')
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
  select coalesce(jsonb_agg(r order by r.rank desc), '[]'::jsonb) from (
    select s.kind, s.title, s.sub, s.href, s.date, s.tags,
           -- StartSel/StopSel emptied: the default wraps every match in <b>, and what reads this
           -- is a language model about to quote it, not a browser about to render it
           ts_headline('english', s.quote, p_tq,
             'StartSel="", StopSel="", MaxWords=40, MinWords=20, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … "') as excerpt,
           ts_rank_cd(s.tsv, p_tq) as rank
      from public.content_search s
     where s.tsv @@ p_tq
       -- only the kinds this caller may search (a bot's `searches:`), and only what somebody at
       -- their rung on the class ladder may be shown: a members-only article is not quoted at a
       -- guest, by the record's own bar rather than by a second rule invented for bots
       and (p_kinds is null or s.kind = any(p_kinds))
       and public.access_allows(s.access, p_class)
     order by rank desc
     limit p_limit
  ) r;
$$;

GRANT EXECUTE ON FUNCTION "public"."search_content_by"(tsquery, integer, text[], text) TO "service_role";

--
-- THE SERVER'S, NOT THE PUBLIC'S.
--
-- This is SECURITY DEFINER over an index that matches on the full text of every book. Granting it
-- to anon put a scraper on the public API: call it with a phrase, get the passage back, repeat.
-- The excerpt now comes from the quote column so there is nothing paywalled to take, and the grant
-- is the belt to that pair of braces. The reader's own palette searches in the browser and has
-- never needed this; whatever asks on somebody's behalf is a function, and a function has the key.
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so naming the roles is not a fence:
-- PUBLIC has to be revoked explicitly or anon keeps it however few roles are listed.
REVOKE ALL ON FUNCTION "public"."search_content"(text, integer, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."search_content_by"(tsquery, integer, text[], text) FROM PUBLIC;
-- and Supabase ALTER DEFAULT PRIVILEGES grants anon and authenticated EXECUTE on every function
-- it creates, so each has to be taken back by name as well. Revoking PUBLIC alone leaves both.
REVOKE ALL ON FUNCTION "public"."search_content"(text, integer, text[], text) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."search_content_by"(tsquery, integer, text[], text) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."search_content"(text, integer, text[], text) TO "service_role";

-- The class ladder, in SQL, matching _shared/access.js exactly: guest < authenticated < paid <
-- subscribed, and a record's `access` is the LOWEST rung that clears it (empty admits everyone).
CREATE OR REPLACE FUNCTION "public"."access_allows"("p_access" text[], "p_class" text) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when p_access is null or cardinality(p_access) = 0 then true
    else coalesce(array_position(array['guest','authenticated','paid','subscribed'], p_class), 0)
         >= (select min(coalesce(array_position(array['guest','authenticated','paid','subscribed'], a), 0))
               from unnest(p_access) a)
  end;
$$;
REVOKE ALL ON FUNCTION "public"."access_allows"(text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."access_allows"(text[], text) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."access_allows"(text[], text) TO "service_role";

-- WHICH RUNG THE CALLER STANDS ON, by the same ladder _shared/access.js defines. agent_class asks
-- this about a bot's subject; this asks it about whoever is calling, which is what a policy needs.
CREATE OR REPLACE FUNCTION "public"."my_class"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when auth.uid() is null then 'guest'
    when exists (select 1 from public.entitlements e where e.user_id = auth.uid()
                  and e.kind = 'class' and e.key = 'subscribed' and e.active
                  and (e.expires_at is null or e.expires_at > now())) then 'subscribed'
    when exists (select 1 from public.entitlements e where e.user_id = auth.uid()
                  and e.kind = 'class' and e.key = 'paid' and e.active
                  and (e.expires_at is null or e.expires_at > now())) then 'paid'
    else 'authenticated' end;
$$;
GRANT EXECUTE ON FUNCTION "public"."my_class"() TO "authenticated", "anon", "service_role";


-- ============================================================================
-- WHAT THE SITE HAS WORKED OUT SOMEBODY IS INTERESTED IN.
--
-- DERIVED WHEN IT IS ASKED FOR, never accumulated. It is a join: what they have read and bought,
-- against those pieces' tags AS THOSE SUBJECTS ARE NOW. Nothing is copied onto the reader at
-- read time, so RE-TAGGING A PIECE CHANGES WHO IT IS RECOMMENDED TO — for everybody who has
-- already read it, with no backfill and nothing to re-run. A tag taken off a piece stops
-- counting for all of them the moment the change is published.
--
-- The alternative was a trait written when the piece was read, and that is exactly what goes stale:
-- change a tag and every reader who came before keeps the old tag for ever. It is also what the
-- funnel audiences already do — they ask the events rather than reading a stored note — so this is
-- one pattern rather than two.
--
-- READING IS NOT FINISHING. `content_read` fires when a piece is LEFT, carrying the seconds it held
-- the reader and how far down they got, and both count: somebody who reads half of something read
-- it, and somebody who never finishes anything is still interested in what they keep opening. So a
-- read is weighted by the ATTENTION it got, and only an open too brief to be a read at all counts
-- for nothing.
--
-- The three numbers are here and nowhere else:
--   READ_FLOOR    below this, an open is not a read           (seconds)
--   READ_CEIL     the most all the reading on one tag can be worth
--   BUY_WEIGHT    what a purchase is worth, flat — above the ceiling on purpose, so it wins
-- A purchase outweighs any amount of reading on the same tag, because paying for something is
-- the least ambiguous statement of interest a person makes.
CREATE OR REPLACE FUNCTION "public"."my_interests"("p_days" integer DEFAULT 365)
    RETURNS TABLE("tag" "text", "weight" numeric, "reads" integer, "bought" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as uid),
  -- the floor, the ceiling and the multiple, named once
  k as (select 8::numeric as read_floor, 2::numeric as read_ceil, 3::numeric as buy_weight),
  -- WHAT THEY READ, one row per piece per session, with the attention it got. A piece read twice
  -- counts twice: coming back to something is its own signal.
  seen as (
    select e.props ->> 'kind' as kind, e.props ->> 'id' as ref,
           greatest(0, coalesce((e.props ->> 'seconds')::numeric, 0)) as secs,
           least(100, greatest(0, coalesce((e.props ->> 'depth')::numeric, 0))) as depth
      from public.events e, me
     where e.user_id = me.uid and e.type = 'content_read'
       and e.props ? 'id' and e.props ? 'kind'
       and e.occurred_at >= now() - make_interval(days => greatest(1, coalesce(p_days, 365))))
  ,
  -- attention, 0..1: the seconds above the floor, lifted by how far they got. A glance is 0; a long
  -- attentive read approaches 1. Deliberately gentle — this reorders a ranking, it is not a score
  -- anybody is shown.
  weighted as (
    select s.kind, s.ref,
           least(1.0, (least(s.secs, 240) - k.read_floor) / 240.0 * (0.5 + s.depth / 200.0)) as w
      from seen s, k where s.secs >= k.read_floor)
  ,
  read_subjects as (
    select lower(btrim(t)) as tag, sum(w.w) as w, count(*)::int as n
      from weighted w
      join public.content_search c on c.kind = w.kind and c.ref = w.ref
      cross join lateral unnest(c.tags) as t
     where btrim(t) <> ''
     group by 1)
  ,
  -- WHAT THEY BOUGHT. A sku is the thing's own slug; a format sells under `<slug>-<format>`, so the
  -- suffix comes off before the join — buying the paperback is buying the book.
  bought_subjects as (
    select lower(btrim(t)) as tag, count(distinct p.id)::int as n
      from public.purchases p
      join public.content_search c
        on c.ref = regexp_replace(p.sku, '-(print|hardcover|softcover|casewrap|premium|pdf|epub)$', '')
      cross join lateral unnest(c.tags) as t
     where p.user_id = (select uid from me) and p.status = 'paid' and p.sku is not null and btrim(t) <> ''
     group by 1)
  select coalesce(r.tag, b.tag) as tag,
         round(least(coalesce(r.w, 0), (select read_ceil from k)) + coalesce(b.n, 0) * (select buy_weight from k), 3) as weight,
         coalesce(r.n, 0) as reads,
         coalesce(b.n, 0) as bought
    from read_subjects r
    full outer join bought_subjects b on b.tag = r.tag
   where auth.uid() is not null
   order by 2 desc, 1;
$$;
-- their own and nobody else's: the function reads auth.uid() and takes no user, so there is no
-- argument to pass somebody else's id in. A reader cannot set one either — it is derived from what
-- they have done, and a value anybody could write is not derived.
REVOKE ALL ON FUNCTION "public"."my_interests"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_interests"(integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_interests"(integer) TO "authenticated", "service_role";

-- WHAT THEY HAVE ALREADY GOT TO THE END OF. The companion to my_interests, and the reason it
-- exists: a ranking built out of somebody's reading, with nothing taken out, hands them back the
-- five things they just read — which is the one result a recommendation must never be. So the lane
-- drops what is behind them and keeps what the tags point AT.
--
-- IT IS NOT THE SAME BAR AS THE INTERESTS, and that is the point. The interests are deliberately
-- generous: a piece half read is still interest, because somebody who never finishes anything is
-- still telling you what they keep opening. Being DONE with something is a stricter claim, and the
-- honest measure of it is DEPTH — how far down the page they actually got. Both were the floor
-- once, and the effect was that a twenty-second skim counted as interest AND was never offered
-- again: exactly the piece somebody meant to come back to, silently withheld.
--
-- So a piece is behind them when one read of it cleared both bars at once: long enough to be a
-- read at all (READ_FLOOR) and far enough down to be finished with (READ_DEPTH). Both, because
-- either alone lies — a short page sits entirely in the viewport and reports 100 the instant it
-- loads, and a long one can hold somebody for minutes near the top. One read has to do it: two
-- halves do not make a whole, since neither reached the end.
--
-- Books are not governed here. A book's depth is a chapter's depth, which says nothing about the
-- book, so the lane keeps one that has been begun and not finished (bookProgress, dropFinished in
-- ContentHub) and that rule stands on its own.
--
-- It is not folded into my_interests because it answers a different question and is asked by a
-- different thing: the interests are the query, this is the filter.
CREATE OR REPLACE FUNCTION "public"."my_reading"("p_days" integer DEFAULT 365)
    RETURNS TABLE("kind" "text", "ref" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select distinct e.props ->> 'kind', e.props ->> 'id'
    from public.events e
   where e.user_id = auth.uid() and auth.uid() is not null and e.type = 'content_read'
     and e.props ? 'id' and e.props ? 'kind'
     and coalesce((e.props ->> 'seconds')::numeric, 0) >= 8    -- READ_FLOOR, as my_interests
     and coalesce((e.props ->> 'depth')::numeric, 0) >= 70     -- READ_DEPTH: far enough down to be done with
     and e.occurred_at >= now() - make_interval(days => greatest(1, coalesce(p_days, 365)));
$$;
REVOKE ALL ON FUNCTION "public"."my_reading"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_reading"(integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_reading"(integer) TO "authenticated", "service_role";
