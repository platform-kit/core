-- GLUE: what joins the events module and the spaces module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;
