-- ---------------------------------------------------------------------------------------------
-- WHAT AN ENCRYPTED CHANNEL KEEPS IN THE DATABASE — which is as little as it can and still work.
--
-- AFTER THE MATRIX SURFACE (91), because the key endpoints these tables answer are served from it
-- and the declaration is applied in the order these files are named.
--
-- Four tables, and every one of them is STATE: a device is an ACT — somebody signed a client in on
-- a laptop — never a file, and nothing a redeploy should bring back. If the database were dropped,
-- every reader would set a device up again and the messages already sent would be unreadable,
-- which is the guarantee working rather than the guarantee failing.
--
-- ONLY PUBLIC KEYS AND OPAQUE BLOBS ARE HERE, and that is the whole of why the guarantee is true
-- rather than decorative. A private key never leaves the browser except into `space_key_backups`,
-- sealed under a recovery key the reader keeps and the site has never seen — so the backup is a
-- blob this database cannot read, not a column it can. A schema that could open its own backups
-- would be a schema whose owner can read every room, which is the thing being refused.
--
-- The module is `space-encryption` (packages/kit/build/modules/kit.mjs), separate from `spaces` on
-- purpose: encryption costs a site the search of a room, the bots in it, and the moderating of
-- what nobody can read, and a site that wants rooms should not have to take that bargain to get
-- them. With the module off this file still applies — a table nothing writes to is free — but the
-- spaces compile refuses `encrypted: true`, so nothing ever reaches these tables.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- A DEVICE. One row per (person, device): the public identity and signing keys a correspondent
-- needs in order to seal something only this device can open, and the cross-signing keys that let
-- one of a person's devices vouch for another.
--
-- The device id is the Matrix one, which is the same id `matrix_sessions` keeps — a client that
-- signs in and then uploads its keys is the same device both times. It is NOT a foreign key to
-- that table: our own web client has a device and no Matrix session, and a Matrix client that
-- signs out should not take its keys with it, or every message anybody sealed to that device
-- becomes unreadable the moment somebody closes a laptop.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."space_devices" (
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    -- what a client calls it in a list of its owner's devices ("Ada's laptop")
    "display_name" "text",
    -- the device's public keys, as Matrix hands them over: { "curve25519:ABC": "...", "ed25519:ABC": "..." }
    "keys" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- and the algorithms it will accept a session in
    "algorithms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    -- the device's own signature over its keys, which is what makes them its own rather than
    -- whatever the server felt like serving
    "signatures" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- a person's three cross-signing keys, kept on the row of no device in particular: the device
    -- whose id is '' is the person themselves. Master vouches for self-signing and user-signing;
    -- self-signing vouches for their other devices; user-signing for other people's masters.
    "cross_signing" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "space_devices_device_check" CHECK (("char_length"("device_id") <= 120))
);
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_devices" ADD CONSTRAINT "space_devices_pkey" PRIMARY KEY ("user_id", "device_id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_devices" ADD CONSTRAINT "space_devices_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "space_devices_user_idx" ON "public"."space_devices" USING "btree" ("user_id");

ALTER TABLE "public"."space_devices" ENABLE ROW LEVEL SECURITY;

-- A PERSON OWNS THEIR OWN DEVICES, and may read the PUBLIC keys of anybody they share a room with.
-- Both halves matter. Without the first, nobody can register a device; without the second, nobody
-- can seal a message to anybody, because sealing means knowing the other side's public key.
--
-- The fence is the rooms, not the whole site: a reader learns the devices of the people they could
-- already be talking to and nobody else, so the table is not a directory of everybody who ever
-- signed up and what they read on.
DROP POLICY IF EXISTS "space_devices_own" ON "public"."space_devices";
CREATE POLICY "space_devices_own" ON "public"."space_devices"
  USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "space_devices_shared_room" ON "public"."space_devices";
CREATE POLICY "space_devices_shared_room" ON "public"."space_devices" FOR SELECT
  USING ((EXISTS (
    SELECT 1 FROM "public"."space_members" "m"
     WHERE "m"."user_id" = "public"."space_devices"."user_id"
       AND "m"."space_id" IN (SELECT "public"."my_space_ids"())
  )));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."space_devices" TO "authenticated";
GRANT ALL ON TABLE "public"."space_devices" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- ONE-TIME KEYS. A public key a correspondent claims in order to start a session with a device
-- that is not online to agree one. Each is claimable EXACTLY ONCE — that is the whole point of
-- the table, and it is a property of the delete, not of anybody's good manners.
--
-- A claim is `delete ... returning`, which is atomic: two callers racing for the last key, one
-- gets it and one gets nothing. A `select` then `delete` would hand the same key to both, and two
-- sessions built on one key is the failure this kind of table exists to prevent.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."space_one_time_keys" (
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    -- Matrix's own name for it, algorithm and id: "signed_curve25519:AAAAAQ"
    "key_id" "text" NOT NULL,
    "algorithm" "text" NOT NULL,
    -- the key itself, with its signature, exactly as the device uploaded it
    "key" "jsonb" NOT NULL,
    -- a fallback key is NOT one-time: it is served when the one-time keys have run out, and is
    -- never deleted by a claim. Without one, a device that has been offline long enough to exhaust
    -- its keys cannot be reached at all.
    "fallback" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_one_time_keys" ADD CONSTRAINT "space_one_time_keys_pkey" PRIMARY KEY ("user_id", "device_id", "key_id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_one_time_keys" ADD CONSTRAINT "space_one_time_keys_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- a device's unclaimed keys, oldest first: what a claim reaches for and what a count counts
CREATE INDEX IF NOT EXISTS "space_one_time_keys_device_idx" ON "public"."space_one_time_keys" USING "btree" ("user_id", "device_id", "fallback", "created_at");

ALTER TABLE "public"."space_one_time_keys" ENABLE ROW LEVEL SECURITY;

-- A DEVICE UPLOADS ITS OWN AND NOBODY ELSE'S. There is deliberately NO select policy for anybody
-- but the owner: a claim goes through `matrix-api` with the service role, because claiming is a
-- delete and a client that could delete these rows could empty somebody's keys and make them
-- unreachable. Reading one's own is allowed so a client can see how many it has left.
DROP POLICY IF EXISTS "space_one_time_keys_own" ON "public"."space_one_time_keys";
CREATE POLICY "space_one_time_keys_own" ON "public"."space_one_time_keys"
  USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."space_one_time_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."space_one_time_keys" TO "service_role";

-- CLAIMING ONE, ATOMICALLY — and it has to be a function, because PostgREST has no
-- `DELETE … ORDER BY … LIMIT 1`. Writing it as a select and then a delete from the client would
-- hand the same key to two callers racing for the last one, and two sessions built on one key is
-- exactly what a one-time key exists to prevent. Here the delete picks its row in the same
-- statement, so one caller gets it and the other gets nothing.
--
-- The FALLBACK is returned only when the one-time keys have run out, and is never deleted: a
-- device offline long enough to exhaust its keys is still reachable, which is the whole reason a
-- fallback exists.
CREATE OR REPLACE FUNCTION "public"."space_claim_otk"("p_user" "uuid", "p_device" "text", "p_algorithm" "text")
    RETURNS TABLE ("key_id" "text", "key" "jsonb")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  delete from public.space_one_time_keys k
   where k.user_id = p_user and k.device_id = p_device and k.algorithm = p_algorithm and not k.fallback
     and k.key_id = (
       select k2.key_id from public.space_one_time_keys k2
        where k2.user_id = p_user and k2.device_id = p_device and k2.algorithm = p_algorithm and not k2.fallback
        order by k2.created_at, k2.key_id
        limit 1
        for update skip locked
     )
  returning k.key_id, k.key;

  if found then return; end if;

  return query
  select f.key_id, f.key from public.space_one_time_keys f
   where f.user_id = p_user and f.device_id = p_device and f.algorithm = p_algorithm and f.fallback
   limit 1;
end $$;
-- the service role alone: a claim deletes somebody else's row, and matrix-api is the only caller.
REVOKE ALL ON FUNCTION "public"."space_claim_otk"("uuid", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_claim_otk"("uuid", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_claim_otk"("uuid", "text", "text") TO "service_role";

-- …AND THE SAME CLAIM FOR THE SITE'S OWN BROWSER, which has no Matrix session to reach
-- matrix-api with. The caller is whoever is signed in, and the fence is the one the devices
-- already have: a key may be claimed from somebody you SHARE A SPACE WITH and nobody else.
--
-- A claim is spending somebody else's key, so an unfenced one is a way to empty a stranger's
-- keys. Within a shared space it is not a weapon: Matrix is built so that running out falls back
-- to the fallback key, which is never deleted, so the worst a member can do to another member is
-- make them use it. Across the site it would be a way to reach anybody at all, which is why the
-- fence is the space rather than nothing.
CREATE OR REPLACE FUNCTION "public"."space_claim_key"("p_user" "uuid", "p_device" "text", "p_algorithm" "text")
    RETURNS TABLE ("key_id" "text", "key" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $BODY$
begin
  if auth.uid() is null then return; end if;
  if p_user <> auth.uid() and not exists (
    select 1 from public.space_members m
     where m.user_id = p_user and m.space_id in (select public.my_space_ids())
  ) then
    return;   -- not somebody you share a room with: no keys, and no word about whether they exist
  end if;
  return query select * from public.space_claim_otk(p_user, p_device, p_algorithm);
end $BODY$;
REVOKE ALL ON FUNCTION "public"."space_claim_key"("uuid", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_claim_key"("uuid", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_claim_key"("uuid", "text", "text") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- AND SENDING ONE, for the same reason.
--
-- `space_to_device` has no insert policy on purpose: one that let a client write into another
-- person's queue would let anybody deliver anything to anybody as anybody — including a forged
-- room key, which would look exactly like a real one. matrix-api writes with the service role
-- because it has established who the caller is; the site's own browser needs the same door, and
-- this is it.
--
-- The sender is `auth.uid()` and never anything the caller passes. The recipient must share a
-- space. The body is opaque — it is already sealed to the recipient device — so what this writes
-- is a ciphertext it cannot read, exactly like a message row.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."space_send_to_device"("p_type" "text", "p_messages" "jsonb")
    RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $BODY$
declare me uuid := auth.uid(); n integer := 0; u text; d text; body jsonb;
begin
  if me is null then raise exception 'sign in first' using errcode = 'insufficient_privilege'; end if;
  if p_type is null or btrim(p_type) = '' then raise exception 'a to-device message has a type'; end if;

  for u in select jsonb_object_keys(coalesce(p_messages, '{}'::jsonb)) loop
    -- the caller's own devices, or somebody they share a space with, and nobody else
    if u::uuid <> me and not exists (
      select 1 from public.space_members m
       where m.user_id = u::uuid and m.space_id in (select public.my_space_ids())
    ) then
      continue;
    end if;
    for d in select jsonb_object_keys(p_messages -> u) loop
      body := p_messages -> u -> d;
      insert into public.space_to_device (user_id, device_id, sender_id, type, content)
      values (u::uuid, d, me, p_type, body);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $BODY$;
REVOKE ALL ON FUNCTION "public"."space_send_to_device"("text", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_send_to_device"("text", "jsonb") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_send_to_device"("text", "jsonb") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- TO-DEVICE MESSAGES. The out-of-band channel Matrix uses to hand a room key from one device to
-- another: queued per device, delivered in the next `/sync`, deleted once acknowledged.
--
-- The body is OPAQUE — it is already sealed to the recipient device, so this table holds a
-- ciphertext it cannot read, exactly like a message row. What it does hold in clear is WHO sent
-- to WHOM, which is unavoidable: a queue has to know whose queue it is.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."space_to_device" (
    "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    -- whose queue this is
    "user_id" "uuid" NOT NULL,
    -- and which of their devices; '*' is every device of theirs, which Matrix allows
    "device_id" "text" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    -- "m.room.encrypted", "m.room_key_request", and the rest
    "type" "text" NOT NULL,
    "content" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_to_device" ADD CONSTRAINT "space_to_device_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_to_device" ADD CONSTRAINT "space_to_device_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_to_device" ADD CONSTRAINT "space_to_device_sender_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- a device's queue in order, which is the only way this table is ever read
CREATE INDEX IF NOT EXISTS "space_to_device_queue_idx" ON "public"."space_to_device" USING "btree" ("user_id", "device_id", "id");

ALTER TABLE "public"."space_to_device" ENABLE ROW LEVEL SECURITY;

-- A PERSON READS AND CLEARS THEIR OWN QUEUE. Sending is NOT a client write: it goes through
-- `matrix-api` with the service role, because an insert policy that let one person write into
-- another's queue is a policy that lets anybody deliver anything to anybody as anybody.
DROP POLICY IF EXISTS "space_to_device_own" ON "public"."space_to_device";
CREATE POLICY "space_to_device_own" ON "public"."space_to_device" FOR SELECT
  USING (("user_id" = "auth"."uid"()));
DROP POLICY IF EXISTS "space_to_device_clear_own" ON "public"."space_to_device";
CREATE POLICY "space_to_device_clear_own" ON "public"."space_to_device" FOR DELETE
  USING (("user_id" = "auth"."uid"()));
GRANT SELECT, DELETE ON TABLE "public"."space_to_device" TO "authenticated";
GRANT ALL ON TABLE "public"."space_to_device" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- THE KEY BACKUP. A reader who opens the community on a second browser has none of the room keys
-- their first browser made, and every message sent before that moment is unreadable there. The
-- backup is how they get them: an opaque blob per session, sealed under a recovery key shown to
-- them ONCE and never again, because the site never had it to show twice.
--
-- The site cannot read this and that is the design, not a limitation. What it can do is keep it,
-- serve it back, and count versions — a new version is a reader starting again, and the old one
-- stays until they say otherwise, since a backup deleted in error is a year of conversation gone.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."space_key_backups" (
    "user_id" "uuid" NOT NULL,
    -- Matrix's backup version, a number as a string, counting up per person
    "version" "text" NOT NULL,
    -- how the blob is sealed, and the public half of the key it is sealed to
    "algorithm" "text" NOT NULL,
    "auth_data" "jsonb" NOT NULL,
    -- the sealed sessions themselves, keyed room → session → blob. Opaque.
    "sessions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- what a client shows as "N keys backed up"; kept rather than counted, since the sessions
    -- blob is deliberately not something this database looks inside
    "count" integer DEFAULT 0 NOT NULL,
    "etag" "text",
    -- a reader may keep an old version and start a new one; only one is current
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_key_backups" ADD CONSTRAINT "space_key_backups_pkey" PRIMARY KEY ("user_id", "version");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_key_backups" ADD CONSTRAINT "space_key_backups_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "public"."space_key_backups" ENABLE ROW LEVEL SECURITY;

-- theirs alone, in every direction: nobody else may read a backup, and nobody else may write one.
-- There is no shared-room exception here as there is for the devices, because a backup is not a
-- public key — it is everything that person can read, sealed.
DROP POLICY IF EXISTS "space_key_backups_own" ON "public"."space_key_backups";
CREATE POLICY "space_key_backups_own" ON "public"."space_key_backups"
  USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."space_key_backups" TO "authenticated";
GRANT ALL ON TABLE "public"."space_key_backups" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- AND THE TWO COLUMNS ON TABLES THAT ALREADY EXIST.
-- ---------------------------------------------------------------------------------------------

-- IS THIS ROOM SEALED. PROJECTED, from content/spaces/<space>/<channel>.md, like every other
-- column the file owns — `encryptedOf` in build/spaces-io.mjs resolves the channel's answer
-- against its space's and the compile writes the result here. Nobody sets it in the admin.
ALTER TABLE "public"."channels" ADD COLUMN IF NOT EXISTS "encrypted" boolean DEFAULT false NOT NULL;

-- THE CIPHERTEXT, and the leak that is easy to miss.
--
-- An encrypted message is stored as its opaque event — the ciphertext, the algorithm, the sender
-- key and the session id — and `body`, `title` AND `attachment_name` are left NULL. That third one
-- is the point. `space_messages.fts` is a generated column over exactly those three, so leaving
-- them null means the full-text index holds nothing for the row and search misses the room for
-- free, with no change to the index and no exception anywhere in the search path.
--
-- Were `attachment_name` written, the file name would be searchable while the message was not:
-- "severance-agreement.pdf" findable in a room whose words nobody can read. That is the kind of
-- half-guarantee that reads as a bug and is one.
ALTER TABLE "public"."space_messages" ADD COLUMN IF NOT EXISTS "cipher" "jsonb";

-- a message is one or the other, never both and never neither: a row with a cipher AND a body is a
-- row where somebody wrote the plaintext alongside the ciphertext, which is the whole guarantee
-- undone by one careless insert.
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_messages" ADD CONSTRAINT "space_messages_cipher_clear" CHECK (
    ("cipher" IS NULL) OR ("body" IS NULL AND "title" IS NULL AND "attachment_name" IS NULL)
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AND THE OLDER CHECK HAS TO MAKE ROOM FOR IT. `space_messages_body_check` in 90-spaces.sql says a
-- message of kind 'text' must have a body — written when a body was the only way a message could
-- carry words, and it makes a SEALED text message impossible: the ciphertext is the words, and the
-- body is null by design. The constraint is replaced here rather than loosened there because
-- `cipher` does not exist until this file runs, and 90 is applied first.
--
-- The rule it becomes is the same rule with the second case admitted: a text message carries its
-- words either in the open or sealed, and a row with neither is still refused.
ALTER TABLE "public"."space_messages" DROP CONSTRAINT IF EXISTS "space_messages_body_check";
DO $$ BEGIN
  ALTER TABLE ONLY "public"."space_messages" ADD CONSTRAINT "space_messages_body_check" CHECK (
    ("kind" <> 'text'::"text") OR ("body" IS NOT NULL) OR ("cipher" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------------------------
-- A NOTIFICATION FROM A SEALED ROOM NAMES THE ROOM AND CARRIES NO WORDS.
--
-- It already carries none by construction — `body` and `title` are null on a sealed row, so the
-- push's `left(coalesce(new.title, new.body, ''), 140)` is the empty string. That is the leak
-- closed and the sentence left broken: "Ada in #vault:" with nothing after the colon reads as a
-- notification that failed rather than as a sealed room working.
--
-- So a sealed message gets a TOPIC OF ITS OWN, and the words are a record in `## push` of
-- emails.md like every other topic — not an `if` in the push function. The same facts go with it
-- (who, which room), because those are not secret: the queue has to know whose it is, and the
-- person needs to know where to go.
--
-- `space_after_message` in 90-spaces.sql is replaced here rather than edited there, for the same
-- reason the body check is: `cipher` does not exist until this file runs.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."space_after_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record;
  -- IS THIS ROW SEALED. Everything below that reads words already skips a sealed row for free,
  -- because `body` and `title` are null on one — including the mentions, which are read out of
  -- the body and so simply find none. That is one of the things a sealed room costs and is
  -- documented as such: a client that wants its people mentioned there tells the server who.
  sealed boolean := new.cipher is not null;
begin
  -- YOU HAVE READ WHAT YOU JUST WROTE. Without this a room you spoke in last counts as unread to
  -- you until the surface happens to say otherwise, which is why a room could sit there with a
  -- badge nobody could clear by reading it, and why the count and the list of what is waiting
  -- could disagree about the same room.
  if new.author_id is not null then
    update public.channel_members
       set last_read_seq = greatest(last_read_seq, new.seq)
     where channel_id = new.channel_id and user_id = new.author_id;
  end if;

  if new.thread_root_id is not null then
    update public.space_messages
       set reply_count = reply_count + 1, last_reply_at = new.created_at
     where id = new.thread_root_id;
  end if;

  -- the composer writes a token, never a name, so this resolves exactly and survives a rename;
  -- an id that is not a member of the channel is simply not a mention.
  if new.body is not null then
    insert into public.space_mentions (message_id, channel_id, user_id, kind)
    select distinct new.id, new.channel_id, cm.user_id, 'user'
    -- the alias is never a name this function declares: plpgsql substitutes its own variables into
    -- the query, and a table aliased r beside a record variable r reads as the record.
    from regexp_matches(new.body, '<@([0-9a-fA-F-]{36})>', 'g') as tok(m)
    join public.channel_members cm on cm.channel_id = new.channel_id and cm.user_id = (tok.m[1])::uuid
    on conflict do nothing;

    -- A ROLE IS A GROUP YOU CAN NAME. `@coaches` reaches whoever holds the role in THIS space and
    -- is in THIS room — not everybody with the role everywhere, and not somebody who holds it but
    -- is not here. The role is named by its slug rather than its name, so renaming the role does
    -- not silently stop the mention working.
    insert into public.space_mentions (message_id, channel_id, user_id, kind)
    select distinct new.id, new.channel_id, cm.user_id, 'group'
    from regexp_matches(new.body, '<@role:([a-z0-9-]{1,48})>', 'g') as tok(m)
    join public.channels c on c.id = new.channel_id
    join public.space_roles sr on sr.space_id = c.space_id and sr.slug = tok.m[1]
    join public.space_member_roles mr on mr.role_id = sr.id and mr.space_id = c.space_id
    join public.channel_members cm on cm.channel_id = new.channel_id and cm.user_id = mr.user_id
    on conflict do nothing;

    if new.body like '%<!channel>%' then
      insert into public.space_mentions (message_id, channel_id, user_id, kind)
      select new.id, new.channel_id, cm.user_id, 'channel'
      from public.channel_members cm where cm.channel_id = new.channel_id
      on conflict do nothing;
    end if;

    update public.channel_members cm
       set mention_count = cm.mention_count + 1
      from public.space_mentions sm
     where sm.message_id = new.id and cm.channel_id = new.channel_id and cm.user_id = sm.user_id
       and cm.user_id is distinct from new.author_id;
  end if;

  -- who is told, and why: the decision is its own function so it can be asked directly, and the
  -- push function is handed the person because the right to this one was decided here.
  for r in select * from public.space_notify_targets(new.id) loop
    perform public.space_mail(r.space_notify_targets, new.channel_id, new.id);
    -- A NOTIFICATION FROM A SEALED ROOM NAMES THE ROOM AND CARRIES NO WORDS. It already carries
    -- none — `body` below is the empty string for a sealed row — and an empty body is the leak
    -- closed and the sentence left broken: "Ada in #vault:" with nothing after the colon reads as
    -- a notification that failed rather than as a sealed room working. So it is a TOPIC of its
    -- own, whose words are a record in `## push` of emails.md like every other topic.
    perform public.push_notify(case when sealed then 'space-mention-sealed' else 'space-mention' end, jsonb_build_object(
      'user', r.space_notify_targets, 'channel_id', new.channel_id,
      'channel', (select c.name from public.channels c where c.id = new.channel_id),
      'name', coalesce((select nullif(p.display_name, '') from public.profiles p where p.id = new.author_id), 'Someone'),
      'body', left(coalesce(new.title, new.body, ''), 140)));
  end loop;

  perform public.space_wake(new.channel_id, 'message', jsonb_build_object(
    'id', new.id, 'seq', new.seq, 'channel', new.channel_id, 'root', new.thread_root_id,
    'author', new.author_id, 'kind', new.kind, 'title', new.title,
    'body', case when length(coalesce(new.body, '')) <= 4000 then new.body else null end,
    -- …and the ciphertext, so a reader whose room is open decrypts it there and then instead of
    -- fetching back the row it was just told about
    'cipher', new.cipher,
    'attachment', new.attachment, 'attachment_type', new.attachment_type, 'seconds', new.seconds,
    'meta', new.meta, 'at', new.created_at));
  return null;
end;
$$;
-- ---------------------------------------------------------------------------------------------
-- WHAT SEARCH COULD NOT LOOK IN.
--
-- A sealed message leaves `fts` empty, so search misses it already and needs no exception — but
-- missing it SILENTLY is the fault. Somebody who knows a thing was said, searches for it and finds
-- nothing concludes the search is broken, or worse, that the thing was never said.
--
-- So the surface says how many rooms it could not look in. This counts them: the caller's own
-- rooms, sealed, inside whatever the search was scoped to. It is a count and never a list of
-- rooms — "it is not in #payroll" is itself something a search should not be made to say.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."space_sealed_rooms"("p_space" "uuid" DEFAULT NULL::"uuid", "p_channel" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $BODY$
  select count(*)::int
    from public.channels c
    join public.channel_members cm on cm.channel_id = c.id and cm.user_id = auth.uid()
   where c.encrypted
     and c.archived_at is null
     and (p_space is null or c.space_id = p_space)
     and (p_channel is null or c.id = p_channel);
$BODY$;
-- the default grant taken back by name first — PUBLIC, then the two roles Supabase grants on top
-- of it — so the file and the database agree about who may ask, rather than relying on a default
REVOKE ALL ON FUNCTION "public"."space_sealed_rooms"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."space_sealed_rooms"("uuid", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."space_sealed_rooms"("uuid", "uuid") TO "authenticated", "service_role";

-- ---------------------------------------------------------------------------------------------
-- A SEAL COMES OFF ONLY WHILE THERE IS NOTHING BEHIND IT.
--
-- Turning `encrypted` off would make the room readable from now on — but every message already in
-- it is a ciphertext nobody will ever decrypt again, because the clients stop asking. The timeline
-- would be a wall of "cannot read this" with no way back, and the person who flipped the switch
-- would have been told nothing.
--
-- So it is one-way the moment anything has been sealed. Before that, a site that switched it on by
-- mistake may switch it off, which is the only time it is a free action.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."guard_channel_encryption"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if old.encrypted and not new.encrypted then
    if exists (select 1 from public.space_messages m where m.channel_id = old.id and m.cipher is not null) then
      raise exception 'channels.encrypted cannot be turned off: % already holds messages nobody could read afterwards', old.slug
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS "trg_channels_encryption" ON "public"."channels";
CREATE TRIGGER "trg_channels_encryption" BEFORE UPDATE OF "encrypted" ON "public"."channels"
  FOR EACH ROW EXECUTE FUNCTION "public"."guard_channel_encryption"();

-- and it is granted to nobody, which is right and not an omission: a trigger function is run BY
-- the trigger, as the table's owner, and never called. 90-spaces.sql grants its own guards nothing
-- for the same reason. An EXECUTE grant here would only be a door nothing needs.

-- ---------------------------------------------------------------------------------------------
-- A REPORT FROM A SEALED ROOM REACHES THE STAFF WITHOUT WORDS, AND SAYS SO.
--
-- Every action still works — a member can be muted, removed, shadow-banned — because those are
-- acts against a PERSON and not against a message. What cannot happen is a moderator reading what
-- was said, and the honest thing is to say that rather than to show an empty quote that reads as
-- a message that failed to load.
--
-- Replaced here rather than edited in 90-spaces.sql, for the same reason as the others: `cipher`
-- does not exist until this file runs.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."space_reports"("p_space" "uuid" DEFAULT NULL::"uuid", "p_open" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select jsonb_agg(row order by row->>'created_at' desc) from (
    select jsonb_build_object(
      'id', r.id, 'space', r.space_id, 'channel', r.channel_id, 'message', r.message_id,
      'reason', r.reason, 'note', r.note, 'created_at', r.created_at,
      'answered_at', r.answered_at,
      'by', coalesce(nullif(pa.display_name, ''), split_part(coalesce(pa.email, ''), '@', 1)),
      'about', coalesce(nullif(ps.display_name, ''), split_part(coalesce(ps.email, ''), '@', 1)),
      'about_id', r.subject_id,
      'body', case when sm.deleted_at is null then sm.body else null end,
      -- WAS IT SEALED. The body above is already null for a sealed message — there is nothing to
      -- read — but "no body" and "sealed" are different facts and the desk has to tell them apart:
      -- the first is a message somebody withdrew, the second is a message nobody on this side can
      -- read and never could. Shown as a sentence where the words would be, so a moderator knows
      -- to ask the person who reported it rather than wondering what went wrong.
      'sealed', sm.cipher is not null,
      'withdrawn', sm.deleted_at is not null,
      'kind', sm.kind,
      'room', c.name) as row
    from public.space_moderation r
    left join public.space_messages sm on sm.id = r.message_id
    left join public.channels c on c.id = r.channel_id
    left join public.profiles pa on pa.id = r.actor_id
    left join public.profiles ps on ps.id = r.subject_id
   where r.kind = 'report'
     and (p_space is null or r.space_id = p_space)
     and (not p_open or r.answered_at is null)
     and exists (select 1 from public.channels x where x.space_id = r.space_id and public.space_may(x.id, 'moderate'))
   limit 200) q), '[]'::jsonb);
$$;
