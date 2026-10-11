-- library: a reader may share into the public audio bucket the chapters their browser spoke (the buckets are rows: data.sql)
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;


CREATE POLICY "readers share the chapters they spoke" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (
  bucket_id = 'audio'
  and name ~ '^books/[a-z0-9-]+/[0-9a-f]{16}\.mp3$'
);
