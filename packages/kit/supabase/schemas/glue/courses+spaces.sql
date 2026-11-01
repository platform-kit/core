-- GLUE: what joins the courses module and the spaces module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

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
