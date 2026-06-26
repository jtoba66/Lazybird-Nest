CREATE TABLE "analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"meta" text
);
--> statement-breakpoint
CREATE TABLE "collab_access_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"collab_id" integer NOT NULL,
	"email" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collab_access_list_collab_id_email_unique" UNIQUE("collab_id","email")
);
--> statement-breakpoint
CREATE TABLE "collab_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"folder_id" integer NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"host_encrypted_collab_key" "bytea" NOT NULL,
	"host_collab_key_nonce" "bytea" NOT NULL,
	"link_encrypted_collab_key" "bytea" NOT NULL,
	"link_collab_key_nonce" "bytea" NOT NULL,
	"require_pin" boolean DEFAULT false NOT NULL,
	"pin_hash" text,
	"strict_mode" boolean DEFAULT false NOT NULL,
	"activity_notifications" boolean DEFAULT true NOT NULL,
	"custom_slug" text,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collab_folders_token_unique" UNIQUE("token"),
	CONSTRAINT "collab_folders_custom_slug_unique" UNIQUE("custom_slug")
);
--> statement-breakpoint
CREATE TABLE "collab_guest_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"collab_id" integer NOT NULL,
	"email" text NOT NULL,
	"session_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collab_guest_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "collab_otp_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"collab_id" integer NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drop_zone_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"drop_zone_id" integer NOT NULL,
	"encrypted_file_key" "bytea" NOT NULL,
	"file_key_nonce" "bytea" NOT NULL,
	"storage_key" text NOT NULL,
	"file_size" bigint NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drop_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"folder_id" integer NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"drop_public_key" "bytea" NOT NULL,
	"encrypted_drop_private_key" "bytea" NOT NULL,
	"drop_private_key_nonce" "bytea" NOT NULL,
	"require_pin" boolean DEFAULT false NOT NULL,
	"pin_hash" text,
	"upload_notifications" boolean DEFAULT true NOT NULL,
	"custom_slug" text,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drop_zones_token_unique" UNIQUE("token"),
	CONSTRAINT "drop_zones_custom_slug_unique" UNIQUE("custom_slug")
);
--> statement-breakpoint
CREATE TABLE "graveyard" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_file_id" integer,
	"user_id" integer,
	"filename" text,
	"file_size" bigint,
	"jackal_fid" text,
	"merkle_hash" text,
	"original_created_at" timestamp,
	"deleted_at" timestamp DEFAULT now(),
	"deletion_reason" text DEFAULT 'user_permanent_delete'
);
--> statement-breakpoint
CREATE TABLE "graveyard_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"graveyard_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"jackal_merkle" text,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "share_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_type" text NOT NULL,
	"share_id" integer NOT NULL,
	"action" text NOT NULL,
	"actor" text,
	"filename" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_with_me" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"collab_id" integer NOT NULL,
	"encrypted_collab_key" "bytea" NOT NULL,
	"collab_key_nonce" "bytea" NOT NULL,
	"pinned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shared_with_me_user_id_collab_id_unique" UNIQUE("user_id","collab_id")
);
--> statement-breakpoint
CREATE TABLE "user_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_hash" text NOT NULL,
	"ip_address" text NOT NULL,
	"user_agent" text NOT NULL,
	"last_seen_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_devices_user_id_device_hash_unique" UNIQUE("user_id","device_hash")
);
--> statement-breakpoint
ALTER TABLE "file_chunks" ADD COLUMN "obsideo_key" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "share_password_hash" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "share_max_downloads" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "share_download_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "share_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "share_custom_slug" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "storage_provider" text DEFAULT 'jackal' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "obsideo_key" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "migration_status" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "purge_after" timestamp;--> statement-breakpoint
ALTER TABLE "user_crypto" ADD COLUMN "metadata_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "collab_access_list" ADD CONSTRAINT "collab_access_list_collab_id_collab_folders_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collab_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_folders" ADD CONSTRAINT "collab_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_folders" ADD CONSTRAINT "collab_folders_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_guest_sessions" ADD CONSTRAINT "collab_guest_sessions_collab_id_collab_folders_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collab_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_otp_sessions" ADD CONSTRAINT "collab_otp_sessions_collab_id_collab_folders_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collab_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_zone_files" ADD CONSTRAINT "drop_zone_files_drop_zone_id_drop_zones_id_fk" FOREIGN KEY ("drop_zone_id") REFERENCES "public"."drop_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_zones" ADD CONSTRAINT "drop_zones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_zones" ADD CONSTRAINT "drop_zones_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graveyard_chunks" ADD CONSTRAINT "graveyard_chunks_graveyard_id_graveyard_id_fk" FOREIGN KEY ("graveyard_id") REFERENCES "public"."graveyard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_with_me" ADD CONSTRAINT "shared_with_me_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_with_me" ADD CONSTRAINT "shared_with_me_collab_id_collab_folders_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collab_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_share_custom_slug_unique" UNIQUE("share_custom_slug");