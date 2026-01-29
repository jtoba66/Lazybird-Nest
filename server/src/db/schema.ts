import { pgTable, serial, text, integer, timestamp, boolean, uniqueIndex, foreignKey, decimal, uuid, customType, unique } from 'drizzle-orm/pg-core';
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
    storage_quota_bytes: integer('storage_quota_bytes').default(2147483648), // 2GB for free tier
    storage_used_bytes: integer('storage_used_bytes').default(0),

    // Password Reset
    reset_token: text('reset_token'),
    reset_token_expires: timestamp('reset_token_expires'),

    // Account Management
    is_banned: integer('is_banned').default(0),
    role: text('role').default('user'),
    last_accessed_at: timestamp('last_accessed_at').defaultNow(),
    created_at: timestamp('created_at').defaultNow(),
});

export const userCrypto = pgTable('user_crypto', {
    userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    salt: bytea('salt').notNull(),
    kdf_algorithm: text('kdf_algorithm').default('argon2id'),
    kdf_params: text('kdf_params').notNull(),
    metadata_blob: bytea('metadata_blob').notNull(),
    metadata_nonce: bytea('metadata_nonce').notNull(),
    encrypted_master_key: bytea('encrypted_master_key'),
    encrypted_master_key_nonce: bytea('encrypted_master_key_nonce'),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
});

export const folders = pgTable('folders', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id'),
    path_hash: text('path_hash').notNull(),
    folder_key_encrypted: bytea('folder_key_encrypted').notNull(),
    folder_key_nonce: bytea('folder_key_nonce').notNull(),
    created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
    parentRef: foreignKey({
        columns: [table.parentId],
        foreignColumns: [table.id]
    }).onDelete('cascade')
}));

export const files = pgTable('files', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // Jackal Storage
    jackal_fid: text('jackal_fid'),
    merkle_hash: text('merkle_hash'),
    jackal_filename: text('jackal_filename'),

    // Encrypted File Key
    file_key_encrypted: bytea('file_key_encrypted').notNull(),
    file_key_nonce: bytea('file_key_nonce').notNull(),

    // File Metadata
    file_size: integer('file_size').notNull(),

    // Folder Structure
    folderId: integer('folder_id').references(() => folders.id, { onDelete: 'set null' }),

    // Chunking
    is_chunked: integer('is_chunked').default(0),
    chunk_count: integer('chunk_count').default(0),

    // Share Link
    share_token: text('share_token').unique(),
    share_key_encrypted: bytea('share_key_encrypted'),
    share_key_nonce: bytea('share_key_nonce'),

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
});

export const fileChunks = pgTable('file_chunks', {
    id: text('id').primaryKey(), // UUID
    fileId: integer('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
    chunk_index: integer('chunk_index').notNull(),
    jackal_merkle: text('jackal_merkle'),
    jackal_cid: text('jackal_cid'),
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
