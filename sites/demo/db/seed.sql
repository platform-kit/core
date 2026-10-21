-- The demo's members: the kit's seed makes the accounts and leaves the memberships to the site (its own tiers) —
-- member@example.com on the member tier, member2@example.com on the patron tier, exactly the rows the webhook
-- writes for a live subscription. So the coaching chat, the sessions' allowances and the content API's paywall
-- (a book gated to members) have a member to show.
do $$
declare m uuid; m2 uuid;
begin
  if exists (select 1 from public.entitlements where source_id = 'seed') then return; end if;
  select id into m  from auth.users where email = 'member@example.com';
  select id into m2 from auth.users where email = 'member2@example.com';
  if m is null or m2 is null then return; end if;
  insert into public.entitlements (user_id, kind, key, source, source_id, tier, plan_amount, expires_at)
  values (m,  'class', 'subscribed', 'grant', 'seed', 'member', 1200, now() + interval '30 days'),
         (m2, 'class', 'subscribed', 'grant', 'seed', 'patron', 4000, now() + interval '30 days');
end $$;

-- The demo's own rows after a reset: a session the site itself scheduled, next week, on the seeded
-- coach (the kit's seed gives the coach their hours), so the Coaching tab and the desk have a native
-- booking to show and the booker a calendar to draw.
do $$
declare c uuid; m uuid;
begin
  select id into c from public.profiles where email = 'coach@example.com';
  select id into m from public.profiles where email = 'member@example.com';
  if c is null or m is null then return; end if;
  insert into public.bookings (uid, provider, type, user_id, email, name, title, start_at, end_at, status, event, host_id, provider_id, provider_email, attendee_emails, "where", followup_at, room, join_url)
  values ('ns_seed0000000001', 'native', 'members-call', m, 'member@example.com', 'Member Person', 'The members'' call',
          date_trunc('day', now()) + interval '9 days' + interval '9 hours', date_trunc('day', now()) + interval '9 days' + interval '10 hours',
          'accepted', 'members-call', c, c, 'coach@example.com', array['member@example.com'], '{"kind":"video"}'::jsonb,
          date_trunc('day', now()) + interval '9 days' + interval '10 hours 5 minutes', 'ns_seed0000000001', '/app/call/ns_seed0000000001')
  on conflict (uid) do nothing;
end $$;

-- content analytics: sixty days of views and reads over the site's pieces, so Dashboard → Content analytics has a
-- shape to show (a few pieces well read, a long tail; a read's seconds and depth drawn around each piece's own habit).
-- Deterministic (setseed), and only when no content event is there yet.
do $$
declare
  p record; dd integer; n integer; i integer; sid uuid; aid uuid; uid uuid; uids uuid[]; secs numeric; dep numeric; at timestamptz; w numeric; ref_ text; q record; pth text; qth text; k integer; arr jsonb;
begin
  if exists (select 1 from public.events where type = 'content_view') then return; end if;
  perform setseed(0.42);
  -- the readers: a few hundred browsers, the first of them back most often (a returning core), and one view in six from a seeded account
  select array_agg(id) into uids from auth.users;
  for p in select * from (values
    ('article', 'the-first-hour-in-practice', 'The first hour, in practice', '["craft","habits"]'::jsonb, array['practice']::text[], 9, 0),
    ('article', 'ten-minutes-of-nothing', 'Ten minutes of nothing', '["attention","rest"]'::jsonb, array['practice']::text[], 7, 1),
    ('article', 'why-we-publish-in-markdown', 'Why we publish in markdown', '["publishing"]'::jsonb, array['craft']::text[], 5, 2),
    ('article', 'read-it-aloud', 'Read it aloud', '["writing","craft"]'::jsonb, array['craft']::text[], 4, 3),
    ('article', 'reading-with-a-companion', 'Reading with a companion', '["reading"]'::jsonb, array['reading']::text[], 3, 4),
    ('article', 'the-autumn-list', 'The autumn list', '["publishing"]'::jsonb, array['craft']::text[], 2, 5),
    ('book', 'the-quiet-room', 'The Quiet Room', '[]'::jsonb, array['practice']::text[], 8, 6),
    ('book', 'plain-words', 'Plain Words', '[]'::jsonb, array['craft']::text[], 6, 7),
    ('book', 'the-field-guide', 'The Field Guide', '[]'::jsonb, array['reading']::text[], 5, 8),
    ('book', 'working-hours', 'Working Hours', '[]'::jsonb, array['practice']::text[], 3, 9),
    ('wiki', 'the-press', 'The press', '["orientation"]'::jsonb, '{}'::text[], 4, 10),
    ('wiki', 'glossary', 'Glossary', '["orientation"]'::jsonb, '{}'::text[], 3, 11),
    ('docs', 'start-here', 'Start here', '["getting started"]'::jsonb, '{}'::text[], 6, 12),
    ('docs', 'your-account', 'Your account', '["getting started"]'::jsonb, '{}'::text[], 2, 13),
    ('docs', 'reading-on-a-phone', 'Reading on a phone', '["reading"]'::jsonb, '{}'::text[], 2, 14)
  ) as v(kind, id, title, tags, topics, weight, ord) loop
    for dd in 0..59 loop
      -- the last thirty days a little busier than the thirty before, with a weekly rhythm
      w := p.weight * (case when dd < 30 then 1.25 else 1 end) * (case when extract(dow from now() - make_interval(days => dd)) in (0, 6) then 0.6 else 1 end);
      n := floor(random() * w * 1.4)::int;
      for i in 1..n loop
        sid := gen_random_uuid();
        aid := ('00000000-0000-4000-8000-' || lpad(to_hex(floor(power(random(), 1.6) * 420)::int), 12, '0'))::uuid;
        uid := case when uids is not null and random() < 0.16 then uids[1 + floor(random() * array_length(uids, 1))::int] else null end;
        at := now() - make_interval(days => dd, hours => floor(random() * 14 + 7)::int, mins => floor(random() * 60)::int);
        pth := case p.kind when 'article' then '/articles/' when 'book' then '/books/' when 'wiki' then '/wiki/' else '/docs/' end || p.id;
        -- a visit: the page view the app writes on arrival, then the piece opened (the same session, the same moment)
        -- what the session said on arrival: its channel (search most, then direct, social, a referral, the welcome funnel's tagged link),
        -- its device, browser and system, its time zone and language — the facts the dashboard's acquisition and audience read
        k := floor(random() * 20)::int;
        ref_ := case when k < 7 then (array['https://www.google.com/', 'https://www.google.com/', 'https://www.bing.com/', 'https://duckduckgo.com/'])[1 + floor(random() * 4)::int]
                     when k < 13 then null
                     when k < 16 then (array['https://t.co/x', 'https://www.reddit.com/r/books/', 'https://www.linkedin.com/', 'https://www.facebook.com/'])[1 + floor(random() * 4)::int]
                     when k < 18 then (array['https://news.ycombinator.com/', 'https://example.org/reading-list', 'https://chatgpt.com/'])[1 + floor(random() * 3)::int]
                     else null end;
        arr := jsonb_build_object('entry', pth,
                 'device', (array['desktop', 'desktop', 'phone', 'phone', 'tablet', 'desktop'])[1 + floor(random() * 6)::int],
                 'tz', (array['Europe/Amsterdam', 'Europe/London', 'America/New_York', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Kolkata', 'Australia/Sydney', 'Europe/Amsterdam'])[1 + floor(random() * 8)::int],
                 'lang', (array['en-GB', 'en-US', 'nl-NL', 'en-US', 'de-DE', 'en-AU', 'fr-FR', 'en-GB'])[1 + floor(random() * 8)::int]);
        -- the country, as the door would have stamped it from the host's header: the one the time zone sits in
        arr := arr || jsonb_build_object('country', case arr ->> 'tz' when 'Europe/Amsterdam' then 'NL' when 'Europe/London' then 'GB' when 'America/New_York' then 'US' when 'Europe/Berlin' then 'DE' when 'America/Los_Angeles' then 'US' when 'Asia/Kolkata' then 'IN' when 'Australia/Sydney' then 'AU' else 'NL' end);
        arr := arr || case arr ->> 'device' when 'phone' then (array['{"browser":"safari","os":"ios"}', '{"browser":"chrome","os":"android"}', '{"browser":"safari","os":"ios"}'])[1 + floor(random() * 3)::int]::jsonb
                            when 'tablet' then '{"browser":"safari","os":"ios"}'::jsonb
                            else (array['{"browser":"chrome","os":"mac"}', '{"browser":"chrome","os":"windows"}', '{"browser":"safari","os":"mac"}', '{"browser":"firefox","os":"linux"}', '{"browser":"edge","os":"windows"}'])[1 + floor(random() * 5)::int]::jsonb end;
        if k >= 18 then arr := arr || jsonb_build_object('utm', jsonb_build_object('source', 'welcome', 'medium', 'email', 'campaign', (array['The first note', 'A week in', 'The call'])[1 + floor(random() * 3)::int])); end if;
        insert into public.events (session_id, anon_id, user_id, type, path, ref, props, occurred_at)
        values (sid, aid, uid, 'session_start', pth, ref_, arr, at);
        -- the site's own goal, registered in its config: one visit in twenty-five signs up for the newsletter
        if random() < 0.04 then insert into public.events (session_id, anon_id, user_id, type, path, props, occurred_at) values (sid, aid, uid, 'newsletter_signup', pth, jsonb_build_object('list', 'weekly'), at + interval '90 seconds'); end if;
        if p.kind = 'article' and random() < 0.06 then insert into public.events (session_id, anon_id, user_id, type, path, props, occurred_at) values (sid, aid, uid, 'video_play', pth, jsonb_build_object('seconds', 30 + floor(random() * 240)::int, 'video', 'intro'), at + interval '2 minutes'); end if;
        insert into public.events (session_id, anon_id, user_id, type, path, ref, props, occurred_at)
        values (sid, aid, uid, 'pageview', pth, ref_, '{}'::jsonb, at);
        insert into public.events (session_id, anon_id, user_id, type, path, topic_slugs, ref, props, occurred_at)
        values (sid, aid, uid, 'content_view', pth, nullif(p.topics, '{}'), ref_,
                jsonb_build_object('kind', p.kind, 'id', p.id, 'title', p.title, 'tags', p.tags), at);
        -- three reads in four leave a read behind; a book holds people longer and is read less far in one sitting
        if random() < 0.75 then
          secs := case when p.kind = 'book' then 240 + random() * 900 when p.kind = 'article' then 60 + random() * 300 else 30 + random() * 120 end;
          dep := least(100, greatest(5, (case when p.kind = 'book' then 35 else 60 end) + (random() * 60 - 20)));
          insert into public.events (session_id, anon_id, user_id, type, path, topic_slugs, ref, props, occurred_at)
          values (sid, aid, uid, 'content_read', pth, nullif(p.topics, '{}'), null,
                  jsonb_build_object('kind', p.kind, 'id', p.id, 'title', p.title, 'tags', p.tags, 'seconds', round(secs), 'depth', round(dep)), at + make_interval(secs => round(secs)::int));
        end if;
        -- three visits in ten go on to a second piece: the library's hub, then another piece of the same kind
        if random() < 0.3 then
          select * into q from (values
            ('article', 'ten-minutes-of-nothing', 'Ten minutes of nothing', '["attention","rest"]'::jsonb, array['practice']::text[]),
            ('article', 'read-it-aloud', 'Read it aloud', '["writing","craft"]'::jsonb, array['craft']::text[]),
            ('book', 'plain-words', 'Plain Words', '[]'::jsonb, array['craft']::text[]),
            ('book', 'the-quiet-room', 'The Quiet Room', '[]'::jsonb, array['practice']::text[]),
            ('docs', 'start-here', 'Start here', '["getting started"]'::jsonb, '{}'::text[]),
            ('wiki', 'the-press', 'The press', '["orientation"]'::jsonb, '{}'::text[])
          ) as v(kind, id, title, tags, topics) where v.kind = p.kind and v.id <> p.id order by random() limit 1;
          if q.id is not null then
            qth := case q.kind when 'article' then '/articles/' when 'book' then '/books/' when 'wiki' then '/wiki/' else '/docs/' end || q.id;
            insert into public.events (session_id, anon_id, user_id, type, path, props, occurred_at) values (sid, aid, uid, 'pageview', '/content', '{}'::jsonb, at + interval '2 minutes');
            insert into public.events (session_id, anon_id, user_id, type, path, ref, props, occurred_at) values (sid, aid, uid, 'pageview', qth, null, '{}'::jsonb, at + interval '3 minutes');
            insert into public.events (session_id, anon_id, user_id, type, path, topic_slugs, props, occurred_at)
            values (sid, aid, uid, 'content_view', qth, nullif(q.topics, '{}'), jsonb_build_object('kind', q.kind, 'id', q.id, 'title', q.title, 'tags', q.tags), at + interval '3 minutes');
            insert into public.events (session_id, anon_id, user_id, type, path, topic_slugs, props, occurred_at)
            values (sid, aid, uid, 'content_read', qth, nullif(q.topics, '{}'), jsonb_build_object('kind', q.kind, 'id', q.id, 'title', q.title, 'tags', q.tags, 'seconds', 60 + round(random() * 200), 'depth', round(40 + random() * 60)), at + interval '6 minutes');
          end if;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- Responses to the three forms over the last sixty days, so the forms' analytics page has a picture: the reading check
-- (five choices, a score, some who stopped part way), the newsletter (one field) and the contact form (some who stopped
-- at the message). Deterministic, and only when no response is there yet.
do $$
declare
  i integer; dd integer; rid uuid; at timestamptz; reach integer; sc integer; k integer; pick text; ans text[];
  q1 text[] := array['Long', 'Loud', 'Late', 'Lonely']; q2 text[] := array['Once', 'Daily', 'Early', 'Together'];
  q3 text[] := array['Face down', 'On silent', 'Away', 'In a drawer nearby']; q4 text[] := array['Five', 'Ten', 'Twenty', 'As long as it takes'];
  q5 text[] := array['Sleep', 'Focus', 'Choice', 'Quiet']; right_ text[] := array['Loud', 'Once', 'Away', 'Ten', 'Choice'];
  topics text[] := array['A book', 'An order', 'Membership', 'Something else'];
begin
  if exists (select 1 from public.form_responses) then return; end if;
  perform setseed(0.7);
  for i in 1..64 loop
    dd := floor(power(random(), 1.3) * 60)::int; at := now() - make_interval(days => dd, hours => floor(random() * 14 + 7)::int);
    reach := case when random() < 0.72 then 5 else 1 + floor(random() * 4)::int end; sc := 0; rid := gen_random_uuid();
    insert into public.form_responses (id, form, anon_id, origin, started_at, updated_at, completed_at, score, total, passed)
    values (rid, 'reading-check', 'seed-' || i, '/books/the-quiet-room', at, at, case when reach = 5 then at + interval '4 minutes' end, null, null, null);
    for k in 1..reach loop
      ans := case k when 1 then q1 when 2 then q2 when 3 then q3 when 4 then q4 else q5 end;
      pick := case when random() < 0.7 then right_[k] else ans[1 + floor(random() * 4)::int] end;
      if pick = right_[k] then sc := sc + 1; end if;
      insert into public.form_answers (response_id, field, value, slide, latency_ms, answered_at)
      values (rid, 'q' || k, to_jsonb(pick), k, 4000 + floor(random() * 12000)::int, at + make_interval(secs => k * 40));
    end loop;
    if reach = 5 then update public.form_responses set score = sc, total = 5, passed = sc >= 4 where id = rid; end if;
  end loop;
  for i in 1..38 loop
    dd := floor(power(random(), 1.3) * 60)::int; at := now() - make_interval(days => dd, hours => floor(random() * 14 + 7)::int); rid := gen_random_uuid();
    insert into public.form_responses (id, form, anon_id, origin, started_at, updated_at, completed_at)
    values (rid, 'newsletter', 'seed-n' || i, '/', at, at, case when random() < 0.85 then at + interval '30 seconds' end);
    insert into public.form_answers (response_id, field, value, slide, answered_at) values (rid, 'email', to_jsonb('reader' || i || '@example.com'), 1, at + interval '20 seconds');
  end loop;
  for i in 1..21 loop
    dd := floor(power(random(), 1.3) * 60)::int; at := now() - make_interval(days => dd, hours => floor(random() * 14 + 7)::int); rid := gen_random_uuid();
    reach := case when random() < 0.6 then 5 else 1 + floor(random() * 4)::int end;
    insert into public.form_responses (id, form, anon_id, origin, started_at, updated_at, completed_at)
    values (rid, 'contact', 'seed-c' || i, '/contact', at, at, case when reach = 5 then at + interval '3 minutes' end);
    insert into public.form_answers (response_id, field, value, slide, answered_at) values (rid, 'name', to_jsonb('Reader ' || i), 1, at + interval '10 seconds');
    insert into public.form_answers (response_id, field, value, slide, answered_at) values (rid, 'email', to_jsonb('reader' || i || '@example.com'), 1, at + interval '20 seconds');
    if reach >= 2 then insert into public.form_answers (response_id, field, value, slide, answered_at) values (rid, 'topic', to_jsonb(topics[1 + floor(power(random(), 1.5) * 4)::int]), 2, at + interval '40 seconds'); end if;
    if reach >= 3 then insert into public.form_answers (response_id, field, value, slide, answered_at) values (rid, 'order', to_jsonb('NL-' || (1000 + i)), 3, at + interval '60 seconds'); end if;
    if reach >= 4 then insert into public.form_answers (response_id, field, value, slide, answered_at) values (rid, 'message', to_jsonb('A line about it, in their own words.'::text), 4, at + interval '2 minutes'); end if;
    if reach >= 5 and random() < 0.5 then insert into public.form_answers (response_id, field, value, slide, answered_at) values (rid, 'when', to_jsonb(to_char(at + interval '3 days', 'YYYY-MM-DD')), 5, at + interval '3 minutes'); end if;
  end loop;
end $$;

-- The finder's rounds and the support chat's prompts over the same sixty days, so Content analytics' feature
-- sections have a picture too: rounds started, most finished with three books, some opened; the desk's default
-- and the store's prompt shown, choices picked, a few threads begun. Deterministic, and only when none is there.
do $$
declare
  i integer; dd integer; sid uuid; aid uuid; at timestamptz; k integer; picked text; first_ text; second_ text; third_ text;
  problems text[] := array['I cannot keep a habit going past the second week', 'Too much noise in my head to sit down and work', 'I start books and never finish them', 'I want to write more clearly and say less', 'Mornings disappear before I have done anything', 'I want to read more slowly and remember it', 'My attention is in pieces by ten in the morning'];
  frustrations text[] := array['Every plan lasts three days', 'Reading the same page four times', 'The phone, always the phone', 'Finishing a chapter and remembering nothing', 'Writing that goes on and on', 'Getting to the end of the day with nothing done', 'Starting again from zero every Monday'];
  books text[] := array['the-quiet-room', 'plain-words', 'the-field-guide', 'working-hours'];
  looks text[] := array['theory', 'technique', 'encouragement', 'other'];
  desk text := '8b2e4d6a-3f5c-4e0a-9d7f-4c3f7a0e5b32'; store_ text := 'c5d6e7f8-9a0b-4c1d-8e2f-3a4b5c6d7e8f';
  desk_text text := 'Hi there. Ask us anything about the books, the membership or your order.';
  store_text text := 'Looking for a particular book? Every title opens for good, and a membership opens them all — say which and we will point you to it.';
  desk_choices text[] := array['a-question-about-a-book', 'my-membership', 'an-order', 'something-else'];
  desk_words text[] := array['A question about a book', 'My membership', 'An order', 'Something else'];
  store_choices text[] := array['which-book-should-i-start-with', 'what-does-a-membership-include', 'do-you-ship-to-me'];
  store_words text[] := array['Which book should I start with?', 'What does a membership include?', 'Do you ship to me?'];
begin
  if exists (select 1 from public.events where type in ('find_start', 'support_prompt')) then return; end if;
  perform setseed(0.11);
  -- the finder: 70 rounds, most finished, a third opening a book
  for i in 1..70 loop
    dd := floor(power(random(), 1.2) * 60)::int; at := now() - make_interval(days => dd, hours => floor(random() * 14 + 7)::int, mins => floor(random() * 60)::int);
    sid := gen_random_uuid(); aid := ('00000000-0000-4000-8000-' || lpad(to_hex(floor(power(random(), 1.6) * 420)::int), 12, '0'))::uuid;
    insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'find_start', '/app/quiz/teachings', '{}'::jsonb, at);
    if random() < 0.7 then
      k := 1 + floor(random() * 4)::int; first_ := books[k]; second_ := books[1 + (k % 4)]; third_ := books[1 + ((k + 1) % 4)];
      picked := looks[1 + floor(power(random(), 1.4) * 4)::int];
      insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'find_result', '/app/quiz/teachings',
        jsonb_build_object('problem', problems[1 + floor(random() * 7)::int], 'problem_prompt', 'The problem I would solve at a snap is',
                           'frustration', frustrations[1 + floor(random() * 7)::int], 'frustration_prompt', 'What has frustrated me most lately is',
                           'looking', picked, 'looking_text', case when picked = 'other' then 'Something I can start today' else null end,
                           'pace', (array['short', 'long', 'either'])[1 + floor(random() * 3)::int], 'books', jsonb_build_array(first_, second_, third_)), at + interval '3 minutes');
      if random() < 0.45 then
        insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'find_open', '/app/quiz/teachings',
          jsonb_build_object('book', case when random() < 0.7 then first_ else second_ end, 'rank', 1, 'from', 'quiz'), at + interval '4 minutes');
      end if;
    end if;
  end loop;
  -- the prompts: the desk's default shown on most visits, the store's on the store; a choice picked now and then, a thread begun less often
  for i in 1..260 loop
    dd := floor(power(random(), 1.2) * 60)::int; at := now() - make_interval(days => dd, hours => floor(random() * 14 + 7)::int, mins => floor(random() * 60)::int);
    sid := gen_random_uuid(); aid := ('00000000-0000-4000-8000-' || lpad(to_hex(floor(power(random(), 1.6) * 420)::int), 12, '0'))::uuid;
    if random() < 0.7 then
      insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'support_prompt', '/', jsonb_build_object('prompt', desk, 'funnel', 'support-desk', 'how', (array['nudge', 'default', 'default'])[1 + floor(random() * 3)::int], 'text', desk_text), at);
      if random() < 0.25 then
        k := 1 + floor(power(random(), 1.3) * 4)::int;
        insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'support_choice', '/', jsonb_build_object('prompt', desk, 'funnel', 'support-desk', 'choice', desk_choices[k], 'text', desk_words[k]), at + interval '20 seconds');
        if random() < 0.5 then insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'support_start', '/', jsonb_build_object('prompt', desk, 'funnel', 'support-desk', 'choice', desk_choices[k]), at + interval '40 seconds'); end if;
      end if;
    else
      insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'support_prompt', '/store', jsonb_build_object('prompt', store_, 'funnel', 'support-desk', 'how', 'teaser', 'text', store_text), at);
      if random() < 0.3 then
        k := 1 + floor(power(random(), 1.3) * 3)::int;
        insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'support_choice', '/store', jsonb_build_object('prompt', store_, 'funnel', 'support-desk', 'choice', store_choices[k], 'text', store_words[k]), at + interval '20 seconds');
        if random() < 0.6 then insert into public.events (session_id, anon_id, type, path, props, occurred_at) values (sid, aid, 'support_start', '/store', jsonb_build_object('prompt', store_, 'funnel', 'support-desk', 'choice', store_choices[k]), at + interval '40 seconds'); end if;
      end if;
    end if;
  end loop;
end $$;

-- What the content led to: the seeded readers' accounts made a little after one of their reads (a sign-up), and for
-- a few of them a book bought or a membership begun a day or two after another — so Content analytics' Conversions
-- tab has a picture. Deterministic, and only when no seeded conversion is there yet.
do $$
declare
  u uuid; t timestamptz; n integer := 0;
begin
  if exists (select 1 from public.purchases where stripe_checkout_session_id like 'cs_seed_read_%') then return; end if;
  perform setseed(0.23);
  -- THE SEEDED READERS ONLY. The kit's own named accounts each stand for one state — free@ has
  -- bought nothing, buyer@ has bought something, coach@ gives sessions — and handing them a purchase
  -- at random takes that away: a free reader who turns out to own a book is no longer the account
  -- anything can be shown or checked against.
  for u in select id from public.profiles where email like 'reader%@example.com' loop
    -- the account made ten minutes after a read the same browser made, so the sign-up follows the piece
    select occurred_at into t from public.events where user_id = u and type = 'content_view' and occurred_at >= now() - interval '55 days' order by random() limit 1;
    if t is null then continue; end if;
    update public.profiles set created_at = t + interval '10 minutes' where id = u;
    n := n + 1;
    -- every other one buys a book two days on; every third begins a membership
    if n % 2 = 0 then
      select occurred_at into t from public.events where user_id = u and type = 'content_view' and occurred_at >= now() - interval '40 days' order by random() limit 1;
      if t is not null then
        insert into public.purchases (user_id, email, stripe_checkout_session_id, sku, key, amount_total, currency, status, created_at)
        select u, p.email, 'cs_seed_read_' || n, 'plain-words', 'a4b5c6d7', 800, 'usd', 'paid', t + interval '1 day' from public.profiles p where p.id = u;
      end if;
    end if;
    if n % 3 = 0 then
      select occurred_at into t from public.events where user_id = u and type = 'content_view' and occurred_at >= now() - interval '40 days' order by random() limit 1;
      if t is not null and not exists (select 1 from public.subscriptions where user_id = u) then
        insert into public.subscriptions (id, user_id, status, plan_amount, current_period_end, created_at, updated_at, sku, key)
        values ('sub_seed_read_' || n, u, 'active', 1200, now() + interval '20 days', t + interval '2 days', t + interval '2 days', 'member-monthly', 'b2c3d4e5');
      end if;
    end if;
  end loop;
end $$;

-- What the funnels did: ninety readers' accounts, each entered into the welcome funnel some day in the last two months and
-- carried as far as its emails had time to go — sent, opened (some of them on a phone, at an hour of their own), clicked
-- (three destinations), a few unsubscribed at the second email, some waiting for the next, some overdue for it, some who
-- subscribed and so left the audience; every fourth clicker bought a book a day or three later and one in ten began a
-- membership; the first email went out in two versions. Deterministic, and only when the funnel has no log yet.
do $$
declare
  fun text := 'welcome';
  ids uuid[] := array['6f0c2b4e-1d3a-4c8e-9b7f-2a1d5e8c3f10', '7a1d3c5f-2e4b-4d9f-8c6e-3b2e6f9d4a21', '9c3f5e7a-4b6d-4f1b-a0e8-5d4f8b1e6c43']::uuid[];
  afters integer[] := array[0, 7, 14];
  subjects text[] := array['Where to begin', 'A week in', 'The call'];
  urls text[] := array['https://demo.platformkit.dev/store', 'https://demo.platformkit.dev/library/plain-words', 'https://demo.platformkit.dev/app'];
  phone_ua text := 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  desk_ua text := 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  firsts text[] := array['Ada', 'Bram', 'Chloe', 'Dev', 'Elin', 'Farah', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lena', 'Mo', 'Nia', 'Oli', 'Pia', 'Quin', 'Rae', 'Sol', 'Tam'];
  lasts text[] := array['Aalto', 'Bishop', 'Costa', 'Dahl', 'Ekman', 'Flores', 'Grau', 'Hale', 'Ito', 'Jansen', 'Kaur', 'Lund', 'Mora', 'Nakamura', 'Ortiz'];
  i integer; k integer; j integer; u uuid; entered timestamptz; due timestamptz; sent_at timestamptz; opened timestamptz; clicked timestamptz;
  step_ integer; last_sent timestamptz; done timestamptz; lid bigint; opens integer; clicks integer; ua text; is_phone boolean; clicker boolean;
  v text; cu text; hr integer; unsub boolean; goal_at timestamptz; conv integer := 0; lower_ integer;
begin
  if exists (select 1 from public.email_log where name = fun) then return; end if;
  perform setseed(0.31);
  for i in 1..90 loop
    u := public.seed_user('reader' || i || '@example.com', firsts[1 + (i % 20)] || ' ' || lasts[1 + (i % 15)]);
    -- entered some day in the last two months, most of them longer ago (so the later steps had time to go out)
    entered := now() - make_interval(days => 2 + floor(power(random(), 0.9) * 58)::int, hours => floor(random() * 12 + 7)::int, mins => floor(random() * 60)::int);
    update public.profiles set created_at = entered - interval '1 day', email_verified_at = entered - interval '1 day' where id = u;
    step_ := 0; last_sent := null; done := null; clicker := false; unsub := false;
    for k in 1..3 loop
      due := coalesce(last_sent, entered) + make_interval(days => afters[k]);
      if k > 1 and due > now() then exit; end if;                       -- waiting for this step
      if k > 1 and random() < 0.08 then exit; end if;                   -- held: the cooldown, or no longer matching
      sent_at := due + make_interval(mins => floor(random() * 50)::int);
      if sent_at > now() then exit; end if;
      -- the first email went out in two versions: the words changed a month ago
      v := case when k = 1 and sent_at < now() - interval '30 days' then 'v1' else 'v2' end;
      -- opened by a little over half, at an hour of their own — evenings and mornings more than the night; one in three on a phone
      opens := case when random() < 0.56 then 1 + floor(power(random(), 2) * 3)::int else 0 end;
      hr := (array[7, 8, 8, 9, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 21, 22, 23, 6, 12])[1 + floor(random() * 20)::int];
      opened := case when opens > 0 then date_trunc('day', sent_at + make_interval(hours => floor(power(random(), 1.5) * 40)::int)) + make_interval(hours => hr, mins => floor(random() * 60)::int) else null end;
      if opened is not null and opened < sent_at then opened := sent_at + interval '25 minutes'; end if;
      if opened is not null and opened > now() then opened := sent_at + interval '25 minutes'; end if;
      is_phone := random() < 0.34; ua := case when is_phone then phone_ua else desk_ua end;
      -- clicked by a third of those who opened, a few minutes on
      clicks := case when opened is not null and random() < 0.33 then 1 + floor(power(random(), 2) * 2)::int else 0 end;
      clicked := case when clicks > 0 then opened + make_interval(mins => 1 + floor(random() * 12)::int) else null end;
      -- one in twenty who opened the second email unsubscribed from it
      unsub := (k = 2 and opened is not null and random() < 0.06);
      insert into public.email_log (user_id, email, kind, name, step, subject, sent_at, email_id, version, opened_at, opens, clicked_at, clicks, unsubscribed_at)
      values (u, 'reader' || i || '@example.com', 'funnel', fun, k, subjects[k], sent_at, ids[k], v, opened, opens, clicked, clicks, case when unsub then opened + interval '3 minutes' end)
      returning id into lid;
      insert into public.email_links (token, log_id, kind, url, hits, first_at, last_at) values (substr(md5(lid::text || 'o'), 1, 10), lid, 'open', null, opens, opened, opened);
      for j in 1..opens loop
        insert into public.email_events (log_id, kind, url, ua, at) values (lid, 'open', null, ua, opened + make_interval(mins => (j - 1) * 37));
      end loop;
      if clicks > 0 then
        cu := urls[1 + floor(power(random(), 1.6) * 3)::int];
        insert into public.email_links (token, log_id, kind, url, hits, first_at, last_at) values (substr(md5(lid::text || 'c'), 1, 10), lid, 'click', cu, clicks, clicked, clicked);
        for j in 1..clicks loop
          insert into public.email_events (log_id, kind, url, ua, at) values (lid, 'click', cu, ua, clicked + make_interval(mins => (j - 1) * 9));
        end loop;
        clicker := true;
        -- what a click led to: every fourth clicker bought a book a day or three on; one in ten began a membership
        if (i + k) % 4 = 0 then
          conv := conv + 1;
          insert into public.purchases (user_id, email, stripe_checkout_session_id, sku, key, amount_total, currency, status, created_at)
          values (u, 'reader' || i || '@example.com', 'cs_seed_mail_' || conv, 'plain-words', 'a4b5c6d7', 800, 'usd', 'paid', clicked + make_interval(days => 1 + floor(random() * 3)::int));
        elsif (i + k) % 10 = 0 and not exists (select 1 from public.subscriptions where user_id = u) then
          insert into public.subscriptions (id, user_id, status, plan_amount, current_period_end, created_at, updated_at, sku, key)
          values ('sub_seed_mail_' || i, u, 'active', 1200, now() + interval '20 days', clicked + interval '2 days', clicked + interval '2 days', 'member-monthly', 'b2c3d4e5');
        end if;
      end if;
      -- one in five who opened reached the goal — the store — within three days
      if opened is not null and random() < 0.2 then
        goal_at := opened + make_interval(hours => 2 + floor(random() * 70)::int);
        if goal_at < now() then
          insert into public.events (session_id, anon_id, user_id, type, path, props, occurred_at) values (gen_random_uuid(), gen_random_uuid(), u, 'session_start', '/store', '{}'::jsonb, goal_at);
          insert into public.events (session_id, anon_id, user_id, type, path, props, occurred_at) values (gen_random_uuid(), gen_random_uuid(), u, 'pageview', '/store', '{}'::jsonb, goal_at);
        end if;
      end if;
      step_ := k; last_sent := sent_at;
      if unsub then update public.profiles set email_opt_out_at = opened + interval '3 minutes' where id = u; exit; end if;
      if k = 3 then done := sent_at; end if;
    end loop;
    insert into public.funnel_members (user_id, funnel, entered_at, step, last_sent_at, done_at) values (u, fun, entered, step_, last_sent, done);
  end loop;

  -- the blast: the autumn list, sent twenty days ago to every reader who was there by then; opened by half, clicked by a few
  for u, i in select p.id, row_number() over (order by p.email) from public.profiles p where p.email like 'reader%@example.com' and p.created_at < now() - interval '20 days' and p.email_opt_out_at is null loop
    sent_at := now() - interval '20 days' + make_interval(mins => floor(random() * 30)::int);
    opens := case when random() < 0.5 then 1 + floor(power(random(), 2) * 3)::int else 0 end;
    opened := case when opens > 0 then sent_at + make_interval(hours => floor(power(random(), 1.5) * 30)::int, mins => floor(random() * 60)::int) end;
    is_phone := random() < 0.4; ua := case when is_phone then phone_ua else desk_ua end;
    clicks := case when opened is not null and random() < 0.3 then 1 else 0 end;
    clicked := case when clicks > 0 then opened + make_interval(mins => 2 + floor(random() * 10)::int) end;
    insert into public.email_log (user_id, email, kind, name, step, subject, sent_at, email_id, version, opened_at, opens, clicked_at, clicks)
    values (u, 'reader' || i || '@example.com', 'blast', 'the-autumn-list', null, 'What is coming this autumn', sent_at, '5fce84b5-fa8a-4280-aeac-93246712202e', 'v1', opened, opens, clicked, clicks) returning id into lid;
    insert into public.email_links (token, log_id, kind, url, hits, first_at, last_at) values (substr(md5(lid::text || 'bo'), 1, 10), lid, 'open', null, opens, opened, opened);
    for j in 1..opens loop insert into public.email_events (log_id, kind, url, ua, at) values (lid, 'open', null, ua, opened + make_interval(mins => (j - 1) * 41)); end loop;
    if clicks > 0 then
      cu := urls[1 + floor(random() * 3)::int];
      insert into public.email_links (token, log_id, kind, url, hits, first_at, last_at) values (substr(md5(lid::text || 'bc'), 1, 10), lid, 'click', cu, 1, clicked, clicked);
      insert into public.email_events (log_id, kind, url, ua, at) values (lid, 'click', cu, ua, clicked);
      if i % 6 = 0 then
        conv := conv + 1;
        insert into public.purchases (user_id, email, stripe_checkout_session_id, sku, key, amount_total, currency, status, created_at)
        values (u, 'reader' || i || '@example.com', 'cs_seed_mail_' || conv, 'the-field-guide', 'a1b2c3d4', 500, 'usd', 'paid', clicked + interval '1 day');
      end if;
    end if;
  end loop;
end $$;

-- ONE ORDER THAT WENT OUT IN TWO PIECES. The thing a purchase could never say: two lines of one
-- basket sent on different days by different suppliers, a third still at the printer, and
-- something asked to come back. Every state the Orders page can draw, in a row somebody can look
-- at — and the state itself derived from the rows rather than seeded as a column.
do $$
declare
  u    uuid;
  ord  uuid;
  ln1  uuid := gen_random_uuid();
  ln2  uuid := gen_random_uuid();
  ln3  uuid := gen_random_uuid();
  f1   uuid;
  f2   uuid;
  ret  uuid;
  addr jsonb := '{"name":"Rowan Ellis","line1":"14 Mill Lane","city":"Hebden Bridge","state":"","postal_code":"HX7 8EX","country":"GB"}'::jsonb;
begin
  if exists (select 1 from public.orders where checkout_session = 'cs_demo_two_parcels') then return; end if;
  select id into u from public.profiles where email = 'member@example.com' limit 1;
  if u is null then return; end if;

  insert into public.orders (user_id, email, currency, checkout_session, shipping_total, shipping_address, created_at)
  values (u, 'member@example.com', 'usd', 'cs_demo_two_parcels', 695, addr, now() - interval '5 days')
  returning id into ord;

  insert into public.order_items (order_id, line, version, sku, key, variant, title, variant_title, unit_price, quantity)
  values (ord, ln1, 1, 'notebook', 'd4e5f6a7', 'linen.lined',  'The first-hour notebook', 'Linen · Lined',  1800, 2),
         (ord, ln2, 1, 'one-line-tee', '7c2d94ab', 'black.l',  'The one-line tee',        'Black · L',      2800, 1),
         (ord, ln3, 1, 'plain-words-softcover', 'b7c8d9e0', 'full', 'Plain Words',        'Paperback',      1400, 1);

  insert into public.order_transactions (order_id, amount, currency, reason, reference)
  values (ord, 2 * 1800 + 2800 + 1400 + 695, 'usd', 'payment', 'pi_demo_two_parcels');

  -- the notebooks off the shop's own shelf, three days ago
  insert into public.fulfilments (order_id, user_id, email, key, supplier, status, quantity, address, shipping_level, tracking, created_at)
  values (ord, u, 'member@example.com', 'd4e5f6a7', 'post-room', 'shipped', 2, addr, 'standard',
          '{"carrier":"Royal Mail","number":"RM123456789GB"}'::jsonb, now() - interval '3 days')
  returning id into f1;
  insert into public.fulfilment_items (fulfilment_id, line, quantity) values (f1, ln1, 2);

  -- the shirt made to order by the garment printer, and on its way
  insert into public.fulfilments (order_id, user_id, email, key, supplier, status, quantity, address, shipping_level, supplier_job, supplier_status, created_at)
  values (ord, u, 'member@example.com', '7c2d94ab', 'printify', 'in_production', 1, addr, 'standard',
          'pf_demo_0001', 'in-production', now() - interval '2 days')
  returning id into f2;
  insert into public.fulfilment_items (fulfilment_id, line, quantity) values (f2, ln2, 1);

  -- and the paperback still at the printer: no parcel at all, which is why the order reads part sent
  -- (a third line with nothing against it is what makes the derivation worth having)

  -- one of the notebooks is coming back, and has not arrived: the shelf has not moved
  insert into public.returns (order_id, order_version, reason, note)
  values (ord, 1, 'ordered two by mistake', 'keeping one')
  returning id into ret;
  insert into public.return_items (return_id, line, quantity, restock) values (ret, ln1, 1, true);
end $$;

-- A source: the landing page at landing.example reports in through the drop-in script under the key the config registers,
-- three weeks of page views and sign-ups with a distinct id on a third of them, so the dashboard's Source filter has a
-- picture. Deterministic, and only when no source row is there yet.
do $$
declare
  i integer; sid uuid; aid uuid; at timestamptz; did text; k integer;
begin
  if exists (select 1 from public.events where source = 'landing') then return; end if;
  perform setseed(0.37);
  for i in 1..420 loop
    sid := gen_random_uuid(); aid := ('00000000-0000-4000-9000-' || lpad(to_hex(floor(power(random(), 1.4) * 260)::int), 12, '0'))::uuid;
    at := now() - make_interval(days => floor(random() * 21)::int, hours => floor(random() * 15 + 6)::int, mins => floor(random() * 60)::int);
    did := case when random() < 0.33 then 'u-' || floor(random() * 90)::int else null end;
    k := floor(random() * 10)::int;
    insert into public.events (session_id, anon_id, type, path, ref, props, occurred_at, source, distinct_id)
    values (sid, aid, '$pageview', (array['/', '/', '/pricing', '/about'])[1 + floor(random() * 4)::int],
            case when k < 4 then 'https://www.google.com/' when k < 6 then 'https://www.linkedin.com/' when k < 7 then 'https://news.ycombinator.com/' else null end,
            jsonb_build_object('$current_url', 'https://landing.example/', '$host', 'landing.example', '$pathname', '/', 'entry', '/',
                               'device', (array['desktop', 'phone', 'desktop'])[1 + floor(random() * 3)::int], 'browser', (array['chrome', 'safari', 'firefox'])[1 + floor(random() * 3)::int], 'os', (array['mac', 'windows', 'ios'])[1 + floor(random() * 3)::int],
                               'tz', (array['Europe/Amsterdam', 'America/New_York', 'Europe/London'])[1 + floor(random() * 3)::int], 'lang', 'en-US', 'country', (array['NL', 'US', 'GB'])[1 + floor(random() * 3)::int]),
            at, 'landing', did);
    if random() < 0.35 then insert into public.events (session_id, anon_id, type, path, props, occurred_at, source, distinct_id) values (sid, aid, '$pageview', '/pricing', jsonb_build_object('$pathname', '/pricing'), at + interval '40 seconds', 'landing', did); end if;
    if random() < 0.12 then insert into public.events (session_id, anon_id, type, path, props, occurred_at, source, distinct_id) values (sid, aid, 'signup', '/pricing', jsonb_build_object('plan', (array['monthly', 'yearly', 'monthly'])[1 + floor(random() * 3)::int]), at + interval '2 minutes', 'landing', coalesce(did, 'u-' || i)); end if;
    insert into public.events (session_id, anon_id, type, path, props, occurred_at, source, distinct_id) values (sid, aid, '$pageleave', '/', '{}'::jsonb, at + interval '3 minutes', 'landing', did);
  end loop;
end $$;

-- A MORNING THE TWO HOSTS SHARE, so the demo's collective type ("The review") has times to offer.
-- The kit's seed gives the coach weekday mornings and the administrator two afternoons on purpose —
-- they overlap nowhere, and a collective type is the INTERSECTION, so without this the booker would
-- correctly say there is nothing open and show nobody what the feature does.
do $$
declare a uuid;
begin
  select id into a from public.profiles where email = 'admin@example.com';
  if a is null then return; end if;
  update public.provider_schedules
     set weekly = '{"2":[["10:00","12:00"],["14:00","17:00"]],"4":[["10:00","12:00"],["14:00","17:00"]]}'::jsonb
   where user_id = a and is_default;
end $$;

-- THE OTHER PERSON ON THE TEAM HAS HOURS TOO, so the demo's round-robin type ("A first call") has
-- somebody to rotate TO. The team is everybody with the provider role — the coach and the writer —
-- and a rota with one member who offers times is a rota nobody can see working. Afternoons, so a day
-- shows both of them and the turn passing between them is the visible thing.
do $$
declare w uuid;
begin
  select id into w from public.profiles where email = 'writer@example.com';
  if w is null then return; end if;
  insert into public.provider_schedules (user_id, name, is_default, timezone, weekly, buffer_before, buffer_after, notice_hours, max_per_day)
  values (w, 'Working hours', true, 'Europe/Amsterdam',
          '{"1":[["13:00","17:00"]],"2":[["13:00","17:00"]],"3":[["13:00","17:00"]],"4":[["13:00","17:00"]],"5":[["13:00","17:00"]]}'::jsonb,
          0, 0, 24, 0)
  on conflict (user_id, name) do nothing;
end $$;

-- and the seeded booking holds its host's time, as a booking made through the app does
do $$
declare b record;
begin
  for b in select uid from public.bookings where status in ('accepted', 'pending') and host_id is not null
                and not exists (select 1 from public.booking_holds h where h.booking_uid = bookings.uid)
  loop
    perform public.booking_hold(b.uid, null);
  end loop;
end $$;

-- THE CUSTOMER HAS BOUGHT SOMETHING. The kit's seed makes buyer@example.com and says the site gives
-- them a purchase: the rows above hand purchases out from the read history, which is a lottery this
-- account can lose, and a customer with nothing bought is not a customer. So this one is deliberate
-- — the book, paid, a fortnight ago — and every surface that asks what somebody has bought has an
-- answer for them.
do $$
declare b uuid;
begin
  select id into b from public.profiles where email = 'buyer@example.com';
  if b is null then return; end if;
  if exists (select 1 from public.purchases where user_id = b) then return; end if;
  insert into public.purchases (user_id, email, stripe_checkout_session_id, sku, key, amount_total, currency, status, created_at)
  values (b, 'buyer@example.com', 'cs_seed_buyer_1', 'the-field-guide', 'a1b2c3d4', 500, 'usd', 'paid', now() - interval '14 days');
  /* and what a purchase grants (ledger-rules.js grantsOf): the paid class and the book — a purchase row alone told the
     buyer they held nothing, which no real checkout ever does */
  insert into public.entitlements (user_id, kind, key, source, source_id, active)
  values (b, 'class', 'paid', 'purchase', 'cs_seed_buyer_1', true),
         (b, 'product', 'the-field-guide', 'purchase', 'cs_seed_buyer_1', true);
end $$;

-- THE COACHING CHAT, so a coach opening the tab after a reset finds somebody to answer. A thread
-- between the member and the coach with a few lines both ways, and one from the second member to
-- the administrator that nobody has answered yet — which is the inbox's "awaiting your reply", the
-- state the order and the badge are for.
do $$
declare c uuid; a uuid; m uuid; m2 uuid; conv uuid; conv2 uuid;
begin
  select id into c from public.profiles where email = 'coach@example.com';
  select id into a from public.profiles where email = 'admin@example.com';
  select id into m from public.profiles where email = 'member@example.com';
  select id into m2 from public.profiles where email = 'member2@example.com';
  if c is null or a is null or m is null or m2 is null then return; end if;
  if exists (select 1 from public.conversations) then return; end if;

  insert into public.conversations (member_id, provider_id) values (m, c) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, last_read_at) values (conv, m, now()), (conv, c, now());
  insert into public.messages (conversation_id, sender_id, kind, body, created_at) values
    (conv, m, 'text', 'I read the first three chapters twice and the second one still will not sit. Is that me or the book?', now() - interval '2 days'),
    (conv, c, 'text', 'It is the book — that chapter assumes the one after it. Read four, then go back to two and tell me if it lands.', now() - interval '2 days' + interval '3 hours'),
    (conv, m, 'text', 'That worked. Thank you.', now() - interval '1 day');

  insert into public.conversations (member_id, provider_id) values (m2, a) returning id into conv2;
  insert into public.conversation_members (conversation_id, user_id, last_read_at) values (conv2, m2, now()), (conv2, a, now() - interval '1 day');
  insert into public.messages (conversation_id, sender_id, kind, body, created_at) values
    (conv2, m2, 'text', 'Finished the field guide this week. What would you put next — the workshop, or the quiet room?', now() - interval '5 hours');
end $$;
