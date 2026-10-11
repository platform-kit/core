-- The seed's shape — the kit's part of a site's seed (packages/kit/supabase/seed.sql). Runs after the
-- migrations on `supabase db reset`, and only then: `db push` (the deploy) never touches it, so nothing
-- here reaches production. A site's own rows follow, in the same assembled file (platformkit assemble).
--
-- Accounts. Auth users are written straight into auth.users (the way GoTrue stores them: a bcrypt
-- password, the email confirmed, an email identity), so the handle_new_user trigger makes their
-- profiles as it would for a sign-up. All share the password `password123`. The addresses are
-- example.com — never a real person's.
--
--   admin@example.com    roles {admin}    — the site's administrator, who reaches everything
--   coach@example.com    roles {provider} — a provider and nothing else: the chat, their hours, the community
--                        (the site calls them a Coach; the kit's word for the role is provider)
--   support@example.com  roles {support}  — the support desk, and not a provider
--   editor@example.com   roles {editor}   — writes the content, sells nothing, sees no figures
--   analyst@example.com  roles {analyst}  — reads the dashboards and writes nothing anywhere
--   writer@example.com   roles {provider,editor} — two roles at once, to show that neither leaks into the other
--   member@example.com   a member (the site's seed grants the membership)
--   member2@example.com  a second member (Priya Natarajan)
--   buyer@example.com    a customer (the site's seed gives them a purchase)
--   free@example.com     signed in, nothing bought
--
-- A reset wipes whatever was made since, including any account signed up locally: an account that
-- should survive goes in the site's seed. In production an admin is made by hand in the SQL editor:
--   select public.set_roles((select id from public.profiles where email = 'you@example.com'), array['admin']);
--
-- A direct message for the seed: what space_dm_open does, without a session to be the asker.
create or replace function public.seed_dm(p_space uuid, p_who uuid[]) returns uuid
    language plpgsql security definer set search_path to 'public' as $dm$
declare ids uuid[]; k text; cid uuid; u uuid;
begin
  select array_agg(distinct x) into ids from unnest(p_who) as x where x is not null;
  if array_length(ids, 1) is null or array_length(ids, 1) < 2 then return null; end if;
  select string_agg(x::text, ',' order by x::text) into k from unnest(ids) as x;
  select id into cid from public.channels where space_id = p_space and dm_key = k;
  if cid is null then
    insert into public.channels (space_id, slug, name, kind, dm_key, mode, visibility, created_by)
    values (p_space, 'dm-' || substr(md5(k), 1, 12), '', 'dm', k, 'stream', 'private', ids[1])
    on conflict (space_id, dm_key) do update set dm_key = excluded.dm_key
    returning id into cid;
  end if;
  foreach u in array ids loop
    insert into public.channel_members (channel_id, user_id) values (cid, u) on conflict do nothing;
  end loop;
  return cid;
end;
$dm$;
REVOKE ALL ON FUNCTION public.seed_dm(uuid, uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.seed_dm(uuid, uuid[]) TO service_role;

-- The helper is kept as public.seed_user so the site's rows can make accounts of their own.
create or replace function public.seed_user(p_email text, p_name text) returns uuid
language plpgsql as $$
-- THE SAME PERSON GETS THE SAME ID ON EVERY RESET, derived from their address. A random one
  -- meant that every reset signed every open browser out: the access token in the tab names a
  -- person who no longer exists, every read comes back empty, and a developer mid-way through
  -- something is thrown out of it. The shape is a valid v4 so nothing downstream blinks at it.
  declare uid uuid := ('00000000-0000-4000-8000-' || substr(md5(lower(btrim(p_email))), 1, 12))::uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user, is_anonymous
  ) values (
    uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name), now(), now(),
    '', '', '', '', false, false
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now());
  return uid;
end $$;

do $$
declare a uuid; c uuid; s uuid; e uuid; n uuid; w uuid; m uuid; m2 uuid; b uuid; f uuid;
begin
  if exists (select 1 from auth.users where email = 'admin@example.com') then return; end if;
  a  := public.seed_user('admin@example.com',   'Admin Person');
  c  := public.seed_user('coach@example.com',   'Coach Person');
  s  := public.seed_user('support@example.com', 'Sam Support');
  e  := public.seed_user('editor@example.com',  'Edie Editor');
  n  := public.seed_user('analyst@example.com', 'Ana Analyst');
  w  := public.seed_user('writer@example.com',  'Wren Writer');
  m  := public.seed_user('member@example.com',  'Member Person');
  m2 := public.seed_user('member2@example.com', 'Priya Natarajan');
  b  := public.seed_user('buyer@example.com',   'Bea Buyer');
  f  := public.seed_user('free@example.com',    'Free Person');
  -- the site's own: an administrator, a provider, and somebody on the support desk. They are sets,
  -- so the provider is a provider and nothing more — not an administrator who happens to deliver.
  update public.profiles set roles = array['admin'], role = 'admin' where id = a;
  -- the legacy `role` column means nothing any more (a capability is asked of the set); the coach
  -- had 'admin' there because coaching once required it, and leaving it said the wrong thing
  update public.profiles set roles = array['provider'], role = 'user' where id = c;
  -- and their OWN word for what they are, which beats the site's wherever they are named
  update public.profiles set title = 'Somatic Coach' where id = c;
  -- USERNAMES for the people who have a page: somebody's own page is /p/<username>, and a managed
  -- booking type's copy is addressed at the type and their name, so a provider with no username has
  -- no page and no copy. The seed gives one to everybody who gives appointments.
  -- and their page is public, because a provider whose page nobody can open has nowhere to be
  -- booked: /p/<username> is the address a managed type's copy lives at.
  update public.profiles set username = 'coach', public_profile = true where id = c and username is null;
  update public.profiles set username = 'writer', public_profile = true where id = w and username is null;
  update public.profiles set username = 'admin', public_profile = true where id = a and username is null;
  update public.profiles set roles = array['support'], role = 'support' where id = s;
  update public.profiles set roles = array['editor'],  role = 'user'    where id = e;
  update public.profiles set roles = array['analyst'], role = 'user'    where id = n;
  update public.profiles set roles = array['provider', 'editor'], role = 'user' where id = w;
  update public.profiles set email_verified_at = now() where id in (a, c, s, e, n, w, m, m2, b, f);
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

-- A MORNING IN THE STAFF ROOM. The rooms themselves are NOT here: a space, its channels and its
-- roles are a declaration and live in the site's own files (content/spaces/**), projected into the
-- tables by build/spaces-push.mjs. What is here is what nobody could declare — a conversation with
-- a thread, two mentions (one of them unanswered, so the staff's desk lists a channel beside the
-- support desk and the coaching thread), a reaction, and one line the platform wrote itself.
--
-- It is a FUNCTION rather than a do-block because it runs after the reset rather than during it:
-- `platformkit migrate reset` resets, projects the declaration, and then asks for this. It does
-- nothing when the rooms are not there yet, and nothing a second time.
CREATE OR REPLACE FUNCTION "public"."seed_spaces_demo"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $seed$
declare a uuid; c uuid; s uuid; sp uuid; gen uuid; ops uuid; brd uuid; root uuid; mid uuid; dm1 uuid;
begin
  select id into sp from public.spaces where slug = 'the-team';
  if sp is null then return 0; end if;
  select id into gen from public.channels where space_id = sp and slug = 'general';
  select id into ops from public.channels where space_id = sp and slug = 'orders';
  select id into brd from public.channels where space_id = sp and slug = 'hiring';
  if gen is null or ops is null then return 0; end if;
  if exists (select 1 from public.space_messages where channel_id = gen) then return 0; end if;
  select id into a from public.profiles where email = 'admin@example.com';
  select id into c from public.profiles where email = 'coach@example.com';
  select id into s from public.profiles where email = 'support@example.com';
  if a is null then return 0; end if;

  perform public.space_sync_members();
  insert into public.space_member_roles (space_id, user_id, role_id)
  select sp, a, r.id from public.space_roles r where r.space_id = sp and r.slug = 'owner'
  on conflict do nothing;

  insert into public.channel_members (channel_id, user_id)
    select x.ch, m.user_id from (values (gen), (ops)) as x(ch), public.space_members m where m.space_id = sp
    on conflict do nothing;
  if brd is not null then insert into public.channel_members (channel_id, user_id) values (brd, a) on conflict do nothing; end if;

  insert into public.space_messages (channel_id, author_id, body)
  values (gen, a, 'Morning. The print run for the Kybalion lands this week, so the store page wants a last read.')
  returning id into root;
  insert into public.space_messages (channel_id, author_id, thread_root_id, body)
  values (gen, c, root, 'I can take the copy pass on it today.'),
         (gen, a, root, 'Perfect. The jacket blurb is the only bit I would not touch.');
  insert into public.space_messages (channel_id, author_id, body)
  values (gen, c, 'The coaching calendar is full through Thursday, by the way.');
  insert into public.space_messages (channel_id, author_id, body)
  values (gen, a, 'Nice. <@' || s::text || '> could you keep an eye on the desk while I am on the call?')
  returning id into mid;
  insert into public.space_messages (channel_id, author_id, body)
  values (gen, s, 'Already on it.');
  -- and one back the other way, unanswered: the staff's desk wants a channel waiting on it beside
  -- the guest at the support desk and the member waiting on their coach, or it shows only two of three
  insert into public.space_messages (channel_id, author_id, body)
  values (gen, s, 'When you are back <@' || a::text || '> — the guest asking about Japan is one for you.');
  insert into public.space_reactions (message_id, channel_id, user_id, emoji) values (mid, gen, c, '👍');

  -- one line the platform wrote itself, so the feature is on screen after a reset. Which room hears
  -- which event is the CHANNEL's own line (`hears` in content/spaces/the-team/orders.md) and is
  -- nothing the seed decides; a sale is history and an operations room says what just happened, so
  -- nothing is replayed through the hook. The line carries the facts; the surface says the words
  -- (spaces.md, ## events).
  perform public.space_post(ops, null, jsonb_build_object(
    'event', 'purchase-paid', 'sku', 'the-kybalion-softcover', 'amount', 2400, 'currency', 'usd'));

  -- TWO DIRECT MESSAGES, so the DMs place has something in it after a reset: one between two
  -- people and one between three. A DM is a channel with no name of its own, keyed by who is in it
  -- (dm_key), exactly as space_dm_open makes one — the key is the ids in one order, so there is
  -- never a second room for the same people.
  -- A direct message is inside a space, so it can only be between people that space holds: the
  -- staff space is filled by role, and the coach is not on it. (Seeding one with the coach in it
  -- looked right and was then quietly emptied by the next fill sweep, which was the sweep doing
  -- its job.) The site's own seed adds a second, in its community, so the DMs place shows what it
  -- is for: one list, whichever space each conversation lives in.
  dm1 := public.seed_dm(sp, array[a, s]);
  if dm1 is not null then
    insert into public.space_messages (channel_id, author_id, body) values
      (dm1, s, 'The guest asking about Japan wants a date before they order. What do I tell them?'),
      (dm1, a, 'Say a fortnight from the print run, and that we will write the moment it ships.'),
      (dm1, s, 'Done — and I have put a note on the thread so nobody says anything different.');
    -- the admin has not read the last of it, so the place opens with something to answer
    update public.channel_members set last_read_seq = 0 where channel_id = dm1 and user_id = a;
  end if;

  update public.channel_members set last_read_seq = 0 where channel_id = gen and user_id in (s, c);
  return 1;
end;
$seed$;
REVOKE ALL ON FUNCTION "public"."seed_spaces_demo"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_spaces_demo"() TO "service_role";
