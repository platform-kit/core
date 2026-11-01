-- The kit's data that is not schema: what a database holds as rows rather than as objects, so the
-- diff cannot see it — the extensions, the buckets, and the settings the cron reads. Every statement
-- is idempotent: the script runs whole on every plan and every reset. Scheduled jobs are generated
-- from enabled module manifests by assemble.mjs, after the kit and site row scripts. Never a
-- migration; never a table or a policy (those are declared under schemas/).

-- extensions: cron, the http client the cron's functions post with, and the crypto the keys are made with
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists btree_gist with schema extensions;   -- a host's time never booked twice (the exclusion constraint on bookings)
create extension if not exists vector with schema extensions;        -- what somebody told an assistant, recalled by meaning (copilot_memory; gte-small, 384 wide)

-- buckets: a row each, brought to these limits and types on every run (a bucket is never dropped here)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('audio',   'audio',   true,  104857600, array['audio/mpeg', 'application/json']),
  ('models',  'models',  true,  536870912, array['application/octet-stream', 'application/json']),
  ('chat',    'chat',    false, 20971520,  array['audio/mpeg', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']),
  ('spaces',  'spaces',  false, 104857600, array['audio/mpeg', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'video/mp4', 'video/webm', 'video/quicktime']),   -- what is attached to a message, and a feed post's pictures and videos, under the channel's id
  -- WHAT PRINT ACTUALLY PUTS HERE. The interior and every cover as PDF, the manifest and the
  -- registry as JSON, the EPUB — which was NOT on this list, so every epub upload would have been
  -- refused the first time a book was really set — and the type the cloud renderer fetches once
  -- per worker, since an Edge Function has no fonts of its own.
  ('print',   'print',   false, 209715200, array['application/pdf', 'application/json', 'application/epub+zip', 'font/ttf', 'font/otf', 'text/plain', 'application/octet-stream']),
  ('support', 'support', false, 10485760,  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/mpeg', 'application/pdf', 'text/plain']),
  ('network', 'network', false, 104857600, array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']),   -- a post's pictures and videos (and each video's first frame), under its author's id; read by whoever may read the post; a picture is held to 10 MB by the composer
  ('social',  'social',  false, 104857600, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('forms',   'forms',   false, 26214400,  null),
  ('avatars', 'avatars', true,  2097152,   array['image/png', 'image/jpeg', 'image/gif', 'image/webp']),   -- a person's own picture, under their id; public, since a face is shown wherever they are
  ('recordings', 'recordings', false, 2147483648, null),   -- a call's recording and transcript under the booking's uid (session-recordings), written by the functions alone
  ('content-assets', 'content-assets', true, 52428800, null)   -- cloud mode's uploads and covers, by their path under content/, public
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- the cron's settings: where the functions are and the key they are called with. The local stack's from
-- the start; a hosted project's are written by the functions-run function itself on its first authorised
-- call (deploy makes one, dry) — so the rows are only ever seeded, never overwritten here.
insert into public.app_settings (key, value) values
  ('functions_url', 'http://kong:8000/functions/v1'),
  ('functions_secret', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU')
on conflict (key) do nothing;

-- Provider-scoped commerce identities preserve the historical Stripe id as-is. Non-Stripe
-- checkout identities are provider-prefixed by the shared ledger at write time.
update public.purchases
   set checkout_identity = stripe_checkout_session_id
 where checkout_identity is null and nullif(btrim(stripe_checkout_session_id), '') is not null;

update public.usage_meter_reports r
   set user_id = p.id
  from public.profiles p
 where r.user_id is null
   and nullif(btrim(r.stripe_customer_id), '') = p.stripe_customer_id;

update public.usage_topup_attempts
   set payment_provider_id = 'stripe',
       provider_payment_intent_id = stripe_payment_intent_id
 where stripe_payment_intent_id is not null
   and provider_payment_intent_id is null;

-- Existing Stripe-shaped columns are kept for compatibility. Copy their external IDs into the
-- provider-scoped index without rewriting purchases, subscriptions, orders, grants, or ownership.
-- Every insert is repeatable: a plan runs this data script on populated databases as well as reset.
insert into public.payment_provider_refs (provider, object_type, external_id, entity_type, entity_id)
select 'stripe', 'customer', p.stripe_customer_id, 'profiles', p.id::text
  from public.profiles p
 where nullif(btrim(p.stripe_customer_id), '') is not null
union all
select 'stripe', 'checkout', p.stripe_checkout_session_id, 'purchases', p.id::text
  from public.purchases p
 where nullif(btrim(p.stripe_checkout_session_id), '') is not null
union all
select 'stripe', 'payment', p.stripe_payment_intent_id, 'purchases', p.id::text
  from public.purchases p
 where nullif(btrim(p.stripe_payment_intent_id), '') is not null
union all
select 'stripe', 'price', p.price_id, 'purchases', p.id::text
  from public.purchases p
 where p.stripe_checkout_session_id is not null and nullif(btrim(p.price_id), '') is not null
union all
select 'stripe', 'product', p.product_id, 'purchases', p.id::text
  from public.purchases p
 where p.stripe_checkout_session_id is not null and nullif(btrim(p.product_id), '') is not null
union all
select 'stripe', 'subscription', s.id, 'subscriptions', s.id
  from public.subscriptions s
 where position(':' in s.id) = 0
union all
select 'stripe', 'price', s.price_id, 'subscriptions', s.id
  from public.subscriptions s
 where position(':' in s.id) = 0 and nullif(btrim(s.price_id), '') is not null
union all
select 'stripe', 'price', s.usage_price_id, 'subscriptions', s.id
  from public.subscriptions s
 where position(':' in s.id) = 0 and nullif(btrim(s.usage_price_id), '') is not null
union all
select 'stripe', 'meter', s.usage_meter, 'subscriptions', s.id
  from public.subscriptions s
 where position(':' in s.id) = 0 and nullif(btrim(s.usage_meter), '') is not null
union all
select 'stripe', 'customer', r.stripe_customer_id, 'usage_meter_reports', r.usage_event_id::text
  from public.usage_meter_reports r
 where nullif(btrim(r.stripe_customer_id), '') is not null
union all
select 'stripe', 'usage_event', r.identifier, 'usage_meter_reports', r.usage_event_id::text
  from public.usage_meter_reports r
 where nullif(btrim(r.identifier), '') is not null
union all
select 'stripe', 'payment', a.stripe_payment_intent_id, 'usage_topup_attempts', a.id::text
  from public.usage_topup_attempts a
 where nullif(btrim(a.stripe_payment_intent_id), '') is not null
union all
select a.payment_provider_id, 'payment', a.provider_payment_intent_id, 'usage_topup_attempts', a.id::text
  from public.usage_topup_attempts a
 where nullif(btrim(a.provider_payment_intent_id), '') is not null
union all
select 'stripe', 'invoice', split_part(g.source_id, ':', 2), 'usage_grants', g.id::text
  from public.usage_grants g
 where g.source = 'subscription' and g.source_id like 'invoice:%'
   and nullif(btrim(split_part(g.source_id, ':', 2)), '') is not null
union all
select 'stripe', 'payment', split_part(g.source_id, ':', 2), 'usage_grants', g.id::text
  from public.usage_grants g
 where g.source = 'purchase' and g.source_id like 'topup:%'
   and nullif(btrim(split_part(g.source_id, ':', 2)), '') is not null
union all
select 'stripe',
       'checkout', split_part(e.source_id, ':', 1), 'entitlements', e.id::text
  from public.entitlements e
 where e.source = 'purchase'
   and nullif(btrim(split_part(e.source_id, ':', 1)), '') is not null
   and not exists (
     select 1 from public.payment_provider_refs r
      where r.provider <> 'stripe'
        and r.object_type = 'checkout'
        and r.entity_type = 'entitlements'
        and r.entity_id = e.id::text
   )
union all
select 'stripe', 'subscription', e.source_id, 'entitlements', e.id::text
  from public.entitlements e
 where e.source = 'subscription'
   and position(':' in e.source_id) = 0
on conflict do nothing;

insert into public.payment_events (provider, event_id, type, received_at)
select 'stripe', e.id, e.type, e.received_at
  from public.stripe_events e
on conflict do nothing;

-- the spaces' memberships re-read against what fills them, hourly: a tier that lapsed takes its
-- rooms with it without anybody having to do anything.
-- the agent loop: the sweep picks up a run whose worker died (the worker asks for itself while it
-- is alive, so this is the backstop and normally finds nothing), and the clock wakes the bots that
-- keep one. Both do nothing at all when there is nothing waiting.
-- a message written now and due at nine: the minute it is due, it is sent like any other.

-- WHAT `role` SAID, `roles` NOW HOLDS. A person had exactly one word; they now hold it in a set,
-- and a reader ('user') holds nothing at all. This runs after the schema and before the seed, on
-- every reset and every deploy, and does nothing once everybody has been carried across — which is
-- what makes it safe to leave here until `role` is dropped by a change of its own.
update public.profiles
   set roles = array[role]
 where cardinality(roles) = 0
   and role is not null
   and role <> 'user';

-- WHAT `coach` MEANT, `provider` NOW MEANS. The kit does not know what business a site is: the
-- person who delivers what it sells may be a coach, a healer, a therapist, a consultant or a
-- tutor, so the ROLE is generic and the word a reader sees is the site's own. This carries the
-- old value across wherever it is still held — the set, and the single `role` column behind it —
-- and does nothing once it has. It runs before the check constraint could ever see the old value,
-- because the data script is applied after the schema on every reset and every deploy.
update public.profiles
   set roles = array_replace(roles, 'coach', 'provider')
 where 'coach' = any(roles);
update public.profiles
   set role = 'provider'
 where role = 'coach';

-- A PAID SESSION'S WEEK OF CHAT IS READ FROM THE BOOKING (chat_session_with, 50-chat.sql), and is no
-- longer a `subscribed` grant: the grants it once wrote, keyed `session:<uid>`, are closed — they made
-- a session's buyer a member everywhere a membership is asked. Re-runnable: nothing writes them now.
update public.entitlements set active = false
 where kind = 'class' and key = 'subscribed' and source_id like 'session:%' and active;
