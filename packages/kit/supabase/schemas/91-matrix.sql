-- ---------------------------------------------------------------------------------------------
-- THE MATRIX SURFACE'S OWN ROWS.
--
-- AFTER THE SPACES, because matrix_read points at a channel and the declaration is applied in the
-- order these files are named. It was 86 for one run and the reset said so at once.
--
-- Three tables, and every one of them is STATE: made by an act (somebody signed a client in, a
-- client read to here), never a file, and nothing a redeploy should bring back. If the database
-- were dropped, every Matrix client would sign in again and nothing of value would be lost —
-- which is the test that says these are not declarations.
--
-- THE SESSION TABLE HAS RLS ON AND NO POLICIES AT ALL. That is deliberate and is the single most
-- important line in this file. It holds a GoTrue refresh token, which is a credential: anything
-- that could read a row could become that person. RLS with no policy means no client of any kind
-- reaches it — not anon, not authenticated, not a member, not an administrator through the API —
-- and only the service role, which bypasses RLS, can. The matrix-api function is the only thing
-- that holds the service key, and it uses it for exactly two things: checking a password and
-- reading this table.
--
-- Why a refresh token is kept at all, rather than minting our own JWT: a function that can sign a
-- session can forge ANY identity, and a minted token would outlive a password change. Keeping
-- GoTrue's own session means revocation belongs to the account — change the password, ban the
-- account, sign out everywhere, and every Matrix client of that person stops working without this
-- surface being told anything.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."matrix_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- the token the CLIENT holds is never stored: only its sha256, as the support desk keeps a
    -- guest's token, so a dump of this table cannot be replayed as a login
    "token_hash" "text" NOT NULL,
    -- Matrix's own idea of a device: a client says which one it is, and a person signs one out
    -- without signing out the others
    "device_id" "text" NOT NULL,
    "device_name" "text",
    -- GoTrue's refresh token, which is what makes auth.uid() the person on every request. Rotated
    -- on use; the lock below is what stops two requests spending it at once.
    "refresh_token" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    CONSTRAINT "matrix_sessions_device_check" CHECK ((("char_length"("device_id") >= 1) AND ("char_length"("device_id") <= 120)))
);
ALTER TABLE ONLY "public"."matrix_sessions" ADD CONSTRAINT "matrix_sessions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."matrix_sessions" ADD CONSTRAINT "matrix_sessions_token_key" UNIQUE ("token_hash");
ALTER TABLE ONLY "public"."matrix_sessions" ADD CONSTRAINT "matrix_sessions_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "matrix_sessions_user_idx" ON "public"."matrix_sessions" USING "btree" ("user_id");

-- RLS ON, NO POLICIES. See the note at the top of this file: the absence of a policy IS the
-- security property here, not an omission somebody forgot to fill in.
ALTER TABLE "public"."matrix_sessions" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- WHERE A CLIENT HAS READ TO, per room. Matrix's read receipts and read markers; ours to keep
-- because our own unread is a subtraction against `channel_members.last_read_seq` and a Matrix
-- client's position is its own — a person reading on their phone should not mark the room read in
-- our web client, and the reverse. Two positions, one per surface, both the person's own.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."matrix_read" (
    "user_id" "uuid" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "seq" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."matrix_read" ADD CONSTRAINT "matrix_read_pkey" PRIMARY KEY ("user_id", "channel_id");
ALTER TABLE ONLY "public"."matrix_read" ADD CONSTRAINT "matrix_read_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."matrix_read" ADD CONSTRAINT "matrix_read_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;

ALTER TABLE "public"."matrix_read" ENABLE ROW LEVEL SECURITY;
-- a person's own position, theirs to read and write, and nobody else's business
DROP POLICY IF EXISTS "matrix_read_own" ON "public"."matrix_read";
CREATE POLICY "matrix_read_own" ON "public"."matrix_read"
  USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."matrix_read" TO "authenticated";
GRANT ALL ON TABLE "public"."matrix_read" TO "service_role";
-- as above: the default grant taken back, so the file and the database agree that nothing but
-- the service role reaches a refresh token
REVOKE ALL ON TABLE "public"."matrix_sessions" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."matrix_sessions" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- HOW MANY TIMES AN ADDRESS HAS TRIED TO SIGN IN. The Matrix door takes a password, which our own
-- sign-in does not expose to anonymous callers in the same way, so it is capped per address per
-- hour the way the support desk caps its anonymous door. Rows older than the window are swept by
-- the same nightly cron that sweeps the desk's files; an unswept row simply stops counting.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."matrix_login_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ip" "text" NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE ONLY "public"."matrix_login_attempts" ADD CONSTRAINT "matrix_login_attempts_pkey" PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "matrix_login_attempts_ip_idx" ON "public"."matrix_login_attempts" USING "btree" ("ip", "at" DESC);
ALTER TABLE "public"."matrix_login_attempts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."matrix_login_attempts" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."matrix_login_attempts" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- SPENDING A REFRESH TOKEN IS A LOCKED READ. Two requests from the same client arriving together
-- would otherwise both take the same refresh token to GoTrue, and the second would be refused
-- because the first rotated it — signing the person out in the middle of using the app. This
-- hands one caller the row and makes the other wait for it.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."matrix_session_claim"("p_hash" "text")
RETURNS TABLE("id" "uuid", "user_id" "uuid", "refresh_token" "text", "device_id" "text")
    LANGUAGE "sql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select s.id, s.user_id, s.refresh_token, s.device_id
    from public.matrix_sessions s
   where s.token_hash = p_hash
     for update
$$;
REVOKE ALL ON FUNCTION "public"."matrix_session_claim"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."matrix_session_claim"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."matrix_session_claim"("text") TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- A PICTURE FROM A MATRIX CLIENT IS STAGED BEFORE IT BELONGS ANYWHERE.
--
-- The community's own rule for a file is exact and good: `<channel>/<message>.<ext>`, insertable
-- only by somebody who may put a file in that channel. A Matrix client cannot satisfy it, and not
-- because it is badly behaved: the protocol uploads the bytes FIRST and returns an mxc url, and
-- only afterwards does the client send the event that says which room the picture is for. At the
-- moment of the upload there is no channel to name. So the upload used to be written under
-- `matrix/<user>/…`, which no policy admitted, and every picture from every client was refused
-- with a message about a room — a path that had never once worked against a real database.
--
-- The answer is a staging shelf that is nobody's room: a person may put a file under their OWN id
-- and read their own, and nothing else. It is not readable by anyone else and never served to a
-- room. When the client then sends the event, the surface copies the file into
-- `<channel>/<message>.<ext>` AS THAT PERSON, so the real fence above decides, exactly as it does
-- for the site's own client: somebody who may not put a file in that channel cannot, and the
-- event is refused rather than the picture quietly landing somewhere it should not.
--
-- The shelf is swept: a staged file that no event ever claimed is removed after a day.
-- ---------------------------------------------------------------------------------------------

CREATE POLICY "matrix clients stage their own files" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (
  bucket_id = 'spaces'
  and name ~ '^matrix/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|gif|webp|pdf|txt|mp3)$'
  and ((storage.foldername(name))[2])::uuid = auth.uid()
);
CREATE POLICY "matrix clients read their own staged files" ON "storage"."objects" FOR SELECT TO "authenticated" USING (
  bucket_id = 'spaces'
  and name like 'matrix/%'
  and ((storage.foldername(name))[2])::uuid = auth.uid()
);
CREATE POLICY "matrix clients clear their own staged files" ON "storage"."objects" FOR DELETE TO "authenticated" USING (
  bucket_id = 'spaces'
  and name like 'matrix/%'
  and ((storage.foldername(name))[2])::uuid = auth.uid()
);
