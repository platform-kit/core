-- GLUE: what joins the bots module and social publishing — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

ALTER TABLE ONLY "public"."social_automation_responses"
    ADD CONSTRAINT "social_automation_responses_bot_run_fkey" FOREIGN KEY ("bot_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."social_automations"
    ADD CONSTRAINT "social_automations_bot_fkey" FOREIGN KEY ("bot_slug") REFERENCES "public"."bots"("slug") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "public"."social_start_automation_run"(
    "p_response_id" "uuid",
    "p_subject_key" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  response public.social_automation_responses;
  automation public.social_automations;
  event public.social_inbound_events;
  bot public.bots;
  run public.agent_runs;
  spent_window text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select * into response from public.social_automation_responses
   where id = p_response_id for update;
  if not found or response.status <> 'generating' then return null; end if;
  if response.bot_run_id is not null then
    return jsonb_build_object('id', response.bot_run_id, 'existing', true);
  end if;
  select * into automation from public.social_automations where id = response.automation_id;
  select * into event from public.social_inbound_events where id = response.event_id;
  select * into bot from public.bots where slug = automation.bot_slug;
  if not found or automation.account_id <> response.account_id
      or event.account_id <> response.account_id
      or event.event_kind <> automation.event_kind
      or automation.bot_slug <> bot.slug
      or not bot.published
      or not ('social' = any(bot.surfaces))
      or jsonb_array_length(coalesce(bot.serves, '[]'::jsonb)) <> 0
      or response.mode <> automation.mode
      or not automation.enabled
      or not (response.destination = any(automation.destinations))
      or p_subject_key !~ ('^social:' || response.account_id::text || ':[0-9a-f]{64}$')
  then return jsonb_build_object('error', 'automation_unavailable'); end if;

  spent_window := public.agent_over_cap(bot.slug, p_subject_key, bot.limits->'per');
  if spent_window is not null then
    return jsonb_build_object('error', 'budget', 'window', spent_window);
  end if;

  insert into public.agent_runs (
    bot, surface, asked_by, subject_key, status, state, deadline_at
  ) values (
    bot.slug, 'social', automation.authorized_by, p_subject_key, 'queued',
    jsonb_build_object('social_response_id', response.id),
    now() + make_interval(mins => coalesce((bot.limits->>'minutes')::int, 10))
  ) returning * into run;

  update public.social_automation_responses
     set bot_run_id = run.id, updated_at = now()
   where id = response.id and status = 'generating' and bot_run_id is null;
  if not found then raise exception 'automation response changed while starting the bot'; end if;
  return jsonb_build_object('id', run.id, 'existing', false);
end;
$$;
