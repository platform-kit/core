-- GLUE: what joins the forms module and the sessions module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- the response is the booking's, and goes with it; a response deleted on its own simply leaves the
-- booking with nothing to show, which is better than refusing to delete either
ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_response_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE SET NULL;
