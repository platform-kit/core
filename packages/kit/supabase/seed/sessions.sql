-- the sessions' seed: the coach's hours and offerings, so a booking type can be booked after a reset
-- The seed's shape: applied after the kit's seed.sql on a local reset, and assembled only while the module is on
-- (openspec: module-switch-removes-backend). Never reaches production.

do $$
declare a uuid; c uuid;
begin
  select id into a from public.profiles where email = 'admin@example.com';
  select id into c from public.profiles where email = 'coach@example.com';
  if c is null then return; end if;
  if exists (select 1 from public.provider_schedules where user_id = c) then return; end if;
  -- the coach's hours: weekday mornings in Amsterdam, a day's notice — so a native booking type can be booked after a reset
  insert into public.provider_schedules (user_id, name, is_default, timezone, weekly, buffer_before, buffer_after, notice_hours, max_per_day)
  values (c, 'Working hours', true, 'Europe/Amsterdam', '{"1":[["09:00","12:00"]],"2":[["09:00","12:00"]],"3":[["09:00","12:00"]],"4":[["09:00","12:00"]],"5":[["09:00","12:00"]]}'::jsonb, 0, 0, 24, 0),
         (a, 'Working hours', true, 'Europe/Amsterdam', '{"2":[["14:00","17:00"]],"4":[["14:00","17:00"]]}'::jsonb, 15, 15, 24, 0);
  -- a SECOND named set for the coach, so the panel and a type's "schedule:" are on screen after a reset
  insert into public.provider_schedules (user_id, name, is_default, timezone, weekly, buffer_before, buffer_after, notice_hours, max_per_day)
  values (c, 'Evenings', false, 'Europe/Amsterdam', '{"2":[["18:00","21:00"]],"4":[["18:00","21:00"]]}'::jsonb, 0, 10, 12, 2);
  -- THE COACH'S OWN OFFERINGS, so the two kinds of bookable thing are on the screen after a reset:
  -- one live and free, one live and priced, one still waiting to be read. The site's own switch is
  -- off by default, so these are invisible until content/providers.md says offerings: on — which is
  -- exactly what a site turning the feature on should see happen.
  insert into public.provider_offerings (provider_id, slug, title, sub, about, minutes, price_cents, "where", place, state, released_at, released_by)
  values (c, 'a-walk-and-a-talk', 'A walk and a talk', 'Outside, if the weather holds',
          'Forty-five minutes on your feet. Bring one thing you are turning over and we will walk until it is smaller.',
          45, 0, 'place', 'Vondelpark, Amsterdam', 'live', now(), a),
         (c, 'a-deep-dive', 'A ninety-minute deep dive', 'One thing, all the way down',
          'For when a session is not long enough. We take one question and stay with it.',
          90, 9000, 'video', null, 'live', now(), a),
         (c, 'a-first-conversation', 'A first conversation', 'Twenty minutes, no charge',
          'To find out whether we should work together at all.', 20, 0, 'video', null, 'waiting', null, null)
  on conflict do nothing;
end $$;
