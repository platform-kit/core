-- content: the site's content as rows, for cloud mode (CONTENT_STORE=cloud) — every file under content/ a row:
-- its path, its collection and slug, whether it is published, the frontmatter as JSON, the body, and the markdown
-- exactly as the grammar wrote it (the bytes the push to the repository and the deploy's export use) — that is
-- the LIVE version, what the site reads. The DRAFT is its own row in content_drafts (the text, data and body of
-- the edit, who and when, `deleted` for a removal not yet published), which a save writes and a publish moves into
-- the live columns; a row that has never been published has no live text. Published rows with a live version
-- are readable by anyone, every row by an administrator; the drafts by the service role alone (RLS on, no policy
-- — no client reads a draft); nothing is written from a client — the `admin` function is the door, with the
-- service role, so every write goes through the pipe's checks. A published removal is a row marked deleted_at and
-- pending until the push has deleted it from the repository.
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."content" (
    "path" "text" NOT NULL,
    "collection" "text",
    "slug" "text",
    "published" boolean DEFAULT true NOT NULL,
    "data" "jsonb",
    "body" "text",
    "text" "text",
    "sha" "text",
    "published_at" timestamp with time zone,
    "pending" boolean DEFAULT true NOT NULL,
    "deleted_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "text",
    "pushed_at" timestamp with time zone,
    "push_error" "text"
);

ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_pkey" PRIMARY KEY ("path");

CREATE INDEX "content_collection_idx" ON "public"."content" USING "btree" ("collection", "slug") WHERE ("deleted_at" IS NULL);

CREATE INDEX "content_pending_idx" ON "public"."content" USING "btree" ("updated_at") WHERE ("pending" = true);

ALTER TABLE "public"."content" ENABLE ROW LEVEL SECURITY;

-- WHO READS A ROW: an administrator, whole, for the admin and the preview. Nobody else reads the table:
-- a row holds a record's whole text, gated chapters and gated pages included, so a reader's site gets the
-- published rows from functions/reader-content, cut to what a guest may read (_shared/gate.js), and a reader
-- with more access asks the same function for their own text. Until 2026-10 published rows were readable by
-- anyone, which put every gated chapter one query away from a visitor.
DROP POLICY IF EXISTS "content_select_published" ON "public"."content";

CREATE POLICY "content_select_admin" ON "public"."content" FOR SELECT USING ("public"."is_admin"());

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."content";

GRANT ALL ON TABLE "public"."content" TO "anon";
GRANT ALL ON TABLE "public"."content" TO "authenticated";
GRANT ALL ON TABLE "public"."content" TO "service_role";

-- the drafts: one per row, the edit not yet published — readable by no client (RLS on, no policy; the service
-- role reads and writes for the function), gone with its row
CREATE TABLE IF NOT EXISTS "public"."content_drafts" (
    "path" "text" NOT NULL,
    "text" "text",
    "data" "jsonb",
    "body" "text",
    "by" "text",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY "public"."content_drafts"
    ADD CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("path");

ALTER TABLE ONLY "public"."content_drafts"
    ADD CONSTRAINT "content_drafts_path_fkey" FOREIGN KEY ("path") REFERENCES "public"."content"("path") ON DELETE CASCADE;

ALTER TABLE "public"."content_drafts" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."content_drafts" TO "anon";
GRANT ALL ON TABLE "public"."content_drafts" TO "authenticated";
GRANT ALL ON TABLE "public"."content_drafts" TO "service_role";

-- the push to the repository, asked again by pg_cron every minute (`content-push` in data.sql) for whatever is
-- still pending — a save whose push failed, a token set after edits were made. The function does nothing, at
-- once, when no row is pending or no repository is set; a hosted project's url and key are the same rows the
-- funnels' runner reads (functions_url, functions_secret).
CREATE OR REPLACE FUNCTION "public"."run_content_push"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  if not exists (select 1 from public.content where pending = true) then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/admin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"seg":"push-pending"}'::jsonb,
    timeout_milliseconds := 120000);
end;
$$;

REVOKE ALL ON FUNCTION "public"."run_content_push"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_content_push"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_content_push"() TO "service_role";
