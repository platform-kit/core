-- the spaces' seed: a direct message, and a morning in the staff room
-- The seed's shape: applied after the kit's seed.sql on a local reset, and assembled only while the module is on
-- (openspec: module-switch-removes-backend). Never reaches production.

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
