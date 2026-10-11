-- support: the support desk: contacts, conversations, messages, the staff's presence
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."bump_support_conversation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform set_config('support.bump', '1', true);
  update public.support_conversations set
    last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
    last_contact_at = case when new.author = 'contact' then greatest(coalesce(last_contact_at, new.created_at), new.created_at) else last_contact_at end,
    last_agent_at   = case when new.author = 'agent' then greatest(coalesce(last_agent_at, new.created_at), new.created_at) else last_agent_at end,
    contact_read_at = case when new.author = 'contact' then greatest(coalesce(contact_read_at, new.created_at), new.created_at) else contact_read_at end,
    agent_read_at   = case when new.author = 'agent' then greatest(coalesce(agent_read_at, new.created_at), new.created_at) else agent_read_at end,
    status          = case when new.author = 'contact' and status = 'resolved' then 'open' else status end,
    resolved_at     = case when new.author = 'contact' and status = 'resolved' then null else resolved_at end
  where id = new.conversation_id;
  perform set_config('support.bump', '', true);
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."guard_support_contact_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if auth.role() in ('anon', 'authenticated') then
    if new.user_id is distinct from old.user_id or new.token_hash is distinct from old.token_hash or new.anon_id is distinct from old.anon_id
       or new.ip is distinct from old.ip or new.last_seen_at is distinct from old.last_seen_at or new.last_path is distinct from old.last_path
       or new.ua is distinct from old.ua or new.created_at is distinct from old.created_at then
      raise exception 'only the note is yours to change';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."guard_support_conversation_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if auth.role() in ('anon', 'authenticated') and coalesce(current_setting('support.bump', true), '') <> '1' then
    if new.contact_id is distinct from old.contact_id
       or new.source is distinct from old.source
       or new.prompt_id is distinct from old.prompt_id
       or new.path is distinct from old.path
       or new.created_at is distinct from old.created_at
       or new.last_message_at is distinct from old.last_message_at
       or new.last_contact_at is distinct from old.last_contact_at
       or new.last_agent_at is distinct from old.last_agent_at
       or new.contact_read_at is distinct from old.contact_read_at
       or new.contact_notified_at is distinct from old.contact_notified_at
       or new.contact_typing_at is distinct from old.contact_typing_at
       or new.escalated_at is distinct from old.escalated_at then
      raise exception 'only the status, the assignee and the read stamp are yours to change';
    end if;
  end if;
  if new.status = 'resolved' and old.status <> 'resolved' then new.resolved_at := now();
  elsif new.status <> 'resolved' then new.resolved_at := null;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."guard_support_message_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if auth.role() in ('anon', 'authenticated') then
    if new.conversation_id is distinct from old.conversation_id or new.author is distinct from old.author or new.agent_id is distinct from old.agent_id
       or new.kind is distinct from old.kind or new.body is distinct from old.body or new.attachment_path is distinct from old.attachment_path
       or new.attachment_type is distinct from old.attachment_type or new.attachment_name is distinct from old.attachment_name
       or new.attachment_size is distinct from old.attachment_size or new.seconds is distinct from old.seconds or new.created_at is distinct from old.created_at
       -- an offer and its taking are the function's alone: a contact never touches RLS at all, and
       -- an agent editing their own line has no business saying what a bot offered or who took it
       or new.choices is distinct from old.choices or new.choice_at is distinct from old.choice_at
       or new.choice_key is distinct from old.choice_key then
      raise exception 'a message cannot be edited, only withdrawn';
    end if;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."run_support_escalation"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/support',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"escalate"}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."run_support_retention"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/support',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"retain"}'::jsonb,
    timeout_milliseconds := 120000);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."support_agents"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_support() then coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)), 'roles', to_jsonb(p.roles)
  ) order by p.display_name, p.email), '[]'::jsonb) else '[]'::jsonb end
  from public.profiles p where p.roles && array['admin', 'support'];
$$;

CREATE OR REPLACE FUNCTION "public"."support_inbox"("p_status" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 300) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with convs as (
    select c.* from public.support_conversations c
    where p_status is null or c.status = p_status
    order by coalesce(c.last_message_at, c.created_at) desc
    limit greatest(1, least(coalesce(p_limit, 300), 1000))
  ),
  items as (
    select
      x.id, x.status, x.assignee_id, x.source, x.prompt_id, x.path, x.created_at, x.last_message_at,
      x.last_contact_at, x.last_agent_at, x.resolved_at, x.contact_read_at, x.agent_read_at, x.contact_typing_at,
      jsonb_build_object(
        'id', k.id, 'user_id', k.user_id,
        'name', case when k.user_id is null then null else coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)) end,
        'email', case when k.user_id is null then null else p.email end,
        'verified', k.user_id is not null and p.email_verified_at is not null,
        'kind', case
          when k.user_id is null then 'guest'
          when exists (select 1 from public.purchases pu where pu.status = 'paid' and pu.user_id = k.user_id)
            or exists (select 1 from public.entitlements en where en.user_id = k.user_id and en.kind = 'class' and en.key = 'subscribed' and en.active and (en.expires_at is null or en.expires_at > now()))
            then 'customer'
          else 'user' end,
        'orders', (select count(*) from public.purchases pu where pu.status = 'paid' and pu.user_id = k.user_id),
        'notes', k.notes, 'custom_attributes', k.custom_attributes,
        'last_seen_at', k.last_seen_at, 'last_path', k.last_path, 'created_at', k.created_at
      ) as contact,
      (select to_jsonb(l) from (
         select m.id, m.author, m.kind, m.body, m.seconds, m.deleted_at, m.created_at from public.support_messages m
         where m.conversation_id = x.id order by m.created_at desc limit 1) l) as last,
      (select count(*) from public.support_messages m where m.conversation_id = x.id and m.author = 'contact'
         and m.created_at > coalesce(x.agent_read_at, '-infinity'::timestamptz)) as unread,
      case when x.status <> 'resolved' and x.last_contact_at is not null and x.last_contact_at > coalesce(x.last_agent_at, '-infinity'::timestamptz)
        then (select min(m.created_at) from public.support_messages m where m.conversation_id = x.id and m.author = 'contact'
                and m.created_at > coalesce(x.last_agent_at, '-infinity'::timestamptz))
        else null end as waiting_since,
      (select coalesce(nullif(a.display_name, ''), split_part(coalesce(a.email, ''), '@', 1)) from public.profiles a where a.id = x.assignee_id) as assignee
    from convs x
    join public.support_contacts k on k.id = x.contact_id
    left join public.profiles p on p.id = k.user_id
  )
  select case when public.is_support() then coalesce(jsonb_agg(to_jsonb(items) order by coalesce(items.last_message_at, items.created_at) desc), '[]'::jsonb) else null end
  from items;
$$;

CREATE OR REPLACE FUNCTION "public"."support_search"("q" "text", "lim" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_support() and length(trim(coalesce(q, ''))) >= 2 then coalesce((
    select jsonb_agg(distinct c.id)
    from public.support_conversations c
    join public.support_contacts k on k.id = c.contact_id
    left join public.profiles p on p.id = k.user_id
    where exists (select 1 from public.support_messages m where m.conversation_id = c.id and m.deleted_at is null and m.body ilike '%' || trim(q) || '%')
       or p.display_name ilike '%' || trim(q) || '%' or p.email ilike '%' || trim(q) || '%' or k.notes ilike '%' || trim(q) || '%'
    limit greatest(1, least(coalesce(lim, 50), 500))
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;

CREATE OR REPLACE FUNCTION "public"."support_unread_staff"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_support() then (
    select coalesce(count(*), 0)::integer
    from public.support_messages m
    join public.support_conversations c on c.id = m.conversation_id
    where m.author = 'contact' and c.status <> 'resolved' and m.created_at > coalesce(c.agent_read_at, '-infinity'::timestamptz)
  ) else 0 end;
$$;

CREATE OR REPLACE FUNCTION "public"."support_wake"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  k text;
begin
  if tg_table_name = 'support_messages' then
    select listen_key into k from public.support_conversations where id = new.conversation_id;
    if k is not null then perform realtime.send(jsonb_build_object('at', now(), 'id', new.id), 'message', 'support:' || k, false); end if;
  else
    perform realtime.send(jsonb_build_object('at', now()), 'conversation', 'support:' || new.listen_key, false);
  end if;
  return null;
end;
$$;

CREATE TABLE IF NOT EXISTS "public"."support_agents_seen" (
    "user_id" "uuid" NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."support_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "token_hash" "text",
    "anon_id" "text",
    "last_seen_at" timestamp with time zone,
    "last_path" "text",
    "ua" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip" "text",
    "notes" "text",
    "custom_attributes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."support_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "assignee_id" "uuid",
    -- WHEN SOMEBODY ASKED FOR A PERSON. An act: they said they wanted one, so it is a row and it is
    -- theirs. While it is set no bot answers this thread, whatever the bot is configured to do —
    -- a bot you cannot get away from is a bad bot. Cleared only by a human taking the thread.
    -- WHEN THE BOT BECAME THIS THREAD'S HANDLER. A conversation has one handler at a time — the
    -- bot or a person — which is how every desk that does this models it. An `always` bot is the
    -- handler of every thread; an `ask` bot becomes one when the reader chooses it, and from then
    -- on it answers what they write rather than making them press again for each message.
    "bot_at" timestamp with time zone,
    "bot_off_at" timestamp with time zone,
    "source" "text" DEFAULT 'contact'::"text" NOT NULL,
    "prompt_id" "uuid",
    "path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_message_at" timestamp with time zone,
    "last_contact_at" timestamp with time zone,
    "last_agent_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "contact_read_at" timestamp with time zone,
    "agent_read_at" timestamp with time zone,
    "contact_notified_at" timestamp with time zone,
    "escalated_at" timestamp with time zone,
    "agent_typing_at" timestamp with time zone,
    "contact_typing_at" timestamp with time zone,
    "acknowledged_at" timestamp with time zone,
    "listen_key" "text" DEFAULT "translate"("encode"("extensions"."gen_random_bytes"(18), 'base64'::"text"), '+/='::"text", '-_'::"text") NOT NULL,
    CONSTRAINT "support_conversations_source_check" CHECK (("source" = ANY (ARRAY['contact'::"text", 'prompt'::"text"]))),
    CONSTRAINT "support_conversations_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'pending'::"text", 'resolved'::"text"])))
,
    "custom_attributes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL);

ALTER TABLE ONLY "public"."support_conversations" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."support_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "author" "text" NOT NULL,
    "agent_id" "uuid",
    -- WHICH BOT SAID IT, where a bot did. An agent's line and a bot's line are both author 'agent'
    -- — they are both the business answering — but a reader is owed the difference, and the widget
    -- cannot offer "talk to a person" without knowing whether a person has already answered.
    "bot" "text",
    "body" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" DEFAULT 'text'::"text" NOT NULL,
    "attachment_path" "text",
    "attachment_type" "text",
    "attachment_name" "text",
    "attachment_size" integer,
    "seconds" numeric,
    -- WHAT WAS OFFERED, AND WHETHER IT WAS TAKEN. A bot's answer may end in a list, and the list is
    -- cut off the words on the way in so nothing downstream reparses markdown and no reader is ever
    -- shown the grammar (the arrow that points a choice at a form read as an arrow and a path, the
    -- one time this was cut at render). Taken is a stamp rather than a guess from the transcript:
    -- the same person on two tabs cannot take one offer twice.
    "choices" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "choice_at" timestamp with time zone,
    "choice_key" "text",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "support_messages_author_check" CHECK (("author" = ANY (ARRAY['contact'::"text", 'agent'::"text", 'system'::"text"]))),
    CONSTRAINT "support_messages_body_check" CHECK (((("kind" = 'text'::"text") AND ("body" IS NOT NULL) AND (("char_length"("body") >= 1) AND ("char_length"("body") <= 4000))) OR (("kind" <> 'text'::"text") AND ("attachment_path" IS NOT NULL) AND (("body" IS NULL) OR ("char_length"("body") <= 4000))))),
    CONSTRAINT "support_messages_kind_check" CHECK (("kind" = ANY (ARRAY['text'::"text", 'voice'::"text", 'file'::"text"])))
);

ALTER TABLE ONLY "public"."support_agents_seen"
    ADD CONSTRAINT "support_agents_seen_pkey" PRIMARY KEY ("user_id");

ALTER TABLE ONLY "public"."support_contacts"
    ADD CONSTRAINT "support_contacts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."support_contacts"
    ADD CONSTRAINT "support_contacts_token_hash_key" UNIQUE ("token_hash");

ALTER TABLE ONLY "public"."support_contacts"
    ADD CONSTRAINT "support_contacts_user_id_key" UNIQUE ("user_id");

ALTER TABLE ONLY "public"."support_conversations"
    ADD CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id");

CREATE INDEX "support_conversations_contact_idx" ON "public"."support_conversations" USING "btree" ("contact_id", "last_message_at" DESC);

CREATE UNIQUE INDEX "support_conversations_listen_idx" ON "public"."support_conversations" USING "btree" ("listen_key");

CREATE UNIQUE INDEX "support_conversations_prompt_idx" ON "public"."support_conversations" USING "btree" ("contact_id", "prompt_id") WHERE ("prompt_id" IS NOT NULL);

CREATE INDEX "support_conversations_status_idx" ON "public"."support_conversations" USING "btree" ("status", "last_message_at" DESC);

CREATE INDEX "support_messages_conversation_idx" ON "public"."support_messages" USING "btree" ("conversation_id", "created_at");

CREATE OR REPLACE TRIGGER "trg_support_contacts_guard" BEFORE UPDATE ON "public"."support_contacts" FOR EACH ROW EXECUTE FUNCTION "public"."guard_support_contact_edit"();

CREATE OR REPLACE TRIGGER "trg_support_conversations_guard" BEFORE UPDATE ON "public"."support_conversations" FOR EACH ROW EXECUTE FUNCTION "public"."guard_support_conversation_edit"();

CREATE OR REPLACE TRIGGER "trg_support_conversations_wake" AFTER UPDATE ON "public"."support_conversations" FOR EACH ROW WHEN ((("old"."status" IS DISTINCT FROM "new"."status") OR ("old"."agent_typing_at" IS DISTINCT FROM "new"."agent_typing_at") OR ("old"."agent_read_at" IS DISTINCT FROM "new"."agent_read_at") OR ("old"."assignee_id" IS DISTINCT FROM "new"."assignee_id"))) EXECUTE FUNCTION "public"."support_wake"();

CREATE OR REPLACE TRIGGER "trg_support_messages_bump" AFTER INSERT ON "public"."support_messages" FOR EACH ROW EXECUTE FUNCTION "public"."bump_support_conversation"();

CREATE OR REPLACE TRIGGER "trg_support_messages_guard" BEFORE UPDATE ON "public"."support_messages" FOR EACH ROW EXECUTE FUNCTION "public"."guard_support_message_edit"();

CREATE OR REPLACE TRIGGER "trg_support_messages_wake" AFTER INSERT OR UPDATE ON "public"."support_messages" FOR EACH ROW EXECUTE FUNCTION "public"."support_wake"();

ALTER TABLE ONLY "public"."support_agents_seen"
    ADD CONSTRAINT "support_agents_seen_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."support_contacts"
    ADD CONSTRAINT "support_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."support_conversations"
    ADD CONSTRAINT "support_conversations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."support_conversations"
    ADD CONSTRAINT "support_conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."support_contacts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."support_messages"
    ADD CONSTRAINT "support_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE CASCADE;

ALTER TABLE "public"."support_agents_seen" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_agents_seen_own_insert" ON "public"."support_agents_seen" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_support"() AND ("user_id" = "auth"."uid"())));

CREATE POLICY "support_agents_seen_own_update" ON "public"."support_agents_seen" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("public"."is_support"() AND ("user_id" = "auth"."uid"())));

CREATE POLICY "support_agents_seen_staff_select" ON "public"."support_agents_seen" FOR SELECT TO "authenticated" USING ("public"."is_support"());

ALTER TABLE "public"."support_contacts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_contacts_staff_select" ON "public"."support_contacts" FOR SELECT TO "authenticated" USING ("public"."is_support"());

CREATE POLICY "support_contacts_staff_update" ON "public"."support_contacts" FOR UPDATE TO "authenticated" USING ("public"."is_support"()) WITH CHECK ("public"."is_support"());

ALTER TABLE "public"."support_conversations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_conversations_staff_delete" ON "public"."support_conversations" FOR DELETE TO "authenticated" USING ("public"."is_support"());

CREATE POLICY "support_conversations_staff_select" ON "public"."support_conversations" FOR SELECT TO "authenticated" USING ("public"."is_support"());

CREATE POLICY "support_conversations_staff_update" ON "public"."support_conversations" FOR UPDATE TO "authenticated" USING ("public"."is_support"()) WITH CHECK ("public"."is_support"());

ALTER TABLE "public"."support_messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_messages_staff_insert" ON "public"."support_messages" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_support"() AND ("author" = 'agent'::"text") AND ("agent_id" = "auth"."uid"())));

CREATE POLICY "support_messages_staff_select" ON "public"."support_messages" FOR SELECT TO "authenticated" USING ("public"."is_support"());

CREATE POLICY "support_messages_staff_update" ON "public"."support_messages" FOR UPDATE TO "authenticated" USING (("public"."is_support"() AND ("author" = 'agent'::"text") AND ("agent_id" = "auth"."uid"()))) WITH CHECK (("public"."is_support"() AND ("author" = 'agent'::"text") AND ("agent_id" = "auth"."uid"())));

GRANT ALL ON FUNCTION "public"."bump_support_conversation"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_support_conversation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_support_conversation"() TO "service_role";

GRANT ALL ON FUNCTION "public"."guard_support_contact_edit"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_support_contact_edit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_support_contact_edit"() TO "service_role";

GRANT ALL ON FUNCTION "public"."guard_support_conversation_edit"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_support_conversation_edit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_support_conversation_edit"() TO "service_role";

GRANT ALL ON FUNCTION "public"."guard_support_message_edit"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_support_message_edit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_support_message_edit"() TO "service_role";

GRANT ALL ON FUNCTION "public"."run_support_escalation"() TO "anon";
GRANT ALL ON FUNCTION "public"."run_support_escalation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_support_escalation"() TO "service_role";

GRANT ALL ON FUNCTION "public"."run_support_retention"() TO "anon";
GRANT ALL ON FUNCTION "public"."run_support_retention"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_support_retention"() TO "service_role";

GRANT ALL ON FUNCTION "public"."support_agents"() TO "anon";
GRANT ALL ON FUNCTION "public"."support_agents"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."support_agents"() TO "service_role";

GRANT ALL ON FUNCTION "public"."support_inbox"("p_status" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."support_inbox"("p_status" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."support_inbox"("p_status" "text", "p_limit" integer) TO "service_role";

GRANT ALL ON FUNCTION "public"."support_search"("q" "text", "lim" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."support_search"("q" "text", "lim" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."support_search"("q" "text", "lim" integer) TO "service_role";

GRANT ALL ON FUNCTION "public"."support_unread_staff"() TO "anon";
GRANT ALL ON FUNCTION "public"."support_unread_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."support_unread_staff"() TO "service_role";

GRANT ALL ON FUNCTION "public"."support_wake"() TO "anon";
GRANT ALL ON FUNCTION "public"."support_wake"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."support_wake"() TO "service_role";

GRANT ALL ON TABLE "public"."support_agents_seen" TO "anon";
GRANT ALL ON TABLE "public"."support_agents_seen" TO "authenticated";
GRANT ALL ON TABLE "public"."support_agents_seen" TO "service_role";

GRANT ALL ON TABLE "public"."support_contacts" TO "anon";
GRANT ALL ON TABLE "public"."support_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."support_contacts" TO "service_role";

GRANT ALL ON TABLE "public"."support_conversations" TO "anon";
GRANT ALL ON TABLE "public"."support_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."support_conversations" TO "service_role";

GRANT ALL ON TABLE "public"."support_messages" TO "anon";
GRANT ALL ON TABLE "public"."support_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."support_messages" TO "service_role";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."support_contacts", "public"."support_conversations", "public"."support_messages";

-- Attachments live in the private support bucket; the staff's side under RLS, a contact's through the function.
CREATE POLICY "support staff add files" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (bucket_id = 'support' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]+$' and public.is_support());
CREATE POLICY "support staff read files" ON "storage"."objects" FOR SELECT TO "authenticated" USING (bucket_id = 'support' and public.is_support());

-- the Support API's webhooks (support-api-chatwoot): a subscription made through the Application API — Chatwoot's events
-- delivered by the support-api function, which the database tells of every insert and change whichever door made it
-- (the widget's function, the inbox under RLS, the API): support_api_notify over pg_net with the service secret.
CREATE TABLE IF NOT EXISTS "public"."support_webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "url" "text" NOT NULL,
    "subscriptions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_at" timestamp with time zone,
    "last_error" "text",
    -- A subscription a deployment SHIPS is declared (platformkit.config.js `webhooks`) and is the
    -- projection's to replace; one somebody made through the API is theirs and is never touched.
    "source" "text" DEFAULT 'hand'::"text" NOT NULL,
    CONSTRAINT "support_webhooks_source_check" CHECK (("source" = ANY (ARRAY['file'::"text", 'hand'::"text"])))
);
ALTER TABLE ONLY "public"."support_webhooks" ADD CONSTRAINT "support_webhooks_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."support_webhooks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "support_webhooks_staff_select" ON "public"."support_webhooks" FOR SELECT TO "authenticated" USING ("public"."is_support"());
GRANT SELECT ON TABLE "public"."support_webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."support_webhooks" TO "service_role";

CREATE OR REPLACE FUNCTION "public"."support_api_notify"("event" "text", "id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  url text; secret text;
begin
  if not exists (select 1 from public.support_webhooks) then return; end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'functions_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/support-api/deliver',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := jsonb_build_object('event', event, 'id', id),
    timeout_milliseconds := 30000);
end;
$$;
REVOKE ALL ON FUNCTION "public"."support_api_notify"("event" "text", "id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."support_api_notify"("event" "text", "id" "uuid") FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."support_api_notify"("event" "text", "id" "uuid") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."support_api_on_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.support_api_notify('message_created', new.id);
  return null;
end;
$$;
CREATE OR REPLACE FUNCTION "public"."support_api_on_conversation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then perform public.support_api_notify('conversation_created', new.id);
  elsif old.status is distinct from new.status then perform public.support_api_notify('conversation_status_changed', new.id);
  elsif old.assignee_id is distinct from new.assignee_id or old.custom_attributes is distinct from new.custom_attributes then perform public.support_api_notify('conversation_updated', new.id);
  end if;
  return null;
end;
$$;
CREATE OR REPLACE FUNCTION "public"."support_api_on_contact"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.support_api_notify('contact_created', new.id);
  return null;
end;
$$;
CREATE OR REPLACE TRIGGER "trg_support_messages_api" AFTER INSERT ON "public"."support_messages" FOR EACH ROW EXECUTE FUNCTION "public"."support_api_on_message"();
CREATE OR REPLACE TRIGGER "trg_support_conversations_api" AFTER INSERT OR UPDATE ON "public"."support_conversations" FOR EACH ROW EXECUTE FUNCTION "public"."support_api_on_conversation"();
CREATE OR REPLACE TRIGGER "trg_support_contacts_api" AFTER INSERT ON "public"."support_contacts" FOR EACH ROW EXECUTE FUNCTION "public"."support_api_on_contact"();
