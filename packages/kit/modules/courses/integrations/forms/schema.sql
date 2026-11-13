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


-- ============================================================================================================
-- A COURSE'S WORKBOOK (openspec: courses). A text lesson may carry a workbook form; the reader's answers to those forms,
-- in course order, are the course's workbook. They are the reader's own: a workbook response is private (25-forms.sql),
-- read by its writer and by the coaches they share the course's workbook with, one share at a time, each a record of
-- its own. No administrator reads one as such: only a coach who was shared it, whatever else they are.
-- ============================================================================================================

CREATE TABLE IF NOT EXISTS "public"."course_workbook_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reader" "uuid" NOT NULL,
    "coach" "uuid" NOT NULL,
    "course" "text" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "withdrawn_at" timestamp with time zone,
    CONSTRAINT "course_workbook_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "course_workbook_shares_not_self" CHECK (("reader" <> "coach"))
);
ALTER TABLE ONLY "public"."course_workbook_shares" ADD CONSTRAINT "course_workbook_shares_reader_fkey" FOREIGN KEY ("reader") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."course_workbook_shares" ADD CONSTRAINT "course_workbook_shares_coach_fkey" FOREIGN KEY ("coach") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."course_workbook_shares" ADD CONSTRAINT "course_workbook_shares_course_fkey" FOREIGN KEY ("course") REFERENCES "public"."courses"("slug") ON DELETE CASCADE;
-- one live share per reader, coach and course; a withdrawn one stays as the record of what was shared and when
CREATE UNIQUE INDEX IF NOT EXISTS "course_workbook_shares_live" ON "public"."course_workbook_shares" ("reader", "coach", "course") WHERE ("withdrawn_at" IS NULL);
CREATE INDEX IF NOT EXISTS "course_workbook_shares_coach" ON "public"."course_workbook_shares" ("coach") WHERE ("withdrawn_at" IS NULL);
ALTER TABLE "public"."course_workbook_shares" ENABLE ROW LEVEL SECURITY;
-- the reader sees what they shared, the coach what was shared with them; every change goes through the functions below
CREATE POLICY "course_workbook_shares_own" ON "public"."course_workbook_shares" FOR SELECT TO "authenticated" USING ((("reader" = "auth"."uid"()) OR ("coach" = "auth"."uid"())));
GRANT SELECT ON TABLE "public"."course_workbook_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."course_workbook_shares" TO "service_role";

-- who a coach is, for sharing: somebody holding the coach or provider role. An administrator is one only if they also hold
-- one of those (is_provider counts an administrator, so it isn't the question here)
CREATE OR REPLACE FUNCTION "public"."course_is_coach"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select roles && array['coach', 'provider'] from public.profiles where id = p_user), false);
$$;
REVOKE ALL ON FUNCTION "public"."course_is_coach"("uuid") FROM PUBLIC, "anon", "authenticated";

-- a person's name as the course pages show it
CREATE OR REPLACE FUNCTION "public"."course_person_name"("p_user" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1))
  from public.profiles p where p.id = p_user;
$$;
REVOKE ALL ON FUNCTION "public"."course_person_name"("uuid") FROM PUBLIC, "anon", "authenticated";

-- the forms module's question, answered: the caller is a coach this writer shared a course's workbook with, and the
-- form is one of that course's
CREATE OR REPLACE FUNCTION "public"."form_shared_with_me"("p_user" "uuid", "p_form" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select auth.uid() is not null and public.course_is_coach(auth.uid()) and exists (
    select 1 from public.course_workbook_shares s join public.course_lessons l on l.course = s.course and l.form = p_form
    where s.reader = p_user and s.coach = auth.uid() and s.withdrawn_at is null);
$$;
GRANT ALL ON FUNCTION "public"."form_shared_with_me"("uuid", "text") TO "authenticated";

-- THE WORKBOOK: every lesson of the course that carries a form, in order, with the reader's answers to it. The reader
-- reads their own (and whom they shared it with); a coach reads one shared with them, naming the reader.
CREATE OR REPLACE FUNCTION "public"."course_workbook"("p_course" "text", "p_reader" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare me uuid := auth.uid(); who uuid; c public.courses;
begin
  if me is null then return jsonb_build_object('error', 'sign-in'); end if;
  who := coalesce(p_reader, me);
  select * into c from public.courses where slug = p_course and published;
  if c.slug is null then return jsonb_build_object('error', 'no-course'); end if;
  if who <> me and not (public.course_is_coach(me) and exists (select 1 from public.course_workbook_shares s
      where s.reader = who and s.coach = me and s.course = p_course and s.withdrawn_at is null)) then
    return jsonb_build_object('error', 'not-shared');
  end if;
  return jsonb_build_object(
    'course', c.slug, 'title', c.title, 'mine', who = me,
    'reader', jsonb_build_object('id', who, 'name', public.course_person_name(who)),
    'lessons', coalesce((
      -- each lesson's answers, one entry a response: a form about the rows of an earlier list has one per row (item)
      select jsonb_agg(jsonb_build_object('key', l.key, 'title', l.title, 'section', l.section, 'form', l.form, 'required', l.answers_required,
        'entries', coalesce((select jsonb_agg(jsonb_build_object('item', x.item, 'updated_at', x.updated_at, 'completed', x.completed_at is not null,
            'answers', coalesce((select jsonb_object_agg(a.field, a.value) from public.form_answers a where a.response_id = x.id), '{}'::jsonb))
            order by x.started_at)
          from public.form_responses x where x.user_id = who and x.form = l.form), '[]'::jsonb))
        order by l.position)
      from public.course_lessons l
      where l.course = p_course and l.form is not null), '[]'::jsonb),
    'shares', case when who = me then coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'coach', s.coach, 'name', public.course_person_name(s.coach), 'granted_at', s.granted_at) order by s.granted_at)
      from public.course_workbook_shares s where s.reader = me and s.course = p_course and s.withdrawn_at is null), '[]'::jsonb) else null end);
end;
$$;
GRANT ALL ON FUNCTION "public"."course_workbook"("text", "uuid") TO "authenticated";

-- the coaches a reader may share with: everyone holding the coach or provider role but themselves
CREATE OR REPLACE FUNCTION "public"."course_workbook_coaches"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when auth.uid() is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', public.course_person_name(p.id), 'title', p.title, 'avatar', p.avatar) order by public.course_person_name(p.id))
    from public.profiles p where p.roles && array['coach', 'provider'] and p.id <> auth.uid()), '[]'::jsonb) end;
$$;
GRANT ALL ON FUNCTION "public"."course_workbook_coaches"() TO "authenticated";

-- sharing a course's workbook with a coach, and withdrawing it; each answers the workbook as it now is
CREATE OR REPLACE FUNCTION "public"."course_workbook_share"("p_course" "text", "p_coach" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare me uuid := auth.uid();
begin
  if me is null then return jsonb_build_object('error', 'sign-in'); end if;
  if not exists (select 1 from public.courses where slug = p_course and published) then return jsonb_build_object('error', 'no-course'); end if;
  if p_coach is null or p_coach = me or not public.course_is_coach(p_coach) then return jsonb_build_object('error', 'not-a-coach'); end if;
  insert into public.course_workbook_shares (reader, coach, course)
    select me, p_coach, p_course where not exists (select 1 from public.course_workbook_shares s
      where s.reader = me and s.coach = p_coach and s.course = p_course and s.withdrawn_at is null);
  return public.course_workbook(p_course);
end;
$$;
GRANT ALL ON FUNCTION "public"."course_workbook_share"("text", "uuid") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."course_workbook_withdraw"("p_share" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare me uuid := auth.uid(); s public.course_workbook_shares;
begin
  if me is null then return jsonb_build_object('error', 'sign-in'); end if;
  update public.course_workbook_shares set withdrawn_at = now() where id = p_share and reader = me and withdrawn_at is null returning * into s;
  if s.id is null then return jsonb_build_object('error', 'no-share'); end if;
  return public.course_workbook(s.course);
end;
$$;
GRANT ALL ON FUNCTION "public"."course_workbook_withdraw"("uuid") TO "authenticated";

-- what a coach has been shared: each live share, newest first, with when its answers last changed
CREATE OR REPLACE FUNCTION "public"."course_workbooks_shared"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when auth.uid() is null or not public.course_is_coach(auth.uid()) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'reader', s.reader, 'name', public.course_person_name(s.reader), 'course', s.course, 'title', c.title,
      'granted_at', s.granted_at,
      'updated_at', (select max(r.updated_at) from public.form_responses r join public.course_lessons l on l.form = r.form and l.course = s.course where r.user_id = s.reader))
      order by s.granted_at desc)
    from public.course_workbook_shares s join public.courses c on c.slug = s.course
    where s.coach = auth.uid() and s.withdrawn_at is null), '[]'::jsonb) end;
$$;
GRANT ALL ON FUNCTION "public"."course_workbooks_shared"() TO "authenticated";
