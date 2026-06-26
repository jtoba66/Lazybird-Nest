import { pgTable, serial, text, integer, timestamp, boolean, uniqueIndex, foreignKey, decimal, uuid, customType, unique, bigint, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Custom type for BLOBs in Postgres (bytea)
const bytea = customType<{ data: Buffer }>({
    dataType() {
        return 'bytea';
    },
    toDriver(value: Buffer) {
        return value;
    },
    fromDriver(value: unknown) {
        if (Buffer.isBuffer(value)) return value;
        return Buffer.from(value as any);
    }
});

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    email: text('email').unique().notNull(),
    password_hash: text('password_hash').notNull(),

    // Subscription & Billing
    subscription_tier: text('subscription_tier').default('free'),
    subscription_status: text('subscription_status').default('active'),
    subscription_expires_at: timestamp('subscription_expires_at'),
    trial_ends_at: timestamp('trial_ends_at'),
    stripe_customer_id: text('stripe_customer_id'),
    stripe_subscription_id: text('stripe_subscription_id'),

    // Storage Quota Tracking
    storage_quota_bytes: bigint('storage_quota_bytes', { mode: 'number' }).default(2147483648), // 2GB for free tier
    storage_used_bytes: bigint('storage_used_bytes', { mode: 'number' }).default(0),

    // Password Reset
    reset_token: text('reset_token'),
    reset_token_expires: timestamp('reset_token_expires'),

    // Account Management
    is_banned: integer('is_banned').default(0),
    role: text('role').default('user'),
    last_accessed_at: timestamp('last_accessed_at').defaultNow(),
    created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
    stripeCustomerIdx: index('users_stripe_customer_id_idx').on(table.stripe_customer_id), // webhook lookups
}));

export const userCrypto = pgTable('user_crypto', {
    userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    salt: bytea('salt').notNull(),
    kdf_algorithm: text('kdf_algorithm').default('argon2id'),
    kdf_params: text('kdf_params').notNull(),
    metadata_blob: bytea('metadata_blob').notNull(),
    metadata_nonce: bytea('metadata_nonce').notNull(),
    metadata_version: integer('metadata_version').default(1).notNull(), // Fix #5: Optimistic locking
    encrypted_master_key: bytea('encrypted_master_key'),
    encrypted_master_key_nonce: bytea('encrypted_master_key_nonce'),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
});

export const userDevices = pgTable('user_devices', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    device_hash: text('device_hash').notNull(),
    ip_address: text('ip_address').notNull(),
    user_agent: text('user_agent').notNull(),
    last_seen_at: timestamp('last_seen_at').defaultNow(),
    created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
    unq: unique().on(table.userId, table.device_hash)
}));

export const folders = pgTable('folders', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id'),
    path_hash: text('path_hash').notNull(),
    folder_key_encrypted: bytea('folder_key_encrypted').notNull(),
    folder_key_nonce: bytea('folder_key_nonce').notNull(),
    encrypted_folder_name: text('encrypted_folder_name'),
    created_at: timestamp('created_at').defaultNow(),
    deleted_at: timestamp('deleted_at'),
}, (table) => ({
    parentRef: foreignKey({
        columns: [table.parentId],
        foreignColumns: [table.id]
    }).onDelete('cascade'),
    userIdx: index('folders_user_id_idx').on(table.userId),
    parentIdx: index('folders_parent_id_idx').on(table.parentId),
}));

export const files = pgTable('files', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // Storage Provider (migration)
    storage_provider: text('storage_provider').default('jackal').notNull(),
    obsideo_key: text('obsideo_key'),
    migration_status: text('migration_status'), // null | 'migrated' | 'broken'
    purge_after: timestamp('purge_after'),       // set on soft-delete: NOW + 30 days
    file_origin: text('file_origin').default('private').notNull(), // 'private' | 'drop_zone' | 'collab'
    upload_session_id: text('upload_session_id'), // Used for batching recent uploads

    // Jackal Storage
    jackal_fid: text('jackal_fid'),
    merkle_hash: text('merkle_hash'),
    jackal_filename: text('jackal_filename'),

    // Encrypted File Key
    file_key_encrypted: bytea('file_key_encrypted').notNull(),
    file_key_nonce: bytea('file_key_nonce').notNull(),

    // File Metadata
    file_size: bigint('file_size', { mode: 'number' }).notNull(),

    // Folder Structure
    folderId: integer('folder_id').references(() => folders.id, { onDelete: 'set null' }),

    // Chunking
    is_chunked: integer('is_chunked').default(0),
    chunk_count: integer('chunk_count').default(0),

    // Share Link
    share_token: text('share_token').unique(),
    share_key_encrypted: bytea('share_key_encrypted'),
    share_key_nonce: bytea('share_key_nonce'),
    share_password_hash: text('share_password_hash'),
    share_max_downloads: integer('share_max_downloads'),
    share_download_count: integer('share_download_count').default(0).notNull(),
    share_expires_at: timestamp('share_expires_at'),
    share_custom_slug: text('share_custom_slug').unique(),
    encrypted_filename: text('encrypted_filename'),
    encrypted_mime_type: text('encrypted_mime_type'),

    // Timestamps
    created_at: timestamp('created_at').defaultNow(),
    last_accessed_at: timestamp('last_accessed_at'),
    deleted_at: timestamp('deleted_at'),

    // Local Failover / Retry
    encrypted_file_path: text('encrypted_file_path'),
    is_gateway_verified: integer('is_gateway_verified').default(0),
    retry_count: integer('retry_count').default(0),
    last_retry_at: text('last_retry_at'),
    failure_reason: text('failure_reason'),
}, (table) => ({
    userIdx: index('files_user_id_idx').on(table.userId),
    folderIdx: index('files_folder_id_idx').on(table.folderId),
    deletedIdx: index('files_deleted_at_idx').on(table.deleted_at),
}));

export const fileChunks = pgTable('file_chunks', {
    id: text('id').primaryKey(), // UUID
    fileId: integer('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
    chunk_index: integer('chunk_index').notNull(),
    jackal_merkle: text('jackal_merkle'),
    jackal_cid: text('jackal_cid'),
    obsideo_key: text('obsideo_key'),  // Obsideo object key for this chunk
    size: integer('size').notNull(),
    nonce: bytea('nonce').notNull(),
    local_path: text('local_path'),
    is_gateway_verified: integer('is_gateway_verified').default(0),
    retry_count: integer('retry_count').default(0),
    last_retry_at: text('last_retry_at'),
    failure_reason: text('failure_reason'),
    created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
    unq: unique().on(table.fileId, table.chunk_index)
}));

export const graveyard = pgTable('graveyard', {
    id: serial('id').primaryKey(),
    original_file_id: integer('original_file_id'),
    user_id: integer('user_id'), // No reference, keep even if user deleted? Or maybe reference. Let's keep vague for audit.
    filename: text('filename'),
    file_size: bigint('file_size', { mode: 'number' }),
    jackal_fid: text('jackal_fid'),
    merkle_hash: text('merkle_hash'),
    original_created_at: timestamp('original_created_at'),
    deleted_at: timestamp('deleted_at').defaultNow(),
    deletion_reason: text('deletion_reason').default('user_permanent_delete'),
});
export const graveyardChunks = pgTable('graveyard_chunks', {
    id: serial('id').primaryKey(),
    graveyard_id: integer('graveyard_id').notNull().references(() => graveyard.id, { onDelete: 'cascade' }),
    chunk_index: integer('chunk_index').notNull(),
    jackal_merkle: text('jackal_merkle'),
    size: integer('size').notNull(),
    created_at: timestamp('created_at').defaultNow(),
});

export const analyticsEvents = pgTable('analytics_events', {
    id: serial('id').primaryKey(),
    type: text('type').notNull(), // 'upload', 'prune'
    bytes: bigint('bytes', { mode: 'number' }).notNull(), // Positive or Negative
    timestamp: timestamp('timestamp').defaultNow().notNull(),
    meta: text('meta'), // Optional: file_id or description
}, (table) => ({
    typeTimeIdx: index('analytics_events_type_timestamp_idx').on(table.type, table.timestamp),
}));

// ============================================================================
// Advanced Sharing Tables — Collab Folders & Drop Zones
// ============================================================================

export const collabFolders = pgTable('collab_folders', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    folderId: integer('folder_id').notNull().references(() => folders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').notNull().unique(),           // public token in URL
    host_encrypted_collab_key: bytea('host_encrypted_collab_key').notNull(),
    host_collab_key_nonce: bytea('host_collab_key_nonce').notNull(),
    link_encrypted_collab_key: bytea('link_encrypted_collab_key').notNull(),
    link_collab_key_nonce: bytea('link_collab_key_nonce').notNull(),
    require_pin: boolean('require_pin').notNull().default(false),
    pin_hash: text('pin_hash'),
    strict_mode: boolean('strict_mode').notNull().default(false),
    activity_notifications: boolean('activity_notifications').notNull().default(true),
    custom_slug: text('custom_slug').unique(),
    expires_at: timestamp('expires_at'),
    revoked_at: timestamp('revoked_at'),
    created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    userIdx: index('collab_folders_user_id_idx').on(table.userId),
}));

export const collabAccessList = pgTable('collab_access_list', {
    id: serial('id').primaryKey(),
    collabId: integer('collab_id').notNull().references(() => collabFolders.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    added_at: timestamp('added_at').defaultNow().notNull(),
}, (table) => ({
    unq: unique().on(table.collabId, table.email)
}));

export const collabOtpSessions = pgTable('collab_otp_sessions', {
    id: serial('id').primaryKey(),
    collabId: integer('collab_id').notNull().references(() => collabFolders.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    code_hash: text('code_hash').notNull(),          // sha256 of the 6-digit code
    attempts: integer('attempts').notNull().default(0),
    expires_at: timestamp('expires_at').notNull(),
    verified_at: timestamp('verified_at'),
    created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    collabEmailIdx: index('collab_otp_sessions_collab_email_idx').on(table.collabId, table.email),
}));

export const collabGuestSessions = pgTable('collab_guest_sessions', {
    id: serial('id').primaryKey(),
    collabId: integer('collab_id').notNull().references(() => collabFolders.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    session_token: text('session_token').notNull().unique(),   // issued after OTP verification
    expires_at: timestamp('expires_at').notNull(),
    created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    collabIdx: index('collab_guest_sessions_collab_id_idx').on(table.collabId),
}));

export const dropZones = pgTable('drop_zones', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    folderId: integer('folder_id').notNull().references(() => folders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').notNull().unique(),
    drop_public_key: bytea('drop_public_key').notNull(),                 // plaintext ECDH public key
    encrypted_drop_private_key: bytea('encrypted_drop_private_key').notNull(), // private key enc with master_key
    drop_private_key_nonce: bytea('drop_private_key_nonce').notNull(),
    require_pin: boolean('require_pin').notNull().default(false),
    pin_hash: text('pin_hash'),
    upload_notifications: boolean('upload_notifications').notNull().default(true),
    custom_slug: text('custom_slug').unique(),
    expires_at: timestamp('expires_at'),
    revoked_at: timestamp('revoked_at'),
    created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    userIdx: index('drop_zones_user_id_idx').on(table.userId),
}));

export const dropZoneFiles = pgTable('drop_zone_files', {
    id: serial('id').primaryKey(),
    dropZoneId: integer('drop_zone_id').notNull().references(() => dropZones.id, { onDelete: 'cascade' }),
    encrypted_file_key: bytea('encrypted_file_key').notNull(),     // file_key encrypted with drop_public_key
    file_key_nonce: bytea('file_key_nonce').notNull(),
    storage_key: text('storage_key').notNull(),      // key on Obsideo/storage
    file_size: bigint('file_size', { mode: 'number' }).notNull(),
    uploaded_at: timestamp('uploaded_at').defaultNow().notNull(),
});

export const sharedWithMe = pgTable('shared_with_me', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    collabId: integer('collab_id').notNull().references(() => collabFolders.id, { onDelete: 'cascade' }),
    encrypted_collab_key: bytea('encrypted_collab_key').notNull(),   // collab_key re-enc with user's master_key
    collab_key_nonce: bytea('collab_key_nonce').notNull(),
    pinned_at: timestamp('pinned_at').defaultNow().notNull(),
}, (table) => ({
    unq: unique().on(table.userId, table.collabId)
}));

export const shareAuditLog = pgTable('share_audit_log', {
    id: serial('id').primaryKey(),
    share_type: text('share_type').notNull(),          // 'standard_link' | 'drop_zone' | 'collab_folder'
    share_id: integer('share_id').notNull(),       // id from the relevant share table
    action: text('action').notNull(),          // 'view' | 'download' | 'upload' | 'otp_sent' | ...
    actor: text('actor'),                   // email of guest, or user id of host (as string)
    filename: text('filename'),                   // exact filename where relevant (NOT a summary)
    timestamp: timestamp('timestamp').defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    token: text('token').unique().notNull(),
    previousToken: text('previous_token'),
    rotatedAt: timestamp('rotated_at'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
    userIdx: index('refresh_tokens_user_id_idx').on(table.userId),       // family revoke / logout-all
    prevTokenIdx: index('refresh_tokens_previous_token_idx').on(table.previousToken), // grace-period lookup
}));

// Dedup table for Stripe webhook idempotency: an event_id is recorded after it is
// successfully processed, so at-least-once redeliveries / retries are skipped.
export const processedStripeEvents = pgTable('processed_stripe_events', {
    event_id: text('event_id').primaryKey(),
    type: text('type'),
    processed_at: timestamp('processed_at').defaultNow().notNull(),
});
