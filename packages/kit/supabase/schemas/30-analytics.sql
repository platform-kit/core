-- analytics: events, experiments and the admin's KPIs
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE TYPE "public"."session_fact" AS (
	"session_id" "uuid",
	"t0" timestamp with time zone,
	"t1" timestamp with time zone,
	"pv" integer,
	"uid" "uuid",
	"anon_id" "uuid",
	"distinct_id" "text",
	"source" "text",
	"ref" "text",
	"refhost" "text",
	"entry" "text",
	"exit" "text",
	"device" "text",
	"browser" "text",
	"os" "text",
	"zone" "text",
	"lang" "text",
	"country" "text",
	"utm" "jsonb",
	"channel" "text"
);

CREATE OR REPLACE FUNCTION "public"."session_facts"("since" timestamp with time zone) RETURNS SETOF "public"."session_fact"
    LANGUAGE "sql" STABLE
    AS $$
  -- every session that began since the moment given, with what its first row said on arrival (lib/arrival.js), its last
  -- page, its channel (channel_of) and its source (this site: null) — the one shape every dashboard read filters on
  select s.session_id, s.t0, s.t1, s.pv::integer, s.uid, s.anon_id, s.distinct_id, s.source,
         f.ref, lower(coalesce(nullif(substring(f.ref from '^(?:https?://)?([^/?#]+)'), ''), '')) as refhost,
         coalesce(f.props ->> 'entry', f.props ->> '$pathname', f.path) as entry, l.path as exit,
         f.props ->> 'device' as device, f.props ->> 'browser' as browser, f.props ->> 'os' as os,
         f.props ->> 'tz' as zone, lower(split_part(f.props ->> 'lang', '-', 1)) as lang, upper(f.props ->> 'country') as country,
         f.props -> 'utm' as utm, public.channel_of(f.ref, f.props -> 'utm') as channel
  from (select session_id, min(occurred_at) as t0, max(occurred_at) as t1, count(*) filter (where type in ('pageview', '$pageview')) as pv,
               max(user_id::text)::uuid as uid, min(anon_id::text)::uuid as anon_id, max(distinct_id) as distinct_id, max(source) as source
        from public.events where occurred_at >= since group by session_id) s
  left join lateral (select ref, path, props from public.events e where e.session_id = s.session_id order by (e.type in ('session_start', '$pageview')) desc, e.occurred_at limit 1) f on true
  left join lateral (select path from public.events e where e.session_id = s.session_id and e.type in ('pageview', '$pageview') order by e.occurred_at desc limit 1) l on true
$$;

CREATE OR REPLACE FUNCTION "public"."session_ok"("s" "public"."session_fact", "filters" "jsonb", "audience" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  -- the dashboards' filters, one predicate: the audience (everyone, guests, signed in, members), the source (this site
  -- unless one is named), and every chip — channel, referrer host, campaign, entry page, device, browser, system,
  -- country, language — each holding when given
  select public.audience_ok((s).uid, audience)
    and (case when coalesce(filters ->> 'source', '') = '' then (s).source is null else (s).source = filters ->> 'source' end)
    and (filters ->> 'channel' is null or (s).channel = filters ->> 'channel')
    and (filters ->> 'ref' is null or (s).refhost = lower(filters ->> 'ref'))
    and (filters ->> 'campaign' is null or (s).utm ->> 'campaign' = filters ->> 'campaign')
    and (filters ->> 'entry' is null or (s).entry = filters ->> 'entry')
    and (filters ->> 'device' is null or coalesce((s).device, 'unknown') = filters ->> 'device')
    and (filters ->> 'browser' is null or coalesce((s).browser, 'unknown') = filters ->> 'browser')
    and (filters ->> 'os' is null or coalesce((s).os, 'unknown') = filters ->> 'os')
    and (filters ->> 'country' is null or coalesce((s).country, 'unknown') = upper(filters ->> 'country'))
    and (filters ->> 'lang' is null or (s).lang = lower(filters ->> 'lang'))
$$;


-- content analytics (Dashboard → Content analytics): what is read, by whom, for how long and how far — from the
-- content_view events (a piece opened: kind, id, title, tags, topic slugs) and the content_read events (a piece left:
-- the seconds it held the reader while the tab was visible, and the furthest the viewport reached, 0–100). Every
-- figure is for the window and, where a delta is drawn, the window before it. Never a row per reader.
CREATE OR REPLACE FUNCTION "public"."admin_content"("days" integer DEFAULT 30, "audience" "text" DEFAULT 'all'::"text", "published" "jsonb" DEFAULT '{}'::"jsonb", "filters" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  d      integer := greatest(coalesce(days, 30), 1);
  since  timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  before timestamptz := now() - make_interval(days => 2 * greatest(coalesce(days, 30), 1));
  aud    text := coalesce(nullif(audience, ''), 'all');
  fl     jsonb := coalesce(filters, '{}'::jsonb) - 'source';   /* the content is this site's alone */
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with okses as (select s.session_id from public.session_facts(before) s where public.session_ok(s, fl, aud)),
  views as (
    -- every view the audience and the filters admit, with the next piece its session went on to (recirculation: the share that went on to another)
    select occurred_at, session_id, anon_id, user_id, path, ref, topic_slugs,
           props ->> 'kind' as kind, props ->> 'id' as id, nullif(props ->> 'title', '') as title, props -> 'tags' as tags,
           occurred_at >= since as now_,
           lead(props ->> 'kind') over (partition by session_id order by occurred_at) as next_kind,
           lead(props ->> 'id') over (partition by session_id order by occurred_at) as next_id
    from public.events where type = 'content_view' and occurred_at >= before and props ? 'id' and session_id in (select session_id from okses)
  ),
  reads as (
    -- one read per session and piece: the segments summed, the deepest kept
    select session_id, props ->> 'kind' as kind, props ->> 'id' as id, occurred_at >= since as now_,
           sum(greatest(0, (props ->> 'seconds')::numeric)) as seconds,
           max(least(100, greatest(0, (props ->> 'depth')::numeric))) as depth
    from public.events where type = 'content_read' and occurred_at >= before and props ? 'id' and session_id in (select session_id from okses)
    group by session_id, props ->> 'kind', props ->> 'id', occurred_at >= since
  ),
  titles as (
    select distinct on (kind, id) kind, id, title, path from views where title is not null order by kind, id, occurred_at desc
  ),
  items as (
    select v.kind, v.id, coalesce(t.title, v.id) as title, t.path,
           count(*) filter (where v.now_) as views, count(*) filter (where not v.now_) as prev_views,
           count(distinct v.anon_id) filter (where v.now_) as readers,
           count(distinct v.anon_id) filter (where v.now_ and v.user_id is not null) as signed_in,
           count(*) filter (where v.now_ and v.next_id is not null and (v.next_kind, v.next_id) is distinct from (v.kind, v.id)) as recirculated
    from views v left join titles t on t.kind = v.kind and t.id = v.id
    group by v.kind, v.id, t.title, t.path
  ),
  item_reads as (
    select kind, id, round(avg(seconds)) as avg_seconds, round(avg(depth)) as depth, round(sum(seconds) / 60) as minutes,
           count(*) filter (where depth >= 90) as finished, count(*) as reads
    from reads where now_ group by kind, id
  ),
  -- what content leads to: every sign-up, subscription and paid purchase in the window, by the person who made it
  conv as (
    select id as user_id, created_at as at, 'signup' as what, 0::numeric as amount from public.profiles where created_at >= since and public.audience_ok(id, aud)
    union all
    select user_id, created_at, 'subscription', coalesce(plan_amount, 0) from public.subscriptions where user_id is not null and created_at >= since and public.audience_ok(user_id, aud)
    union all
    select user_id, created_at, 'purchase', coalesce(amount_total, 0) from public.purchases where user_id is not null and status = 'paid' and created_at >= since and public.audience_ok(user_id, aud)
  ),
  who as (select distinct user_id, anon_id from public.events where user_id is not null and anon_id is not null),
  -- attributed to the last piece the person opened in the seven days before (last touch); a conversion with no piece before it is content's not at all
  touch as (
    select distinct on (c.user_id, c.at, c.what) c.what, c.amount, v.kind, v.id
    from conv c join who w on w.user_id = c.user_id
    join views v on v.anon_id = w.anon_id and v.occurred_at < c.at and v.occurred_at >= c.at - interval '7 days'
    order by c.user_id, c.at, c.what, v.occurred_at desc
  ),
  item_conv as (
    select kind, id, count(*) filter (where what = 'signup') as signups, count(*) filter (where what = 'subscription') as subscriptions,
           count(*) filter (where what = 'purchase') as purchases, sum(amount) filter (where what = 'purchase') as revenue
    from touch group by kind, id
  ),
  item_rows as (
    select i.kind, i.id, i.title, i.path, i.views, i.prev_views, i.readers, i.signed_in,
           case when i.views = 0 then 0 else round(100.0 * i.recirculated / i.views) end as recirculation,
           coalesce(r.avg_seconds, 0) as avg_seconds, coalesce(r.depth, 0) as depth, coalesce(r.minutes, 0) as minutes, coalesce(r.finished, 0) as finished, coalesce(r.reads, 0) as reads,
           (published ->> (i.kind || ':' || i.id))::date as published_at,
           coalesce(c.signups, 0) as signups, coalesce(c.subscriptions, 0) as subscriptions, coalesce(c.purchases, 0) as purchases, coalesce(c.revenue, 0) as revenue
    from items i left join item_reads r on r.kind = i.kind and r.id = i.id left join item_conv c on c.kind = i.kind and c.id = i.id
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'views', count(*) filter (where now_), 'readers', count(distinct anon_id) filter (where now_),
        'items', count(distinct (kind, id)) filter (where now_),
        'signed_in', count(distinct anon_id) filter (where now_ and user_id is not null),
        'recirculation', case when count(*) filter (where now_) = 0 then 0 else round(100.0 * count(*) filter (where now_ and next_id is not null and (next_kind, next_id) is distinct from (kind, id)) / count(*) filter (where now_)) end,
        'minutes', (select coalesce(round(sum(seconds) / 60), 0) from reads where now_)) from views),
    'prev', (select jsonb_build_object('views', count(*) filter (where not now_), 'readers', count(distinct anon_id) filter (where not now_),
        'items', count(distinct (kind, id)) filter (where not now_), 'signed_in', count(distinct anon_id) filter (where not now_ and user_id is not null),
        'recirculation', case when count(*) filter (where not now_) = 0 then 0 else round(100.0 * count(*) filter (where not now_ and next_id is not null and (next_kind, next_id) is distinct from (kind, id)) / count(*) filter (where not now_)) end,
        'minutes', (select coalesce(round(sum(seconds) / 60), 0) from reads where not now_)) from views),
    'reading', (select jsonb_build_object(
        'avg_seconds', coalesce(round(avg(seconds) filter (where now_)), 0), 'prev_avg_seconds', coalesce(round(avg(seconds) filter (where not now_)), 0),
        'avg_depth', coalesce(round(avg(depth) filter (where now_)), 0),
        'finished', count(*) filter (where now_ and depth >= 90), 'prev_finished', count(*) filter (where not now_ and depth >= 90),
        'reads', count(*) filter (where now_), 'prev_reads', count(*) filter (where not now_)) from reads),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g.dd::date, 'views', coalesce(v.n, 0), 'readers', coalesce(v.r, 0)) order by g.dd), '[]'::jsonb)
        from generate_series(before::date, now()::date, interval '1 day') as g(dd)
        left join (select occurred_at::date as dd, count(*) as n, count(distinct anon_id) as r from views group by 1) v on v.dd = g.dd),
    'kinds', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'views', views, 'readers', readers, 'avg_seconds', avg_seconds) order by views desc), '[]'::jsonb)
        from (select kind, sum(views) as views, sum(readers) as readers, round(avg(avg_seconds) filter (where avg_seconds > 0)) as avg_seconds from item_rows where views > 0 group by kind) k),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.views desc, x.readers desc), '[]'::jsonb) from (select * from item_rows where views > 0 order by views desc, readers desc limit 60) x),
    'rising', (select coalesce(jsonb_agg(to_jsonb(x) order by (x.views - x.prev_views) desc), '[]'::jsonb) from (select kind, id, title, path, views, prev_views from item_rows where views >= 3 and views > prev_views order by (views - prev_views) desc limit 6) x),
    'fading', (select coalesce(jsonb_agg(to_jsonb(x) order by (x.prev_views - x.views) desc), '[]'::jsonb) from (select kind, id, title, path, views, prev_views from item_rows where prev_views >= 3 and prev_views > views order by (prev_views - views) desc limit 6) x),
    -- evergreen: published more than a month before the window began (the dates the client brings from the collections) and still in the top third by views
    'evergreen', (select coalesce(jsonb_agg(to_jsonb(x) order by x.views desc), '[]'::jsonb)
        from (select kind, id, title, path, views, prev_views, published_at from item_rows
              where published_at is not null and published_at < (since - interval '30 days')::date and views >= 3
                and views >= coalesce((select percentile_cont(0.67) within group (order by views) from item_rows where views > 0), 0)
              order by views desc limit 6) x),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('topic', topic, 'views', n) order by n desc), '[]'::jsonb)
        from (select t as topic, count(*) as n from views, unnest(topic_slugs) as t where now_ group by t order by n desc limit 12) tp),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('tag', tag, 'views', n) order by n desc), '[]'::jsonb)
        from (select t as tag, count(*) as n from views, jsonb_array_elements_text(case when jsonb_typeof(tags) = 'array' then tags else '[]'::jsonb end) as t where now_ group by t order by n desc limit 12) tg),
    'depth', (select jsonb_build_object(
        'q1', count(*) filter (where depth < 25), 'q2', count(*) filter (where depth >= 25 and depth < 50),
        'q3', count(*) filter (where depth >= 50 and depth < 90), 'q4', count(*) filter (where depth >= 90)) from reads where now_),
    'currency', (select coalesce(min(currency), 'usd') from public.purchases where status = 'paid'),
    'conversions', jsonb_build_object(
        'signups', (select count(*) from conv where what = 'signup'), 'signups_content', (select count(*) from touch where what = 'signup'),
        'subscriptions', (select count(*) from conv where what = 'subscription'), 'subscriptions_content', (select count(*) from touch where what = 'subscription'),
        'purchases', (select count(*) from conv where what = 'purchase'), 'purchases_content', (select count(*) from touch where what = 'purchase'),
        'revenue', (select coalesce(sum(amount), 0) from conv where what = 'purchase'), 'revenue_content', (select coalesce(sum(amount), 0) from touch where what = 'purchase'),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'title', title, 'path', path, 'readers', readers, 'signups', signups, 'subscriptions', subscriptions, 'purchases', purchases, 'revenue', revenue)
                                    order by (signups + subscriptions + purchases) desc, readers desc), '[]'::jsonb)
                  from item_rows where signups + subscriptions + purchases > 0)),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'views', n) order by n desc), '[]'::jsonb)
        from (select coalesce(nullif(regexp_replace(ref, '^https?://([^/]+).*$', '\1'), ''), '(direct)') as ref, count(*) as n from views where now_ group by 1 order by n desc limit 8) rf),
    -- the channels the reading sessions came by
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'views', n, 'readers', r) order by n desc), '[]'::jsonb)
        from (select public.channel_of(f.ref, f.props -> 'utm') as channel, count(*) as n, count(distinct v.anon_id) as r
              from views v left join lateral (select ref, props from public.events e where e.session_id = v.session_id and e.type = 'session_start' order by e.occurred_at limit 1) f on true
              where v.now_ group by 1) ch)
  ) into result;

  return result;
end;
$$;

GRANT ALL ON FUNCTION "public"."admin_content"("days" integer, "audience" "text", "published" "jsonb", "filters" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_content"("days" integer, "audience" "text", "published" "jsonb", "filters" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_content"("days" integer, "audience" "text", "published" "jsonb", "filters" "jsonb") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."admin_events"("days" integer DEFAULT 30, "audience" "text" DEFAULT 'all'::"text", "filters" "jsonb" DEFAULT '{}'::"jsonb", "event" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- the Events tab: every event name sent in the window (the sessions the audience and the filters admit) with its
-- count, people, sessions and the window before; and for one event named, its series a day, the channels it came by,
-- and the top values of its first properties — the site's own labels are the client's to lay over
declare
  d      integer := greatest(coalesce(days, 30), 1);
  since  timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  before timestamptz := now() - make_interval(days => 2 * greatest(coalesce(days, 30), 1));
  aud    text := coalesce(nullif(audience, ''), 'all');
  fl     jsonb := coalesce(filters, '{}'::jsonb);
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  with ses as (select s.*, s.t0 >= since as now_ from public.session_facts(before) s where public.session_ok(s, fl, aud)),
  ev as (select e.type, e.occurred_at, e.anon_id, e.session_id, e.props, e.occurred_at >= since as now_, ses.channel from public.events e join ses on ses.session_id = e.session_id where e.occurred_at >= before)
  select jsonb_build_object(
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'n', n, 'prev', prev, 'people', people, 'sessions', sessions) order by n desc), '[]'::jsonb)
               from (select type, count(*) filter (where now_) as n, count(*) filter (where not now_) as prev, count(distinct anon_id) filter (where now_) as people, count(distinct session_id) filter (where now_) as sessions
                     from ev group by type having count(*) filter (where now_) > 0) x),
    'sessions', (select count(*) from ses where now_),
    'one', case when event is null then null else (
      select jsonb_build_object(
        'type', event,
        'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g.dd::date, 'n', coalesce(v.n, 0), 'people', coalesce(v.p, 0)) order by g.dd), '[]'::jsonb)
                   from generate_series(since::date, now()::date, interval '1 day') as g(dd)
                   left join (select occurred_at::date as dd, count(*) as n, count(distinct anon_id) as p from ev where type = event and now_ group by 1) v on v.dd = g.dd),
        'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'n', n) order by n desc), '[]'::jsonb) from (select channel, count(*) as n from ev where type = event and now_ group by 1) c),
        -- the first eight property keys (PostHog's own, the $-keys, aside), each with its top eight values
        'properties', (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'values', k.vals) order by k.total desc), '[]'::jsonb)
                       from (select key, sum(n) as total, jsonb_agg(jsonb_build_object('value', value, 'n', n) order by n desc) as vals
                             from (select key, value, count(*) as n, row_number() over (partition by key order by count(*) desc) as rn
                                   from ev, jsonb_each_text(case when jsonb_typeof(props) = 'object' then props else '{}'::jsonb end) as kv(key, value)
                                   where type = event and now_ and key not like '$%' and length(value) <= 120 group by key, value) v
                             where rn <= 8 group by key order by total desc limit 8) k))
    ) end
  ) into result;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_retention"("weeks" integer DEFAULT 8, "audience" "text" DEFAULT 'all'::"text", "filters" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- retention as the classic grid: the browsers first seen in each of the last N weeks (the source the filters name — this
-- site unless one is — the audience, and the chips: a browser is in a cohort when its first session passes them), and
-- of them the share seen again in each later week
declare
  n      integer := least(greatest(coalesce(weeks, 8), 2), 26);
  start  timestamptz := date_trunc('week', now()) - make_interval(weeks => least(greatest(coalesce(weeks, 8), 2), 26) - 1);
  aud    text := coalesce(nullif(audience, ''), 'all');
  src    text := nullif(coalesce(filters ->> 'source', ''), '');
  fl     jsonb := coalesce(filters, '{}'::jsonb);
  chips  boolean := (coalesce(filters, '{}'::jsonb) - 'source') <> '{}'::jsonb;
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  with rows_ as (
    select anon_id, occurred_at, user_id from public.events where (case when src is null then source is null else source = src end)
  ),
  firsts as (select anon_id, min(occurred_at) as first_at, max(user_id::text)::uuid as uid from rows_ group by anon_id),
  first_ses as (select distinct on (s.anon_id) s.anon_id, public.session_ok(s, fl, aud) as ok from public.session_facts(start) s order by s.anon_id, s.t0),
  cohort as (select f.anon_id, date_trunc('week', f.first_at) as wk from firsts f
             where f.first_at >= start and public.audience_ok(f.uid, aud)
               and (not chips or exists (select 1 from first_ses x where x.anon_id = f.anon_id and x.ok))),
  seen as (select distinct r.anon_id, date_trunc('week', r.occurred_at) as wk from rows_ r join cohort c on c.anon_id = r.anon_id)
  select coalesce(jsonb_agg(jsonb_build_object('week', c.wk::date, 'size', c.size, 'back', c.back) order by c.wk), '[]'::jsonb) into result
  from (
    select w.wk, count(c.anon_id) as size,
           (select coalesce(jsonb_agg(coalesce(b.share, 0) order by k.k), '[]'::jsonb)
            from generate_series(1, n - 1) as k(k)
            left join lateral (select round(100.0 * count(distinct s.anon_id) / greatest(1, count(distinct c2.anon_id))) as share
                               from cohort c2 left join seen s on s.anon_id = c2.anon_id and s.wk = w.wk + make_interval(weeks => k.k)
                               where c2.wk = w.wk and w.wk + make_interval(weeks => k.k) <= date_trunc('week', now())) b on true
            where w.wk + make_interval(weeks => k.k) <= date_trunc('week', now())) as back
    from generate_series(start, date_trunc('week', now()), interval '1 week') as w(wk)
    left join cohort c on c.wk = w.wk group by w.wk
  ) c;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_find"("days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  since timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'starts',  (select count(*) from public.events where type = 'find_start'  and occurred_at >= since),
    'results', (select count(*) from public.events where type = 'find_result' and occurred_at >= since),
    'opens',   (select count(*) from public.events where type = 'find_open'   and occurred_at >= since),
    -- sessions that went on to open a book they were given
    'opened_sessions', (select count(distinct session_id) from public.events where type = 'find_open' and occurred_at >= since),
    'people',  (select count(distinct coalesce(user_id::text, anon_id::text)) from public.events where type = 'find_result' and occurred_at >= since),
    -- what they say they are looking for
    'looking', (
      select coalesce(jsonb_agg(jsonb_build_object('choice', choice, 'n', n) order by n desc), '[]'::jsonb)
      from (select coalesce(props ->> 'looking', '') as choice, count(*) as n
            from public.events where type = 'find_result' and occurred_at >= since group by 1) x),
    -- speed or depth
    'pace', (
      select coalesce(jsonb_agg(jsonb_build_object('choice', choice, 'n', n) order by n desc), '[]'::jsonb)
      from (select coalesce(props ->> 'pace', '') as choice, count(*) as n
            from public.events where type = 'find_result' and occurred_at >= since group by 1) x),
    -- the books recommended, by how often, and how often each was opened from a finding
    'books', (
      select coalesce(jsonb_agg(jsonb_build_object('book', r.book, 'recommended', r.recs, 'first', r.firsts, 'opened', coalesce(o.opens, 0)) order by r.recs desc), '[]'::jsonb)
      from (select b.value #>> '{}' as book, count(*) as recs, count(*) filter (where b.ordinality = 1) as firsts
            from public.events e, jsonb_array_elements(e.props -> 'books') with ordinality as b
            where e.type = 'find_result' and e.occurred_at >= since group by 1) r
      left join (select props ->> 'book' as book, count(*) as opens from public.events where type = 'find_open' and occurred_at >= since group by 1) o on o.book = r.book),
    -- the words people reach for, sentence by sentence
    'words', jsonb_build_object('problem', public.find_words('problem', since), 'frustration', public.find_words('frustration', since)),
    -- the answers themselves, latest first: what people wrote and what they were given
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'at', occurred_at, 'user', user_id, 'problem', props ->> 'problem', 'problem_prompt', props ->> 'problem_prompt',
          'frustration', props ->> 'frustration', 'frustration_prompt', props ->> 'frustration_prompt',
          'looking', props ->> 'looking', 'looking_text', props ->> 'looking_text', 'pace', props ->> 'pace', 'books', props -> 'books') order by occurred_at desc), '[]'::jsonb)
      from (select * from public.events where type = 'find_result' and occurred_at >= since order by occurred_at desc limit 100) r)
  ) into result;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."audience_ok"("uid" "uuid", "audience" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  -- the dashboards' audience filter, one predicate: everyone; a guest (no account); signed in; a member (an account
  -- with a live subscription at the time of reading — an approximation, and said so in the docs)
  select case coalesce(audience, 'all')
    when 'guest' then uid is null
    when 'user' then uid is not null
    when 'member' then uid is not null and exists (select 1 from public.entitlements en where en.user_id = uid and en.kind = 'class' and en.key = 'subscribed' and en.active and (en.expires_at is null or en.expires_at > now()))
    else true end
$$;

CREATE OR REPLACE FUNCTION "public"."channel_of"("ref" "text", "utm" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  -- the channel a session came by, told once and here alone: the UTM tags first, then the referrer's host
  with h as (select lower(coalesce(nullif(substring(ref from '^(?:https?://)?([^/?#]+)'), ''), '')) as host,
                    lower(coalesce(utm ->> 'medium', '')) as medium, lower(coalesce(utm ->> 'source', '')) as source)
  select case
    when medium in ('email', 'e-mail', 'newsletter') or source in ('newsletter', 'email') then 'email'
    when medium in ('social', 'paid_social', 'paidsocial') then 'social'
    when medium in ('cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'display', 'banner') then 'paid'
    when medium in ('organic', 'search') then 'search'
    when medium in ('referral', 'affiliate', 'partner') then 'referral'
    when host ~ '(^|\.)(mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|mail\.proton\.me|protonmail\.com|fastmail\.com|mail\.aol\.com|icloud\.com)$' then 'email'
    when host ~ '(^|\.)(facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|t\.co|linkedin\.com|lnkd\.in|reddit\.com|threads\.net|tiktok\.com|youtube\.com|youtu\.be|pinterest\.[a-z.]+|mastodon\.[a-z]+|bsky\.app|snapchat\.com|whatsapp\.com|telegram\.org|t\.me)$' then 'social'
    when host ~ '(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.[a-z.]+|ecosia\.org|brave\.com|baidu\.com|yandex\.[a-z]+|ask\.com|qwant\.com|startpage\.com)$' and host !~ '^(gemini|mail|docs|drive)\.' then 'search'
    when host ~ '(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com|poe\.com)$' then 'ai'
    when host = '' then 'direct'
    else 'referral' end
  from h
$$;

CREATE OR REPLACE FUNCTION "public"."admin_kpis"("days" integer DEFAULT 30, "audience" "text" DEFAULT 'all'::"text", "tz" "text" DEFAULT 'UTC'::"text", "filters" "jsonb" DEFAULT '{}'::"jsonb", "goals" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- the dashboard's read: visitors (distinct browsers), views, sessions, bounce, length and the goals with their rates
-- against the window before; the channels (channel_of over each session's arrival), the referrers under them, the
-- campaigns, the entry and exit pages; the audience (new against returning, devices, browsers, systems, time zones,
-- languages, countries, who, the hours at the administrator's zone); the site's own goals (`goals`: the registered events, each a
-- key, a label and optionally the property that is its value) counted and per channel; and the site's own sections as before.
-- `audience` narrows every session (a session is its people: signed in when anyone in it was) and every conversion to
-- Everyone, Guests, Signed in or Members; `filters` (session_ok) narrows to a source — this site unless one is named — and
-- to the chips: channel, referrer, campaign, entry, device, browser, system, country, language.
declare
  d      integer := greatest(coalesce(days, 30), 1);
  since  timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  before timestamptz := now() - make_interval(days => 2 * greatest(coalesce(days, 30), 1));
  tzname text := coalesce(nullif(tz, ''), 'UTC');
  aud    text := coalesce(nullif(audience, ''), 'all');
  fl     jsonb := coalesce(filters, '{}'::jsonb);
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  begin perform now() at time zone tzname; exception when others then tzname := 'UTC'; end;

  with ses as (
    -- every session of both windows that the audience and the filters admit, with what its first row said on arrival
    select s.*, s.t0 >= since as now_ from public.session_facts(before) s where public.session_ok(s, fl, aud)
  ),
  ev as (select e.* from public.events e join ses on ses.session_id = e.session_id and ses.now_),
  firsts as (select anon_id, min(occurred_at) as first_at from public.events group by anon_id),
  who as (select distinct user_id, anon_id from public.events where user_id is not null),
  -- the goals: every sign-up, paid purchase and subscription of both windows, each in the session it happened in (its channel)
  goal as (
    select g.what, g.at, g.amount, g.at >= since as now_, s.channel, s.utm, s.entry
    from (select 'signup' as what, p.id as user_id, p.created_at as at, 0::bigint as amount from public.profiles p where p.created_at >= before
          union all select 'purchase', pu.user_id, pu.created_at, coalesce(pu.amount_total, 0) from public.purchases pu where pu.status = 'paid' and pu.user_id is not null and pu.created_at >= before
          union all select 'subscription', su.user_id, su.created_at, 0 from public.subscriptions su where su.created_at >= before) g
    left join lateral (select ses.channel, ses.utm, ses.entry from ses join who w on w.anon_id = ses.anon_id and w.user_id = g.user_id
                       where ses.t0 <= g.at + interval '5 minutes' and ses.t1 >= g.at - interval '30 minutes' order by ses.t0 desc limit 1) s on true
    where public.audience_ok(g.user_id, aud)
  ),
  -- the site's own goals: every event of a registered key, in the session that sent it, with the property that is its value
  cgoal as (
    select g.value ->> 'key' as key, e.occurred_at >= since as now_, ses.channel, case when g.value ->> 'value' is not null then (e.props ->> (g.value ->> 'value'))::numeric else null end as val
    from jsonb_array_elements(case when jsonb_typeof(goals) = 'array' then goals else '[]'::jsonb end) g
    join public.events e on e.type = g.value ->> 'key' and e.occurred_at >= before
    join ses on ses.session_id = e.session_id
  ),
  tot as (
    select now_, count(*) as sessions, count(distinct anon_id) as visitors, sum(pv) as pageviews, count(*) filter (where pv <= 1 and t1 - t0 < interval '10 seconds') as bounces,
           coalesce(round(avg(least(extract(epoch from (t1 - t0)), 1800))), 0) as avg_seconds,
           count(*) filter (where uid is not null) as signed_sessions
    from ses group by now_
  )
  select jsonb_build_object(
    'since', since, 'days', d, 'audience', aud,

    -- ---------------------------------------------------------------- traffic
    'totals', (
      select jsonb_build_object(
        'visitors',        coalesce((select visitors from tot where now_), 0),
        'pageviews',       coalesce((select pageviews from tot where now_), 0),
        'sessions',        coalesce((select sessions from tot where now_), 0),
        'views_per_visit', coalesce((select case when sessions = 0 then 0 else round(pageviews::numeric / sessions, 2) end from tot where now_), 0),
        'users',           (select count(distinct user_id) from ev where user_id is not null),
        'content_views',   (select count(*) from ev where type = 'content_view'),
        'cta_impressions', (select count(*) from ev where type = 'cta_impression'),
        'cta_clicks',      (select count(*) from ev where type = 'cta_click'),
        'signups',         (select count(*) from goal where what = 'signup' and now_),
        'add_to_cart',     (select count(*) from ev where type = 'click' and props ->> 'kind' = 'add_to_cart'),
        'checkouts',       (select count(*) from ev where type = 'click' and props ->> 'kind' in ('checkout', 'buy_now')),
        'new_sessions',    (select count(*) from ses s join firsts f on f.anon_id = s.anon_id where s.now_ and f.first_at >= since),
        'returning_sessions', (select count(*) from ses s join firsts f on f.anon_id = s.anon_id where s.now_ and f.first_at < since),
        'bounce_sessions', coalesce((select bounces from tot where now_), 0),
        'avg_session_seconds', coalesce((select avg_seconds from tot where now_), 0),
        'pages_per_session', coalesce((select case when sessions = 0 then 0 else round(pageviews::numeric / sessions, 2) end from tot where now_), 0))),

    -- the same headline numbers over the window before this one, for deltas
    'prev', (
      select jsonb_build_object(
        'visitors',      coalesce((select visitors from tot where not now_), 0),
        'pageviews',     coalesce((select pageviews from tot where not now_), 0),
        'sessions',      coalesce((select sessions from tot where not now_), 0),
        'views_per_visit', coalesce((select case when sessions = 0 then 0 else round(pageviews::numeric / sessions, 2) end from tot where not now_), 0),
        'bounce_sessions', coalesce((select bounces from tot where not now_), 0),
        'avg_session_seconds', coalesce((select avg_seconds from tot where not now_), 0),
        'users',         (select count(distinct e.user_id) from public.events e join ses on ses.session_id = e.session_id and not ses.now_ where e.user_id is not null),
        'content_views', (select count(*) from public.events e join ses on ses.session_id = e.session_id and not ses.now_ where e.type = 'content_view'),
        'signups',       (select count(*) from goal where what = 'signup' and not now_),
        'purchases',     (select count(*) from goal where what = 'purchase' and not now_),
        'revenue',       (select coalesce(sum(amount), 0) from goal where what = 'purchase' and not now_),
        'subscriptions', (select count(*) from goal where what = 'subscription' and not now_),
        'rounds',        (select count(*) from public.results where computed_at >= before and computed_at < since),
        'answers',       (select count(*) from public.answers where answered_at >= before and answered_at < since))),

    -- the goals: a count, the window before, and the rate per hundred visitors
    'goals', (
      select jsonb_build_object(
        'signups',       jsonb_build_object('n', (select count(*) from goal where what = 'signup' and now_), 'prev', (select count(*) from goal where what = 'signup' and not now_),
                           'credited', (select count(*) from goal where what = 'signup' and now_ and channel is not null)),
        'purchases',     jsonb_build_object('n', (select count(*) from goal where what = 'purchase' and now_), 'prev', (select count(*) from goal where what = 'purchase' and not now_),
                           'credited', (select count(*) from goal where what = 'purchase' and now_ and channel is not null)),
        'subscriptions', jsonb_build_object('n', (select count(*) from goal where what = 'subscription' and now_), 'prev', (select count(*) from goal where what = 'subscription' and not now_),
                           'credited', (select count(*) from goal where what = 'subscription' and now_ and channel is not null)),
        'custom', (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'n', k.n, 'prev', k.prev, 'value', k.val) order by k.n desc), '[]'::jsonb)
                   from (select key, count(*) filter (where now_) as n, count(*) filter (where not now_) as prev, coalesce(sum(val) filter (where now_), 0) as val from cgoal group by key) k))),

    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', dd, 'pageviews', n) order by dd), '[]'::jsonb)
      from (select date_trunc('day', occurred_at)::date as dd, count(*) as n from ev where type = 'pageview' group by 1) x),

    'top_pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', v, 'sessions', s) order by v desc), '[]'::jsonb)
      from (select path, count(*) as v, count(distinct session_id) as s from ev where type = 'pageview' and path is not null
            group by path order by v desc limit 12) x),

    'engagement', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'avg_seconds', round(avg_s), 'reads', n) order by avg_s desc), '[]'::jsonb)
      from (select path, avg(secs) as avg_s, count(*) as n
            from (select path, greatest(0, (props ->> 'seconds')::numeric) as secs from ev where type = 'content_read' and props ? 'seconds') r
            where path is not null group by path having count(*) >= 2 order by avg_s desc limit 12) x),

    'topics', (
      select coalesce(jsonb_agg(jsonb_build_object('topic', t, 'views', n) order by n desc), '[]'::jsonb)
      from (select unnest(topic_slugs) as t, count(*) as n from ev where type = 'content_view' group by 1 order by n desc limit 15) x),

    -- ------------------------------------------------------------ acquisition
    'channels', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', c.channel, 'visitors', c.visitors, 'sessions', c.sessions, 'bounces', c.bounces, 'avg_seconds', c.avg_seconds,
                                                   'signups', coalesce(g.signups, 0), 'purchases', coalesce(g.purchases, 0), 'subscriptions', coalesce(g.subscriptions, 0), 'revenue', coalesce(g.revenue, 0),
                                                   'prev_visitors', coalesce(p.visitors, 0), 'custom', coalesce(cg.o, '{}'::jsonb)) order by c.visitors desc), '[]'::jsonb)
      from (select channel, count(distinct anon_id) as visitors, count(*) as sessions, count(*) filter (where pv <= 1 and t1 - t0 < interval '10 seconds') as bounces,
                   coalesce(round(avg(least(extract(epoch from (t1 - t0)), 1800))), 0) as avg_seconds from ses where now_ group by channel) c
      left join (select channel, count(*) filter (where what = 'signup') as signups, count(*) filter (where what = 'purchase') as purchases,
                        count(*) filter (where what = 'subscription') as subscriptions, coalesce(sum(amount) filter (where what = 'purchase'), 0) as revenue
                 from goal where now_ and channel is not null group by channel) g on g.channel = c.channel
      left join (select channel, count(distinct anon_id) as visitors from ses where not now_ group by channel) p on p.channel = c.channel
      left join lateral (select jsonb_object_agg(z.key, z.n) as o from (select key, count(*) as n from cgoal where now_ and cgoal.channel = c.channel group by key) z) cg on true),
    'referrers', (
      select coalesce(jsonb_agg(jsonb_build_object('ref', r, 'channel', channel, 'sessions', n, 'visitors', v) order by n desc), '[]'::jsonb)
      from (select coalesce(nullif(refhost, ''), '(direct)') as r, channel, count(*) as n, count(distinct anon_id) as v
            from ses where now_ group by 1, 2 order by n desc limit 30) x),
    'campaigns', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'medium', medium, 'campaign', campaign, 'visitors', v, 'sessions', n, 'signups', g.signups) order by v desc), '[]'::jsonb)
      from (select utm ->> 'source' as source, utm ->> 'medium' as medium, utm ->> 'campaign' as campaign, count(distinct anon_id) as v, count(*) as n
            from ses where now_ and utm is not null group by 1, 2, 3 order by v desc limit 20) x
      left join lateral (select count(*) as signups from goal gl where gl.now_ and gl.what = 'signup' and gl.utm ->> 'source' is not distinct from x.source and gl.utm ->> 'medium' is not distinct from x.medium and gl.utm ->> 'campaign' is not distinct from x.campaign) g on true),
    'entry_pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', x.p, 'sessions', x.n, 'visitors', x.v, 'bounces', x.b, 'signups', coalesce(g.n, 0)) order by x.n desc), '[]'::jsonb)
      from (select entry as p, count(*) as n, count(distinct anon_id) as v, count(*) filter (where pv <= 1 and t1 - t0 < interval '10 seconds') as b from ses where now_ and entry is not null group by 1 order by n desc limit 12) x
      left join lateral (select count(*) as n from goal gl where gl.now_ and gl.what = 'signup' and gl.entry = x.p) g on true),
    'exit_pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', p, 'sessions', n, 'share', share) order by n desc), '[]'::jsonb)
      from (select exit as p, count(*) as n, round(100.0 * count(*) / greatest(1, (select count(*) from ses where now_ and exit is not null))) as share
            from ses where now_ and exit is not null group by 1 order by n desc limit 12) x),

    -- --------------------------------------------------------------- audience
    'audience', (
      select jsonb_build_object(
        'new',       (select count(distinct s.anon_id) from ses s join firsts f on f.anon_id = s.anon_id where s.now_ and f.first_at >= since),
        'returning', (select count(distinct s.anon_id) from ses s join firsts f on f.anon_id = s.anon_id where s.now_ and f.first_at < since),
        'devices',   (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(device, 'unknown') as k, count(distinct anon_id) as n from ses where now_ group by 1) x),
        'browsers',  (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(browser, 'unknown') as k, count(distinct anon_id) as n from ses where now_ group by 1) x),
        'os',        (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(os, 'unknown') as k, count(distinct anon_id) as n from ses where now_ group by 1) x),
        'zones',     (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc), '[]'::jsonb) from (select ses.zone as k, count(distinct ses.anon_id) as n from ses where ses.now_ and ses.zone is not null group by 1 order by n desc limit 12) x),
        'countries', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(country, 'unknown') as k, count(distinct anon_id) as n from ses where now_ group by 1 order by n desc limit 16) x),
        'langs',     (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc), '[]'::jsonb) from (select lang as k, count(distinct anon_id) as n from ses where now_ and lang is not null and lang <> '' group by 1 order by n desc limit 12) x),
        'who',       jsonb_build_object(
                       'guest',  (select count(distinct anon_id) from ses where now_ and uid is null),
                       'user',   (select count(distinct anon_id) from ses where now_ and uid is not null and not public.audience_ok(uid, 'member')),
                       'member', (select count(distinct anon_id) from ses where now_ and public.audience_ok(uid, 'member'))),
        'hours',     (select coalesce(jsonb_agg(jsonb_build_array(dow, hr, n)), '[]'::jsonb)
                      from (select extract(dow from (t0 at time zone tzname))::integer as dow, extract(hour from (t0 at time zone tzname))::integer as hr, count(*) as n from ses where now_ group by 1, 2) h))),

    -- ------------------------------------------------------------------- ctas
    'ctas', (
      select coalesce(jsonb_agg(jsonb_build_object('ad', b, 'impressions', i, 'clicks', c) order by i desc), '[]'::jsonb)
      from (select coalesce(props ->> 'ad_id', props ->> 'banner_id') as b,
                   count(*) filter (where type = 'cta_impression') as i, count(*) filter (where type = 'cta_click') as c
            from ev where type in ('cta_impression', 'cta_click') and (props ? 'ad_id' or props ? 'banner_id') group by 1 order by i desc limit 12) x),

    -- --------------------------------------------------------------- commerce
    'revenue', (
      select jsonb_build_object('purchases', count(*), 'total', coalesce(sum(amount), 0), 'currency', (select coalesce(min(currency), 'usd') from public.purchases where status = 'paid'),
                                'aov', case when count(*) = 0 then 0 else round(sum(amount)::numeric / count(*)) end)
      from goal where what = 'purchase' and now_),
    'top_products', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'kind', kind, 'purchases', n, 'revenue', rev) order by rev desc), '[]'::jsonb)
      from (select coalesce(p.sku, p.product_id, '?') as name, null::text as kind, count(*) as n, coalesce(sum(p.amount_total), 0) as rev
            from public.purchases p where p.status = 'paid' and p.created_at >= since and public.audience_ok(p.user_id, aud)
            group by 1 order by rev desc limit 10) x),
    'converting_pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'purchases', n) order by n desc), '[]'::jsonb)
      from (select e.path, count(*) as n
            from public.purchases p
            join lateral (select ev2.path from public.events ev2 where ev2.user_id = p.user_id and ev2.type in ('content_view', 'pageview') and ev2.occurred_at <= p.created_at order by ev2.occurred_at desc limit 1) e on true
            where p.status = 'paid' and p.created_at >= since and e.path is not null and public.audience_ok(p.user_id, aud)
            group by e.path order by n desc limit 10) x),

    -- ------------------------------------------------------------- membership (the fuller reading is admin_members)
    'membership', (
      select jsonb_build_object(
        'active',  (select count(*) from public.subscriptions where status in ('active', 'trialing', 'past_due')),
        'mrr',     (select coalesce(sum(plan_amount), 0) from public.subscriptions where status in ('active', 'trialing', 'past_due')),
        'new',     (select count(*) from public.subscriptions where created_at >= since),
        'churned', (select count(*) from public.subscriptions where status = 'canceled' and updated_at >= since),
        'ending',  (select count(*) from public.subscriptions where cancel_at_period_end and status in ('active', 'trialing')))),

    -- ------------------------------------------------------------- diagnostic
    'diagnostic', jsonb_build_object(
      'rounds',  (select count(*) from public.results where computed_at >= since and public.audience_ok(user_id, aud)),
      'answers', (select count(*) from public.answers where answered_at >= since and public.audience_ok(user_id, aud)),
      'readers', (select count(distinct user_id) from public.answers where answered_at >= since and public.audience_ok(user_id, aud))),
    'tests', (
      select coalesce(jsonb_agg(jsonb_build_object('test', k.t, 'answers', k.a, 'rounds', k.r, 'readers', k.u) order by k.o), '[]'::jsonb)
      from (select u.t, u.o,
                   (select count(*) from public.answers a where a.test = u.t and a.answered_at >= since) as a,
                   (select count(*) from public.results r where r.test = u.t and r.computed_at >= since) as r,
                   (select count(distinct a.user_id) from public.answers a where a.test = u.t and a.answered_at >= since) as u
            from unnest(array['personality', 'diagnostics', 'blockages']) with ordinality as u(t, o)) k),
    'types', (
      select coalesce(jsonb_agg(jsonb_build_object('type', ty, 'readers', n) order by n desc, ty), '[]'::jsonb)
      from (select (latest.payload ->> 'type')::int as ty, count(*) as n
            from (select distinct on (user_id) user_id, payload from public.results where test = 'personality' and payload ? 'type' order by user_id, computed_at desc) latest
            group by 1) x),

    -- ------------------------------------------------------------ experiments
    'experiments', public.experiment_results()
  ) into result;

  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_members"("days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- the membership as a business: members now (a live subscription), free accounts, joined and lapsed in the window
-- against the window before, monthly recurring revenue (a weekly plan × 52 / 12), members a day over the window, and
-- what brought the joined — the last piece they opened in the seven days before (last touch, as admin_content
-- credits) and the channel of the session they joined in
declare
  d      integer := greatest(coalesce(days, 30), 1);
  since  timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  before timestamptz := now() - make_interval(days => 2 * greatest(coalesce(days, 30), 1));
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with subs as (
    select s.id, s.user_id, s.status, s.created_at, s.updated_at, s.sku,
           case when status in ('active', 'trialing', 'past_due') then coalesce(s.plan_amount, 0) * (case when p.period = 'weekly' then 52.0 / 12 else 1 end) else 0 end as monthly
    from public.subscriptions s
    left join lateral (select case when s.sku ~ 'week' then 'weekly' else 'monthly' end as period) p on true
  ),
  who as (select distinct user_id, anon_id from public.events where user_id is not null),
  joined as (
    select s.*, ch.channel, t.kind, t.id as piece, t.title
    from subs s
    left join lateral (
      select public.channel_of(f.ref, f.props -> 'utm') as channel
      from public.events f join who w on w.anon_id = f.anon_id and w.user_id = s.user_id
      where f.type = 'session_start' and f.occurred_at <= s.created_at + interval '5 minutes' and f.occurred_at >= s.created_at - interval '1 day'
      order by f.occurred_at desc limit 1) ch on true
    left join lateral (
      select v.props ->> 'kind' as kind, v.props ->> 'id' as id, nullif(v.props ->> 'title', '') as title
      from public.events v join who w on w.anon_id = v.anon_id and w.user_id = s.user_id
      where v.type = 'content_view' and v.occurred_at < s.created_at and v.occurred_at >= s.created_at - interval '7 days'
      order by v.occurred_at desc limit 1) t on true
    where s.created_at >= before
  )
  select jsonb_build_object(
    'members',  (select count(*) from subs where status in ('active', 'trialing', 'past_due')),
    'free',     (select count(*) from public.profiles p where not exists (select 1 from subs s where s.user_id = p.id and s.status in ('active', 'trialing', 'past_due'))),
    'mrr',      (select coalesce(round(sum(monthly)), 0) from subs),
    'currency', (select coalesce(min(currency), 'usd') from public.purchases where status = 'paid'),
    'now', jsonb_build_object(
      'joined', (select count(*) from joined where created_at >= since),
      'lapsed', (select count(*) from subs where status in ('canceled', 'unpaid', 'incomplete_expired') and updated_at >= since)),
    'prev', jsonb_build_object(
      'joined', (select count(*) from joined where created_at < since),
      'lapsed', (select count(*) from subs where status in ('canceled', 'unpaid', 'incomplete_expired') and updated_at >= before and updated_at < since)),
    'ending',   (select count(*) from public.subscriptions where cancel_at_period_end and status in ('active', 'trialing')),
    -- members a day: the live ones today, walked back by what joined and lapsed each day
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g.dd::date, 'joined', coalesce(j.n, 0), 'lapsed', coalesce(l.n, 0)) order by g.dd), '[]'::jsonb)
      from generate_series(since::date, now()::date, interval '1 day') as g(dd)
      left join (select created_at::date as dd, count(*) as n from subs where created_at >= since group by 1) j on j.dd = g.dd
      left join (select updated_at::date as dd, count(*) as n from subs where status in ('canceled', 'unpaid', 'incomplete_expired') and updated_at >= since group by 1) l on l.dd = g.dd),
    'by_content', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', piece, 'title', coalesce(title, piece), 'n', n) order by n desc), '[]'::jsonb)
      from (select kind, piece, max(title) as title, count(*) as n from joined where created_at >= since and piece is not null group by kind, piece order by n desc limit 8) x),
    'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'n', n) order by n desc), '[]'::jsonb)
      from (select coalesce(channel, 'unknown') as channel, count(*) as n from joined where created_at >= since group by 1 order by n desc) x),
    'by_plan', (select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'n', n) order by n desc), '[]'::jsonb)
      from (select coalesce(sku, '?') as sku, count(*) as n from subs where status in ('active', 'trialing', 'past_due') group by 1 order by n desc) x)
  ) into result;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_now"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- right now: the browsers that wrote an event in the last five minutes, the pages their last page view is on, and
-- the pieces opened in that time — near enough without a heartbeat, which would be an event a second
declare
  since timestamptz := now() - interval '5 minutes';
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  with recent as (select * from public.events where occurred_at >= since)
  select jsonb_build_object(
    'visitors', (select count(distinct anon_id) from recent),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('path', path, 'n', n) order by n desc), '[]'::jsonb)
              from (select path, count(distinct anon_id) as n from (select distinct on (anon_id) anon_id, path from recent where type = 'pageview' and path is not null order by anon_id, occurred_at desc) l group by path order by n desc limit 8) x),
    'pieces', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'title', title, 'path', path, 'n', n) order by n desc), '[]'::jsonb)
               from (select props ->> 'kind' as kind, props ->> 'id' as id, max(nullif(props ->> 'title', '')) as title, max(path) as path, count(distinct anon_id) as n
                     from recent where type = 'content_view' and props ? 'id' group by 1, 2 order by n desc limit 8) x)
  ) into result;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_piece"("kind" "text", "id" "text", "days" integer DEFAULT 30, "audience" "text" DEFAULT 'all'::"text", "tz" "text" DEFAULT 'UTC'::"text", "filters" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- one piece's page: views, visitors, engaged minutes, average time, read to the end and recirculation against the
-- window before; views a day since the first view on record; the channels and referrers of the sessions that opened
-- it; devices; new against returning readers; where reads ended in ten bands; what they read next (the next piece in
-- the same session); and the sign-ups, memberships and purchases credited to it (last touch, as admin_content
-- credits), each with the channel the person arrived by
declare
  d      integer := greatest(coalesce(days, 30), 1);
  since  timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  before timestamptz := now() - make_interval(days => 2 * greatest(coalesce(days, 30), 1));
  aud    text := coalesce(nullif(audience, ''), 'all');
  fl     jsonb := coalesce(filters, '{}'::jsonb) - 'source';
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with okses as (select s.session_id from public.session_facts(before) s where public.session_ok(s, fl, aud)),
  views as (
    select v.occurred_at, v.session_id, v.anon_id, v.user_id, v.occurred_at >= since as now_,
           lead(v.props ->> 'kind') over (partition by v.session_id order by v.occurred_at) as next_kind,
           lead(v.props ->> 'id') over (partition by v.session_id order by v.occurred_at) as next_id,
           lead(nullif(v.props ->> 'title', '')) over (partition by v.session_id order by v.occurred_at) as next_title,
           lead(v.path) over (partition by v.session_id order by v.occurred_at) as next_path,
           v.props ->> 'kind' as kind, v.props ->> 'id' as id
    from public.events v where v.type = 'content_view' and v.occurred_at >= before and v.session_id in (select session_id from okses)
  ),
  mine as (select * from views where views.kind = admin_piece.kind and views.id = admin_piece.id),
  reads as (
    select session_id, occurred_at >= since as now_, sum(greatest(0, (props ->> 'seconds')::numeric)) as seconds, max(least(100, greatest(0, (props ->> 'depth')::numeric))) as depth
    from public.events where type = 'content_read' and occurred_at >= before and props ->> 'kind' = admin_piece.kind and props ->> 'id' = admin_piece.id and session_id in (select session_id from okses)
    group by session_id, occurred_at >= since
  ),
  ses as (
    select m.session_id, min(m.anon_id::text)::uuid as anon_id, public.channel_of(f.ref, f.props -> 'utm') as channel,
           coalesce(nullif(substring(f.ref from '^(?:https?://)?([^/?#]+)'), ''), '(direct)') as ref, f.props ->> 'device' as device
    from mine m
    left join lateral (select ref, props from public.events e where e.session_id = m.session_id and e.type = 'session_start' order by e.occurred_at limit 1) f on true
    where m.now_ group by m.session_id, f.ref, f.props
  ),
  firsts as (select anon_id, min(occurred_at) as first_at from public.events group by anon_id),
  who as (select distinct user_id, anon_id from public.events where user_id is not null),
  conv as (
    select pr.id as user_id, pr.created_at as at, 'signup' as what, 0::numeric as amount from public.profiles pr where pr.created_at >= since and public.audience_ok(pr.id, aud)
    union all select user_id, created_at, 'subscription', coalesce(plan_amount, 0) from public.subscriptions where user_id is not null and created_at >= since and public.audience_ok(user_id, aud)
    union all select user_id, created_at, 'purchase', coalesce(amount_total, 0) from public.purchases where user_id is not null and status = 'paid' and created_at >= since and public.audience_ok(user_id, aud)
  ),
  touch as (
    select distinct on (c.user_id, c.at, c.what) c.what, c.amount, c.at, v.kind, v.id, v.session_id
    from conv c join who w on w.user_id = c.user_id
    join views v on v.anon_id = w.anon_id and v.occurred_at < c.at and v.occurred_at >= c.at - interval '7 days'
    order by c.user_id, c.at, c.what, v.occurred_at desc
  ),
  credited as (
    select t.*, public.channel_of(f.ref, f.props -> 'utm') as channel
    from touch t left join lateral (select ref, props from public.events e where e.session_id = t.session_id and e.type = 'session_start' order by e.occurred_at limit 1) f on true
    where t.kind = admin_piece.kind and t.id = admin_piece.id
  ),
  nums as (
    select m.now_, count(*) as views, count(distinct m.anon_id) as visitors,
           count(*) filter (where m.next_id is not null and (m.next_kind, m.next_id) is distinct from (m.kind, m.id)) as recirculated
    from mine m group by m.now_
  ),
  rnums as (select now_, count(*) as reads, coalesce(sum(seconds), 0) as seconds, coalesce(round(avg(seconds)), 0) as avg_seconds, count(*) filter (where depth >= 90) as finished from reads group by now_)
  select jsonb_build_object(
    'now', jsonb_build_object(
      'views', coalesce((select views from nums where now_), 0), 'visitors', coalesce((select visitors from nums where now_), 0),
      'recirculation', coalesce((select case when views = 0 then 0 else round(100.0 * recirculated / views) end from nums where now_), 0),
      'minutes', coalesce((select round(seconds / 60) from rnums where now_), 0), 'avg_seconds', coalesce((select avg_seconds from rnums where now_), 0),
      'finished', coalesce((select case when reads = 0 then 0 else round(100.0 * finished / reads) end from rnums where now_), 0), 'reads', coalesce((select reads from rnums where now_), 0)),
    'prev', jsonb_build_object(
      'views', coalesce((select views from nums where not now_), 0), 'visitors', coalesce((select visitors from nums where not now_), 0),
      'recirculation', coalesce((select case when views = 0 then 0 else round(100.0 * recirculated / views) end from nums where not now_), 0),
      'minutes', coalesce((select round(seconds / 60) from rnums where not now_), 0), 'avg_seconds', coalesce((select avg_seconds from rnums where not now_), 0),
      'finished', coalesce((select case when reads = 0 then 0 else round(100.0 * finished / reads) end from rnums where not now_), 0)),
    'first_seen', (select min(occurred_at) from public.events where type = 'content_view' and props ->> 'kind' = admin_piece.kind and props ->> 'id' = admin_piece.id),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g.dd::date, 'views', coalesce(v.n, 0), 'readers', coalesce(v.r, 0)) order by g.dd), '[]'::jsonb)
      from generate_series(before::date, now()::date, interval '1 day') as g(dd)
      left join (select occurred_at::date as dd, count(*) as n, count(distinct anon_id) as r from mine group by 1) v on v.dd = g.dd),
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'n', n) order by n desc), '[]'::jsonb) from (select channel, count(*) as n from ses group by 1) x),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'channel', channel, 'n', n) order by n desc), '[]'::jsonb) from (select ref, max(channel) as channel, count(*) as n from ses group by 1 order by n desc limit 10) x),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('device', device, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(device, 'unknown') as device, count(*) as n from ses group by 1) x),
    'new', (select count(distinct m.anon_id) from mine m join firsts f on f.anon_id = m.anon_id where m.now_ and f.first_at >= since),
    'returning', (select count(distinct m.anon_id) from mine m join firsts f on f.anon_id = m.anon_id where m.now_ and f.first_at < since),
    'depth', (select coalesce(jsonb_agg(jsonb_build_object('band', b, 'n', n) order by b), '[]'::jsonb)
      from (select least(9, floor(depth / 10))::integer as b, count(*) as n from reads where now_ group by 1) x),
    'next', (select coalesce(jsonb_agg(jsonb_build_object('kind', next_kind, 'id', next_id, 'title', title, 'path', path, 'n', n) order by n desc), '[]'::jsonb)
      from (select m.next_kind, m.next_id, max(m.next_title) as title, max(m.next_path) as path, count(*) as n from mine m
            where m.now_ and m.next_id is not null and (m.next_kind, m.next_id) is distinct from (m.kind, m.id) group by 1, 2 order by n desc limit 8) x),
    'currency', (select coalesce(min(currency), 'usd') from public.purchases where status = 'paid'),
    'conversions', jsonb_build_object(
      'signups', (select count(*) from credited where what = 'signup'), 'subscriptions', (select count(*) from credited where what = 'subscription'),
      'purchases', (select count(*) from credited where what = 'purchase'), 'revenue', (select coalesce(sum(amount), 0) from credited where what = 'purchase'),
      'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(channel, 'unknown') as channel, count(*) as n from credited group by 1) x))
  ) into result;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_series"("days" integer DEFAULT 30, "audience" "text" DEFAULT 'all'::"text", "filters" "jsonb" DEFAULT '{}'::"jsonb", "goals" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  d     integer := greatest(coalesce(days, 30), 1);
  since date := (now() - make_interval(days => greatest(coalesce(days, 30), 1) - 1))::date;
  aud   text := coalesce(nullif(audience, ''), 'all');
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'day', g.dd::date,
      'visitors',        coalesce(ev.visitors, 0),
      'pageviews',       coalesce(ev.pageviews, 0),
      'sessions',        coalesce(ev.sessions, 0),
      'users',           coalesce(ev.users, 0),
      'content_views',   coalesce(ev.content_views, 0),
      'cta_impressions', coalesce(ev.cta_impressions, 0),
      'cta_clicks',      coalesce(ev.cta_clicks, 0),
      'add_to_cart',     coalesce(ev.add_to_cart, 0),
      'checkouts',       coalesce(ev.checkouts, 0),
      'exposures',       coalesce(ev.exposures, 0),
      'signups',         coalesce(pf.n, 0),
      'purchases',       coalesce(pu.n, 0),
      'revenue',         coalesce(pu.rev, 0),
      'rounds',          coalesce(rs.n, 0),
      'answers',         coalesce(an.n, 0),
      'new_members',     coalesce(sb.n, 0),
      'find_starts',     coalesce(ev.find_starts, 0),
      'find_results',    coalesce(ev.find_results, 0)
    ) || coalesce(cg.o, '{}'::jsonb) order by g.dd), '[]'::jsonb)
  from generate_series(since, now()::date, interval '1 day') as g(dd)
  left join (
    select e.occurred_at::date as dd,
           count(distinct e.anon_id) as visitors,
           count(*) filter (where e.type = 'pageview') as pageviews,
           count(distinct e.session_id) as sessions,
           count(distinct e.user_id) filter (where e.user_id is not null) as users,
           count(*) filter (where e.type = 'content_view') as content_views,
           count(*) filter (where e.type = 'cta_impression') as cta_impressions,
           count(*) filter (where e.type = 'cta_click') as cta_clicks,
           count(*) filter (where e.type = 'click' and e.props ->> 'kind' = 'add_to_cart') as add_to_cart,
           count(*) filter (where e.type = 'click' and e.props ->> 'kind' in ('checkout', 'buy_now')) as checkouts,
           count(*) filter (where e.type = 'experiment') as exposures,
           count(*) filter (where e.type = 'find_start') as find_starts,
           count(*) filter (where e.type = 'find_result') as find_results
    from public.events e join public.session_facts(since::timestamptz) sf on sf.session_id = e.session_id
    where e.occurred_at >= since and public.session_ok(sf, coalesce(filters, '{}'::jsonb), aud)
    group by 1) ev on ev.dd = g.dd
  -- the site's own goals, each a column named by its key
  left join lateral (select jsonb_object_agg(z.key, z.n) as o from (
    select gl.value ->> 'key' as key, count(*) as n from jsonb_array_elements(case when jsonb_typeof(goals) = 'array' then goals else '[]'::jsonb end) gl
    join public.events e on e.type = gl.value ->> 'key' and e.occurred_at::date = g.dd and e.occurred_at >= since
    join public.session_facts(since::timestamptz) sf on sf.session_id = e.session_id and public.session_ok(sf, coalesce(filters, '{}'::jsonb), aud)
    group by 1) z) cg on true
  left join (select created_at::date as dd, count(*) as n from public.profiles where created_at >= since and public.audience_ok(id, aud) group by 1) pf on pf.dd = g.dd
  left join (select created_at::date as dd, count(*) as n, coalesce(sum(amount_total), 0) as rev
             from public.purchases where status = 'paid' and created_at >= since and public.audience_ok(user_id, aud) group by 1) pu on pu.dd = g.dd
  left join (select computed_at::date as dd, count(*) as n from public.results where computed_at >= since group by 1) rs on rs.dd = g.dd
  left join (select answered_at::date as dd, count(*) as n from public.answers where answered_at >= since group by 1) an on an.dd = g.dd
  left join (select created_at::date as dd, count(*) as n from public.subscriptions where created_at >= since group by 1) sb on sb.dd = g.dd
  into result;

  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_support"("days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  since timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  result jsonb;
begin
  if not public.may_see_figures() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'shown',   (select count(*) from public.events where type = 'support_prompt' and occurred_at >= since),
    'chosen',  (select count(*) from public.events where type = 'support_choice' and occurred_at >= since),
    'started', (select count(*) from public.events where type = 'support_start' and occurred_at >= since),
    'people',  (select count(distinct coalesce(user_id::text, anon_id::text)) from public.events where type in ('support_choice', 'support_start') and occurred_at >= since),
    -- threads begun, by where they came from: a prompt (which), or the reader's own opening
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object('prompt', prompt, 'n', n) order by n desc), '[]'::jsonb)
      from (select coalesce(props ->> 'prompt', '') as prompt, count(*) as n
            from public.events where type = 'support_start' and occurred_at >= since group by 1) x),
    -- each prompt: how often shown (by how), and every choice by how often it was picked
    'prompts', (
      select coalesce(jsonb_agg(jsonb_build_object('prompt', p.prompt, 'text', p.text, 'shown', p.shown, 'teased', p.teased, 'chosen', coalesce(c.chosen, 0), 'started', coalesce(s.started, 0), 'choices', coalesce(c.choices, '[]'::jsonb)) order by p.shown desc), '[]'::jsonb)
      from (select props ->> 'prompt' as prompt, max(props ->> 'text') as text, count(*) as shown, count(*) filter (where props ->> 'how' = 'teaser') as teased
            from public.events where type = 'support_prompt' and occurred_at >= since group by 1) p
      left join (select prompt, sum(n) as chosen, jsonb_agg(jsonb_build_object('choice', choice, 'text', text, 'n', n) order by n desc) as choices
                 from (select props ->> 'prompt' as prompt, props ->> 'choice' as choice, max(props ->> 'text') as text, count(*) as n
                       from public.events where type = 'support_choice' and occurred_at >= since group by 1, 2) y group by prompt) c on c.prompt = p.prompt
      left join (select props ->> 'prompt' as prompt, count(*) as started from public.events where type = 'support_start' and occurred_at >= since group by 1) s on s.prompt = p.prompt)
  ) into result;
  return result;
end;
$$;

CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" bigint NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "anon_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "path" "text",
    "topic_slugs" "text"[],
    "ref" "text",
    "props" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text",
    "distinct_id" "text",
    CONSTRAINT "events_type_check" CHECK (("type" ~ '^[A-Za-z$][A-Za-z0-9_$:. -]{0,63}$'::"text"))
);

CREATE OR REPLACE FUNCTION "public"."experiment_converted"("e" "public"."events") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1 from public.events g
    where g.session_id = e.session_id and g.occurred_at >= e.occurred_at
      and ((coalesce(e.props ->> 'goal_type', 'pageview') = 'pageview' and g.type = 'pageview' and g.path = e.props ->> 'goal')
        or (e.props ->> 'goal_type' = 'cta_click' and g.type = 'cta_click' and g.props ->> 'ad_id' = e.props ->> 'goal')))
$$;

CREATE OR REPLACE FUNCTION "public"."experiment_results"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('experiment', x.ex, 'started_at', x.started, 'variants', public.experiment_variants(x.ex)) order by x.started desc)
    from (select props ->> 'experiment' as ex, min(occurred_at) as started
          from public.events where type = 'experiment' group by 1) x), '[]'::jsonb)
$$;

CREATE OR REPLACE FUNCTION "public"."experiment_state"("name" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'experiment', name,
    'started_at', (select min(occurred_at) from public.events where type = 'experiment' and props ->> 'experiment' = name),
    'variants', public.experiment_variants(name)
  );
$$;

CREATE OR REPLACE FUNCTION "public"."experiment_variants"("name" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('variant', v, 'exposures', ex, 'conversions', cv) order by v)
    from (
      select e.props ->> 'variant' as v,
             count(distinct e.session_id) as ex,
             count(distinct e.session_id) filter (where public.experiment_converted(e)) as cv
      from public.events e
      where e.type = 'experiment' and e.props ->> 'experiment' = name
      group by 1) x), '[]'::jsonb)
$$;

CREATE OR REPLACE FUNCTION "public"."find_words"("k" "text", "since" timestamp with time zone, "lim" integer DEFAULT 8) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object('word', w, 'n', n) order by n desc, w), '[]'::jsonb)
  from (
    select w, count(*) as n
    from (select lower(regexp_split_to_table(props ->> k, '[^A-Za-z'']+')) as w
          from public.events where type = 'find_result' and occurred_at >= since) t
    where length(w) >= 3
      and w not in ('and','are','but','for','from','has','have','how','into','its','just','not','our','than','that','the','their','them','then','there','these','they','this','too','very','was','what','when','where','which','who','why','will','with','would','you','your','about','all','can','get','got','out','some','being','been','feel','feeling','like','lately','most','much','thing','things','life','instantly','problem','would','could','really','always','never','myself','because','ever','every')
    group by w order by n desc, w limit lim) x;
$$;

ALTER TABLE "public"."events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");

CREATE INDEX "events_book_quiz_idx" ON "public"."events" USING "btree" ((("props" ->> 'slug'::"text"))) WHERE ("type" = 'book_quiz'::"text");

CREATE INDEX "events_experiment_idx" ON "public"."events" USING "btree" ((("props" ->> 'experiment'::"text"))) WHERE ("type" = 'experiment'::"text");

CREATE INDEX "events_path_time_idx" ON "public"."events" USING "btree" ("path", "occurred_at" DESC);

CREATE INDEX "events_session_idx" ON "public"."events" USING "btree" ("session_id", "occurred_at");

CREATE INDEX "events_source_time_idx" ON "public"."events" USING "btree" ("source", "occurred_at" DESC);

CREATE INDEX "events_topics_gin" ON "public"."events" USING "gin" ("topic_slugs");

CREATE INDEX "events_type_time_idx" ON "public"."events" USING "btree" ("type", "occurred_at" DESC);

CREATE INDEX "events_user_idx" ON "public"."events" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_insert_self" ON "public"."events" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("user_id" IS NULL) OR ("user_id" = "auth"."uid"())));

GRANT ALL ON FUNCTION "public"."admin_find"("days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_find"("days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_find"("days" integer) TO "service_role";

GRANT ALL ON FUNCTION "public"."admin_kpis"("days" integer, "audience" "text", "tz" "text", "filters" "jsonb", "goals" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_kpis"("days" integer, "audience" "text", "tz" "text", "filters" "jsonb", "goals" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_kpis"("days" integer, "audience" "text", "tz" "text", "filters" "jsonb", "goals" "jsonb") TO "service_role";

GRANT ALL ON FUNCTION "public"."admin_series"("days" integer, "audience" "text", "filters" "jsonb", "goals" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_series"("days" integer, "audience" "text", "filters" "jsonb", "goals" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_series"("days" integer, "audience" "text", "filters" "jsonb", "goals" "jsonb") TO "service_role";

GRANT ALL ON FUNCTION "public"."admin_support"("days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_support"("days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_support"("days" integer) TO "service_role";

GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";

GRANT ALL ON FUNCTION "public"."experiment_converted"("e" "public"."events") TO "anon";
GRANT ALL ON FUNCTION "public"."experiment_converted"("e" "public"."events") TO "authenticated";
GRANT ALL ON FUNCTION "public"."experiment_converted"("e" "public"."events") TO "service_role";

GRANT ALL ON FUNCTION "public"."experiment_results"() TO "anon";
GRANT ALL ON FUNCTION "public"."experiment_results"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."experiment_results"() TO "service_role";

GRANT ALL ON FUNCTION "public"."experiment_state"("name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."experiment_state"("name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."experiment_state"("name" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."experiment_variants"("name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."experiment_variants"("name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."experiment_variants"("name" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."find_words"("k" "text", "since" timestamp with time zone, "lim" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."find_words"("k" "text", "since" timestamp with time zone, "lim" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_words"("k" "text", "since" timestamp with time zone, "lim" integer) TO "service_role";

GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "service_role";

GRANT ALL ON FUNCTION "public"."admin_members"("days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_members"("days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_members"("days" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_now"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_now"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_now"() TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_piece"("kind" "text", "id" "text", "days" integer, "audience" "text", "tz" "text", "filters" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_piece"("kind" "text", "id" "text", "days" integer, "audience" "text", "tz" "text", "filters" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_piece"("kind" "text", "id" "text", "days" integer, "audience" "text", "tz" "text", "filters" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."audience_ok"("uid" "uuid", "audience" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."audience_ok"("uid" "uuid", "audience" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."audience_ok"("uid" "uuid", "audience" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."channel_of"("ref" "text", "utm" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."channel_of"("ref" "text", "utm" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."channel_of"("ref" "text", "utm" "jsonb") TO "service_role";

GRANT ALL ON FUNCTION "public"."admin_events"("days" integer, "audience" "text", "filters" "jsonb", "event" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_events"("days" integer, "audience" "text", "filters" "jsonb", "event" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_events"("days" integer, "audience" "text", "filters" "jsonb", "event" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."admin_retention"("weeks" integer, "audience" "text", "filters" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_retention"("weeks" integer, "audience" "text", "filters" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_retention"("weeks" integer, "audience" "text", "filters" "jsonb") TO "service_role";

GRANT ALL ON FUNCTION "public"."session_facts"("since" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."session_facts"("since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."session_facts"("since" timestamp with time zone) TO "service_role";

GRANT ALL ON FUNCTION "public"."session_ok"("s" "public"."session_fact", "filters" "jsonb", "audience" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."session_ok"("s" "public"."session_fact", "filters" "jsonb", "audience" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."session_ok"("s" "public"."session_fact", "filters" "jsonb", "audience" "text") TO "service_role";
