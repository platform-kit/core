-- GLUE: what joins the courses module and the forms module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- A FORM FINISHED FINISHES ITS LESSON. When somebody's response completes, and is passed where the form is scored,
-- every open form lesson pointing at that form is recorded done for them, then the course is checked for completion.
-- Nobody marks a quiz lesson by hand; a response that fails changes nothing, and a later pass still counts.
CREATE OR REPLACE FUNCTION "public"."course_form_finished"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare e public.enrollments; f record;
begin
  if new.user_id is null or new.completed_at is null or new.passed is false then return new; end if;
  if tg_op = 'UPDATE' and old.completed_at is not null and old.passed is not distinct from new.passed then return new; end if;
  for e in select en.* from public.enrollments en where en.user_id = new.user_id
             and exists (select 1 from public.course_lessons l where l.course = en.course and l.kind = 'form' and l.ref = new.form) loop
    for f in select x.key from public.course_lessons_for(e.course, new.user_id) x where x.kind = 'form' and x.ref = new.form and x.open and not x.done loop
      insert into public.lesson_progress (enrollment, lesson, how) values (e.id, f.key, 'form') on conflict do nothing;
      -- a quiz passed, the first time: an event like any other, from which the achievements module awards that quiz's achievement
      if found and new.passed is true then
        insert into public.events (session_id, user_id, anon_id, type, props, occurred_at, source)
          values (gen_random_uuid(), new.user_id, new.user_id, 'quiz_passed', jsonb_build_object('course', e.course, 'lesson', f.key, 'score', new.score, 'total', new.total), now(), 'server');
      end if;
    end loop;
    perform public.course_check_complete(e.id);
  end loop;
  return new;
end;
$$;

CREATE OR REPLACE TRIGGER "trg_form_responses_course" AFTER INSERT OR UPDATE OF "completed_at", "passed" ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "public"."course_form_finished"();
REVOKE ALL ON FUNCTION "public"."course_form_finished"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_form_finished"() FROM "anon", "authenticated";

-- a form lesson finished: the form answered and completed — passed, where p_passed asks, or not failed otherwise
CREATE OR REPLACE FUNCTION "public"."course_form_done"("p_user" "uuid", "p_form" "text", "p_passed" boolean) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.form_responses r
                  where r.user_id = p_user and r.form = p_form and r.completed_at is not null
                    and case when p_passed then r.passed is true else coalesce(r.passed, true) end);
$$;

-- A QUIZ'S RESULT for one person: their best score on a scored form, whether any attempt passed, and how many they
-- made. Every attempt is a form response of its own, so this reads them; nothing is copied. Null where none is scored.
CREATE OR REPLACE FUNCTION "public"."course_quiz_result"("p_user" "uuid", "p_form" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when count(*) = 0 then null else jsonb_build_object('score', max(r.score), 'total', max(r.total), 'passed', bool_or(coalesce(r.passed, false)), 'attempts', count(*)) end
  from public.form_responses r where r.user_id = p_user and r.form = p_form and r.completed_at is not null and r.total is not null;
$$;

