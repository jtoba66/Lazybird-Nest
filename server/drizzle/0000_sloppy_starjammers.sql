CREATE TABLE "file_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"jackal_merkle" text,
	"jackal_cid" text,
	"size" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"local_path" text,
	"is_gateway_verified" integer DEFAULT 0,
	"retry_count" integer DEFAULT 0,
	"last_retry_at" text,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "file_chunks_file_id_chunk_index_unique" UNIQUE("file_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"jackal_fid" text,
	"merkle_hash" text,
	"jackal_filename" text,
	"file_key_encrypted" "bytea" NOT NULL,
	"file_key_nonce" "bytea" NOT NULL,
	"file_size" integer NOT NULL,
	"folder_id" integer,
	"is_chunked" integer DEFAULT 0,
	"chunk_count" integer DEFAULT 0,
	"share_token" text,
	"share_key_encrypted" "bytea",
	"share_key_nonce" "bytea",
	"created_at" timestamp DEFAULT now(),
	"last_accessed_at" timestamp,
	"deleted_at" timestamp,
	"encrypted_file_path" text,
	"is_gateway_verified" integer DEFAULT 0,
	"retry_count" integer DEFAULT 0,
	"last_retry_at" text,
	"failure_reason" text,
	CONSTRAINT "files_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"parent_id" integer,
	"path_hash" text NOT NULL,
	"folder_key_encrypted" "bytea" NOT NULL,
	"folder_key_nonce" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_crypto" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"salt" "bytea" NOT NULL,
	"kdf_algorithm" text DEFAULT 'argon2id',
	"kdf_params" text NOT NULL,
	"metadata_blob" text NOT NULL,
	"metadata_nonce" "bytea" NOT NULL,
	"encrypted_master_key" text,
	"encrypted_master_key_nonce" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"subscription_tier" text DEFAULT 'free',
	"subscription_status" text DEFAULT 'active',
	"subscription_expires_at" timestamp,
	"trial_ends_at" timestamp,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"storage_quota_bytes" integer DEFAULT 2147483648,
	"storage_used_bytes" integer DEFAULT 0,
	"reset_token" text,
	"reset_token_expires" timestamp,
	"is_banned" integer DEFAULT 0,
	"role" text DEFAULT 'user',
	"last_accessed_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_crypto" ADD CONSTRAINT "user_crypto_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;