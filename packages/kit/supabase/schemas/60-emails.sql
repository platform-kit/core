-- emails: funnels and blasts: the audience, the log, the links, who is where in a funnel
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."admin_funnel"("kind" "text", "name" "text", "days" integer DEFAULT 30, "steps" "jsonb" DEFAULT '[]'::"jsonb", "rules" "jsonb" DEFAULT NULL::"jsonb", "goal" "text" DEFAULT NULL::"text", "tz" "text" DEFAULT 'UTC'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- one funnel or blast, read for an administrator: the window's tiles against the window before, a series a
-- day, the journey step by step (sent · opened · clicked · goal · unsubscribed per email step; what waits,
-- is held or has left the audience between them — states now, not the window's), a step's detail (links by
-- destination, versions, the hour × weekday of opens in the administrator's zone, the median time to open,
-- the share read on a phone), a chat step's prompt numbers, and the conversions credited last touch: a paid
-- purchase, a subscription or a page view of the goal in the seven days after a send goes to the last email
-- of this funnel the person clicked before it, else the last they opened, else nowhere. `steps` is the funnel
-- as the admin lists it ([{ id, after, channel }] in order; a blast is one step), since the database never
-- holds a funnel's shape; `rules` its normalised audience, for who still matches.
declare
  d      integer := greatest(coalesce(days, 30), 1);
  since  timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  before timestamptz := now() - make_interval(days => 2 * greatest(coalesce(days, 30), 1));
  zone   text := coalesce(nullif(tz, ''), 'UTC');
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  begin perform now() at time zone zone; exception when others then zone := 'UTC'; end;

  with st as (
    -- the steps as given, and each email step's place among the emails (what funnel_members.step counts)
    select (s.value ->> 'id') as id, coalesce((s.value ->> 'after')::numeric, 0) as after, coalesce(s.value ->> 'channel', 'email') as channel, s.ord - 1 as ord,
           case when coalesce(s.value ->> 'channel', 'email') = 'chat' then null
                else (count(*) filter (where coalesce(s.value ->> 'channel', 'email') <> 'chat') over (order by s.ord) - 1) end as k
    from jsonb_array_elements(coalesce(steps, '[]'::jsonb)) with ordinality as s(value, ord)
  ),
  sends as (
    select l.id, l.user_id, l.step, l.email_id, l.version, l.sent_at, l.opened_at, l.clicked_at, l.unsubscribed_at, l.sent_at >= since as now_
    from public.email_log l where l.kind = admin_funnel.kind and l.name = admin_funnel.name and l.sent_at is not null and l.sent_at >= before
  ),
  -- the journey follows a cohort: the people who entered the funnel in the window, however far its emails have carried them
  -- since (so a later step never outnumbers the one before it); a blast's cohort is everyone sent it in the window
  jsends as (
    select l.id, l.user_id, l.email_id, l.version, l.sent_at, l.opened_at, l.clicked_at, l.unsubscribed_at
    from public.email_log l where l.kind = admin_funnel.kind and l.name = admin_funnel.name and l.sent_at is not null
      and (case when admin_funnel.kind = 'funnel' then exists (select 1 from public.funnel_members m where m.funnel = admin_funnel.name and m.user_id = l.user_id and m.entered_at >= since) else l.sent_at >= since end)
  ),
  conv as (
    -- every conversion by someone this funnel wrote to, credited to one of its sends (or to none, and dropped)
    select c.ckind, c.at, c.amount, s.id as send_id, s.email_id, s.now_, c.at >= since as cnow, exists (select 1 from jsends j where j.id = s.id) as cohort
    from (
      select 'purchase' as ckind, pu.user_id, pu.created_at as at, coalesce(pu.amount_total, 0) as amount from public.purchases pu where pu.status = 'paid' and pu.user_id is not null and pu.created_at >= before
      union all
      select 'subscription', su.user_id, su.created_at, 0 from public.subscriptions su where su.created_at >= before
      union all
      select 'goal', e.user_id, e.occurred_at, 0 from public.events e where goal is not null and e.type = 'pageview' and e.user_id is not null and e.path = goal and e.occurred_at >= before
    ) c
    cross join lateral (
      select l.id, l.email_id, l.sent_at >= since as now_
      from public.email_log l
      where l.kind = admin_funnel.kind and l.name = admin_funnel.name and l.user_id = c.user_id and l.sent_at is not null
        and l.sent_at > c.at - interval '7 days' and l.sent_at <= c.at
        and ((l.clicked_at is not null and l.clicked_at <= c.at) or (l.opened_at is not null and l.opened_at <= c.at))
      order by (l.clicked_at is not null and l.clicked_at <= c.at) desc,
               case when l.clicked_at is not null and l.clicked_at <= c.at then l.clicked_at else l.opened_at end desc
      limit 1
    ) s
  ),
  members as (
    select m.user_id, m.entered_at, m.step, m.last_sent_at, m.done_at from public.funnel_members m where admin_funnel.kind = 'funnel' and m.funnel = admin_funnel.name
  ),
  pending as (
    -- who is between two emails now: their next email step, when it is due, and whether they still match
    select m.user_id, m.step as k, st.id as next_id,
           coalesce(case when m.step = 0 then m.entered_at else coalesce(m.last_sent_at, m.entered_at) end, m.entered_at) + st.after * interval '1 day' as due_at,
           -- still in the audience: matching the rules (when given) and not opted out, which the runner's audience never returns
           (case when rules is null then true else public.email_audience_match(m.user_id, rules) end) and not exists (select 1 from public.profiles p where p.id = m.user_id and p.email_opt_out_at is not null) as matches
    from members m join st on st.k = m.step
    where m.done_at is null
  ),
  tiles as (
    select now_, count(*) as sent, count(opened_at) as opened, count(clicked_at) as clicked, count(unsubscribed_at) as unsubscribed from sends group by now_
  ),
  ctiles as (
    select cnow, count(*) filter (where ckind <> 'goal') as conversions, count(*) filter (where ckind = 'goal') as goals, coalesce(sum(amount) filter (where ckind = 'purchase'), 0) as revenue from conv group by cnow
  )
  select jsonb_build_object(
    'now', jsonb_build_object(
      'entered', (select count(*) from members where entered_at >= since),
      'active', (select count(*) from members where done_at is null),
      'done', (select count(*) from members where done_at >= since),
      'done_ever', (select count(*) from members where done_at is not null),
      'entered_ever', (select count(*) from members),
      'sent', coalesce((select sent from tiles where now_), 0), 'opened', coalesce((select opened from tiles where now_), 0),
      'clicked', coalesce((select clicked from tiles where now_), 0), 'unsubscribed', coalesce((select unsubscribed from tiles where now_), 0),
      'goal', coalesce((select goals from ctiles where cnow), 0), 'conversions', coalesce((select conversions from ctiles where cnow), 0), 'revenue', coalesce((select revenue from ctiles where cnow), 0)),
    'prev', jsonb_build_object(
      'entered', (select count(*) from members where entered_at >= before and entered_at < since),
      'done', (select count(*) from members where done_at >= before and done_at < since),
      'sent', coalesce((select sent from tiles where not now_), 0), 'opened', coalesce((select opened from tiles where not now_), 0),
      'clicked', coalesce((select clicked from tiles where not now_), 0), 'unsubscribed', coalesce((select unsubscribed from tiles where not now_), 0),
      'goal', coalesce((select goals from ctiles where not cnow), 0), 'conversions', coalesce((select conversions from ctiles where not cnow), 0), 'revenue', coalesce((select revenue from ctiles where not cnow), 0)),
    'currency', (select coalesce(min(currency), 'usd') from public.purchases where status = 'paid'),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g.dd::date,
        'entered', (select count(*) from members where entered_at::date = g.dd::date),
        'sent', (select count(*) from sends where sent_at::date = g.dd::date),
        'opened', (select count(*) from sends where opened_at::date = g.dd::date),
        'clicked', (select count(*) from sends where clicked_at::date = g.dd::date)) order by g.dd), '[]'::jsonb)
      from generate_series(before::date, now()::date, interval '1 day') as g(dd)),
    'steps', (select coalesce(jsonb_agg(
      case when st.channel = 'chat' then jsonb_build_object('id', st.id, 'channel', 'chat',
        'shown', (select count(*) from public.events e where e.type = 'support_prompt' and e.props ->> 'prompt' = st.id and e.occurred_at >= since),
        'teased', (select count(*) from public.events e where e.type = 'support_prompt' and e.props ->> 'prompt' = st.id and e.props ->> 'how' = 'teaser' and e.occurred_at >= since),
        'text', (select max(e.props ->> 'text') from public.events e where e.type = 'support_prompt' and e.props ->> 'prompt' = st.id and e.occurred_at >= since),
        'chosen', (select count(*) from public.events e where e.type = 'support_choice' and e.props ->> 'prompt' = st.id and e.occurred_at >= since),
        'started', (select count(*) from public.events e where e.type = 'support_start' and e.props ->> 'prompt' = st.id and e.occurred_at >= since),
        'people', (select count(distinct coalesce(e.user_id::text, e.anon_id::text)) from public.events e where e.type in ('support_choice', 'support_start') and e.props ->> 'prompt' = st.id and e.occurred_at >= since),
        'choices', (select coalesce(jsonb_agg(jsonb_build_object('choice', y.choice, 'text', y.text, 'n', y.n) order by y.n desc), '[]'::jsonb)
                    from (select e.props ->> 'choice' as choice, max(e.props ->> 'text') as text, count(*) as n from public.events e
                          where e.type = 'support_choice' and e.props ->> 'prompt' = st.id and e.occurred_at >= since group by 1) y))
      else jsonb_build_object('id', st.id, 'channel', 'email', 'k', st.k,
        'sent', (select count(*) from jsends s where s.email_id::text = st.id),
        'opened', (select count(opened_at) from jsends s where s.email_id::text = st.id),
        'clicked', (select count(clicked_at) from jsends s where s.email_id::text = st.id),
        'unsubscribed', (select count(unsubscribed_at) from jsends s where s.email_id::text = st.id),
        'goal', (select count(*) from conv c where c.email_id::text = st.id and c.cohort and c.ckind = 'goal'),
        'conversions', (select count(*) from conv c where c.email_id::text = st.id and c.cohort and c.ckind <> 'goal'),
        'revenue', (select coalesce(sum(amount), 0) from conv c where c.email_id::text = st.id and c.cohort and c.ckind = 'purchase'),
        -- between: who is waiting for this step, held before it, or has left the audience while it was next
        'waiting', (select count(*) from pending p where p.next_id = st.id and p.matches and p.due_at >= now()),
        'held', (select count(*) from pending p where p.next_id = st.id and p.matches and p.due_at < now()),
        'left', (select count(*) from pending p where p.next_id = st.id and not p.matches),
        'links', (select coalesce(jsonb_agg(jsonb_build_object('url', x.url, 'clicks', x.clicks, 'people', x.people) order by x.clicks desc), '[]'::jsonb)
                  from (select k.url, sum(k.hits) as clicks, count(distinct k.log_id) filter (where k.hits > 0) as people
                        from public.email_links k join jsends s on s.id = k.log_id where k.kind = 'click' and s.email_id::text = st.id and k.hits > 0
                        group by k.url order by clicks desc limit 12) x),
        'versions', (select case when count(*) > 1 then jsonb_agg(jsonb_build_object('version', v.version, 'sent', v.sent, 'opened', v.opened, 'clicked', v.clicked, 'first', v.first) order by v.first) else '[]'::jsonb end
                     from (select coalesce(s.version, '') as version, count(*) as sent, count(opened_at) as opened, count(clicked_at) as clicked, min(sent_at) as first
                           from jsends s where s.email_id::text = st.id group by coalesce(s.version, '')) v),
        'hours', (select coalesce(jsonb_agg(jsonb_build_array(h.dow, h.hr, h.n)), '[]'::jsonb)
                  from (select extract(dow from (e.at at time zone zone))::integer as dow, extract(hour from (e.at at time zone zone))::integer as hr, count(*) as n
                        from public.email_events e join jsends s on s.id = e.log_id where e.kind = 'open' and s.email_id::text = st.id group by 1, 2) h),
        'to_open', (select round((percentile_cont(0.5) within group (order by extract(epoch from s.opened_at - s.sent_at) / 3600))::numeric, 1)
                    from jsends s where s.email_id::text = st.id and s.opened_at is not null),
        'phone', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where e.ua ~* '(iphone|ipad|android.*mobile|mobile)') / count(*)) end
                  from public.email_events e join jsends s on s.id = e.log_id where e.kind = 'open' and s.email_id::text = st.id))
      end order by st.ord), '[]'::jsonb) from st),
    'done', (select count(*) from members where done_at is not null)
  ) into result;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_funnels"("days" integer DEFAULT 30, "goals" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
-- every funnel and blast at once, for an administrator: the window's sent · opened · clicked · unsubscribed
-- · conversions · revenue against the window before, a series a day, and one item per funnel or blast the log
-- or the members know (the admin lays them over the files' list, so a funnel that never sent still has a
-- card). A conversion here is credited once, to the last email of any funnel or blast the person clicked in
-- the seven days before it, else the last opened; `goals` maps "<kind>:<name>" to that funnel's goal path,
-- and a page view of it by someone written to counts as that funnel's alone. Never a row per person.
declare
  d      integer := greatest(coalesce(days, 30), 1);
  since  timestamptz := now() - make_interval(days => greatest(coalesce(days, 30), 1));
  before timestamptz := now() - make_interval(days => 2 * greatest(coalesce(days, 30), 1));
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with sends as (
    select l.id, l.user_id, l.kind, l.name, l.sent_at, l.opened_at, l.clicked_at, l.unsubscribed_at, l.sent_at >= since as now_
    from public.email_log l where l.sent_at is not null and l.sent_at >= before
  ),
  conv as (
    select c.ckind, c.at, c.amount, s.kind, s.name, c.at >= since as cnow
    from (
      select 'purchase' as ckind, pu.user_id, pu.created_at as at, coalesce(pu.amount_total, 0) as amount, null::text as fk, null::text as fn from public.purchases pu where pu.status = 'paid' and pu.user_id is not null and pu.created_at >= before
      union all
      select 'subscription', su.user_id, su.created_at, 0, null, null from public.subscriptions su where su.created_at >= before
      union all
      select 'goal', e.user_id, e.occurred_at, 0, split_part(g.key, ':', 1), substr(g.key, length(split_part(g.key, ':', 1)) + 2)
      from jsonb_each_text(coalesce(goals, '{}'::jsonb)) g join public.events e on e.type = 'pageview' and e.user_id is not null and e.path = g.value and e.occurred_at >= before
    ) c
    cross join lateral (
      select l.kind, l.name
      from public.email_log l
      where l.user_id = c.user_id and l.sent_at is not null and l.sent_at > c.at - interval '7 days' and l.sent_at <= c.at
        and (c.fk is null or (l.kind = c.fk and l.name = c.fn))
        and ((l.clicked_at is not null and l.clicked_at <= c.at) or (l.opened_at is not null and l.opened_at <= c.at))
      order by (l.clicked_at is not null and l.clicked_at <= c.at) desc,
               case when l.clicked_at is not null and l.clicked_at <= c.at then l.clicked_at else l.opened_at end desc
      limit 1
    ) s
  ),
  tiles as (
    select now_, count(*) as sent, count(opened_at) as opened, count(clicked_at) as clicked, count(unsubscribed_at) as unsubscribed from sends group by now_
  ),
  ctiles as (
    select cnow, count(*) as conversions, coalesce(sum(amount) filter (where ckind = 'purchase'), 0) as revenue from conv group by cnow
  ),
  names as (
    select kind, name from public.email_log group by kind, name
    union
    select 'funnel', funnel from public.funnel_members group by funnel
  )
  select jsonb_build_object(
    'now', jsonb_build_object(
      'sent', coalesce((select sent from tiles where now_), 0), 'opened', coalesce((select opened from tiles where now_), 0),
      'clicked', coalesce((select clicked from tiles where now_), 0), 'unsubscribed', coalesce((select unsubscribed from tiles where now_), 0),
      'conversions', coalesce((select conversions from ctiles where cnow), 0), 'revenue', coalesce((select revenue from ctiles where cnow), 0)),
    'prev', jsonb_build_object(
      'sent', coalesce((select sent from tiles where not now_), 0), 'opened', coalesce((select opened from tiles where not now_), 0),
      'clicked', coalesce((select clicked from tiles where not now_), 0), 'unsubscribed', coalesce((select unsubscribed from tiles where not now_), 0),
      'conversions', coalesce((select conversions from ctiles where not cnow), 0), 'revenue', coalesce((select revenue from ctiles where not cnow), 0)),
    'currency', (select coalesce(min(currency), 'usd') from public.purchases where status = 'paid'),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', g.dd::date,
        'sent', (select count(*) from sends where sent_at::date = g.dd::date),
        'opened', (select count(*) from sends where opened_at::date = g.dd::date),
        'clicked', (select count(*) from sends where clicked_at::date = g.dd::date)) order by g.dd), '[]'::jsonb)
      from generate_series(before::date, now()::date, interval '1 day') as g(dd)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'name', n.name,
        'sent', (select count(*) from sends s where s.kind = n.kind and s.name = n.name and s.now_),
        'opened', (select count(opened_at) from sends s where s.kind = n.kind and s.name = n.name and s.now_),
        'clicked', (select count(clicked_at) from sends s where s.kind = n.kind and s.name = n.name and s.now_),
        'unsubscribed', (select count(unsubscribed_at) from sends s where s.kind = n.kind and s.name = n.name and s.now_),
        'conversions', (select count(*) from conv c where c.kind = n.kind and c.name = n.name and c.cnow),
        'revenue', (select coalesce(sum(amount), 0) from conv c where c.kind = n.kind and c.name = n.name and c.cnow and c.ckind = 'purchase'),
        'active', (select count(*) from public.funnel_members m where n.kind = 'funnel' and m.funnel = n.name and m.done_at is null),
        'done', (select count(*) from public.funnel_members m where n.kind = 'funnel' and m.funnel = n.name and m.done_at is not null),
        'last', (select max(sent_at) from public.email_log l where l.kind = n.kind and l.name = n.name))), '[]'::jsonb) from names n),
    -- the chat prompts by the funnel they belong to (the events carry it): shown, picked, threads begun
    'prompts', (select coalesce(jsonb_object_agg(x.funnel, jsonb_build_object('shown', x.shown, 'chosen', x.chosen, 'started', x.started)), '{}'::jsonb)
      from (select props ->> 'funnel' as funnel, count(*) filter (where type = 'support_prompt') as shown, count(*) filter (where type = 'support_choice') as chosen, count(*) filter (where type = 'support_start') as started
            from public.events where type in ('support_prompt', 'support_choice', 'support_start') and occurred_at >= since and props ->> 'funnel' is not null group by 1) x),
    'opted_out', (select count(*) from public.profiles where email_opt_out_at is not null),
    'reachable', (select count(*) from public.profiles where email is not null and email <> '' and email_opt_out_at is null)
  ) into result;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."email_audience"("rules" "jsonb") RETURNS TABLE("user_id" "uuid", "email" "text", "name" "text", "last_active" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id, p.email, p.display_name,
    greatest(p.updated_at, p.created_at,
      coalesce((select max(e.occurred_at) from public.events e where e.user_id = p.id), p.created_at),
      coalesce((select max(a.answered_at) from public.answers a where a.user_id = p.id), p.created_at)) as last_active
  from public.profiles p
  where p.email is not null and p.email <> '' and p.email_opt_out_at is null
    and public.email_audience_match(p.id, rules)
$$;

CREATE OR REPLACE FUNCTION "public"."email_audience_count"("rules" "jsonb") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_admin() then (select count(*)::integer from public.email_audience(rules)) else null end
$$;

CREATE OR REPLACE FUNCTION "public"."email_audience_match"("uid" "uuid", "rules" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with b as (
    select p.id, p.created_at, p.email_verified_at, case when coalesce(array_length(p.roles, 1), 0) > 0 then p.roles when p.role is not null and p.role <> 'user' then array[p.role] else array[]::text[] end as roles,
      greatest(p.updated_at, p.created_at,
        coalesce((select max(e.occurred_at) from public.events e where e.user_id = p.id), p.created_at),
        coalesce((select max(a.answered_at) from public.answers a where a.user_id = p.id), p.created_at)) as last_active,
      (select max(pu.created_at) from public.purchases pu where pu.user_id = p.id and pu.status = 'paid') as last_purchase,
      (select max(bk.start_at) from public.bookings bk where bk.user_id = p.id and bk.status = 'accepted' and coalesce(bk.no_show, false) = false and bk.start_at < now()) as last_session,
      (select s.working from public.signals s where s.user_id = p.id) as working,
      (select array_agg(distinct en.tier) from public.entitlements en where en.user_id = p.id and en.kind = 'class' and en.key = 'subscribed' and en.active and (en.expires_at is null or en.expires_at > now())) as tiers
    from public.profiles p where p.id = uid
  )
  select coalesce((select
    (rules->'inactive' is null or (
      (rules->'inactive'->>'min' is null or extract(epoch from now() - b.last_active) / 86400 >= (rules->'inactive'->>'min')::numeric) and
      (rules->'inactive'->>'max' is null or extract(epoch from now() - b.last_active) / 86400 <= (rules->'inactive'->>'max')::numeric)))
    and (rules->'signed_up' is null or (
      (rules->'signed_up'->>'min' is null or extract(epoch from now() - b.created_at) / 86400 >= (rules->'signed_up'->>'min')::numeric) and
      (rules->'signed_up'->>'max' is null or extract(epoch from now() - b.created_at) / 86400 <= (rules->'signed_up'->>'max')::numeric)))
    and (rules->'since_purchase' is null or (
      case when (rules->'since_purchase'->>'none')::boolean then b.last_purchase is null else
        b.last_purchase is not null and
        (rules->'since_purchase'->>'min' is null or extract(epoch from now() - b.last_purchase) / 86400 >= (rules->'since_purchase'->>'min')::numeric) and
        (rules->'since_purchase'->>'max' is null or extract(epoch from now() - b.last_purchase) / 86400 <= (rules->'since_purchase'->>'max')::numeric) end))
    and (rules->'since_session' is null or (
      case when (rules->'since_session'->>'none')::boolean then b.last_session is null else
        b.last_session is not null and
        (rules->'since_session'->>'min' is null or extract(epoch from now() - b.last_session) / 86400 >= (rules->'since_session'->>'min')::numeric) and
        (rules->'since_session'->>'max' is null or extract(epoch from now() - b.last_session) / 86400 <= (rules->'since_session'->>'max')::numeric) end))
    and (rules->'subscription' is null or exists (
      select 1 from jsonb_array_elements_text(rules->'subscription') t(v)
      where (t.v = 'none' and coalesce(array_length(b.tiers, 1), 0) = 0)
         or (t.v = 'any' and coalesce(array_length(b.tiers, 1), 0) > 0)
         or (t.v not in ('none', 'any') and t.v = any(coalesce(b.tiers, '{}')))))
    and (rules->'interest' is null or exists (
      select 1 from jsonb_array_elements_text(rules->'interest') t(v)
      where exists (select 1 from public.answers a where a.user_id = b.id and a.test = 'diagnostics' and a.value->>'d' = t.v)
         or exists (select 1 from public.events e where e.user_id = b.id and e.topic_slugs @> array[t.v])
         or exists (select 1 from public.signals s where s.user_id = b.id and t.v = any(s.areas))))
    and (rules->'level' is null or b.working is not null and b.working = any(array(select jsonb_array_elements_text(rules->'level'))))
    and (rules->'answered' is null or not exists (
      select 1 from jsonb_array_elements(rules->'answered') r
      where not exists (
        select 1 from public.answers a where a.user_id = b.id and a.item_id = r->>'item'
          and (r->>'truth' is null or a.value->>'truth' = r->>'truth')
          and (r->>'charge' is null or coalesce(a.value->>'charge', 'clear') = r->>'charge'))))
    and (rules->'bought' is null or exists (
      select 1 from public.purchases pu where pu.user_id = b.id and pu.status = 'paid' and pu.sku = any(array(select jsonb_array_elements_text(rules->'bought')))))
    and (rules->'not_bought' is null or not exists (
      select 1 from public.purchases pu where pu.user_id = b.id and pu.status = 'paid' and pu.sku = any(array(select jsonb_array_elements_text(rules->'not_bought')))))
    and (rules->'role' is null or b.roles && array(select jsonb_array_elements_text(rules->'role')))
    and (rules->'grant' is null or exists (
      select 1 from public.space_grants g
       where g.capability = any(array(select jsonb_array_elements_text(rules->'grant')))
         and (g.scope = 'site'
           or (g.scope = 'user' and g.user_id = b.id)
           or (g.scope = 'role' and exists (select 1 from public.space_member_roles mr where mr.user_id = b.id and mr.role_id = g.role_id))
           or (g.scope = 'space' and exists (select 1 from public.space_members m where m.user_id = b.id and m.space_id = g.space_id))
           or (g.scope = 'channel' and exists (select 1 from public.channel_members cm where cm.user_id = b.id and cm.channel_id = g.channel_id))
           or (g.scope = 'tier' and exists (select 1 from public.entitlements e where e.user_id = b.id and e.active and e.tier = g.tier))
           or (g.scope = 'product' and exists (select 1 from public.purchases pu where pu.user_id = b.id and pu.status = 'paid' and pu.key = g.product_key)))))
    and (rules->'verified' is null or ((rules->>'verified')::boolean = (b.email_verified_at is not null)))
  from b), false)
$$;

CREATE OR REPLACE FUNCTION "public"."email_audience_me"("rules" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when auth.uid() is null then false else public.email_audience_match(auth.uid(), rules) end
$$;

CREATE OR REPLACE FUNCTION "public"."email_event"("p_log" bigint, "p_kind" "text", "p_url" "text", "p_ua" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.email_events (log_id, kind, url, ua) values (p_log, p_kind, p_url, left(p_ua, 300));
  if p_kind = 'open' then
    update public.email_log set opens = opens + 1, opened_at = coalesce(opened_at, now()) where id = p_log;
  else
    -- a click proves the email was opened, whether or not the pixel ever loaded; it is not another open
    update public.email_log set clicks = clicks + 1, clicked_at = coalesce(clicked_at, now()), opened_at = coalesce(opened_at, now()) where id = p_log;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."email_hit"("p_token" "text", "p_ua" "text") RETURNS TABLE("kind" "text", "url" "text", "log_kind" "text", "log_name" "text", "log_step" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  l public.email_links%rowtype;
  g public.email_log%rowtype;
begin
  select * into l from public.email_links where token = p_token;
  if not found then return; end if;
  update public.email_links set hits = hits + 1, first_at = coalesce(first_at, now()), last_at = now() where token = p_token;
  perform public.email_event(l.log_id, l.kind, l.url, p_ua);
  -- which email the link was in, so a click lands with the email's tags (email-track adds them)
  select * into g from public.email_log where id = l.log_id;
  return query select l.kind, l.url, g.kind, g.name, g.step;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."email_stats"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_admin() then jsonb_build_object(
    'sent', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'name', name, 'step', step, 'email_id', email_id, 'n', n, 'opened', opened, 'clicked', clicked, 'last', last)) from (
      select kind, name, step, email_id, count(*) filter (where sent_at is not null) n, count(*) filter (where opened_at is not null) opened, count(*) filter (where clicked_at is not null) clicked, max(sent_at) last
      from public.email_log group by kind, name, step, email_id) x), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('funnel', funnel, 'n', n, 'done', done)) from (
      select funnel, count(*) n, count(done_at) done from public.funnel_members group by funnel) y), '[]'::jsonb),
    'opted_out', (select count(*) from public.profiles where email_opt_out_at is not null),
    'reachable', (select count(*) from public.profiles where email is not null and email <> '' and email_opt_out_at is null)
  ) else null end
$$;

CREATE OR REPLACE FUNCTION "public"."run_email_funnels"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/funnels-run',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
end;
$$;

CREATE TABLE IF NOT EXISTS "public"."email_events" (
    "id" bigint NOT NULL,
    "log_id" bigint NOT NULL,
    "kind" "text" NOT NULL,
    "url" "text",
    "ua" "text",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_events_kind_check" CHECK (("kind" = ANY (ARRAY['open'::"text", 'click'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."email_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."email_events_id_seq" OWNED BY "public"."email_events"."id";

CREATE TABLE IF NOT EXISTS "public"."email_links" (
    "token" "text" NOT NULL,
    "log_id" bigint NOT NULL,
    "kind" "text" NOT NULL,
    "url" "text",
    "hits" integer DEFAULT 0 NOT NULL,
    "first_at" timestamp with time zone,
    "last_at" timestamp with time zone,
    CONSTRAINT "email_links_kind_check" CHECK (("kind" = ANY (ARRAY['open'::"text", 'click'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."email_log" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "name" "text" NOT NULL,
    "step" integer,
    "subject" "text",
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "email_id" "uuid",
    "version" "text",
    "opened_at" timestamp with time zone,
    "opens" integer DEFAULT 0 NOT NULL,
    "clicked_at" timestamp with time zone,
    "clicks" integer DEFAULT 0 NOT NULL,
    "unsubscribed_at" timestamp with time zone,
    CONSTRAINT "email_log_kind_check" CHECK (("kind" = ANY (ARRAY['funnel'::"text", 'blast'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."email_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."email_log_id_seq" OWNED BY "public"."email_log"."id";

CREATE TABLE IF NOT EXISTS "public"."funnel_members" (
    "user_id" "uuid" NOT NULL,
    "funnel" "text" NOT NULL,
    "entered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "step" integer DEFAULT 0 NOT NULL,
    "last_sent_at" timestamp with time zone,
    "done_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."email_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."email_events_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."email_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."email_log_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."email_links"
    ADD CONSTRAINT "email_links_pkey" PRIMARY KEY ("token");

ALTER TABLE ONLY "public"."email_log"
    ADD CONSTRAINT "email_log_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."funnel_members"
    ADD CONSTRAINT "funnel_members_pkey" PRIMARY KEY ("user_id", "funnel");

CREATE INDEX "email_events_log_idx" ON "public"."email_events" USING "btree" ("log_id", "at" DESC);

CREATE INDEX "email_links_log_idx" ON "public"."email_links" USING "btree" ("log_id");

CREATE INDEX "email_log_name_idx" ON "public"."email_log" USING "btree" ("kind", "name", "step", "sent_at" DESC);

CREATE UNIQUE INDEX "email_log_once_idx" ON "public"."email_log" USING "btree" ("user_id", "email_id") WHERE (("email_id" IS NOT NULL) AND ("user_id" IS NOT NULL));

CREATE INDEX "email_log_user_idx" ON "public"."email_log" USING "btree" ("user_id", "sent_at" DESC);

ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "public"."email_log"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."email_links"
    ADD CONSTRAINT "email_links_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "public"."email_log"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."email_log"
    ADD CONSTRAINT "email_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."funnel_members"
    ADD CONSTRAINT "funnel_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."email_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_events_admin_select" ON "public"."email_events" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

ALTER TABLE "public"."email_links" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_links_admin_select" ON "public"."email_links" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

ALTER TABLE "public"."email_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_log_admin_select" ON "public"."email_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

ALTER TABLE "public"."funnel_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "funnel_members_admin_select" ON "public"."funnel_members" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

GRANT ALL ON FUNCTION "public"."admin_funnel"("kind" "text", "name" "text", "days" integer, "steps" "jsonb", "rules" "jsonb", "goal" "text", "tz" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_funnel"("kind" "text", "name" "text", "days" integer, "steps" "jsonb", "rules" "jsonb", "goal" "text", "tz" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_funnel"("kind" "text", "name" "text", "days" integer, "steps" "jsonb", "rules" "jsonb", "goal" "text", "tz" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."admin_funnels"("days" integer, "goals" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_funnels"("days" integer, "goals" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_funnels"("days" integer, "goals" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."email_audience"("rules" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."email_audience"("rules" "jsonb") FROM "anon", "authenticated";
-- every member's address: the senders (service) and email_audience_count (an administrator's) ask, never a person
GRANT ALL ON FUNCTION "public"."email_audience"("rules" "jsonb") TO "service_role";

GRANT ALL ON FUNCTION "public"."email_audience_count"("rules" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."email_audience_count"("rules" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."email_audience_count"("rules" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."email_audience_match"("uid" "uuid", "rules" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."email_audience_match"("uid" "uuid", "rules" "jsonb") FROM "anon", "authenticated";
-- about any account by id: a person asks about themselves through email_audience_me
GRANT ALL ON FUNCTION "public"."email_audience_match"("uid" "uuid", "rules" "jsonb") TO "service_role";

GRANT ALL ON FUNCTION "public"."email_audience_me"("rules" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."email_audience_me"("rules" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."email_audience_me"("rules" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."email_event"("p_log" bigint, "p_kind" "text", "p_url" "text", "p_ua" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."email_event"("p_log" bigint, "p_kind" "text", "p_url" "text", "p_ua" "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."email_event"("p_log" bigint, "p_kind" "text", "p_url" "text", "p_ua" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."email_hit"("p_token" "text", "p_ua" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."email_hit"("p_token" "text", "p_ua" "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."email_hit"("p_token" "text", "p_ua" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."email_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."email_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."email_stats"() TO "service_role";

-- the schedule's (pg_cron, as the owner): it posts to a function with the service secret, so a visitor calling it would run the job
REVOKE ALL ON FUNCTION "public"."run_email_funnels"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_email_funnels"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_email_funnels"() TO "service_role";

GRANT ALL ON TABLE "public"."email_events" TO "anon";
GRANT ALL ON TABLE "public"."email_events" TO "authenticated";
GRANT ALL ON TABLE "public"."email_events" TO "service_role";

GRANT ALL ON SEQUENCE "public"."email_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."email_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."email_events_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."email_links" TO "anon";
GRANT ALL ON TABLE "public"."email_links" TO "authenticated";
GRANT ALL ON TABLE "public"."email_links" TO "service_role";

GRANT ALL ON TABLE "public"."email_log" TO "anon";
GRANT ALL ON TABLE "public"."email_log" TO "authenticated";
GRANT ALL ON TABLE "public"."email_log" TO "service_role";

GRANT ALL ON SEQUENCE "public"."email_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."email_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."email_log_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."funnel_members" TO "anon";
GRANT ALL ON TABLE "public"."funnel_members" TO "authenticated";
GRANT ALL ON TABLE "public"."funnel_members" TO "service_role";

REVOKE ALL ON FUNCTION "public"."email_audience"("jsonb") FROM PUBLIC, "anon";
REVOKE ALL ON FUNCTION "public"."email_audience_match"("uuid", "jsonb") FROM PUBLIC, "anon";
REVOKE ALL ON FUNCTION "public"."email_event"(bigint, "text", "text", "text") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."email_hit"("text", "text") FROM PUBLIC, "anon", "authenticated";
