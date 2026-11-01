-- GLUE: what joins the coaching module and the sessions module — declared only while both are on, after every module's
-- own file, so what it declares again replaces the answer-nothing version the asking module declares for a site without
-- the other (build/modules/backend.mjs; openspec: module-switch-removes-backend). Declarative, never a migration.
SET check_function_bodies = false;

-- a host's line to the person they booked with, in the conversation between them
CREATE OR REPLACE FUNCTION "public"."booking_tell"("p_to" "uuid", "p_from" "uuid", "p_body" "text") RETURNS boolean
    LANGUAGE "sql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into public.messages (conversation_id, sender_id, kind, body)
  values (public.conversation_between(p_to, p_from), p_from, 'text', p_body)
  returning true;
$$;

CREATE OR REPLACE FUNCTION "public"."send_booking_followups"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  b record; who record; cid uuid; sent integer := 0;
begin
  for b in
    select uid, provider_id, user_id, attendee_emails, followup_body
    from public.bookings
    where followup_sent_at is null and followup_at is not null and followup_at <= now()
      and provider_id is not null and followup_body is not null
    for update skip locked
  loop
    for who in
      select distinct p.id from public.profiles p
      where p.id <> b.provider_id
        and (p.id = b.user_id or lower(coalesce(p.email, '')) = any (b.attendee_emails))
    loop
      cid := public.conversation_between(who.id, b.provider_id);
      insert into public.messages (conversation_id, sender_id, kind, body) values (cid, b.provider_id, 'text', b.followup_body);
      sent := sent + 1;
    end loop;
    update public.bookings set followup_sent_at = now() where uid = b.uid;
  end loop;
  return sent;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."chat_session_with"("p_member" "uuid", "p_coach" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p_member is not null and p_coach is not null and exists (
    select 1 from public.bookings b
     where b.user_id = p_member and b.provider_id = p_coach
       and b.credit_id is not null and b.status = 'accepted'
       and now() < coalesce(b.end_at, b.start_at) + interval '7 days');
$$;

CREATE OR REPLACE FUNCTION "public"."chat_session_coaches"() RETURNS "uuid"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(array_agg(distinct b.provider_id), '{}'::uuid[]) from public.bookings b
   where b.user_id = auth.uid() and b.provider_id is not null
     and b.credit_id is not null and b.status = 'accepted'
     and now() < coalesce(b.end_at, b.start_at) + interval '7 days';
$$;
