-- GLUE: what joins the forms module and the support module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- a ticket's answers, in its own lists: the short ones as { field: value } for filtering, or all in the order asked
CREATE OR REPLACE FUNCTION "public"."ticket_raised_with"("p_response" "uuid", "p_short" boolean) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when p_short then
      coalesce((select jsonb_object_agg(fa.field, fa.value)
                  from public.form_answers fa where fa.response_id = p_response and length(fa.value #>> '{}') <= 60), '{}'::jsonb)
    else
      coalesce((select jsonb_agg(jsonb_build_object('field', fa.field, 'value', fa.value) order by fa.slide, fa.field)
                  from public.form_answers fa where fa.response_id = p_response), '[]'::jsonb)
  end;
$$;

-- WHAT A TICKET WAS RAISED WITH, for the desk: the answers of the form that raised it, each with
-- the field it answered, so the desk can show them and filter by any of them without knowing in
-- advance what a site asks. The staff only; a ticket with no form answers nothing.
CREATE OR REPLACE FUNCTION "public"."ticket_answers"("p_ticket" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.is_support() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('field', a.field, 'value', a.value, 'slide', a.slide) order by a.slide, a.field)
      from public.support_tickets t
      join public.form_answers a on a.response_id = t.response_id
     where t.id = p_ticket), '[]'::jsonb) end;
$$;

-- EVERY ANSWER ACROSS THE OPEN TICKETS, for the desk's filters: a field, a value, and how many
-- tickets carry it. This is what makes "show me the urgent ones" or "show me the billing ones"
-- work for a question the kit has never heard of — the desk offers whatever the site asked.
CREATE OR REPLACE FUNCTION "public"."ticket_answer_values"("p_open" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.is_support() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('field', f, 'value', v, 'tickets', n) order by f, n desc, v)
      from (select a.field as f, a.value #>> '{}' as v, count(distinct t.id)::int as n
              from public.support_tickets t
              join public.form_answers a on a.response_id = t.response_id
             where t.response_id is not null
               and (not p_open or t.status not in ('resolved', 'closed'))
               and length(a.value #>> '{}') <= 60   -- a paragraph is not something anybody filters by
             group by 1, 2) x), '[]'::jsonb) end;
$$;
