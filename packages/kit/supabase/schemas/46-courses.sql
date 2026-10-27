-- COURSES (openspec: courses). A course is sections and lessons in order, released over time and tracked to completion.
--
-- The course itself is a declaration (content/courses/<slug>.md, or a row in cloud mode), projected here by
-- courses-push: `courses`, `course_lessons` and `course_cohorts` have no client writer. What a person does is rows of
-- their own: an ENROLLMENT, made the first time they get in and kept when they lose access, so coming back resumes
-- it; LESSON_PROGRESS, one row per lesson finished; a CERTIFICATE, issued once when the course is.
--
-- THE DATABASE DECIDES WHAT IS OPEN. course_lessons_for answers, per person, which lessons are open and why each closed
-- one is not (no access, not yet released, the lesson before not finished). The reader's screens ask it, and so does
-- course_lesson, the only way a lesson's text leaves the database, so a closed lesson's text is never sent.
--
-- Completion that the server can see is checked here (a form answered, a session booked). A chapter or an article read
-- is reported by the reader's app, since reading progress is kept on the reader's own synced document.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."courses" (
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "about" "text",
    "image" "text",
    "position" integer DEFAULT 99 NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    -- who gets in: { free: true } for anyone signed in, { skus: [...] } bought in the store, { tiers: [...] } members
    "access" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- all at once; one lesson or section every `every_days` from enrolling; or from a cohort's start date
    "release" "text" DEFAULT 'all'::"text" NOT NULL,
    "drip" "text" DEFAULT 'lesson'::"text" NOT NULL,
    "every_days" integer DEFAULT 7 NOT NULL,
    -- each lesson opens only once the required one before it is finished
    "in_order" boolean DEFAULT false NOT NULL,
    "certificate" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "courses_pkey" PRIMARY KEY ("slug"),
    CONSTRAINT "courses_release_check" CHECK (("release" = ANY (ARRAY['all'::"text", 'drip'::"text", 'cohort'::"text"]))),
    CONSTRAINT "courses_drip_check" CHECK (("drip" = ANY (ARRAY['lesson'::"text", 'section'::"text"]))),
    CONSTRAINT "courses_every_check" CHECK (("every_days" >= 0))
);

CREATE TABLE IF NOT EXISTS "public"."course_lessons" (
    "course" "text" NOT NULL,
    "key" "text" NOT NULL,
    "position" integer NOT NULL,
    "section" "text",
    "title" "text" NOT NULL,
    -- its own text and media, or a pointer to something the site already has, by its slug or key
    "kind" "text" DEFAULT 'text'::"text" NOT NULL,
    "ref" "text",
    "body" "text",
    "media" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "required" boolean DEFAULT true NOT NULL,
    CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("course", "key"),
    CONSTRAINT "course_lessons_kind_check" CHECK (("kind" = ANY (ARRAY['text'::"text", 'chapter'::"text", 'article'::"text", 'form'::"text", 'session'::"text"]))),
    CONSTRAINT "course_lessons_ref_check" CHECK ((("kind" = 'text'::"text") OR ("ref" IS NOT NULL)))
);
ALTER TABLE ONLY "public"."course_lessons" ADD CONSTRAINT "course_lessons_course_fkey" FOREIGN KEY ("course") REFERENCES "public"."courses"("slug") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "public"."course_cohorts" (
    "course" "text" NOT NULL,
    "key" "text" NOT NULL,
    "starts_on" "date" NOT NULL,
    -- the space this cohort meets in, where it has one
    "space" "text",
    CONSTRAINT "course_cohorts_pkey" PRIMARY KEY ("course", "key")
);
ALTER TABLE ONLY "public"."course_cohorts" ADD CONSTRAINT "course_cohorts_course_fkey" FOREIGN KEY ("course") REFERENCES "public"."courses"("slug") ON DELETE CASCADE;

-- AN ENROLLMENT IS ITS OWN RECORD: its release dates count from it, and it outlives a refund or a lapsed membership
CREATE TABLE IF NOT EXISTS "public"."enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "course" "text" NOT NULL,
    "cohort" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "enrollments_once" UNIQUE ("user_id", "course")
);
ALTER TABLE ONLY "public"."enrollments" ADD CONSTRAINT "enrollments_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."enrollments" ADD CONSTRAINT "enrollments_course_fkey" FOREIGN KEY ("course") REFERENCES "public"."courses"("slug") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "enrollments_course_idx" ON "public"."enrollments" ("course");

CREATE TABLE IF NOT EXISTS "public"."lesson_progress" (
    "enrollment" "uuid" NOT NULL,
    "lesson" "text" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- how it was finished: marked done, read (reported by the app), a form answered, a session booked
    "how" "text" NOT NULL,
    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("enrollment", "lesson"),
    CONSTRAINT "lesson_progress_how_check" CHECK (("how" = ANY (ARRAY['marked'::"text", 'read'::"text", 'form'::"text", 'booked'::"text"])))
);
ALTER TABLE ONLY "public"."lesson_progress" ADD CONSTRAINT "lesson_progress_enrollment_fkey" FOREIGN KEY ("enrollment") REFERENCES "public"."enrollments"("id") ON DELETE CASCADE;

-- what each person has been told: a lesson opening, once per lesson, and finishing ('*complete')
CREATE TABLE IF NOT EXISTS "public"."course_notices" (
    "enrollment" "uuid" NOT NULL,
    "lesson" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_notices_pkey" PRIMARY KEY ("enrollment", "lesson")
);
ALTER TABLE ONLY "public"."course_notices" ADD CONSTRAINT "course_notices_enrollment_fkey" FOREIGN KEY ("enrollment") REFERENCES "public"."enrollments"("id") ON DELETE CASCADE;

-- a certificate: issued once, with the name and title as they read at the time, at a public address anyone can check
CREATE TABLE IF NOT EXISTS "public"."certificates" (
    "id" "text" DEFAULT "replace"(("gen_random_uuid"())::"text", '-'::"text", ''::"text") NOT NULL,
    "enrollment" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "course_title" "text" NOT NULL,
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "certificates_once" UNIQUE ("enrollment")
);
ALTER TABLE ONLY "public"."certificates" ADD CONSTRAINT "certificates_enrollment_fkey" FOREIGN KEY ("enrollment") REFERENCES "public"."enrollments"("id") ON DELETE CASCADE;

ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."course_lessons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."course_cohorts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."lesson_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."course_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."certificates" ENABLE ROW LEVEL SECURITY;
-- a person reads their own enrollments and progress; everything else goes through the functions below
CREATE POLICY "a person reads their own enrollments" ON "public"."enrollments" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
CREATE POLICY "a person reads their own progress" ON "public"."lesson_progress" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1 FROM "public"."enrollments" "e" WHERE (("e"."id" = "lesson_progress"."enrollment") AND ("e"."user_id" = "auth"."uid"())))));
GRANT SELECT ON TABLE "public"."enrollments" TO "authenticated";
GRANT SELECT ON TABLE "public"."lesson_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."courses", "public"."course_lessons", "public"."course_cohorts", "public"."enrollments", "public"."lesson_progress", "public"."course_notices", "public"."certificates" TO "service_role";

-- WHO GETS IN: free to anyone signed in, a paid purchase of one of its skus, or a live membership on one of its tiers
CREATE OR REPLACE FUNCTION "public"."course_has_access"("p_user" "uuid", "p_course" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p_user is not null and exists (
    select 1 from public.courses c where c.slug = p_course and c.published and (
      coalesce((c.access ->> 'free')::boolean, false)
      or exists (select 1 from public.purchases p
                  where p.user_id = p_user and p.status = 'paid'
                    and p.sku in (select jsonb_array_elements_text(coalesce(c.access -> 'skus', '[]'::jsonb))))
      or exists (select 1 from public.entitlements e
                  where e.user_id = p_user and e.active and e.kind = 'class' and e.key = 'subscribed'
                    and (e.expires_at is null or e.expires_at > now())
                    and e.tier in (select jsonb_array_elements_text(coalesce(c.access -> 'tiers', '[]'::jsonb))))));
$$;

-- WHICH LESSONS ARE OPEN, for one person, and why each closed one is not. Staff see every lesson open, to check a course.
CREATE OR REPLACE FUNCTION "public"."course_lessons_for"("p_course" "text", "p_user" "uuid")
    RETURNS TABLE("key" "text", "position" integer, "section" "text", "title" "text", "kind" "text", "ref" "text", "required" boolean, "open" boolean, "opens_at" timestamp with time zone, "why" "text", "done" boolean, "how" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
declare c public.courses; e public.enrollments; base timestamptz; ok boolean; staff boolean; step integer;
begin
  select * into c from public.courses where slug = p_course and published;
  if c.slug is null then return; end if;
  if p_user is not null then select * into e from public.enrollments en where en.user_id = p_user and en.course = p_course; end if;
  ok := public.course_has_access(p_user, p_course);
  staff := p_user is not null and p_user = auth.uid() and public.is_staff();
  if c.release = 'cohort' and e.cohort is not null then
    select (h.starts_on::timestamp at time zone 'UTC') into base from public.course_cohorts h where h.course = p_course and h.key = e.cohort;
  end if;
  base := coalesce(base, e.started_at);
  step := case c.release when 'all' then 0 else c.every_days end;
  return query
  with s as (
    select coalesce(x.section, '') as sec, min(x.position) as first from public.course_lessons x where x.course = p_course group by 1
  ), l as (
    select x.key, x.position, x.section, x.title, x.kind, x.ref, x.required,
      (row_number() over (order by x.position) - 1)::integer as idx,
      (dense_rank() over (order by s.first) - 1)::integer as sidx
    from public.course_lessons x join s on s.sec = coalesce(x.section, '') where x.course = p_course
  ), d as (
    select l.*, (p.lesson is not null) as fin, p.how as how_,
      case when base is null then null else base + make_interval(days => step * (case when c.drip = 'section' then l.sidx else l.idx end)) end as at
    from l left join public.lesson_progress p on p.enrollment = e.id and p.lesson = l.key
  ), o as (
    select d.*, coalesce((select bool_and(d2.fin) from d d2 where d2.position < d.position and d2.required), true) as before_done from d
  )
  select o.key, o.position, o.section, o.title, o.kind, o.ref, o.required,
    (staff or (e.id is not null and ok and o.at <= now() and (not c.in_order or o.before_done))),
    o.at,
    case when staff then null
         when p_user is null then 'sign-in'
         when not ok then 'no-access'
         when e.id is null then 'not-enrolled'
         when o.at > now() then 'not-yet'
         when c.in_order and not o.before_done then 'in-order'
         else null end,
    o.fin, o.how_
  from o order by o.position;
end;
$$;

-- THE COURSE AS THIS PERSON SEES IT: its outline (titles only), whether they are in, and every lesson's state
CREATE OR REPLACE FUNCTION "public"."course_state"("p_course" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare c public.courses; e public.enrollments; uid uuid := auth.uid(); lessons jsonb; cert text;
begin
  select * into c from public.courses where slug = p_course and published;
  if c.slug is null then return null; end if;
  if uid is not null then select * into e from public.enrollments where user_id = uid and course = p_course; end if;
  -- `has` is what kinds of media a lesson carries (video, audio, file) so the outline can mark it; never their addresses
  select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'section', f.section, 'title', f.title, 'kind', f.kind, 'ref', f.ref,
      'required', f.required, 'open', f.open, 'opens_at', f.opens_at, 'why', f.why, 'done', f.done,
      -- a quiz's best attempt, the reader's own
      'quiz', case when f.kind = 'form' and uid is not null then public.course_quiz_result(uid, f.ref) end,
      'has', coalesce((select jsonb_agg(distinct m ->> 'type') from public.course_lessons l, jsonb_array_elements(l.media) m
                        where l.course = p_course and l.key = f.key and m ->> 'type' is not null), '[]'::jsonb)) order by f.position), '[]'::jsonb)
    into lessons from public.course_lessons_for(p_course, uid) f;
  if e.id is not null then select id into cert from public.certificates where enrollment = e.id; end if;
  return jsonb_build_object(
    'slug', c.slug, 'title', c.title, 'about', c.about, 'image', c.image, 'release', c.release, 'drip', c.drip, 'every_days', c.every_days,
    'in_order', c.in_order, 'certificate', c.certificate, 'free', coalesce((c.access ->> 'free')::boolean, false),
    'skus', coalesce(c.access -> 'skus', '[]'::jsonb), 'tiers', coalesce(c.access -> 'tiers', '[]'::jsonb),
    'access', public.course_has_access(uid, p_course), 'signed_in', uid is not null,
    'enrollment', case when e.id is null then null else jsonb_build_object('started_at', e.started_at, 'completed_at', e.completed_at, 'cohort', e.cohort) end,
    'cohorts', coalesce((select jsonb_agg(jsonb_build_object('key', h.key, 'starts_on', h.starts_on) order by h.starts_on) from public.course_cohorts h where h.course = p_course), '[]'::jsonb),
    'lessons', lessons,
    'done', (select count(*) from jsonb_array_elements(lessons) x where (x ->> 'done')::boolean and (x ->> 'required')::boolean),
    'total', (select count(*) from jsonb_array_elements(lessons) x where (x ->> 'required')::boolean),
    'certificate_id', cert);
end;
$$;

-- THE LIBRARY: every published course, with the caller's place in it where they are in one — what getting in takes,
-- the next lesson open to them (its title only, from course_lessons_for, so nothing closed is told), when they were
-- last in it and their certificate. The page orders and groups it; this only answers.
CREATE OR REPLACE FUNCTION "public"."courses_list"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', c.slug, 'title', c.title, 'about', c.about, 'image', c.image,
      'lessons', (select count(*) from public.course_lessons l where l.course = c.slug),
      'sections', (select count(distinct coalesce(l.section, '')) from public.course_lessons l where l.course = c.slug),
      'free', coalesce((c.access ->> 'free')::boolean, false),
      'tiers', coalesce(c.access -> 'tiers', '[]'::jsonb), 'skus', coalesce(c.access -> 'skus', '[]'::jsonb),
      'access', public.course_has_access(auth.uid(), c.slug),
      'release', c.release, 'drip', c.drip, 'every_days', c.every_days, 'certificate', c.certificate,
      'enrolled', e.id is not null, 'started_at', e.started_at, 'completed_at', e.completed_at,
      'last_at', case when e.id is null then null else greatest(e.started_at,
        (select max(p.completed_at) from public.lesson_progress p where p.enrollment = e.id)) end,
      'done', (select count(*) from public.lesson_progress p join public.course_lessons l on l.course = c.slug and l.key = p.lesson and l.required where p.enrollment = e.id),
      'total', (select count(*) from public.course_lessons l where l.course = c.slug and l.required),
      'next', case when e.id is null or e.completed_at is not null then null else
        (select jsonb_build_object('key', f.key, 'title', f.title, 'section', f.section)
           from public.course_lessons_for(c.slug, auth.uid()) f where f.open and not f.done order by f.position limit 1) end,
      'next_opens_at', case when e.id is null or e.completed_at is not null then null else
        (select min(f.opens_at) from public.course_lessons_for(c.slug, auth.uid()) f where not f.open and f.why = 'not-yet') end,
      'certificate_id', (select x.id from public.certificates x where x.enrollment = e.id)
    ) order by c.position, c.title), '[]'::jsonb)
  from public.courses c
  left join public.enrollments e on e.course = c.slug and e.user_id = auth.uid()
  where c.published;
$$;

-- IN: an enrollment, for somebody who has access. A cohort course takes the cohort named, or the next to start.
CREATE OR REPLACE FUNCTION "public"."course_enroll"("p_course" "text", "p_cohort" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare uid uuid := auth.uid(); c public.courses; pick text;
begin
  if uid is null then return jsonb_build_object('error', 'sign-in'); end if;
  select * into c from public.courses where slug = p_course and published;
  if c.slug is null then return jsonb_build_object('error', 'no-course'); end if;
  if not public.course_has_access(uid, p_course) then return jsonb_build_object('error', 'no-access'); end if;
  if c.release = 'cohort' then
    select h.key into pick from public.course_cohorts h where h.course = p_course and (p_cohort is null or h.key = p_cohort)
      order by (h.starts_on >= current_date) desc, case when h.starts_on >= current_date then h.starts_on end asc, h.starts_on desc limit 1;
    if pick is null then return jsonb_build_object('error', 'no-cohort'); end if;
  end if;
  insert into public.enrollments (user_id, course, cohort) values (uid, p_course, pick) on conflict (user_id, course) do nothing;
  return public.course_state(p_course);
end;
$$;

-- made on the way in by a purchase or a membership, so a buyer finds the course already started
CREATE OR REPLACE FUNCTION "public"."course_enroll_for"("p_user" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer := 0; c record; pick text;
begin
  if p_user is null then return 0; end if;
  for c in select * from public.courses where published and not coalesce((access ->> 'free')::boolean, false) loop
    if public.course_has_access(p_user, c.slug) and not exists (select 1 from public.enrollments where user_id = p_user and course = c.slug) then
      pick := null;
      if c.release = 'cohort' then
        select h.key into pick from public.course_cohorts h where h.course = c.slug
          order by (h.starts_on >= current_date) desc, case when h.starts_on >= current_date then h.starts_on end asc, h.starts_on desc limit 1;
      end if;
      if c.release <> 'cohort' or pick is not null then
        insert into public.enrollments (user_id, course, cohort) values (p_user, c.slug, pick) on conflict (user_id, course) do nothing;
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."course_enroll_on_access"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.course_enroll_for(new.user_id);
  return null;
end;
$$;
CREATE OR REPLACE TRIGGER "trg_purchases_course_enroll" AFTER INSERT OR UPDATE OF "status" ON "public"."purchases" FOR EACH ROW WHEN (("new"."status" = 'paid'::"text") AND ("new"."user_id" IS NOT NULL)) EXECUTE FUNCTION "public"."course_enroll_on_access"();
CREATE OR REPLACE TRIGGER "trg_entitlements_course_enroll" AFTER INSERT OR UPDATE OF "active" ON "public"."entitlements" FOR EACH ROW WHEN (("new"."active") AND ("new"."kind" = 'class'::"text")) EXECUTE FUNCTION "public"."course_enroll_on_access"();

-- ONE LESSON'S TEXT, and only when it is open: the one way a lesson's body leaves the database
CREATE OR REPLACE FUNCTION "public"."course_lesson"("p_course" "text", "p_lesson" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare f record; l public.course_lessons;
begin
  select * into f from public.course_lessons_for(p_course, auth.uid()) x where x.key = p_lesson;
  if f.key is null then return jsonb_build_object('error', 'no-lesson'); end if;
  if not f.open then return jsonb_build_object('open', false, 'why', f.why, 'opens_at', f.opens_at, 'title', f.title); end if;
  select * into l from public.course_lessons where course = p_course and key = p_lesson;
  return jsonb_build_object('open', true, 'key', l.key, 'title', l.title, 'section', l.section, 'kind', l.kind, 'ref', l.ref,
    'body', l.body, 'media', l.media, 'required', l.required, 'done', f.done);
end;
$$;

-- FINISHING: the enrollment completes when every required lesson has, and the course's certificate is issued
CREATE OR REPLACE FUNCTION "public"."course_check_complete"("p_enrollment" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare e public.enrollments; c public.courses; who text;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if e.id is null or e.completed_at is not null then return false; end if;
  if exists (select 1 from public.course_lessons l where l.course = e.course and l.required
              and not exists (select 1 from public.lesson_progress p where p.enrollment = e.id and p.lesson = l.key)) then return false; end if;
  select * into c from public.courses where slug = e.course;
  update public.enrollments set completed_at = now() where id = e.id;
  -- an event like any other, so a site's achievement rule (event course_completed, match { course }) awards it
  insert into public.events (session_id, user_id, anon_id, type, props, occurred_at, source)
    values (gen_random_uuid(), e.user_id, e.user_id, 'course_completed', jsonb_build_object('course', e.course), now(), 'server');
  if c.certificate then
    select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1))
      into who from public.profiles p where p.id = e.user_id;
    insert into public.certificates (enrollment, name, course_title) values (e.id, coalesce(who, ''), c.title) on conflict (enrollment) do nothing;
  end if;
  return true;
end;
$$;

-- A LESSON FINISHED. What the server can see it checks: the form answered (and passed, where it is scored), the session booked.
CREATE OR REPLACE FUNCTION "public"."course_complete"("p_course" "text", "p_lesson" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare me uuid := auth.uid(); e public.enrollments; f record; how_ text;
begin
  if me is null then return jsonb_build_object('error', 'sign-in'); end if;
  select * into e from public.enrollments where user_id = me and course = p_course;
  if e.id is null then return jsonb_build_object('error', 'not-enrolled'); end if;
  select * into f from public.course_lessons_for(p_course, me) x where x.key = p_lesson;
  if f.key is null then return jsonb_build_object('error', 'no-lesson'); end if;
  if not f.open then return jsonb_build_object('error', coalesce(f.why, 'closed')); end if;
  how_ := case f.kind when 'text' then 'marked' when 'chapter' then 'read' when 'article' then 'read' when 'form' then 'form' else 'booked' end;
  if f.kind = 'form' and not exists (select 1 from public.form_responses r where r.user_id = me and r.form = f.ref and r.completed_at is not null and coalesce(r.passed, true)) then
    return jsonb_build_object('error', 'form-not-finished');
  end if;
  if f.kind = 'session' and not exists (select 1 from public.bookings b where b.user_id = me and b.type = f.ref and b.status in ('accepted', 'ended')) then
    return jsonb_build_object('error', 'not-booked');
  end if;
  insert into public.lesson_progress (enrollment, lesson, how) values (e.id, p_lesson, how_) on conflict do nothing;
  -- a quiz passed before its lesson opened, recorded now: its first pass, as the trigger records one
  if found and f.kind = 'form' and exists (select 1 from public.form_responses r where r.user_id = me and r.form = f.ref and r.completed_at is not null and r.passed is true) then
    insert into public.events (session_id, user_id, anon_id, type, props, occurred_at, source)
      values (gen_random_uuid(), me, me, 'quiz_passed', jsonb_build_object('course', p_course, 'lesson', p_lesson), now(), 'server');
  end if;
  perform public.course_check_complete(e.id);
  return public.course_state(p_course);
end;
$$;

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

-- A QUIZ'S RESULT for one person: their best score on a scored form, whether any attempt passed, and how many they
-- made. Every attempt is a form response of its own, so this reads them; nothing is copied. Null where none is scored.
CREATE OR REPLACE FUNCTION "public"."course_quiz_result"("p_user" "uuid", "p_form" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when count(*) = 0 then null else jsonb_build_object('score', max(r.score), 'total', max(r.total), 'passed', bool_or(coalesce(r.passed, false)), 'attempts', count(*)) end
  from public.form_responses r where r.user_id = p_user and r.form = p_form and r.completed_at is not null and r.total is not null;
$$;

-- a certificate, for anyone holding its address
CREATE OR REPLACE FUNCTION "public"."certificate_public"("p_id" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object('id', x.id, 'name', x.name, 'course', x.course_title, 'slug', e.course, 'issued_at', x.issued_at)
  from public.certificates x join public.enrollments e on e.id = x.enrollment where x.id = p_id;
$$;

-- the reader's own courses, for their app area
CREATE OR REPLACE FUNCTION "public"."my_courses"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.member_courses(auth.uid());
$$;

-- what somebody is enrolled in, for their card's private half: that person or staff, and nothing for anybody else
CREATE OR REPLACE FUNCTION "public"."member_courses"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.may_see_member(p_user) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('slug', c.slug, 'title', c.title, 'image', c.image, 'started_at', e.started_at, 'completed_at', e.completed_at,
        'done', (select count(*) from public.lesson_progress p join public.course_lessons l on l.course = c.slug and l.key = p.lesson and l.required where p.enrollment = e.id),
        'total', (select count(*) from public.course_lessons l where l.course = c.slug and l.required),
        'certificate_id', (select x.id from public.certificates x where x.enrollment = e.id))
      order by e.completed_at nulls first, e.started_at desc)
    from public.enrollments e join public.courses c on c.slug = e.course where e.user_id = p_user), '[]'::jsonb) end;
$$;

-- ADMINISTRATORS: who is where in a course (names and addresses, so an administrator's, as orders are), how many finish, and the lesson where most of those who have not are stuck
CREATE OR REPLACE FUNCTION "public"."admin_course_enrollments"("p_course" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare out jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'not-allowed'); end if;
  with r as (
    select e.id, e.user_id, e.cohort, e.started_at, e.completed_at,
      coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)) as name, p.email,
      (select count(*) from public.lesson_progress lp join public.course_lessons l on l.course = e.course and l.key = lp.lesson and l.required where lp.enrollment = e.id) as done,
      (select l.key from public.course_lessons l where l.course = e.course and l.required
        and not exists (select 1 from public.lesson_progress lp where lp.enrollment = e.id and lp.lesson = l.key) order by l.position limit 1) as at,
      -- each form lesson with this person's best attempt at it (attempts 0 where they have none)
      (select coalesce(jsonb_agg(jsonb_build_object('lesson', l.key, 'title', l.title, 'attempts', 0) || coalesce(public.course_quiz_result(e.user_id, l.ref), '{}'::jsonb) order by l.position), '[]'::jsonb)
        from public.course_lessons l where l.course = e.course and l.kind = 'form') as quizzes
    from public.enrollments e left join public.profiles p on p.id = e.user_id where e.course = p_course
  )
  select jsonb_build_object(
    'enrolled', (select count(*) from r),
    'completed', (select count(*) from r where completed_at is not null),
    'total', (select count(*) from public.course_lessons l where l.course = p_course and l.required),
    'stuck', (select jsonb_build_object('lesson', at, 'title', (select title from public.course_lessons where course = p_course and key = at), 'people', n)
                from (select at, count(*) as n from r where completed_at is null and at is not null group by at order by count(*) desc limit 1) s),
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'email', email, 'cohort', cohort, 'started_at', started_at, 'completed_at', completed_at, 'done', done, 'at', at, 'quizzes', quizzes) order by started_at desc) from r), '[]'::jsonb))
  into out;
  return out;
end;
$$;

-- THE NOTICES OWED: a lesson that opened since the last run for somebody enrolled before it opened (a course released
-- all at once tells nobody lesson by lesson), and a course finished. At most one lesson email a day to one person, the
-- earliest lesson first; never two for one lesson. course-notify writes the notice, then sends.
CREATE OR REPLACE FUNCTION "public"."course_notices_due"("p_late_hours" integer DEFAULT 48) RETURNS TABLE("enrollment" "uuid", "lesson" "text", "user_id" "uuid", "email" "text", "name" "text", "course" "text", "course_title" "text", "lesson_title" "text", "certificate_id" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
declare e record; f record;
begin
  for e in select en.*, c.title as ctitle, p.email as pemail,
             coalesce(nullif(p.first_name, ''), nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)) as pname
           from public.enrollments en join public.courses c on c.slug = en.course and c.published
           join public.profiles p on p.id = en.user_id where p.email is not null loop
    if e.completed_at is not null then
      if not exists (select 1 from public.course_notices n where n.enrollment = e.id and n.lesson = '*complete') then
        enrollment := e.id; lesson := '*complete'; user_id := e.user_id; email := e.pemail; name := e.pname; course := e.course;
        course_title := e.ctitle; lesson_title := null; certificate_id := (select x.id from public.certificates x where x.enrollment = e.id);
        return next;
      end if;
      continue;
    end if;
    for f in select * from public.course_lessons_for(e.course, e.user_id) x
              where x.open and not x.done and x.opens_at > e.started_at and x.opens_at > now() - make_interval(hours => p_late_hours)
                and not exists (select 1 from public.course_notices n where n.enrollment = e.id and n.lesson = x.key)
                -- one lesson email a day to one person, across every course: a second waits for tomorrow's run
                and not exists (select 1 from public.course_notices n2 join public.enrollments e2 on e2.id = n2.enrollment
                                 where e2.user_id = e.user_id and n2.lesson <> '*complete' and n2.sent_at > now() - interval '20 hours')
              order by x.position limit 1 loop
      enrollment := e.id; lesson := f.key; user_id := e.user_id; email := e.pemail; name := e.pname; course := e.course;
      course_title := e.ctitle; lesson_title := f.title; certificate_id := null;
      return next;
    end loop;
  end loop;
end;
$$;

-- THE SWEEP (pg_cron, every fifteen minutes, as the owner), on the same machinery as the event reminders
CREATE OR REPLACE FUNCTION "public"."run_course_notices"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/course-notify',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := jsonb_build_object('action', 'send'));
end;
$$;

REVOKE ALL ON FUNCTION "public"."course_lessons_for"("text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_lessons_for"("text", "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."course_lessons_for"("text", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."course_has_access"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_has_access"("uuid", "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."course_has_access"("uuid", "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."course_enroll_for"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_enroll_for"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."course_enroll_for"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."course_enroll_on_access"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_enroll_on_access"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."course_form_finished"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_form_finished"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."course_quiz_result"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_quiz_result"("uuid", "text") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."course_quiz_result"("uuid", "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."course_check_complete"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_check_complete"("uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."course_check_complete"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."course_notices_due"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."course_notices_due"(integer) FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."course_notices_due"(integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."run_course_notices"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_course_notices"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."run_course_notices"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."member_courses"("uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."member_courses"("uuid") TO "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."course_state"("text") TO "anon", "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."courses_list"() TO "anon", "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."certificate_public"("text") TO "anon", "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."course_lesson"("text", "text") TO "anon", "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."course_enroll"("text", "text") FROM PUBLIC, "anon";
GRANT ALL ON FUNCTION "public"."course_enroll"("text", "text") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."course_complete"("text", "text") FROM PUBLIC, "anon";
GRANT ALL ON FUNCTION "public"."course_complete"("text", "text") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."my_courses"() FROM PUBLIC, "anon";
GRANT ALL ON FUNCTION "public"."my_courses"() TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."admin_course_enrollments"("text") FROM PUBLIC, "anon";
GRANT ALL ON FUNCTION "public"."admin_course_enrollments"("text") TO "authenticated", "service_role";
