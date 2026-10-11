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

-- EVERY BOOKING THAT ALREADY HOLDS A TIME gets the row that now says so. Idempotent: a hold the
-- booking already has is left alone, and a group's hold is written once, on its first seat.
insert into public.booking_holds (booking_uid, user_id, start_at, end_at)
select coalesce(b.seat_of, b.uid), b.host_id, b.start_at, b.end_at
  from public.bookings b
 where b.provider = 'native' and b.status in ('accepted', 'pending')
   and b.host_id is not null and b.start_at is not null and b.end_at is not null
   and (b.seat_of is null or b.seat_of = b.uid)
   /* a host whose account has gone holds nothing — the booking keeps their id for the record, but
      there is no longer a person whose time could be taken twice */
   and exists (select 1 from public.profiles p where p.id = b.host_id)
   and not exists (select 1 from public.booking_holds h
                    where h.booking_uid = coalesce(b.seat_of, b.uid) and h.user_id = b.host_id)
on conflict do nothing;

-- ONE BUFFER BECAME TWO, and the old one meant both sides: `openStarts` widened a busy interval by
-- it before AND after, so copying it into `buffer_before` alone would quietly halve everybody's
-- breathing room. It is copied across once — guarded by a marker rather than by "where it is still
-- zero", because somebody who deliberately wants nothing after a call must be able to say so.
do $$
begin
  if not exists (select 1 from public.app_settings where key = 'buffers_split') then
    update public.provider_schedules set buffer_after = buffer_before where buffer_before > 0;
    insert into public.app_settings (key, value) values ('buffers_split', '1')
    on conflict (key) do nothing;
  end if;
end $$;

-- every set of hours has a name and one of them is the default; a person who kept hours before there
-- was more than one set keeps them as their default, called what cal.com calls it
update public.provider_schedules set name = 'Working hours' where coalesce(btrim(name), '') = '';
update public.provider_schedules s set is_default = true
 where not exists (select 1 from public.provider_schedules d where d.user_id = s.user_id and d.is_default);

-- an override written before there was more than one set of hours belongs to the default one
update public.provider_overrides o set schedule_id = s.id
  from public.provider_schedules s
 where o.schedule_id is null and s.user_id = o.user_id and s.is_default;

-- WHAT A BOOK'S KIND DERIVED, OFF PRINT'S OWN COLUMNS AND ONTO THE GENERIC SLOT.
-- fulfilments carried book, edition, format, contents, cloth and foil beside `chosen`, which is
-- the slot every other kind writes; that is what made the table a print_orders with a wider name.
-- Nothing reads them now. They cannot be dropped in the same deploy as this backfill — the plan is
-- renames, then the diff, then this script, so a drop would run BEFORE the rows were carried over
-- — so they are dropped in the deploy after the one that runs this.
-- A row whose variant was never written (every row made before the store sold anything but books)
-- is the reason this exists rather than deriving from the variant at read time.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'fulfilments' and column_name = 'book') then
    execute $q$
      update public.fulfilments f set chosen = jsonb_strip_nulls(jsonb_build_object(
               'book', f.book, 'edition', f.edition, 'format', f.format,
               'contents', f.contents, 'cloth', f.cloth, 'foil', f.foil))
       where f.chosen is null and f.book is not null
    $q$;
    execute $q$
      update public.fulfilments f
         set variant = concat_ws('.', nullif(f.contents, ''), nullif(f.cloth, ''), nullif(f.foil, ''))
       where coalesce(f.variant, '') = '' and nullif(f.contents, '') is not null
    $q$;
  end if;
end $$;

-- A PAID SESSION'S WEEK OF CHAT IS READ FROM THE BOOKING (chat_session_with, 50-chat.sql), and is no
-- longer a `subscribed` grant: the grants it once wrote, keyed `session:<uid>`, are closed — they made
-- a session's buyer a member everywhere a membership is asked. Re-runnable: nothing writes them now.
update public.entitlements set active = false
 where kind = 'class' and key = 'subscribed' and source_id like 'session:%' and active;
