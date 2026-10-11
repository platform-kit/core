-- Social publishing: after agents, account connections and durable delivery records.
-- The schema is declarative. Never add migrations or edit the assembled copy under supabase/.
SET check_function_bodies = false;

CREATE TABLE IF NOT EXISTS "public"."social_publisher_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "social_publisher_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_publisher_grants_email_check" CHECK (("email" = lower("email") AND "email" <> '')),
    CONSTRAINT "social_publisher_grants_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'revoked'::"text", 'expired'::"text"]))),
    CONSTRAINT "social_publisher_grants_state_check" CHECK (
      ("status" = 'pending' AND "user_id" IS NULL AND "accepted_at" IS NULL AND "revoked_at" IS NULL)
      OR ("status" = 'active' AND "user_id" IS NOT NULL AND "accepted_at" IS NOT NULL AND "revoked_at" IS NULL)
      OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
      OR ("status" = 'expired' AND "user_id" IS NULL)
    )
);
ALTER TABLE "public"."social_publisher_grants"
    ADD COLUMN IF NOT EXISTS "can_manage_accounts" boolean DEFAULT false NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "social_publisher_grants_pending_email_idx"
    ON "public"."social_publisher_grants" USING "btree" ("email") WHERE ("status" = 'pending');
CREATE UNIQUE INDEX IF NOT EXISTS "social_publisher_grants_active_user_idx"
    ON "public"."social_publisher_grants" USING "btree" ("user_id") WHERE ("status" = 'active');
CREATE INDEX IF NOT EXISTS "social_publisher_grants_user_idx"
    ON "public"."social_publisher_grants" USING "btree" ("user_id");
ALTER TABLE ONLY "public"."social_publisher_grants"
    ADD CONSTRAINT "social_publisher_grants_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."social_publisher_grants"
    ADD CONSTRAINT "social_publisher_grants_inviter_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "public"."social_provider_configs" (
    "provider_id" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "client_secret_id" "uuid",
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "updated_by" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "social_provider_configs_pkey" PRIMARY KEY ("provider_id"),
    CONSTRAINT "social_provider_configs_provider_check" CHECK (("provider_id" ~ '^[a-z][a-z0-9-]*$'))
);
ALTER TABLE ONLY "public"."social_provider_configs"
    ADD CONSTRAINT "social_provider_configs_editor_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "public"."social_backend_configs" (
    "backend_id" "text" NOT NULL,
    "credential_secret_id" "uuid" NOT NULL,
    "webhook_secret_id" "uuid",
    "enabled" boolean DEFAULT true NOT NULL,
    "updated_by" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "social_backend_configs_pkey" PRIMARY KEY ("backend_id"),
    CONSTRAINT "social_backend_configs_backend_check" CHECK (("backend_id" = ANY (ARRAY['zernio'::"text", 'post-for-me'::"text", 'postfast'::"text"])))
);
ALTER TABLE ONLY "public"."social_backend_configs"
    ADD CONSTRAINT "social_backend_configs_editor_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "public"."social_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "backend_id" "text" DEFAULT 'default'::"text" NOT NULL,
    "provider_id" "text" NOT NULL,
    "external_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "username" "text" NOT NULL,
    "avatar_url" "text",
    "credential_secret_id" "uuid",
    "status" "text" DEFAULT 'connected'::"text" NOT NULL,
    "approval_required" boolean DEFAULT false NOT NULL,
    "connected_by" "uuid" NOT NULL,
    "connected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "disconnected_at" timestamp with time zone,
    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_accounts_status_check" CHECK (("status" = ANY (ARRAY['connected'::"text", 'reconnect_required'::"text", 'disconnected'::"text"]))),
    CONSTRAINT "social_accounts_backend_check" CHECK (("backend_id" = 'default' OR "backend_id" = ANY (ARRAY['zernio'::"text", 'post-for-me'::"text", 'postfast'::"text"]))),
    CONSTRAINT "social_accounts_provider_check" CHECK (("provider_id" ~ '^[a-z][a-z0-9-]*$'))
);
ALTER TABLE "public"."social_accounts"
    ADD COLUMN IF NOT EXISTS "backend_id" "text" DEFAULT 'default'::"text" NOT NULL;
ALTER TABLE "public"."social_accounts"
    ALTER COLUMN "credential_secret_id" DROP NOT NULL;
ALTER TABLE "public"."social_accounts"
    ADD COLUMN IF NOT EXISTS "approval_required" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."social_accounts"
    DROP CONSTRAINT IF EXISTS "social_accounts_external_key";
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_backend_external_key"
    ON "public"."social_accounts" USING "btree" ("backend_id", "provider_id", "external_id");
CREATE INDEX IF NOT EXISTS "social_accounts_status_idx"
    ON "public"."social_accounts" USING "btree" ("status", "provider_id");
ALTER TABLE ONLY "public"."social_accounts"
    ADD CONSTRAINT "social_accounts_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "public"."social_publisher_account_permissions" (
    "grant_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "read_posts" boolean DEFAULT false NOT NULL,
    "create_posts" boolean DEFAULT false NOT NULL,
    "edit_posts" boolean DEFAULT false NOT NULL,
    "schedule_posts" boolean DEFAULT false NOT NULL,
    "approve_posts" boolean DEFAULT false NOT NULL,
    "publish_now" boolean DEFAULT false NOT NULL,
    "view_results" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "social_publisher_account_permissions_pkey" PRIMARY KEY ("grant_id", "account_id"),
    CONSTRAINT "social_publisher_account_permissions_any_check" CHECK (
      "read_posts" OR "create_posts" OR "edit_posts" OR "schedule_posts"
      OR "approve_posts" OR "publish_now" OR "view_results"
    ),
    CONSTRAINT "social_publisher_account_permissions_grant_fkey"
      FOREIGN KEY ("grant_id") REFERENCES "public"."social_publisher_grants"("id") ON DELETE CASCADE,
    CONSTRAINT "social_publisher_account_permissions_account_fkey"
      FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "social_publisher_account_permissions_account_idx"
    ON "public"."social_publisher_account_permissions" USING "btree" ("account_id");

CREATE TABLE IF NOT EXISTS "public"."social_oauth_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "state_hash" "text" NOT NULL,
    "provider_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "return_path" "text" DEFAULT '/admin/social'::"text" NOT NULL,
    "code_verifier_secret_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    CONSTRAINT "social_oauth_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_oauth_states_state_hash_key" UNIQUE ("state_hash"),
    CONSTRAINT "social_oauth_states_return_path_check" CHECK (("return_path" ~ '^/'))
);
CREATE INDEX IF NOT EXISTS "social_oauth_states_expiry_idx"
    ON "public"."social_oauth_states" USING "btree" ("expires_at") WHERE ("consumed_at" IS NULL);
ALTER TABLE ONLY "public"."social_oauth_states"
    ADD CONSTRAINT "social_oauth_states_user_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "public"."social_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_posts_timezone_check" CHECK (("timezone" <> ''))
);
CREATE INDEX IF NOT EXISTS "social_posts_updated_idx"
    ON "public"."social_posts" USING "btree" ("updated_at" DESC);
ALTER TABLE ONLY "public"."social_posts"
    ADD CONSTRAINT "social_posts_author_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "public"."social_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "byte_size" bigint NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "social_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_attachments_object_path_key" UNIQUE ("object_path"),
    CONSTRAINT "social_attachments_kind_check" CHECK (("kind" = ANY (ARRAY['image'::"text", 'video'::"text"]))),
    CONSTRAINT "social_attachments_size_check" CHECK (("byte_size" > 0 AND "byte_size" <= 104857600)),
    CONSTRAINT "social_attachments_position_check" CHECK (("position" >= 0)),
    CONSTRAINT "social_attachments_path_check" CHECK (("object_path" ~ '^posts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
);
CREATE INDEX IF NOT EXISTS "social_attachments_post_position_idx"
    ON "public"."social_attachments" USING "btree" ("post_id", "position");
ALTER TABLE ONLY "public"."social_attachments"
    ADD CONSTRAINT "social_attachments_post_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION "public"."social_touch_post"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.social_posts set updated_at = now()
   where id = coalesce(new.post_id, old.post_id);
  update public.social_deliveries d
     set approval_state = 'pending', approval_requested_at = now(),
         approved_by = null, approved_at = null, returned_by = null, returned_at = null,
         updated_at = now()
    from public.social_accounts a
   where d.post_id = coalesce(new.post_id, old.post_id)
     and a.id = d.account_id
     and a.approval_required
     and d.approval_state = 'approved'
     and d.status in ('scheduled', 'retry_wait', 'blocked');
  return null;
end;
$$;
DROP TRIGGER IF EXISTS "social_attachments_touch_post" ON "public"."social_attachments";
CREATE TRIGGER "social_attachments_touch_post"
    AFTER INSERT OR UPDATE OR DELETE ON "public"."social_attachments"
    FOR EACH ROW EXECUTE FUNCTION "public"."social_touch_post"();

CREATE TABLE IF NOT EXISTS "public"."social_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "target_options" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "approval_state" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "approval_intent" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "approval_requested_at" timestamp with time zone,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "returned_by" "uuid",
    "returned_at" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "lease_token" "uuid",
    "lease_until" timestamp with time zone,
    "next_attempt_at" timestamp with time zone,
    "provider_post_id" "text",
    "remote_job_id" "text",
    "remote_delivery_id" "text",
    "last_error_code" "text",
    "last_error" "text",
    "published_at" timestamp with time zone,
    "metrics_state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "metrics_last_fetched_at" timestamp with time zone,
    "metrics_next_fetch_at" timestamp with time zone,
    "metrics_attempt_count" integer DEFAULT 0 NOT NULL,
    "metrics_last_error_code" "text",
    "metrics_last_error" "text",
    "metrics_lease_token" "uuid",
    "metrics_lease_until" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "recovered_by" "uuid",
    "recovered_at" timestamp with time zone,
    "recovery_action" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "social_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_deliveries_post_account_key" UNIQUE ("post_id", "account_id"),
    CONSTRAINT "social_deliveries_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'claimed'::"text", 'publishing'::"text", 'remote_scheduled'::"text", 'published'::"text", 'retry_wait'::"text", 'failed'::"text", 'blocked'::"text", 'review_required'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "social_deliveries_approval_state_check" CHECK (("approval_state" = ANY (ARRAY['not_required'::"text", 'pending'::"text", 'approved'::"text", 'returned'::"text", 'reschedule_required'::"text"]))),
    CONSTRAINT "social_deliveries_approval_intent_check" CHECK (("approval_intent" = ANY (ARRAY['scheduled'::"text", 'immediate'::"text"]))),
    CONSTRAINT "social_deliveries_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "social_deliveries_metrics_state_check" CHECK (("metrics_state" = ANY (ARRAY['pending'::"text", 'fetching'::"text", 'available'::"text", 'unsupported'::"text", 'error'::"text"]))),
    CONSTRAINT "social_deliveries_target_options_check" CHECK (
      ("jsonb_typeof"("target_options") = 'object'::"text")
      AND ("octet_length"("target_options"::"text") <= 8192)
    ),
    CONSTRAINT "social_deliveries_recovery_action_check" CHECK (("recovery_action" IS NULL OR "recovery_action" = ANY (ARRAY['retry'::"text", 'marked_published'::"text"]))),
    CONSTRAINT "social_deliveries_lease_check" CHECK ((("lease_token" IS NULL) = ("lease_until" IS NULL))),
    CONSTRAINT "social_deliveries_metrics_attempt_check" CHECK (("metrics_attempt_count" >= 0)),
    CONSTRAINT "social_deliveries_metrics_lease_check" CHECK ((("metrics_lease_token" IS NULL) = ("metrics_lease_until" IS NULL))),
    CONSTRAINT "social_deliveries_remote_job_check" CHECK (
      ("status" <> 'remote_scheduled' OR ("remote_job_id" IS NOT NULL AND "remote_delivery_id" IS NOT NULL))
    )
);
ALTER TABLE "public"."social_deliveries"
    ADD COLUMN IF NOT EXISTS "approval_state" "text" DEFAULT 'not_required'::"text" NOT NULL,
    ADD COLUMN IF NOT EXISTS "approval_intent" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    ADD COLUMN IF NOT EXISTS "approval_requested_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "approved_by" "uuid",
    ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "returned_by" "uuid",
    ADD COLUMN IF NOT EXISTS "returned_at" timestamp with time zone;
ALTER TABLE "public"."social_deliveries"
    DROP CONSTRAINT IF EXISTS "social_deliveries_approval_state_check",
    ADD CONSTRAINT "social_deliveries_approval_state_check" CHECK ("approval_state" = ANY (ARRAY['not_required'::"text", 'pending'::"text", 'approved'::"text", 'returned'::"text", 'reschedule_required'::"text"])),
    DROP CONSTRAINT IF EXISTS "social_deliveries_approval_intent_check",
    ADD CONSTRAINT "social_deliveries_approval_intent_check" CHECK ("approval_intent" = ANY (ARRAY['scheduled'::"text", 'immediate'::"text"])),
    DROP CONSTRAINT IF EXISTS "social_deliveries_status_check",
    ADD CONSTRAINT "social_deliveries_status_check" CHECK ("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'claimed'::"text", 'publishing'::"text", 'remote_scheduled'::"text", 'published'::"text", 'retry_wait'::"text", 'failed'::"text", 'blocked'::"text", 'review_required'::"text", 'cancelled'::"text"]));
ALTER TABLE ONLY "public"."social_deliveries"
    ADD CONSTRAINT "social_deliveries_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."social_deliveries"
    ADD CONSTRAINT "social_deliveries_returned_by_fkey" FOREIGN KEY ("returned_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE "public"."social_deliveries"
    ADD COLUMN IF NOT EXISTS "metrics_state" "text" DEFAULT 'pending'::"text" NOT NULL,
    ADD COLUMN IF NOT EXISTS "metrics_last_fetched_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "metrics_next_fetch_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "metrics_attempt_count" integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS "metrics_last_error_code" "text",
    ADD COLUMN IF NOT EXISTS "metrics_last_error" "text",
    ADD COLUMN IF NOT EXISTS "metrics_lease_token" "uuid",
    ADD COLUMN IF NOT EXISTS "metrics_lease_until" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "public"."social_metrics_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "delivery_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "provider_post_id" "text" NOT NULL,
    "published_at" timestamp with time zone NOT NULL,
    "collected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "views" bigint,
    "reads" bigint,
    "likes" bigint,
    "comments" bigint,
    "provider_metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "social_metrics_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_metrics_snapshots_counts_check" CHECK (
      ("views" IS NULL OR "views" >= 0)
      AND ("reads" IS NULL OR "reads" >= 0)
      AND ("likes" IS NULL OR "likes" >= 0)
      AND ("comments" IS NULL OR "comments" >= 0)
    ),
    CONSTRAINT "social_metrics_snapshots_provider_metrics_check" CHECK (
      "jsonb_typeof"("provider_metrics") = 'object'::"text"
      AND "octet_length"("provider_metrics"::"text") <= 32768
    )
);
CREATE INDEX IF NOT EXISTS "social_metrics_snapshots_delivery_collected_idx"
    ON "public"."social_metrics_snapshots" USING "btree" ("delivery_id", "collected_at" DESC);
CREATE INDEX IF NOT EXISTS "social_metrics_snapshots_post_collected_idx"
    ON "public"."social_metrics_snapshots" USING "btree" ("post_id", "collected_at" DESC);
ALTER TABLE ONLY "public"."social_metrics_snapshots"
    ADD CONSTRAINT "social_metrics_snapshots_delivery_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."social_deliveries"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."social_metrics_snapshots"
    ADD CONSTRAINT "social_metrics_snapshots_post_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."social_metrics_snapshots"
    ADD CONSTRAINT "social_metrics_snapshots_account_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS "social_deliveries_metrics_due_idx"
    ON "public"."social_deliveries" USING "btree" ("metrics_next_fetch_at", "published_at")
    WHERE ("status" = 'published' AND "provider_post_id" IS NOT NULL AND "metrics_state" <> 'unsupported');
CREATE INDEX IF NOT EXISTS "social_deliveries_due_idx"
    ON "public"."social_deliveries" USING "btree" ("scheduled_at", "next_attempt_at")
    WHERE ("status" = ANY (ARRAY['scheduled'::"text", 'retry_wait'::"text", 'remote_scheduled'::"text"]));
CREATE INDEX IF NOT EXISTS "social_deliveries_lease_idx"
    ON "public"."social_deliveries" USING "btree" ("lease_until")
    WHERE ("status" = ANY (ARRAY['claimed'::"text", 'publishing'::"text"]));
CREATE INDEX IF NOT EXISTS "social_deliveries_calendar_idx"
    ON "public"."social_deliveries" USING "btree" ("scheduled_at", "status");
ALTER TABLE ONLY "public"."social_deliveries"
    ADD CONSTRAINT "social_deliveries_post_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."social_deliveries"
    ADD CONSTRAINT "social_deliveries_account_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."social_deliveries"
    ADD CONSTRAINT "social_deliveries_recovered_by_fkey" FOREIGN KEY ("recovered_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "public"."social_delivery_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "delivery_id" "uuid" NOT NULL,
    "attempt_number" integer NOT NULL,
    "status" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "error_code" "text",
    "error_message" "text",
    "provider_post_id" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "social_delivery_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_delivery_attempts_delivery_number_key" UNIQUE ("delivery_id", "attempt_number"),
    CONSTRAINT "social_delivery_attempts_status_check" CHECK (("status" = ANY (ARRAY['started'::"text", 'accepted'::"text", 'published'::"text", 'retryable'::"text", 'terminal'::"text", 'unknown'::"text"]))),
    CONSTRAINT "social_delivery_attempts_number_check" CHECK (("attempt_number" > 0))
);
CREATE INDEX IF NOT EXISTS "social_delivery_attempts_delivery_idx"
    ON "public"."social_delivery_attempts" USING "btree" ("delivery_id", "started_at");
ALTER TABLE ONLY "public"."social_delivery_attempts"
    ADD CONSTRAINT "social_delivery_attempts_delivery_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."social_deliveries"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "public"."social_automations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "event_kind" "text" NOT NULL,
    "keyword" "text" NOT NULL,
    "bot_slug" "text" NOT NULL,
    "destinations" "text"[] NOT NULL,
    "mode" "text" DEFAULT 'draft'::"text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "authorized_by" "uuid" NOT NULL,
    "authorized_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "social_automations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_automations_event_kind_check" CHECK (("event_kind" = ANY (ARRAY['comment'::"text", 'dm'::"text"]))),
    CONSTRAINT "social_automations_keyword_check" CHECK (("keyword" = "btrim"("keyword") AND "char_length"("keyword") BETWEEN 1 AND 100)),
    CONSTRAINT "social_automations_destinations_check" CHECK (
      ("event_kind" = 'comment' AND (
        "destinations" = ARRAY['public_reply'::"text"]
        OR "destinations" = ARRAY['private_dm'::"text"]
        OR "destinations" = ARRAY['public_reply'::"text", 'private_dm'::"text"]
        OR "destinations" = ARRAY['private_dm'::"text", 'public_reply'::"text"]
      ))
      OR ("event_kind" = 'dm' AND "destinations" = ARRAY['private_dm'::"text"])
    ),
    CONSTRAINT "social_automations_mode_check" CHECK (("mode" = ANY (ARRAY['draft'::"text", 'automatic'::"text"])))
);
CREATE INDEX IF NOT EXISTS "social_automations_account_enabled_idx"
    ON "public"."social_automations" USING "btree" ("account_id", "enabled");
CREATE INDEX IF NOT EXISTS "social_automations_authorizer_idx"
    ON "public"."social_automations" USING "btree" ("authorized_by");
ALTER TABLE ONLY "public"."social_automations"
    ADD CONSTRAINT "social_automations_account_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."social_automations"
    ADD CONSTRAINT "social_automations_bot_fkey" FOREIGN KEY ("bot_slug") REFERENCES "public"."bots"("slug") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."social_automations"
    ADD CONSTRAINT "social_automations_authorizer_fkey" FOREIGN KEY ("authorized_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "public"."social_inbound_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "backend_id" "text" NOT NULL,
    "provider_id" "text" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "event_kind" "text" NOT NULL,
    "provider_author_id" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "post_id" "text",
    "comment_id" "text",
    "conversation_id" "text",
    "body" "text" NOT NULL,
    "context" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "lease_until" timestamp with time zone,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "last_error" "text",
    CONSTRAINT "social_inbound_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_inbound_events_identity_key" UNIQUE ("account_id", "provider_event_id", "item_id"),
    CONSTRAINT "social_inbound_events_kind_check" CHECK (("event_kind" = ANY (ARRAY['comment'::"text", 'dm'::"text"]))),
    CONSTRAINT "social_inbound_events_content_check" CHECK (
      ("provider_author_id" <> '' AND "item_id" <> '' AND "char_length"("body") BETWEEN 1 AND 10000)
    ),
    CONSTRAINT "social_inbound_events_context_check" CHECK (("jsonb_typeof"("context") = 'array')),
    CONSTRAINT "social_inbound_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'complete'::"text", 'quarantined'::"text", 'failed'::"text"]))),
    CONSTRAINT "social_inbound_events_attempts_check" CHECK (("attempts" >= 0))
);
CREATE INDEX IF NOT EXISTS "social_inbound_events_recovery_idx"
    ON "public"."social_inbound_events" USING "btree" ("next_attempt_at", "received_at")
    WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"]));
CREATE INDEX IF NOT EXISTS "social_inbound_events_account_idx"
    ON "public"."social_inbound_events" USING "btree" ("account_id", "received_at" DESC);
ALTER TABLE ONLY "public"."social_inbound_events"
    ADD CONSTRAINT "social_inbound_events_account_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "public"."social_automation_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "automation_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "destination" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "status" "text" DEFAULT 'generating'::"text" NOT NULL,
    "bot_run_id" "uuid",
    "body" "text",
    "provider_response_id" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "reviewed_by" "uuid",
    "sent_by" "uuid",
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    CONSTRAINT "social_automation_responses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_automation_responses_event_route_key" UNIQUE ("event_id", "automation_id", "destination"),
    CONSTRAINT "social_automation_responses_destination_check" CHECK (("destination" = ANY (ARRAY['public_reply'::"text", 'private_dm'::"text"]))),
    CONSTRAINT "social_automation_responses_mode_check" CHECK (("mode" = ANY (ARRAY['draft'::"text", 'automatic'::"text"]))),
    CONSTRAINT "social_automation_responses_status_check" CHECK (("status" = ANY (ARRAY['generating'::"text", 'draft'::"text", 'sending'::"text", 'sent'::"text", 'failed'::"text", 'uncertain'::"text", 'discarded'::"text"]))),
    CONSTRAINT "social_automation_responses_attempts_check" CHECK (("attempts" >= 0))
);
CREATE INDEX IF NOT EXISTS "social_automation_responses_account_created_idx"
    ON "public"."social_automation_responses" USING "btree" ("account_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "social_automation_responses_status_idx"
    ON "public"."social_automation_responses" USING "btree" ("status", "updated_at");
ALTER TABLE ONLY "public"."social_automation_responses"
    ADD CONSTRAINT "social_automation_responses_account_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."social_automation_responses"
    ADD CONSTRAINT "social_automation_responses_automation_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."social_automations"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."social_automation_responses"
    ADD CONSTRAINT "social_automation_responses_event_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."social_inbound_events"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."social_automation_responses"
    ADD CONSTRAINT "social_automation_responses_bot_run_fkey" FOREIGN KEY ("bot_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."social_automation_responses"
    ADD CONSTRAINT "social_automation_responses_reviewer_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."social_automation_responses"
    ADD CONSTRAINT "social_automation_responses_sender_fkey" FOREIGN KEY ("sent_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION "public"."social_user_can_create_draft"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  has_admin boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null then return false; end if;
  select coalesce('admin' = any(roles), false) or role = 'admin'
    into has_admin
    from public.profiles
   where id = p_user_id;
  return coalesce(has_admin, false) or exists (
    select 1
      from public.social_publisher_grants g
      join public.social_publisher_account_permissions p on p.grant_id = g.id
     where g.user_id = p_user_id and g.status = 'active' and p.create_posts
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_user_post_ids"("p_user_id" "uuid")
RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  has_admin boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null then return; end if;
  select coalesce('admin' = any(roles), false) or role = 'admin'
    into has_admin
    from public.profiles
   where id = p_user_id;
  if coalesce(has_admin, false) then
    return query select p.id from public.social_posts p;
    return;
  end if;
  return query
    select p.id
      from public.social_posts p
     where (
       p.created_by = p_user_id
       and public.social_user_can_create_draft(p_user_id)
       and not exists (select 1 from public.social_deliveries d where d.post_id = p.id)
     ) or (
       exists (select 1 from public.social_deliveries d where d.post_id = p.id)
       and not exists (
         select 1
           from public.social_deliveries d
          where d.post_id = p.id
            and not (
              public.social_user_can(p_user_id, d.account_id, 'read_posts')
              or public.social_user_can(p_user_id, d.account_id, 'create_posts')
              or public.social_user_can(p_user_id, d.account_id, 'edit_posts')
              or public.social_user_can(p_user_id, d.account_id, 'schedule_posts')
              or public.social_user_can(p_user_id, d.account_id, 'approve_posts')
              or public.social_user_can(p_user_id, d.account_id, 'publish_now')
            )
       )
     );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_user_can_edit_post"(
    "p_user_id" "uuid",
    "p_post_id" "uuid"
) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  author_id uuid;
  has_admin boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null or p_post_id is null then return false; end if;
  select coalesce('admin' = any(roles), false) or role = 'admin'
    into has_admin
    from public.profiles
   where id = p_user_id;
  if coalesce(has_admin, false) then return true; end if;
  select created_by into author_id from public.social_posts where id = p_post_id;
  if not found then return false; end if;
  if exists (select 1 from public.social_deliveries d where d.post_id = p_post_id) then
    return not exists (
      select 1 from public.social_deliveries d
       where d.post_id = p_post_id
         and not public.social_user_can(p_user_id, d.account_id, 'edit_posts')
    );
  end if;
  return author_id = p_user_id and public.social_user_can_create_draft(p_user_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_user_can_manage_post"(
    "p_user_id" "uuid",
    "p_post_id" "uuid",
    "p_permission" "text"
) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  author_id uuid;
  has_admin boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null or p_post_id is null
      or p_permission not in ('read_posts', 'create_posts', 'edit_posts', 'schedule_posts', 'approve_posts', 'publish_now', 'view_results') then
    return false;
  end if;
  select coalesce('admin' = any(roles), false) or role = 'admin'
    into has_admin
    from public.profiles
   where id = p_user_id;
  if coalesce(has_admin, false) then return true; end if;
  select created_by into author_id from public.social_posts where id = p_post_id;
  if not found then return false; end if;
  if exists (select 1 from public.social_deliveries d where d.post_id = p_post_id) then
    return not exists (
      select 1 from public.social_deliveries d
       where d.post_id = p_post_id
         and not public.social_user_can(p_user_id, d.account_id, p_permission)
    );
  end if;
  return author_id = p_user_id
     and case p_permission
       when 'create_posts' then public.social_user_can_create_draft(p_user_id)
       when 'edit_posts' then public.social_user_can_create_draft(p_user_id)
       else false
     end;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_user_delivery_account"(
    "p_user_id" "uuid",
    "p_delivery_id" "uuid",
    "p_permission" "text"
) RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target_account_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select account_id into target_account_id
    from public.social_deliveries
   where id = p_delivery_id;
  if not found or not public.social_user_can(p_user_id, target_account_id, p_permission) then
    return null;
  end if;
  return target_account_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_user_approval_queue"("p_user_id" "uuid")
RETURNS SETOF "public"."social_deliveries"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  has_admin boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null then return; end if;
  select coalesce('admin' = any(roles), false) or role = 'admin'
    into has_admin
    from public.profiles
   where id = p_user_id;
  return query
    select d.*
      from public.social_deliveries d
     where d.approval_state = 'pending'
       and d.status = 'scheduled'
       and (coalesce(has_admin, false)
            or public.social_user_can(p_user_id, d.account_id, 'approve_posts'))
     order by d.approval_requested_at, d.scheduled_at, d.id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_save_draft"(
    "p_post_id" "uuid",
    "p_body" "text",
    "p_timezone" "text",
    "p_actor_id" "uuid"
)
RETURNS "public"."social_posts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  saved public.social_posts;
  author_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select created_by into author_id from public.social_posts where id = p_post_id for update;
  if not found then raise exception 'post not found'; end if;
  if not public.social_user_can_edit_post(p_actor_id, p_post_id) then
    raise exception 'edit permission is required for this post';
  end if;
  if exists (
    select 1 from public.social_deliveries d
     where d.post_id = p_post_id
       and d.status in ('claimed', 'publishing', 'remote_scheduled', 'published', 'review_required')
  ) then raise exception 'a delivery has already started or needs recovery'; end if;
  update public.social_posts
     set body = p_body, timezone = p_timezone, updated_at = now()
   where id = p_post_id
   returning * into saved;
  update public.social_deliveries d
     set approval_state = 'pending', approval_requested_at = now(),
         approved_by = null, approved_at = null, returned_by = null, returned_at = null,
         updated_at = now()
    from public.social_accounts a
   where d.post_id = p_post_id
     and a.id = d.account_id
     and a.approval_required
     and d.approval_state = 'approved'
     and d.status in ('scheduled', 'retry_wait', 'blocked');
  return saved;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_order_attachments"(
    "p_post_id" "uuid",
    "p_attachment_ids" "uuid"[],
    "p_actor_id" "uuid"
)
RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if not public.social_user_can_edit_post(p_actor_id, p_post_id) then
    raise exception 'edit permission is required for this post';
  end if;
  perform 1 from public.social_posts where id = p_post_id for update;
  if not found then raise exception 'post not found'; end if;
  if exists (
    select 1 from public.social_deliveries d
     where d.post_id = p_post_id
       and d.status in ('claimed', 'publishing', 'remote_scheduled', 'published', 'review_required')
  ) then raise exception 'a delivery has already started or needs recovery'; end if;
  if coalesce(array_length(p_attachment_ids, 1), 0) <> (
    select count(*) from public.social_attachments where post_id = p_post_id
  ) or coalesce(array_length(p_attachment_ids, 1), 0) <> (
    select count(distinct target_id) from unnest(p_attachment_ids) as requested(target_id)
  ) or exists (
    select 1
      from unnest(p_attachment_ids) with ordinality requested(id, position)
      left join public.social_attachments a on a.id = requested.id and a.post_id = p_post_id
     where a.id is null
  ) then raise exception 'attachment order must name every attachment once'; end if;
  update public.social_attachments a
     set position = requested.position - 1
    from unnest(p_attachment_ids) with ordinality requested(id, position)
   where a.id = requested.id and a.post_id = p_post_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_save_attachment"(
    "p_attachment_id" "uuid",
    "p_post_id" "uuid",
    "p_object_path" "text",
    "p_kind" "text",
    "p_mime_type" "text",
    "p_file_name" "text",
    "p_byte_size" bigint,
    "p_replace" boolean,
    "p_actor_id" "uuid"
) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  previous_path text;
  next_position integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if not public.social_user_can_edit_post(p_actor_id, p_post_id) then
    raise exception 'edit permission is required for this post';
  end if;
  perform 1 from public.social_posts where id = p_post_id for update;
  if not found then raise exception 'post not found'; end if;
  if exists (
    select 1 from public.social_deliveries d
     where d.post_id = p_post_id
       and d.status in ('claimed', 'publishing', 'remote_scheduled', 'published', 'review_required')
  ) then raise exception 'a delivery has already started or needs recovery'; end if;
  if p_object_path !~ ('^posts/' || p_post_id::text || '/[0-9a-f-]{36}$')
      or p_kind not in ('image', 'video') or p_byte_size <= 0 or p_byte_size > 104857600 then
    raise exception 'attachment metadata is invalid';
  end if;
  if p_replace then
    select object_path into previous_path from public.social_attachments
     where id = p_attachment_id and post_id = p_post_id for update;
    if not found then raise exception 'attachment not found'; end if;
    update public.social_attachments
       set object_path = p_object_path, kind = p_kind, mime_type = p_mime_type,
           file_name = p_file_name, byte_size = p_byte_size
     where id = p_attachment_id;
  else
    select coalesce(max(position) + 1, 0) into next_position
      from public.social_attachments where post_id = p_post_id;
    insert into public.social_attachments (
      id, post_id, object_path, kind, mime_type, file_name, byte_size, position
    ) values (
      p_attachment_id, p_post_id, p_object_path, p_kind, p_mime_type, p_file_name, p_byte_size, next_position
    );
  end if;
  return previous_path;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_remove_attachment"(
    "p_attachment_id" "uuid",
    "p_actor_id" "uuid"
)
RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  parent_id uuid;
  object_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select post_id into parent_id from public.social_attachments where id = p_attachment_id;
  if not found then raise exception 'attachment not found'; end if;
  if not public.social_user_can_edit_post(p_actor_id, parent_id) then
    raise exception 'edit permission is required for this post';
  end if;
  perform 1 from public.social_posts where id = parent_id for update;
  if exists (
    select 1 from public.social_deliveries d
     where d.post_id = parent_id
       and d.status in ('claimed', 'publishing', 'remote_scheduled', 'published', 'review_required')
  ) then raise exception 'a delivery has already started or needs recovery'; end if;
  delete from public.social_attachments where id = p_attachment_id
    returning object_path into object_name;
  return object_name;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_schedule_post"(
    "p_post_id" "uuid",
    "p_body" "text",
    "p_timezone" "text",
    "p_account_ids" "uuid"[],
    "p_scheduled_at" timestamp with time zone,
    "p_expected_updated_at" timestamp with time zone,
    "p_target_options" "jsonb" DEFAULT '{}'::"jsonb",
    "p_actor_id" "uuid" DEFAULT NULL,
    "p_publish_now" boolean DEFAULT false
) RETURNS SETOF "public"."social_deliveries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_publish_now is distinct from true and p_scheduled_at <= now() then raise exception 'schedule time must be in the future'; end if;
  if p_actor_id is null then raise exception 'acting user is required'; end if;
  if coalesce(array_length(p_account_ids, 1), 0) = 0 then raise exception 'at least one account is required'; end if;
  if jsonb_typeof(p_target_options) <> 'object' or octet_length(p_target_options::text) > 8192 then
    raise exception 'target options must be a bounded object';
  end if;
  perform 1 from public.social_posts
   where id = p_post_id and updated_at = p_expected_updated_at for update;
  if not found then raise exception 'post changed while it was being validated'; end if;
  if exists (
    select 1 from public.social_posts p
     where p.id = p_post_id and p.body is distinct from p_body
  ) and not public.social_user_can_edit_post(p_actor_id, p_post_id) then
    raise exception 'edit permission is required for every existing target';
  end if;
  if exists (
    select 1 from public.social_deliveries d
     where d.post_id = p_post_id
       and d.status in ('claimed', 'publishing', 'remote_scheduled', 'published', 'review_required')
  ) then raise exception 'a delivery has already started or needs recovery'; end if;
  if exists (
    select 1
      from unnest(p_account_ids) as requested(account_id)
      left join public.social_accounts a on a.id = requested.account_id
     where a.id is null
        or a.status <> 'connected'
        or not public.social_user_can(
          p_actor_id, requested.account_id,
          case when p_publish_now then 'publish_now' else 'schedule_posts' end
        )
  ) then raise exception 'account permission is required for every target'; end if;

  update public.social_posts
     set body = p_body, timezone = p_timezone, updated_at = now()
   where id = p_post_id;
  if not found then raise exception 'post not found'; end if;

  update public.social_deliveries
     set status = 'cancelled', cancelled_at = now(), updated_at = now(),
         lease_token = null, lease_until = null
   where post_id = p_post_id
     and status in ('scheduled', 'retry_wait', 'blocked', 'failed')
     and not (account_id = any(p_account_ids));

  return query
    insert into public.social_deliveries (
      post_id, account_id, target_options, scheduled_at, status, approval_state, approval_intent,
      approval_requested_at, approved_by, approved_at, returned_by, returned_at,
      attempt_count, lease_token, lease_until,
      next_attempt_at, provider_post_id, remote_job_id, remote_delivery_id,
      last_error_code, last_error, published_at,
      cancelled_at, updated_at
    )
    select p_post_id, target_id, coalesce(p_target_options -> target_id::text, '{}'::jsonb),
           case when p_publish_now then now() else p_scheduled_at end, 'scheduled',
           case when a.approval_required then 'pending' else 'not_required' end,
           case when p_publish_now then 'immediate' else 'scheduled' end,
           case when a.approval_required then now() else null end,
           null, null, null, null, 0, null, null,
           null, null, null, null, null, null, null, null, now()
      from (select distinct unnest(p_account_ids) as target_id) targets
      join public.social_accounts a on a.id = target_id
    on conflict (post_id, account_id) do update
       set target_options = excluded.target_options, scheduled_at = excluded.scheduled_at, status = 'scheduled',
           approval_state = excluded.approval_state, approval_intent = excluded.approval_intent,
           approval_requested_at = excluded.approval_requested_at,
           approved_by = null, approved_at = null, returned_by = null, returned_at = null,
           lease_token = null, lease_until = null, next_attempt_at = null,
           provider_post_id = null, remote_job_id = null, remote_delivery_id = null,
           last_error_code = null, last_error = null,
           published_at = null, cancelled_at = null, updated_at = now()
     where public.social_deliveries.status in ('draft', 'scheduled', 'retry_wait', 'blocked', 'failed', 'cancelled')
    returning *;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_claim_due"("p_limit" integer DEFAULT 20, "p_lease_seconds" integer DEFAULT 120)
RETURNS SETOF "public"."social_deliveries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 30 or p_lease_seconds > 600 then
    raise exception 'claim bounds are invalid';
  end if;

  update public.social_deliveries d
     set status = 'blocked', approval_state = 'reschedule_required', updated_at = now(),
         last_error_code = 'approval_schedule_expired',
         last_error = 'This scheduled time passed before approval. Choose a new time before publishing.'
    from public.social_accounts a
   where a.id = d.account_id
     and a.approval_required
     and d.approval_state = 'pending'
     and d.approval_intent = 'scheduled'
     and d.scheduled_at <= now()
     and d.status in ('scheduled', 'retry_wait', 'blocked');

  update public.social_deliveries
     set status = 'review_required', lease_token = null, lease_until = null,
         last_error_code = 'delivery_lease_expired',
         last_error = 'The provider outcome is uncertain after a delivery worker stopped.',
         updated_at = now()
   where status = 'publishing' and lease_until < now();
  update public.social_delivery_attempts a
     set status = 'unknown', error_code = 'delivery_lease_expired',
         error_message = 'The provider outcome is uncertain after a delivery worker stopped.',
         finished_at = now()
    from public.social_deliveries d
   where d.id = a.delivery_id and a.attempt_number = d.attempt_count
     and a.status = 'started' and d.status = 'review_required'
     and d.last_error_code = 'delivery_lease_expired';

  return query
    with due as (
      select d.id
        from public.social_deliveries d
        join public.social_posts p on p.id = d.post_id
       where (
         (d.status in ('scheduled', 'retry_wait', 'remote_scheduled')
          and d.approval_state not in ('pending', 'reschedule_required')
          and d.scheduled_at <= now()
          and (d.next_attempt_at is null or d.next_attempt_at <= now()))
         or (d.status = 'scheduled'
             and d.approval_state not in ('pending', 'reschedule_required')
             and d.scheduled_at > now()
             and d.scheduled_at <= now() + interval '30 days'
             and exists (
               select 1 from public.social_accounts a
                where a.id = d.account_id and a.backend_id = 'postfast'
             ))
         or (d.status = 'claimed' and d.lease_until < now())
       )
       order by d.scheduled_at, d.id
       for update of d, p skip locked
       limit p_limit
    )
    update public.social_deliveries d
       set status = 'claimed', lease_token = gen_random_uuid(),
           lease_until = now() + make_interval(secs => p_lease_seconds),
           updated_at = now()
      from due
     where d.id = due.id
    returning d.*;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_start_delivery"("p_delivery_id" "uuid", "p_lease_token" "uuid")
RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  attempt integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.social_deliveries
     set status = 'publishing', attempt_count = attempt_count + 1,
         lease_until = now() + interval '10 minutes', updated_at = now()
   where id = p_delivery_id and status = 'claimed' and lease_token = p_lease_token
     and lease_until > now()
   returning attempt_count into attempt;
  if not found then return null; end if;
  insert into public.social_delivery_attempts (delivery_id, attempt_number, status, operation)
    values (p_delivery_id, attempt, 'started', 'publish');
  return attempt;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_finish_delivery"(
    "p_delivery_id" "uuid",
    "p_lease_token" "uuid",
    "p_attempt_number" integer,
    "p_status" "text",
    "p_provider_post_id" "text" DEFAULT NULL,
    "p_error_code" "text" DEFAULT NULL,
    "p_error" "text" DEFAULT NULL,
    "p_next_attempt_at" timestamp with time zone DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  attempt_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_status not in ('published', 'retry_wait', 'failed', 'blocked', 'review_required') then
    raise exception 'delivery status is invalid';
  end if;
  attempt_status := case p_status
    when 'published' then 'published'
    when 'retry_wait' then 'retryable'
    when 'review_required' then 'unknown'
    else 'terminal'
  end;
  update public.social_deliveries
     set status = p_status, provider_post_id = coalesce(p_provider_post_id, provider_post_id),
         last_error_code = p_error_code, last_error = p_error,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
         metrics_next_fetch_at = case
           when p_status = 'published' and published_at is null then now() + interval '1 hour'
           else metrics_next_fetch_at
         end,
         next_attempt_at = case when p_status = 'retry_wait' then p_next_attempt_at else null end,
         lease_token = null, lease_until = null, updated_at = now()
   where id = p_delivery_id and status = 'publishing' and lease_token = p_lease_token;
  if not found then return false; end if;
  update public.social_delivery_attempts
     set status = attempt_status, error_code = p_error_code, error_message = p_error,
         provider_post_id = p_provider_post_id, finished_at = now()
   where delivery_id = p_delivery_id and attempt_number = p_attempt_number and status = 'started';
  if not found then raise exception 'delivery attempt record is unavailable'; end if;
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_finish_managed_delivery"(
    "p_delivery_id" "uuid",
    "p_lease_token" "uuid",
    "p_attempt_number" integer,
    "p_status" "text",
    "p_remote_job_id" "text" DEFAULT NULL,
    "p_remote_delivery_id" "text" DEFAULT NULL,
    "p_provider_post_id" "text" DEFAULT NULL,
    "p_error_code" "text" DEFAULT NULL,
    "p_error" "text" DEFAULT NULL,
    "p_next_attempt_at" timestamp with time zone DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  attempt_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_status not in ('remote_scheduled', 'published', 'retry_wait', 'failed', 'blocked', 'review_required') then
    raise exception 'managed delivery status is invalid';
  end if;
  if p_status = 'remote_scheduled'
      and (coalesce(p_remote_job_id, '') = '' or coalesce(p_remote_delivery_id, '') = '') then
    raise exception 'remote schedule references are required';
  end if;
  attempt_status := case p_status
    when 'published' then 'published'
    when 'remote_scheduled' then 'accepted'
    when 'retry_wait' then 'retryable'
    when 'review_required' then 'unknown'
    else 'terminal'
  end;
  update public.social_deliveries
     set status = p_status,
         remote_job_id = coalesce(p_remote_job_id, remote_job_id),
         remote_delivery_id = coalesce(p_remote_delivery_id, remote_delivery_id),
         provider_post_id = coalesce(p_provider_post_id, provider_post_id),
         last_error_code = p_error_code,
         last_error = p_error,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
         metrics_next_fetch_at = case
           when p_status = 'published' and published_at is null then now() + interval '1 hour'
           else metrics_next_fetch_at
         end,
         next_attempt_at = case when p_status in ('remote_scheduled', 'retry_wait') then p_next_attempt_at else null end,
         lease_token = null, lease_until = null, updated_at = now()
   where id = p_delivery_id and status = 'publishing' and lease_token = p_lease_token;
  if not found then return false; end if;
  update public.social_delivery_attempts
     set status = attempt_status, error_code = p_error_code, error_message = p_error,
         provider_post_id = p_provider_post_id, finished_at = now()
   where delivery_id = p_delivery_id and attempt_number = p_attempt_number and status = 'started';
  if not found then raise exception 'managed delivery attempt record is unavailable'; end if;
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_recover_delivery"(
    "p_delivery_id" "uuid",
    "p_resolution" "text",
    "p_provider_post_id" "text",
    "p_actor_id" "uuid",
    "p_confirmed_not_published" boolean DEFAULT false
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_actor_id is null then raise exception 'recovery actor is required'; end if;
  select status into current_status
    from public.social_deliveries
   where id = p_delivery_id
   for update;
  if not found then return false; end if;

  if p_resolution = 'marked_published' then
    if current_status <> 'review_required' then raise exception 'only an uncertain delivery can be marked published'; end if;
    if p_provider_post_id is null or length(btrim(p_provider_post_id)) = 0
        or length(p_provider_post_id) > 300 then
      raise exception 'a provider post id is required';
    end if;
    update public.social_deliveries
       set status = 'published', provider_post_id = btrim(p_provider_post_id),
           published_at = coalesce(published_at, now()),
           metrics_next_fetch_at = case when published_at is null then now() + interval '1 hour' else metrics_next_fetch_at end,
           next_attempt_at = null, last_error_code = null,
           last_error = null, cancelled_at = null, lease_token = null, lease_until = null,
           recovered_by = p_actor_id, recovered_at = now(), recovery_action = 'marked_published',
           updated_at = now()
     where id = p_delivery_id;
  elsif p_resolution = 'retry' then
    if current_status not in ('failed', 'blocked', 'review_required') then
      raise exception 'delivery is not available for manual retry';
    end if;
    if current_status = 'review_required' and not coalesce(p_confirmed_not_published, false) then
      raise exception 'confirm the provider did not publish this post before retrying';
    end if;
    update public.social_deliveries
       set status = 'scheduled', scheduled_at = now(), next_attempt_at = null,
           provider_post_id = null, remote_job_id = null, remote_delivery_id = null,
           published_at = null, cancelled_at = null,
           last_error_code = null, last_error = null, lease_token = null, lease_until = null,
           recovered_by = p_actor_id, recovered_at = now(), recovery_action = 'retry',
           updated_at = now()
     where id = p_delivery_id;
  else
    raise exception 'delivery resolution is invalid';
  end if;
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."run_social_publishing"() RETURNS "void"
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
    url := url || '/social-publish',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"deliver_due"}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_claim_metrics"("p_limit" integer DEFAULT 10, "p_lease_seconds" integer DEFAULT 300)
RETURNS SETOF "public"."social_deliveries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  return query
  with due as (
    select d.id
      from public.social_deliveries d
     where d.status = 'published'
       and d.provider_post_id is not null
       and d.metrics_state <> 'unsupported'
       and (d.metrics_next_fetch_at is null or d.metrics_next_fetch_at <= now()
            or d.metrics_lease_until <= now())
       and (d.metrics_lease_until is null or d.metrics_lease_until <= now())
     order by coalesce(d.metrics_next_fetch_at, d.published_at), d.id
     for update skip locked
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
  )
  update public.social_deliveries d
     set metrics_state = 'fetching',
         metrics_lease_token = gen_random_uuid(),
         metrics_lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 900)),
         metrics_attempt_count = d.metrics_attempt_count + 1,
         updated_at = now()
    from due
   where d.id = due.id
  returning d.*;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_finish_metrics"(
    "p_delivery_id" "uuid",
    "p_lease_token" "uuid",
    "p_outcome" "text",
    "p_views" bigint DEFAULT NULL,
    "p_reads" bigint DEFAULT NULL,
    "p_likes" bigint DEFAULT NULL,
    "p_comments" bigint DEFAULT NULL,
    "p_provider_metrics" "jsonb" DEFAULT '{}'::"jsonb",
    "p_error_code" "text" DEFAULT NULL,
    "p_error" "text" DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target public.social_deliveries%rowtype;
  next_at timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_outcome not in ('success', 'unsupported', 'error') then raise exception 'metrics outcome is invalid'; end if;
  if p_outcome = 'success' and (
       p_views < 0 or p_reads < 0 or p_likes < 0 or p_comments < 0
       or jsonb_typeof(coalesce(p_provider_metrics, '{}'::jsonb)) <> 'object'
       or octet_length(coalesce(p_provider_metrics, '{}'::jsonb)::text) > 32768
     ) then raise exception 'metrics payload is invalid'; end if;

  update public.social_deliveries d
     set metrics_state = case p_outcome when 'success' then 'available' when 'unsupported' then 'unsupported' else 'error' end,
         metrics_last_fetched_at = case when p_outcome = 'success' then now() else d.metrics_last_fetched_at end,
         metrics_next_fetch_at = case
           when p_outcome = 'unsupported' then null
           when d.published_at > now() - interval '72 hours'
             then least(now() + interval '1 hour', d.published_at + interval '72 hours')
           else now() + interval '1 day'
         end,
         metrics_last_error_code = case when p_outcome = 'success' then null else left(coalesce(p_error_code, p_outcome), 80) end,
         metrics_last_error = case when p_outcome = 'success' then null else left(regexp_replace(coalesce(p_error, 'Metrics collection failed.'), E'[\\r\\n\\t]+', ' ', 'g'), 500) end,
         metrics_lease_token = null,
         metrics_lease_until = null,
         updated_at = now()
   where d.id = p_delivery_id
     and d.status = 'published'
     and d.metrics_state = 'fetching'
     and d.metrics_lease_token = p_lease_token
     and d.metrics_lease_until > now()
   returning d.* into target;
  if not found then return false; end if;

  if p_outcome = 'success' then
    insert into public.social_metrics_snapshots (
      delivery_id, post_id, account_id, provider_post_id, published_at,
      views, reads, likes, comments, provider_metrics
    ) values (
      target.id, target.post_id, target.account_id, target.provider_post_id, target.published_at,
      p_views, p_reads, p_likes, p_comments, coalesce(p_provider_metrics, '{}'::jsonb)
    );
  end if;
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."run_social_metrics"() RETURNS "void"
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
    url := url || '/social-publish',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"collect_metrics"}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."run_social_automation"() RETURNS "void"
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
    url := url || '/social-automation',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{"action":"process_due"}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_claim_automation_events"(
    "p_event_id" "uuid" DEFAULT NULL,
    "p_limit" integer DEFAULT 20
) RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.social_inbound_events
     set status = 'failed', lease_until = null,
         last_error = 'The event exceeded its processing retry limit.'
   where status in ('pending', 'processing')
     and attempts >= 8
     and next_attempt_at <= now()
     and (lease_until is null or lease_until < now())
     and (p_event_id is null or id = p_event_id);
  return query
  with due as (
    select e.id
      from public.social_inbound_events e
     where e.status in ('pending', 'processing')
       and e.attempts < 8
       and e.next_attempt_at <= now()
       and (e.lease_until is null or e.lease_until < now())
       and (p_event_id is null or e.id = p_event_id)
     order by e.received_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.social_inbound_events e
     set status = 'processing',
         attempts = e.attempts + 1,
         lease_until = now() + interval '2 minutes',
         next_attempt_at = now() + interval '2 minutes'
    from due
   where e.id = due.id
  returning e.id;
end;
$$;
REVOKE ALL ON FUNCTION "public"."social_claim_automation_events"("uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_claim_automation_events"("uuid", integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_claim_automation_events"("uuid", integer) TO "service_role";

CREATE OR REPLACE FUNCTION "public"."social_finish_automation_event"(
    "p_event_id" "uuid",
    "p_status" "text",
    "p_error" "text" DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_status not in ('complete', 'quarantined', 'failed') then
    raise exception 'automation event status is invalid';
  end if;
  update public.social_inbound_events
     set status = p_status,
         lease_until = null,
         next_attempt_at = now(),
         processed_at = case when p_status = 'complete' then now() else processed_at end,
         last_error = left(nullif(btrim(p_error), ''), 500)
   where id = p_event_id and status = 'processing';
  return found;
end;
$$;
REVOKE ALL ON FUNCTION "public"."social_finish_automation_event"("uuid", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_finish_automation_event"("uuid", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_finish_automation_event"("uuid", "text", "text") TO "service_role";

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
REVOKE ALL ON FUNCTION "public"."social_start_automation_run"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_start_automation_run"("uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_start_automation_run"("uuid", "text") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."social_begin_automation_send"(
    "p_response_id" "uuid",
    "p_actor_id" "uuid" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  response public.social_automation_responses;
  automation public.social_automations;
  event public.social_inbound_events;
  account public.social_accounts;
  publisher uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select * into response from public.social_automation_responses
   where id = p_response_id for update;
  if not found or response.status <> 'draft' then
    return jsonb_build_object('error', 'response_unavailable');
  end if;
  select * into automation from public.social_automations where id = response.automation_id;
  select * into event from public.social_inbound_events where id = response.event_id;
  select * into account from public.social_accounts where id = response.account_id;
  if automation.id is null or event.id is null or account.id is null
      or automation.account_id <> response.account_id
      or event.account_id <> response.account_id
  then return jsonb_build_object('error', 'route_unavailable'); end if;
  if account.status <> 'connected' then
    if p_actor_id is null and response.mode = 'automatic' then
      update public.social_automations set enabled = false, updated_at = now()
       where id = automation.id and enabled;
    end if;
    return jsonb_build_object('error', 'account_unavailable');
  end if;
  if response.mode <> automation.mode
      or not (response.destination = any(automation.destinations))
  then return jsonb_build_object('error', 'route_unavailable'); end if;

  if p_actor_id is null then
    if response.mode <> 'automatic' or not automation.enabled then
      return jsonb_build_object('error', 'automation_paused');
    end if;
    publisher := automation.authorized_by;
  else
    if response.mode <> 'draft' then
      return jsonb_build_object('error', 'manual_review_unavailable');
    end if;
    publisher := p_actor_id;
  end if;

  if not public.social_user_can(publisher, response.account_id, 'view_results')
      or not public.social_user_can(publisher, response.account_id, 'publish_now')
  then
    if p_actor_id is null then
      update public.social_automations set enabled = false, updated_at = now()
       where id = automation.id and enabled;
    end if;
    return jsonb_build_object('error', 'publisher_permission_revoked');
  end if;

  update public.social_automation_responses
     set status = 'sending',
         attempts = attempts + 1,
         reviewed_by = coalesce(p_actor_id, reviewed_by),
         sent_by = p_actor_id,
         last_error = null,
         updated_at = now()
   where id = response.id and status = 'draft';
  if not found then return jsonb_build_object('error', 'response_unavailable'); end if;
  return jsonb_build_object(
    'id', response.id,
    'account_id', response.account_id,
    'automation_id', response.automation_id,
    'event_id', response.event_id,
    'destination', response.destination,
    'mode', response.mode,
    'body', response.body,
    'actor_id', p_actor_id
  );
end;
$$;
REVOKE ALL ON FUNCTION "public"."social_begin_automation_send"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_begin_automation_send"("uuid", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_begin_automation_send"("uuid", "uuid") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."social_finish_automation_send"(
    "p_response_id" "uuid",
    "p_status" "text",
    "p_provider_response_id" "text" DEFAULT NULL,
    "p_error" "text" DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_status not in ('sent', 'failed', 'uncertain') then
    raise exception 'automation response outcome is invalid';
  end if;
  update public.social_automation_responses
     set status = p_status,
         provider_response_id = left(nullif(btrim(p_provider_response_id), ''), 300),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         last_error = left(nullif(btrim(p_error), ''), 500),
         updated_at = now()
   where id = p_response_id and status = 'sending';
  return found;
end;
$$;
REVOKE ALL ON FUNCTION "public"."social_finish_automation_send"("uuid", "text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_finish_automation_send"("uuid", "text", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_finish_automation_send"("uuid", "text", "text", "text") TO "service_role";

CREATE OR REPLACE FUNCTION "public"."social_recover_automation_sends"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare recovered integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.social_automation_responses
     set status = 'uncertain',
         last_error = 'The worker stopped after sending began; verify the provider before any further action.',
         updated_at = now()
   where status = 'sending' and updated_at < now() - interval '5 minutes';
  get diagnostics recovered = row_count;
  return recovered;
end;
$$;
REVOKE ALL ON FUNCTION "public"."social_recover_automation_sends"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_recover_automation_sends"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_recover_automation_sends"() TO "service_role";

CREATE OR REPLACE FUNCTION "public"."social_can"("p_account_id" "uuid", "p_permission" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or exists (
    select 1
      from public.social_publisher_grants g
      join public.social_publisher_account_permissions p on p.grant_id = g.id
     where g.user_id = auth.uid()
       and g.status = 'active'
       and p.account_id = p_account_id
       and case p_permission
         when 'read_posts' then p.read_posts
         when 'create_posts' then p.create_posts
         when 'edit_posts' then p.edit_posts
         when 'schedule_posts' then p.schedule_posts
         when 'approve_posts' then p.approve_posts
         when 'publish_now' then p.publish_now
         when 'view_results' then p.view_results
         else false
       end
  );
$$;

CREATE OR REPLACE FUNCTION "public"."social_can_manage_accounts"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or exists (
    select 1
      from public.social_publisher_grants g
     where g.user_id = auth.uid()
       and g.status = 'active'
       and g.can_manage_accounts
  );
$$;

CREATE OR REPLACE FUNCTION "public"."social_has_access"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or exists (
    select 1
      from public.social_publisher_grants g
     where g.user_id = auth.uid()
       and g.status = 'active'
       and (
         g.can_manage_accounts
         or exists (
           select 1 from public.social_publisher_account_permissions p
            where p.grant_id = g.id
              and (p.read_posts or p.create_posts or p.edit_posts or p.schedule_posts
                   or p.approve_posts or p.publish_now or p.view_results)
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION "public"."social_user_can"(
    "p_user_id" "uuid",
    "p_account_id" "uuid",
    "p_permission" "text"
) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  has_admin boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null or p_account_id is null then return false; end if;
  select coalesce('admin' = any(roles), false) or role = 'admin'
    into has_admin
    from public.profiles
   where id = p_user_id;
  if coalesce(has_admin, false) then return true; end if;
  return exists (
    select 1
      from public.social_publisher_grants g
      join public.social_publisher_account_permissions p on p.grant_id = g.id
     where g.user_id = p_user_id
       and g.status = 'active'
       and p.account_id = p_account_id
       and case p_permission
         when 'read_posts' then p.read_posts
         when 'create_posts' then p.create_posts
         when 'edit_posts' then p.edit_posts
         when 'schedule_posts' then p.schedule_posts
         when 'approve_posts' then p.approve_posts
         when 'publish_now' then p.publish_now
         when 'view_results' then p.view_results
         else false
       end
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_user_can_manage_accounts"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  has_admin boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null then return false; end if;
  select coalesce('admin' = any(roles), false) or role = 'admin'
    into has_admin
    from public.profiles
   where id = p_user_id;
  return coalesce(has_admin, false) or exists (
    select 1 from public.social_publisher_grants g
     where g.user_id = p_user_id
       and g.status = 'active'
       and g.can_manage_accounts
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_set_publisher_permissions"(
    "p_grant_id" "uuid",
    "p_actor_id" "uuid",
    "p_can_manage_accounts" boolean,
    "p_permissions" "jsonb"
) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  actor_is_admin boolean;
  target_grant public.social_publisher_grants;
  entry jsonb;
  target_account_id uuid;
  permission_values boolean[];
  seen_accounts uuid[] := '{}';
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select coalesce('admin' = any(roles), false) or role = 'admin'
    into actor_is_admin
    from public.profiles where id = p_actor_id;
  if not coalesce(actor_is_admin, false) then raise exception 'administrator permission is required'; end if;
  if p_grant_id is null or jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'publisher permissions are invalid';
  end if;
  if jsonb_array_length(p_permissions) > 100 then
    raise exception 'publisher permissions are invalid';
  end if;
  select * into target_grant from public.social_publisher_grants
   where id = p_grant_id for update;
  if not found or target_grant.status not in ('pending', 'active') then
    raise exception 'publisher grant is unavailable';
  end if;
  update public.social_publisher_grants
     set can_manage_accounts = coalesce(p_can_manage_accounts, false)
   where id = p_grant_id;
  delete from public.social_publisher_account_permissions where grant_id = p_grant_id;

  for entry in select value from jsonb_array_elements(p_permissions)
  loop
    if jsonb_typeof(entry) <> 'object'
        or jsonb_typeof(entry -> 'account_id') <> 'string' then
      raise exception 'publisher account permission is invalid';
    end if;
    begin
      target_account_id := (entry ->> 'account_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'publisher account permission is invalid';
    end;
    if target_account_id = any(seen_accounts) then
      raise exception 'publisher account permissions contain a duplicate account';
    end if;
    if not exists (select 1 from public.social_accounts a where a.id = target_account_id) then
      raise exception 'social account not found';
    end if;
    if exists (
      select 1 from jsonb_each(entry) field
       where field.key <> 'account_id'
         and field.key not in ('read_posts', 'create_posts', 'edit_posts', 'schedule_posts',
                               'approve_posts', 'publish_now', 'view_results')
    ) then raise exception 'publisher permissions contain an unknown action'; end if;
    if exists (
      select 1 from jsonb_each(entry) field
       where field.key <> 'account_id' and jsonb_typeof(field.value) <> 'boolean'
    ) then raise exception 'publisher action permissions must be boolean'; end if;
    permission_values := array[
      coalesce((entry ->> 'read_posts')::boolean, false),
      coalesce((entry ->> 'create_posts')::boolean, false),
      coalesce((entry ->> 'edit_posts')::boolean, false),
      coalesce((entry ->> 'schedule_posts')::boolean, false),
      coalesce((entry ->> 'approve_posts')::boolean, false),
      coalesce((entry ->> 'publish_now')::boolean, false),
      coalesce((entry ->> 'view_results')::boolean, false)
    ];
    if true = any(permission_values) then
      insert into public.social_publisher_account_permissions (
        grant_id, account_id, read_posts, create_posts, edit_posts, schedule_posts,
        approve_posts, publish_now, view_results, updated_at
      ) values (
        p_grant_id, target_account_id, permission_values[1], permission_values[2],
        permission_values[3], permission_values[4], permission_values[5],
        permission_values[6], permission_values[7], now()
      );
    end if;
    seen_accounts := array_append(seen_accounts, target_account_id);
  end loop;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_set_account_approval"(
    "p_account_id" "uuid",
    "p_actor_id" "uuid",
    "p_required" boolean
) RETURNS "public"."social_accounts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  account_row public.social_accounts;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select * into account_row
    from public.social_accounts
   where id = p_account_id
   for update;
  if not found then raise exception 'social account not found'; end if;
  if not public.social_user_can_manage_accounts(p_actor_id) then
    raise exception 'Manage accounts permission is required';
  end if;

  update public.social_accounts
     set approval_required = p_required, updated_at = now()
   where id = p_account_id
   returning * into account_row;

  if p_required then
    update public.social_deliveries
       set approval_state = 'pending', approval_requested_at = now(),
           approved_by = null, approved_at = null, returned_by = null, returned_at = null,
           updated_at = now()
     where account_id = p_account_id
       and status in ('scheduled', 'retry_wait', 'blocked')
       and approval_state <> 'pending';
  else
    update public.social_deliveries
       set approval_state = case when approval_intent = 'immediate' or scheduled_at > now() then 'not_required' else 'reschedule_required' end,
           status = case when approval_intent = 'immediate' or scheduled_at > now() then 'scheduled' else 'blocked' end,
           approved_by = null, approved_at = null,
           last_error_code = case when approval_intent = 'immediate' or scheduled_at > now() then null else 'approval_schedule_expired' end,
           last_error = case
             when approval_intent = 'immediate' or scheduled_at > now() then null
             else 'This scheduled time passed before approval. Choose a new time before publishing.'
           end,
           updated_at = now()
     where account_id = p_account_id
       and approval_state = 'pending'
       and status in ('scheduled', 'retry_wait', 'blocked');
  end if;
  return account_row;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_review_delivery"(
    "p_delivery_id" "uuid",
    "p_actor_id" "uuid",
    "p_decision" "text"
) RETURNS "public"."social_deliveries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target public.social_deliveries;
  approval_required boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_decision not in ('approve', 'return') then raise exception 'approval decision is invalid'; end if;
  select * into target
    from public.social_deliveries
   where id = p_delivery_id
   for update;
  if not found then raise exception 'social delivery not found'; end if;
  select a.approval_required into approval_required
    from public.social_accounts a
   where a.id = target.account_id
   for share;
  if not found then raise exception 'social account not found'; end if;
  if not approval_required or target.approval_state <> 'pending' then
    raise exception 'social delivery is not awaiting approval';
  end if;
  if not public.social_user_can(p_actor_id, target.account_id, 'approve_posts') then
    raise exception 'Approve posts permission is required';
  end if;

  if p_decision = 'approve' and target.approval_intent = 'scheduled' and target.scheduled_at <= now() then
    update public.social_deliveries
       set status = 'blocked', approval_state = 'reschedule_required',
           last_error_code = 'approval_schedule_expired',
           last_error = 'This scheduled time passed before approval. Choose a new time before publishing.',
           updated_at = now()
     where id = p_delivery_id
     returning * into target;
    return target;
  end if;

  if p_decision = 'approve' then
    update public.social_deliveries
       set status = 'scheduled', approval_state = 'approved',
           approved_by = p_actor_id, approved_at = now(),
           returned_by = null, returned_at = null,
           last_error_code = null, last_error = null,
           updated_at = now()
     where id = p_delivery_id
     returning * into target;
  else
    update public.social_deliveries
       set status = 'draft', approval_state = 'returned',
           approved_by = null, approved_at = null,
           returned_by = p_actor_id, returned_at = now(),
           last_error_code = null, last_error = null,
           updated_at = now()
     where id = p_delivery_id
     returning * into target;
  end if;
  return target;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_account_visible"("p_account_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.social_can_manage_accounts()
      or public.social_can(p_account_id, 'read_posts')
      or public.social_can(p_account_id, 'create_posts')
      or public.social_can(p_account_id, 'edit_posts')
      or public.social_can(p_account_id, 'schedule_posts')
      or public.social_can(p_account_id, 'approve_posts')
      or public.social_can(p_account_id, 'publish_now')
      or public.social_can(p_account_id, 'view_results');
$$;

CREATE OR REPLACE FUNCTION "public"."social_can_create_draft"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or exists (
    select 1
      from public.social_publisher_grants g
      join public.social_publisher_account_permissions p on p.grant_id = g.id
     where g.user_id = auth.uid()
       and g.status = 'active'
       and p.create_posts
  );
$$;

CREATE OR REPLACE FUNCTION "public"."social_post_readable"("p_post_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or exists (
    select 1
      from public.social_posts p
     where p.id = p_post_id
       and (
         (p.created_by = auth.uid()
          and public.social_can_create_draft()
          and not exists (select 1 from public.social_deliveries d where d.post_id = p.id))
         or (
           exists (select 1 from public.social_deliveries d where d.post_id = p.id)
           and not exists (
             select 1
               from public.social_deliveries d
              where d.post_id = p.id
                and not (public.social_can(d.account_id, 'read_posts')
                  or public.social_can(d.account_id, 'create_posts')
                  or public.social_can(d.account_id, 'edit_posts')
                  or public.social_can(d.account_id, 'schedule_posts')
                  or public.social_can(d.account_id, 'approve_posts')
                  or public.social_can(d.account_id, 'publish_now'))
           )
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION "public"."social_post_editable"("p_post_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or exists (
    select 1
      from public.social_posts p
     where p.id = p_post_id
       and not exists (
         select 1 from public.social_deliveries d
          where d.post_id = p.id
            and d.status in ('claimed', 'publishing', 'remote_scheduled', 'published', 'review_required')
       )
       and (
         (p.created_by = auth.uid()
          and public.social_can_create_draft()
          and not exists (select 1 from public.social_deliveries d where d.post_id = p.id))
         or (
           exists (select 1 from public.social_deliveries d where d.post_id = p.id)
           and not exists (
             select 1 from public.social_deliveries d
              where d.post_id = p.id
                and not public.social_can(d.account_id, 'edit_posts')
           )
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION "public"."social_storage_post_allowed"("p_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  post_id uuid;
begin
  if p_name !~ '^posts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  post_id := split_part(p_name, '/', 2)::uuid;
  return public.social_post_readable(post_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_storage_post_edit_allowed"("p_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_name !~ '^posts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    else public.social_post_editable(split_part(p_name, '/', 2)::uuid)
  end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_vault_put"("p_secret" "text", "p_name" "text", "p_description" "text" DEFAULT ''::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_secret is null or p_secret = '' then raise exception 'a non-empty secret is required'; end if;
  return vault.create_secret(p_secret, p_name, p_description);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_vault_read"("p_secret_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
declare
  secret text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select decrypted_secret into secret
    from vault.decrypted_secrets
   where id = p_secret_id;
  if secret is null then raise exception 'social credential was not found'; end if;
  return secret;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."social_vault_delete"("p_secret_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  delete from vault.secrets where id = p_secret_id;
end;
$$;

REVOKE ALL ON FUNCTION "public"."run_social_publishing"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_social_publishing"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_social_publishing"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."run_social_metrics"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_social_metrics"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_social_metrics"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."run_social_automation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."run_social_automation"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_social_automation"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_claim_metrics"(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_claim_metrics"(integer, integer) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_claim_metrics"(integer, integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_finish_metrics"("uuid", "uuid", "text", bigint, bigint, bigint, bigint, "jsonb", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_finish_metrics"("uuid", "uuid", "text", bigint, bigint, bigint, bigint, "jsonb", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_finish_metrics"("uuid", "uuid", "text", bigint, bigint, bigint, bigint, "jsonb", "text", "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_schedule_post"("uuid", "text", "text", "uuid"[], timestamp with time zone, timestamp with time zone, "jsonb", "uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_schedule_post"("uuid", "text", "text", "uuid"[], timestamp with time zone, timestamp with time zone, "jsonb", "uuid", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_schedule_post"("uuid", "text", "text", "uuid"[], timestamp with time zone, timestamp with time zone, "jsonb", "uuid", boolean) TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_save_draft"("uuid", "text", "text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_save_draft"("uuid", "text", "text", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_save_draft"("uuid", "text", "text", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_order_attachments"("uuid", "uuid"[], "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_order_attachments"("uuid", "uuid"[], "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_order_attachments"("uuid", "uuid"[], "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_save_attachment"("uuid", "uuid", "text", "text", "text", "text", bigint, boolean, "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_save_attachment"("uuid", "uuid", "text", "text", "text", "text", bigint, boolean, "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_save_attachment"("uuid", "uuid", "text", "text", "text", "text", bigint, boolean, "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_remove_attachment"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_remove_attachment"("uuid", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_remove_attachment"("uuid", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_claim_due"(pg_catalog.int4, pg_catalog.int4) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_claim_due"(pg_catalog.int4, pg_catalog.int4) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_claim_due"(pg_catalog.int4, pg_catalog.int4) TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_start_delivery"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_start_delivery"("uuid", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_start_delivery"("uuid", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_finish_delivery"("uuid", "uuid", pg_catalog.int4, "text", "text", "text", "text", timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_finish_delivery"("uuid", "uuid", pg_catalog.int4, "text", "text", "text", "text", timestamp with time zone) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_finish_delivery"("uuid", "uuid", pg_catalog.int4, "text", "text", "text", "text", timestamp with time zone) TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_finish_managed_delivery"("uuid", "uuid", pg_catalog.int4, "text", "text", "text", "text", "text", "text", timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_finish_managed_delivery"("uuid", "uuid", pg_catalog.int4, "text", "text", "text", "text", "text", "text", timestamp with time zone) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_finish_managed_delivery"("uuid", "uuid", pg_catalog.int4, "text", "text", "text", "text", "text", "text", timestamp with time zone) TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_recover_delivery"("uuid", "text", "text", "uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_recover_delivery"("uuid", "text", "text", "uuid", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_recover_delivery"("uuid", "text", "text", "uuid", boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."social_has_access"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_has_access"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."social_has_access"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."social_has_access"() TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_can"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_can"("uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_can"("uuid", "text") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_can_manage_accounts"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_can_manage_accounts"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_can_manage_accounts"() TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_user_can"("uuid", "uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_user_can"("uuid", "uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_user_can"("uuid", "uuid", "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_user_can_manage_accounts"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_user_can_manage_accounts"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_user_can_manage_accounts"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_set_publisher_permissions"("uuid", "uuid", boolean, "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_set_publisher_permissions"("uuid", "uuid", boolean, "jsonb") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_set_publisher_permissions"("uuid", "uuid", boolean, "jsonb") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_user_can_create_draft"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_user_can_create_draft"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_user_can_create_draft"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_user_post_ids"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_user_post_ids"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_user_post_ids"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_user_can_edit_post"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_user_can_edit_post"("uuid", "uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_user_can_edit_post"("uuid", "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_user_can_manage_post"("uuid", "uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_user_can_manage_post"("uuid", "uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_user_can_manage_post"("uuid", "uuid", "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_user_delivery_account"("uuid", "uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_user_delivery_account"("uuid", "uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_user_delivery_account"("uuid", "uuid", "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_user_approval_queue"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_user_approval_queue"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_user_approval_queue"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_set_account_approval"("uuid", "uuid", boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_set_account_approval"("uuid", "uuid", boolean) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_set_account_approval"("uuid", "uuid", boolean) TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_review_delivery"("uuid", "uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_review_delivery"("uuid", "uuid", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_review_delivery"("uuid", "uuid", "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_account_visible"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_account_visible"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_account_visible"("uuid") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_can_create_draft"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_can_create_draft"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_can_create_draft"() TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_post_readable"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_post_readable"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_post_readable"("uuid") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_post_editable"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_post_editable"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_post_editable"("uuid") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_storage_post_allowed"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_storage_post_allowed"("text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."social_storage_post_allowed"("text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."social_storage_post_allowed"("text") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_storage_post_edit_allowed"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_storage_post_edit_allowed"("text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_storage_post_edit_allowed"("text") TO "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."social_vault_put"("text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_vault_put"("text", "text", "text") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_vault_put"("text", "text", "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_vault_read"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_vault_read"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_vault_read"("uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."social_vault_delete"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."social_vault_delete"("uuid") FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."social_vault_delete"("uuid") TO "service_role";

ALTER TABLE "public"."social_publisher_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_publisher_account_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_provider_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_backend_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_oauth_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_metrics_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_delivery_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_automations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_inbound_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_automation_responses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_publisher_grants_admin_read" ON "public"."social_publisher_grants"
    FOR SELECT TO "authenticated" USING ("public"."is_admin"());
DROP POLICY IF EXISTS "social_accounts_publisher_read" ON "public"."social_accounts";
CREATE POLICY "social_accounts_publisher_read" ON "public"."social_accounts"
    FOR SELECT TO "authenticated" USING ("public"."social_account_visible"("id"));
DROP POLICY IF EXISTS "social_posts_publisher_read" ON "public"."social_posts";
CREATE POLICY "social_posts_publisher_read" ON "public"."social_posts"
    FOR SELECT TO "authenticated" USING ("public"."social_post_readable"("id"));
DROP POLICY IF EXISTS "social_attachments_publisher_read" ON "public"."social_attachments";
CREATE POLICY "social_attachments_publisher_read" ON "public"."social_attachments"
    FOR SELECT TO "authenticated" USING ("public"."social_post_readable"("post_id"));
DROP POLICY IF EXISTS "social_deliveries_publisher_read" ON "public"."social_deliveries";
CREATE POLICY "social_deliveries_publisher_read" ON "public"."social_deliveries"
    FOR SELECT TO "authenticated" USING (
      "public"."social_can"("account_id", 'read_posts')
      OR "public"."social_can"("account_id", 'create_posts')
      OR "public"."social_can"("account_id", 'edit_posts')
      OR "public"."social_can"("account_id", 'schedule_posts')
      OR "public"."social_can"("account_id", 'approve_posts')
      OR "public"."social_can"("account_id", 'publish_now')
      OR "public"."social_can"("account_id", 'view_results')
    );
DROP POLICY IF EXISTS "social_metrics_snapshots_publisher_read" ON "public"."social_metrics_snapshots";
CREATE POLICY "social_metrics_snapshots_publisher_read" ON "public"."social_metrics_snapshots"
    FOR SELECT TO "authenticated" USING ("public"."social_can"("account_id", 'view_results'));
DROP POLICY IF EXISTS "social_delivery_attempts_publisher_read" ON "public"."social_delivery_attempts";
CREATE POLICY "social_delivery_attempts_publisher_read" ON "public"."social_delivery_attempts"
    FOR SELECT TO "authenticated" USING (
      EXISTS (
        SELECT 1 FROM "public"."social_deliveries" d
        WHERE d."id" = "social_delivery_attempts"."delivery_id"
          AND "public"."social_can"(d."account_id", 'view_results')
      )
    );
CREATE POLICY "social_automations_publisher_read" ON "public"."social_automations"
    FOR SELECT TO "authenticated" USING ("public"."social_can"("account_id", 'view_results'));
CREATE POLICY "social_inbound_events_publisher_read" ON "public"."social_inbound_events"
    FOR SELECT TO "authenticated" USING ("public"."social_can"("account_id", 'view_results'));
CREATE POLICY "social_automation_responses_publisher_read" ON "public"."social_automation_responses"
    FOR SELECT TO "authenticated" USING ("public"."social_can"("account_id", 'view_results'));

GRANT SELECT ON TABLE "public"."social_publisher_grants" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_provider_configs" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_accounts" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_oauth_states" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_posts" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_attachments" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_deliveries" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_metrics_snapshots" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_delivery_attempts" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_automations" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_inbound_events" TO "authenticated";
GRANT SELECT ON TABLE "public"."social_automation_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."social_publisher_grants" TO "service_role";
GRANT ALL ON TABLE "public"."social_publisher_account_permissions" TO "service_role";
GRANT ALL ON TABLE "public"."social_provider_configs" TO "service_role";
GRANT ALL ON TABLE "public"."social_backend_configs" TO "service_role";
GRANT ALL ON TABLE "public"."social_accounts" TO "service_role";
GRANT ALL ON TABLE "public"."social_oauth_states" TO "service_role";
GRANT ALL ON TABLE "public"."social_posts" TO "service_role";
GRANT ALL ON TABLE "public"."social_attachments" TO "service_role";
GRANT ALL ON TABLE "public"."social_deliveries" TO "service_role";
GRANT ALL ON TABLE "public"."social_metrics_snapshots" TO "service_role";
GRANT ALL ON TABLE "public"."social_delivery_attempts" TO "service_role";
GRANT ALL ON TABLE "public"."social_automations" TO "service_role";
GRANT ALL ON TABLE "public"."social_inbound_events" TO "service_role";
GRANT ALL ON TABLE "public"."social_automation_responses" TO "service_role";

CREATE POLICY "social_media_publisher_read" ON "storage"."objects"
    FOR SELECT TO "authenticated"
    USING ("bucket_id" = 'social' AND "public"."social_storage_post_allowed"("name"));
DROP POLICY IF EXISTS "social_media_publisher_insert" ON "storage"."objects";
CREATE POLICY "social_media_publisher_insert" ON "storage"."objects"
    FOR INSERT TO "authenticated"
    WITH CHECK ("bucket_id" = 'social' AND "public"."social_storage_post_edit_allowed"("name"));
DROP POLICY IF EXISTS "social_media_publisher_update" ON "storage"."objects";
CREATE POLICY "social_media_publisher_update" ON "storage"."objects"
    FOR UPDATE TO "authenticated"
    USING ("bucket_id" = 'social' AND "public"."social_storage_post_edit_allowed"("name"))
    WITH CHECK ("bucket_id" = 'social' AND "public"."social_storage_post_edit_allowed"("name"));
DROP POLICY IF EXISTS "social_media_publisher_delete" ON "storage"."objects";
CREATE POLICY "social_media_publisher_delete" ON "storage"."objects"
    FOR DELETE TO "authenticated"
    USING ("bucket_id" = 'social' AND "public"."social_storage_post_edit_allowed"("name"));
