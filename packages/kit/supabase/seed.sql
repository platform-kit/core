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
end $$;

