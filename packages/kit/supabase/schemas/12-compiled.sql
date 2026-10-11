-- ---------------------------------------------------------------------------------------------
-- THE COMPILED ARTEFACTS, where a build cannot write them
-- ---------------------------------------------------------------------------------------------
--
-- Several things the Edge Functions read are COMPILED from content rather than read from it: the
-- catalog (what is for sale, the booking types, the tiers), the forms, the funnels and the email
-- designs. On a machine the build writes each as a file beside the functions and the deploy ships
-- it, which is right: a function that recompiled the catalog on every request would be reading a
-- hundred markdown files to answer one question.
--
-- That leaves one shape of deployment with nowhere to put them. Cloud mode comes in two: with the
-- repository in the cycle a publish is a commit and the commit is what builds, and with it out of
-- the cycle there is no commit — and unless a deploy hook is set, nothing ever builds again. In that
-- shape a booking type edited in the admin would never reach the scheduler, because the scheduler
-- reads the catalog and the catalog is a file in a bundle nobody is going to rebuild.
--
-- So a publish compiles what it changed and writes it HERE, and the functions read the row over the
-- file they shipped with. One row per artefact, the whole artefact as it was compiled.
--
-- It is neither a declaration nor state: it is DERIVED, and nothing but the publish writes it. Drop
-- the table and the next publish makes it again; drop the row and the function falls back to the
-- file the deploy shipped, which is exactly what it did before this existed.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."compiled" (
    "path" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "text",
    CONSTRAINT "compiled_pkey" PRIMARY KEY ("path")
);

ALTER TABLE "public"."compiled" ENABLE ROW LEVEL SECURITY;

-- NOBODY READS THIS FROM A BROWSER. The functions read it with the service role, as they read the
-- file it stands in for; a catalog carries what a thing costs to make and what it is sold for, and
-- the storefront already answers the public question in public words.
GRANT ALL ON TABLE "public"."compiled" TO "service_role";
