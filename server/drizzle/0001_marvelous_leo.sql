ALTER TABLE "files" ALTER COLUMN "file_size" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "user_crypto" ALTER COLUMN "metadata_blob" SET DATA TYPE bytea USING metadata_blob::bytea;--> statement-breakpoint
ALTER TABLE "user_crypto" ALTER COLUMN "encrypted_master_key" SET DATA TYPE bytea USING encrypted_master_key::bytea;--> statement-breakpoint
ALTER TABLE "user_crypto" ALTER COLUMN "encrypted_master_key_nonce" SET DATA TYPE bytea USING encrypted_master_key_nonce::bytea;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "storage_quota_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "storage_quota_bytes" SET DEFAULT 2147483648;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "storage_used_bytes" SET DATA TYPE bigint;