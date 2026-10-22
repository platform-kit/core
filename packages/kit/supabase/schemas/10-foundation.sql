-- foundation: accounts (profiles, the role, the verified address), the reader's own document, app_settings, and the helpers every policy asks (is_admin, is_staff, is_subscribed)
-- The declared schema of this module. Declarative: the file says what exists, and a plan brings a
-- database to it (platformkit migrate --plan). Never a migration. Edit here; never a copy under supabase/.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."guard_profile_privileged"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if auth.role() in ('anon', 'authenticated') then
    if new.role is distinct from old.role then
      raise exception 'profiles.role is not user-writable';
    end if;
    if new.stripe_customer_id is distinct from old.stripe_customer_id then
      raise exception 'profiles.stripe_customer_id is not user-writable';
    end if;
    -- the address is the account's own (auth.users), which only a confirmed change moves: guest
    -- purchases are claimed by it and session hosts are named by it, so a profile that could name
    -- any address could take a stranger's orders or their place on a host's calendar
    if new.email is distinct from old.email then
      raise exception 'profiles.email is not user-writable';
    end if;
    -- only set_roles() may change these, and it says so for its transaction
    if new.roles is distinct from old.roles
       and coalesce(current_setting('app.setting_roles', true), '') <> '1' then
      raise exception 'profiles.roles is not user-writable';
    end if;
    -- only mark_email_verified() may set the flag; it says so for its transaction
    if new.email_verified_at is distinct from old.email_verified_at
       and coalesce(current_setting('app.verifying_email', true), '') <> '1' then
      raise exception 'profiles.email_verified_at is not user-writable';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, display_name, email_verified_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when coalesce(new.raw_app_meta_data ->> 'provider', 'email') not in ('email', 'phone') then now() else null end
  )
  on conflict (id) do nothing;
  perform public.claim_guest_purchases(new.id, new.email);
  return new;
end;
$$;

-- who a set of accounts are, for an administrator's page (orders, bookings): profiles are self-select, so the desk asks here — never the table
CREATE OR REPLACE FUNCTION "public"."admin_people"("ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_admin() then coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)), 'email', p.email, 'roles', to_jsonb(p.roles)))
    from public.profiles p where p.id = any(ids)
  ), '[]'::jsonb) else null end
$$;

-- WHAT SOMEBODY MAY DO, asked by name. A policy, a function or a component that compares a role's
-- name is a fault: these five are the only places that know which role reaches what, which is what
-- makes a sixth role cheap and what would let a role mean something different later without
-- touching a single policy.
CREATE OR REPLACE FUNCTION "public"."has_role"("p_role" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and p_role = any(roles));
$$;

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_role('admin');
$$;

-- anybody who runs any part of the site, whatever part that is
CREATE OR REPLACE FUNCTION "public"."is_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and cardinality(roles) > 0);
$$;

-- WHO IS ON THE DESK — and it is not everybody who holds a role.
--
-- `is_staff()` above asks whether somebody is ANYTHING on this site, which is the right question
-- for a staff room and the wrong one for a stranger's support conversation: the roles are admin,
-- provider (a coach who sells their time here), editor, support and analyst, so is_staff() let an
-- analyst — granted the figures and nothing else — and a provider — who is a seller on the
-- platform, not office staff — read every support conversation, every contact and every address
-- that had ever written in. The support-chat spec has always said the desk is an administrator or
-- somebody on support; the implementation had drifted wider than its own words.
--
-- So the desk asks this instead. Everything else keeps asking is_staff(), because a staff space, a
-- moderation queue and a bot's ticket are about working here rather than about the desk.
CREATE OR REPLACE FUNCTION "public"."is_support"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and roles && ARRAY['admin', 'support']);
$$;

REVOKE ALL ON FUNCTION "public"."is_support"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."is_support"() FROM "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."is_support"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_support"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_support"() TO "service_role";

-- THE PERSON WHO DELIVERS WHAT THE SITE SELLS — a coach, a healer, a therapist, a consultant, a
-- tutor. The kit calls them a PROVIDER because the kit has no idea what the business is; what a
-- reader sees them called is the site's own word, and what THIS person is called is their own
-- (profiles.title). Their one-to-one threads, their hours and their bookings.
CREATE OR REPLACE FUNCTION "public"."is_provider"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_role('provider') or public.has_role('coach') or public.has_role('admin');
$$;

-- every content collection, and the pipe that publishes them
CREATE OR REPLACE FUNCTION "public"."may_edit_content"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_role('editor') or public.has_role('admin');
$$;

-- the dashboards. An analyst writes nothing anywhere, which is enforced by no policy admitting
-- this to an insert rather than by a flag saying so.
CREATE OR REPLACE FUNCTION "public"."may_see_figures"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_role('analyst') or public.has_role('admin');
$$;

-- WHO THE STAFF ARE, and who may change that: an administrator, and never the last one taking
-- their own last role away — a site that can be locked out of itself by one careless press is a
-- site somebody has to reach with a database session to mend.
CREATE OR REPLACE FUNCTION "public"."set_roles"("p_user" "uuid", "p_roles" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare want text[] := coalesce(p_roles, '{}'::text[]); admins int;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'why', 'administrators only'); end if;
  if p_user is null then return jsonb_build_object('ok', false, 'why', 'nobody named'); end if;
  -- the SETTER names the new word alone, so nothing new is ever written as 'coach' even while the
  -- constraint above still tolerates a row that predates the change
  if not (want <@ array['admin', 'provider', 'editor', 'support', 'analyst']) then
    return jsonb_build_object('ok', false, 'why', 'a role this site has never heard of');
  end if;
  -- ONE ROLE CHANGE AT A TIME: two administrators taking each other's role at the same moment would
  -- each count the other and both succeed, leaving none. The lock is the transaction's, so the second
  -- counts after the first has committed.
  perform pg_advisory_xact_lock(hashtext('platformkit.set_roles'));
  if 'admin' <> all(want) then
    select count(*) into admins from public.profiles where 'admin' = any(roles) and id <> p_user;
    if admins = 0 then return jsonb_build_object('ok', false, 'why', 'last-admin'); end if;
  end if;
  perform set_config('app.setting_roles', '1', true);
  update public.profiles set roles = want where id = p_user;
  return jsonb_build_object('ok', true, 'roles', to_jsonb(want));
end;
$$;

-- WHO THE STAFF ARE, for the page that says so — and, given something to search by, anybody at all,
-- because granting somebody their first role means finding them among every account first. It
-- answers nothing to anybody but an administrator, and never more than a page of people.
CREATE OR REPLACE FUNCTION "public"."admin_staff"("p_q" "text" DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when public.is_admin() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email,
      'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
      'roles', to_jsonb(p.roles)) order by cardinality(p.roles) desc, p.email)
    from (
      select * from public.profiles p2
       where case when coalesce(trim(p_q), '') = '' then cardinality(p2.roles) > 0
                  else p2.email ilike '%' || trim(p_q) || '%' or p2.display_name ilike '%' || trim(p_q) || '%' end
       order by cardinality(p2.roles) desc, p2.email
       limit 50
    ) p
  ), '[]'::jsonb) else null end
$$;

-- ---------------------------------------------------------------------------------------------
-- EVERY ACCOUNT, for the one page responsible for all of them
-- ---------------------------------------------------------------------------------------------

-- admin_staff answers the people who already hold a role, which is what granting one needs and is
-- useless for the other question an operator has: WHO ARE MY CUSTOMERS. This answers every
-- registered account — searchable, narrowed by what the site already knows, and paged, because a
-- site with twenty thousand readers must not be a page that loads twenty thousand rows.
--
-- What it says about each is only what the site already holds. Nothing here asks anybody anything,
-- and nothing here is editable: this is a page for SEEING who somebody is. The one thing an
-- administrator changes from it is a role, through set_roles, which is already the one writer.
CREATE OR REPLACE FUNCTION "public"."admin_everybody"(
      "p_q" "text" DEFAULT NULL, "p_narrow" "text" DEFAULT NULL,
      "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with q as (select nullif(btrim(coalesce(p_q, '')), '') as term),
  live as (
    select distinct e.user_id from public.entitlements e
     where e.kind = 'class' and e.key = 'subscribed' and e.active
       and (e.expires_at is null or e.expires_at > now())),
  paid as (select distinct pu.user_id from public.purchases pu where pu.status = 'paid' and pu.user_id is not null),
  found as (
    select p.*,
           (p.id in (select user_id from live)) as member,
           (p.id in (select user_id from paid)) as customer
      from public.profiles p, q
     where (q.term is null
            or p.email ilike '%' || q.term || '%'
            or p.display_name ilike '%' || q.term || '%'
            or p.username ilike '%' || q.term || '%')
       and (coalesce(p_narrow, 'all') = 'all'
            or (p_narrow = 'staff' and cardinality(p.roles) > 0)
            or (p_narrow = 'provider' and ('provider' = any(p.roles) or 'coach' = any(p.roles)))
            or (p_narrow = 'member' and p.id in (select user_id from live))
            or (p_narrow = 'paid' and p.id in (select user_id from paid))
            /* an address that has never answered its confirmation: the one narrowing that is about
               something being WRONG, and the reason somebody opens this page at all */
            or (p_narrow = 'unconfirmed' and p.email_verified_at is null)))
  select case when public.is_admin() then jsonb_build_object(
    'total', (select count(*) from found),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'email', f.email,
        'name', coalesce(nullif(f.display_name, ''), split_part(coalesce(f.email, ''), '@', 1)),
        'username', f.username,
        'roles', to_jsonb(coalesce(f.roles, '{}'::text[])),
        'verified', f.email_verified_at is not null,
        'member', f.member, 'customer', f.customer,
        'since', f.created_at) order by f.created_at desc, f.id)
      /* THE ID IS THE TIEBREAK, and it is not decoration: ten accounts made by one insert share a
         created_at to the microsecond, and an order that does not separate them is free to put them
         in a different sequence for each page — so a row is shown twice and another is never shown
         at all. A paged read needs a total order. */
      from (select * from found order by created_at desc, id
             limit greatest(1, least(coalesce(p_limit, 50), 200))
            offset greatest(0, coalesce(p_offset, 0))) f), '[]'::jsonb))
  else null end
$$;

-- ONE PERSON, as everything the site already knows about them. Six reads in one, because an
-- operator answering "who is this and what have they bought" should not be made to open six pages
-- — and because every one of these is already somewhere in this database, so the page inventing a
-- seventh source would be the page inventing a fact.
--
-- Their INVOICES are not here and never will be: they live at the payment processor, the site keeps
-- a customer id and nothing else, and the page links out. Nothing about a card or a bank has ever
-- been in this database and this is not the place to start.
CREATE OR REPLACE FUNCTION "public"."admin_person"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.is_admin() then null else (
    select jsonb_build_object(
      'id', p.id, 'email', p.email, 'username', p.username,
      'name', coalesce(nullif(p.display_name, ''), split_part(coalesce(p.email, ''), '@', 1)),
      'first_name', p.first_name, 'last_name', p.last_name,
      'roles', to_jsonb(coalesce(p.roles, '{}'::text[])),
      'verified_at', p.email_verified_at,
      'since', p.created_at,
      /* the processor's own id, for the link out to their invoices. Never a card, never a bank. */
      'billing_id', p.stripe_customer_id,
      'entitlements', coalesce((
        select jsonb_agg(jsonb_build_object('kind', e.kind, 'key', e.key, 'tier', e.tier,
                 'source', e.source, 'expires_at', e.expires_at) order by e.created_at desc)
          from public.entitlements e where e.user_id = p.id and e.active
            and (e.expires_at is null or e.expires_at > now())), '[]'::jsonb),
      /* the one source the member card's Bought panel reads too (40-commerce.sql) */
      'purchases', public.person_purchases(p.id),
      'subscription', (
        select jsonb_build_object('sku', s.sku, 'key', s.key, 'status', s.status,
                 'period_end', s.current_period_end, 'next_sku', s.next_sku, 'next_at', s.next_at)
          from public.subscriptions s where s.user_id = p.id
           and s.status in ('active', 'trialing', 'past_due')
         order by s.created_at desc limit 1),
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object('uid', b.uid, 'title', b.title,
                 'type', coalesce(b.type, b.event), 'start_at', b.start_at, 'status', b.status)
                 order by b.start_at desc nulls last)
          from public.bookings b where b.user_id = p.id), '[]'::jsonb))
    from public.profiles p where p.id = p_user) end
$$;

REVOKE ALL ON FUNCTION "public"."admin_everybody"("text", "text", integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admin_everybody"("text", "text", integer, integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_everybody"("text", "text", integer, integer) TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."admin_person"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."admin_person"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_person"("uuid") TO "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."is_subscribed"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.entitlements
    where user_id = auth.uid()
      and kind = 'class' and key = 'subscribed'
      and active
      and (expires_at is null or expires_at > now())
  );
$$;

-- the signed-in account's address, lower-cased, once it has proven it (mark_email_verified) — null otherwise;
-- what a policy matches a guest's records by, never the address a token merely carries
CREATE OR REPLACE FUNCTION "public"."my_proven_email"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select lower(btrim(u.email)) from auth.users u join public.profiles p on p.id = u.id
   where u.id = auth.uid() and p.email_verified_at is not null and lower(btrim(p.email)) = lower(btrim(u.email));
$$;

REVOKE ALL ON FUNCTION "public"."my_proven_email"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_proven_email"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_proven_email"() TO "anon", "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."mark_email_verified"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  proven boolean;
  addr text;
begin
  if auth.uid() is null then return false; end if;
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' in ('magiclink', 'otp', 'oauth', 'sso/saml')
  ) into proven;
  if not proven then
    return exists (select 1 from public.profiles where id = auth.uid() and email_verified_at is not null);
  end if;
  perform set_config('app.verifying_email', '1', true);
  update public.profiles set email_verified_at = coalesce(email_verified_at, now()) where id = auth.uid();
  -- the address the token proved, which is the account's, never a field on the profile
  select email into addr from auth.users where id = auth.uid();
  perform public.claim_guest_purchases(auth.uid(), addr);
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."seed_user"("p_email" "text", "p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user, is_anonymous
  ) values (
    uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name), now(), now(),
    '', '', '', '', false, false
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now());
  return uid;
end $$;

CREATE OR REPLACE FUNCTION "public"."touch_user_docs"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    -- WHAT SOMEBODY IS CALLED, in the three ways a person is called things.
    --   username      their own address on this site (/p/<username>), lower case, unique. A person
    --                 has one only if they take one; nothing requires it.
    --   display_name  what everybody sees. Absent, the part of their address before the @, which is
    --                 what every read here already falls back to.
    --   first/last    the real name, for a letter, an invoice, or a list that shows a first name
    --                 and a last initial. Never shown whole to another member unless they said so.
    "username" "text",
    "display_name" "text",
    -- WHAT THIS PERSON IS CALLED, in their own words, where the site's word for the role is not
    -- right for them: Herbalist among Therapists, Supervisor among Coaches. Shown wherever a
    -- surface names THEM; the site's own word is used for the class and wherever this is empty.
    -- Forty characters because it is drawn beside a name in a row, and a paragraph in that slot is
    -- not a title.
    "title" "text",
    "first_name" "text",
    "last_name" "text",
    -- their own picture. Absent, a face is drawn from their id (lib/avatar.js) — never an initial.
    "avatar" "text",
    -- WHICH COLLECTION they picked their drawn face from, where they picked one. Nothing is drawn
    -- from this that is not in the kit's own short list, and where it is empty the site's default
    -- (a pattern, never a face) is used — so an unset row is never a face nobody chose.
    "avatar_style" "text",
    -- AND WHICH FACE OF THAT COLLECTION. A drawn face comes from a seed, and the seed is theirs to
    -- change: the picker offers a handful and keeps the one they press. Absent, the seed is a
    -- digest of their address — so somebody who never opens the picker still has one face, the
    -- same on every device, and their address is disclosed to nobody by it.
    "avatar_seed" "text",
    -- THE PARTS THEY CHOSE, where they designed a face rather than taking one. A shape by name
    -- (hair, eyes, mouth) or a colour as hex, as the style's own definition offers them; anything
    -- NOT chosen is left to the seed, which is what keeps a half-finished face a face rather than
    -- a default one. It is the person's own, like the style and unlike the seed.
    "avatar_options" "jsonb",
    CONSTRAINT "profiles_avatar_seed_len" CHECK (("avatar_seed" IS NULL OR "length"("avatar_seed") <= 64)),
    -- a handful of parts, not a document: this is drawn on every surface that shows a person
    CONSTRAINT "profiles_avatar_options_small" CHECK (("avatar_options" IS NULL OR "length"("avatar_options"::"text") <= 600)),
    "about" "text",
    -- IS THEIR PAGE PUBLIC. A profile is private until its owner says otherwise: a directory of
    -- everybody who ever signed up, indexed, is not a thing to publish on somebody's behalf.
    "public_profile" boolean DEFAULT false NOT NULL,
    -- WHAT THEY HAVE ASKED TO BE TOLD ABOUT, as a set of switches rather than one word: somebody
    -- may want the weekly letter and no push at all. A key absent is the default, so a person who
    -- has never opened the settings is not opted out of everything by the row existing.
    "notify" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- WHAT SOMEBODY IS ON THIS SITE, as a set: a person may be a provider AND an editor without being
    -- made an administrator for it. A reader holds none, which is why there is no 'user' role —
    -- holding nothing already says it. `role` below is what this replaced: it is backfilled into
    -- `roles` by data.sql, read by nothing, and dropped by a change of its own once a deploy has
    -- proved the set (the plan applies the schema before data.sql, so dropping it here would
    -- delete every value before the backfill could read one).
    "roles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email_verified_at" timestamp with time zone,
    "email_opt_out_at" timestamp with time zone,
    CONSTRAINT "profiles_about_len" CHECK (("about" IS NULL OR "length"("about") <= 280)),
    -- a username is an address, so it is shaped like one: lower case, no spaces, long enough to type
    CONSTRAINT "profiles_username_shape" CHECK (("username" IS NULL OR "username" ~ '^[a-z0-9][a-z0-9-]{1,38}$')),
    CONSTRAINT "profiles_title_len" CHECK (("title" IS NULL OR "length"("title") <= 40)),
    -- 'coach' is what 'provider' used to be called, and it is still allowed here ON PURPOSE. A
    -- CHECK validates the rows that already exist at the moment it is added, and the data script
    -- that carries people across runs AFTER the schema — so a constraint naming only the new word
    -- would refuse to apply to any database still holding the old one, which is every database
    -- that was running before this change. It goes in the release after the backfill has run
    -- everywhere, by a change of its own.
    CONSTRAINT "profiles_roles_known" CHECK (("roles" <@ ARRAY['admin'::"text", 'provider'::"text", 'coach'::"text", 'editor'::"text", 'support'::"text", 'analyst'::"text"])),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'admin'::"text", 'support'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."user_docs" (
    "user_id" "uuid" NOT NULL,
    "snapshot" "text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");

/* a username is an address: one person holds it, and only where they took one */
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_username_key" ON "public"."profiles" ("username") WHERE ("username" IS NOT NULL);

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_stripe_customer_id_key" UNIQUE ("stripe_customer_id");

ALTER TABLE ONLY "public"."user_docs"
    ADD CONSTRAINT "user_docs_pkey" PRIMARY KEY ("user_id");

CREATE OR REPLACE TRIGGER "trg_profiles_guard" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."guard_profile_privileged"();

CREATE OR REPLACE TRIGGER "trg_user_docs_touch" BEFORE UPDATE ON "public"."user_docs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_user_docs"();

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_docs"
    ADD CONSTRAINT "user_docs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_self" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));

CREATE POLICY "profiles_update_self" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));

ALTER TABLE "public"."user_docs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_docs_insert_own" ON "public"."user_docs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "user_docs_select_own" ON "public"."user_docs" FOR SELECT USING (("auth"."uid"() = "user_id"));

CREATE POLICY "user_docs_update_own" ON "public"."user_docs" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));

GRANT ALL ON FUNCTION "public"."guard_profile_privileged"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_profile_privileged"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_profile_privileged"() TO "service_role";

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT ALL ON FUNCTION "public"."admin_people"("ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_people"("ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_provider"() TO "authenticated";

-- The same capability, asked about somebody who is not the caller: whether a named person provides.
-- It exists so that nothing has to compare a role's name to answer that question — chat_open did,
-- and an administrator who was not also a provider stopped being somebody a member could write to.
CREATE OR REPLACE FUNCTION "public"."is_provider"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select roles && array['provider', 'coach', 'admin'] from public.profiles where id = p_user), false);
$$;
GRANT ALL ON FUNCTION "public"."is_provider"("uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_provider"("uuid") TO "service_role";

GRANT ALL ON FUNCTION "public"."may_edit_content"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."may_see_figures"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_roles"("uuid", "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_staff"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_people"("ids" "uuid"[]) TO "service_role";

GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";

GRANT ALL ON FUNCTION "public"."is_staff"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_staff"() TO "service_role";

GRANT ALL ON FUNCTION "public"."is_subscribed"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_subscribed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_subscribed"() TO "service_role";

GRANT ALL ON FUNCTION "public"."mark_email_verified"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_email_verified"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_email_verified"() TO "service_role";

GRANT ALL ON FUNCTION "public"."seed_user"("p_email" "text", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."seed_user"("p_email" "text", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_user"("p_email" "text", "p_name" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."touch_user_docs"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_user_docs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_user_docs"() TO "service_role";

GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";

GRANT ALL ON TABLE "public"."user_docs" TO "anon";
GRANT ALL ON TABLE "public"."user_docs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_docs" TO "service_role";

-- The account's row is made as the auth user is: a trigger in the auth schema (pg_dump -s public leaves it out).
CREATE OR REPLACE TRIGGER "trg_on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();

-- ---------------------------------------------------------------------------------------------
-- SOMEBODY'S OWN PAGE, at /p/<username>.
--
-- A profile is PRIVATE until its owner says otherwise. A directory of everybody who ever signed up,
-- indexed by search engines, is not a thing to publish on somebody's behalf — so public_profile
-- defaults to false and this read answers nothing for a person who has not turned it on.
--
-- What it answers is what they put there and nothing else: the name they chose, the line they
-- wrote, the face they picked. Not their address, not what they bought, not what they have read,
-- not which spaces they are in. Anything of that sort is a second question with a second answer,
-- asked of a read that knows who is asking.
--
-- It is readable by ANYBODY, signed in or not, because that is what "public" means and because the
-- page is prerendered like any other.
CREATE OR REPLACE FUNCTION "public"."public_profile"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'name', coalesce(nullif(p.display_name, ''), p.username),
      'about', nullif(p.about, ''),
      'avatar', nullif(p.avatar, ''),
      'avatar_style', nullif(p.avatar_style, ''),
      'avatar_options', p.avatar_options,
      -- the seed, never the address it is made from
      'avatar_seed', coalesce(nullif(p.avatar_seed, ''), md5(lower(coalesce(nullif(p.email, ''), p.id::text)))),
      -- what the site itself says they are, where it says anything: a provider's page is the site's
      -- own claim about them and not theirs, so it is read from the roles and never from a field
      -- they may write.
      'roles', to_jsonb(coalesce(p.roles, '{}'::text[])),
      'since', p.created_at)
    from public.profiles p
   where p.username = lower(btrim(p_username)) and p.public_profile;
$$;
-- REVOKING PUBLIC ALONE IS NOT A FENCE. Postgres grants EXECUTE to PUBLIC on every new function,
-- and Supabase's ALTER DEFAULT PRIVILEGES grants anon and authenticated on top of it — so a file
-- that revokes PUBLIC and then grants to authenticated has in fact been open to a signed-out
-- visitor the whole time. Both have to be taken back BY NAME before the grant that follows says who
-- may really call it. Every REVOKE in these files comes in that pair.
REVOKE ALL ON FUNCTION "public"."public_profile"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."public_profile"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."public_profile"("text") TO "anon", "authenticated", "service_role";

-- IS THIS NAME FREE. A username is an address, so somebody typing one needs to be told before they
-- save rather than after. It answers a boolean and never who holds it: "taken" is all anybody
-- outside needs, and "taken by Ada" would make this a way to look people up.
CREATE OR REPLACE FUNCTION "public"."username_free"("p_username" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists (select 1 from public.profiles
                      where username = lower(btrim(p_username))
                        and id is distinct from auth.uid());
$$;
REVOKE ALL ON FUNCTION "public"."username_free"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."username_free"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."username_free"("text") TO "authenticated", "service_role";

-- A PERSON'S OWN PICTURE, in the public `avatars` bucket under their own id — `<uid>/face.<ext>`
-- and nothing else, so a name once taken is theirs and a client cannot write over anybody. Public
-- to read, because a face is shown wherever the person is and a signed url per face on a directory
-- of two hundred people is two hundred signatures for something nobody is hiding.
DROP POLICY IF EXISTS "avatars_own_write" ON "storage"."objects";
CREATE POLICY "avatars_own_write" ON "storage"."objects" FOR INSERT TO "authenticated"
  WITH CHECK ("bucket_id" = 'avatars' AND "name" ~ ('^' || (SELECT "auth"."uid"())::text || '/face\\.[a-z0-9]+$'));
DROP POLICY IF EXISTS "avatars_own_update" ON "storage"."objects";
CREATE POLICY "avatars_own_update" ON "storage"."objects" FOR UPDATE TO "authenticated"
  USING ("bucket_id" = 'avatars' AND "name" ~ ('^' || (SELECT "auth"."uid"())::text || '/'))
  WITH CHECK ("bucket_id" = 'avatars' AND "name" ~ ('^' || (SELECT "auth"."uid"())::text || '/face\\.[a-z0-9]+$'));
DROP POLICY IF EXISTS "avatars_own_delete" ON "storage"."objects";
CREATE POLICY "avatars_own_delete" ON "storage"."objects" FOR DELETE TO "authenticated"
  USING ("bucket_id" = 'avatars' AND "name" ~ ('^' || (SELECT "auth"."uid"())::text || '/'));

-- THE READER'S OWN ROW, as their settings page reads it. It is a function and not a select because
-- of one field: the seed a drawn face comes from. Everywhere else in the product that seed is
-- resolved the same way — what they picked, else a digest of their address — and a select cannot
-- compute the digest, so a settings page built on one would offer them a different face from the
-- one everybody else sees. One resolution, in one place, for every surface.
CREATE OR REPLACE FUNCTION "public"."my_profile"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
      'id', p.id, 'email', p.email, 'username', p.username,
      'display_name', p.display_name, 'first_name', p.first_name, 'last_name', p.last_name,
      'about', p.about, 'avatar', p.avatar, 'avatar_style', p.avatar_style,
      -- what they picked, and what they would have if they picked nothing: the page needs both,
      -- since "put it back" must mean the face everybody already sees
      'avatar_seed', p.avatar_seed,
      -- and the PARTS they designed. Without this the face a person built was written to the row
      -- and never read back out of it: the picker opened with nothing chosen every time, and the
      -- save itself appeared to do nothing, because the page reloads the profile when it is done.
      'avatar_options', p.avatar_options,
      'seed', coalesce(nullif(p.avatar_seed, ''), md5(lower(coalesce(nullif(p.email, ''), p.id::text)))),
      'public_profile', p.public_profile, 'notify', p.notify,
      'roles', to_jsonb(coalesce(p.roles, '{}'::text[])), 'created_at', p.created_at)
    from public.profiles p where p.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION "public"."my_profile"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_profile"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_profile"() TO "authenticated", "service_role";
