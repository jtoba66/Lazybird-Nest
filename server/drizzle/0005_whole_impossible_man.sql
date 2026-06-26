-- Additive migration: Stripe-webhook idempotency table + performance indexes on hot
-- FK/lookup columns. Hand-cleaned from the drizzle-generated diff to drop statements
-- that re-create objects already present in the live DB (refresh_tokens table, the
-- file_origin/upload_session_id/folders.deleted_at columns, and the refresh_tokens FK
-- were applied earlier via `drizzle-kit push` and are not in the migration journal).
-- Everything here is idempotent (IF NOT EXISTS), so it is safe to (re)apply.
--
-- PROD NOTE: a plain CREATE INDEX briefly write-locks the table while it builds. On
-- large tables, run these as CREATE INDEX CONCURRENTLY (cannot be inside a txn) or
-- deploy during low traffic.

CREATE TABLE IF NOT EXISTS "processed_stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_previous_token_idx" ON "refresh_tokens" USING btree ("previous_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_type_timestamp_idx" ON "analytics_events" USING btree ("type","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_folders_user_id_idx" ON "collab_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_guest_sessions_collab_id_idx" ON "collab_guest_sessions" USING btree ("collab_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_otp_sessions_collab_email_idx" ON "collab_otp_sessions" USING btree ("collab_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drop_zones_user_id_idx" ON "drop_zones" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_user_id_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_folder_id_idx" ON "files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_deleted_at_idx" ON "files" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_user_id_idx" ON "folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_parent_id_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_stripe_customer_id_idx" ON "users" USING btree ("stripe_customer_id");
