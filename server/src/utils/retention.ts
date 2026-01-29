import { db } from '../db';
import { users, files, folders, userCrypto } from '../db/schema';
import { eq, and, sql, lt, ne, isNull, isNotNull } from 'drizzle-orm';
import logger from '../utils/logger';
import crypto from 'crypto';

/**
 * Automated Data Retention Service
 * Implements "Right to be Forgotten" by scrubbing inactive accounts.
 * Policy: 2 years of inactivity = Automated Scrub.
 */
export async function runAccountRetentionPolicy() {
    logger.info('[RETENTION] Running data retention sweep...');

    try {
        // 1. Find inactive users (default: 2 years)
        const inactiveUsers = await db.select({ id: users.id, email: users.email })
            .from(users)
            .where(and(
                sql`${users.last_accessed_at} < now() - interval '2 years'`,
                eq(users.is_banned, 0),
                ne(users.role, 'admin')
            ));

        if (inactiveUsers.length === 0) {
            logger.info('[RETENTION] No inactive accounts found for cleanup.');
            return;
        }

        logger.warn(`[RETENTION] Found ${inactiveUsers.length} inactive accounts to scrub.`);

        for (const user of inactiveUsers) {
            const userId = user.id;
            try {
                // A. Delete local-only files
                await db.delete(files).where(and(eq(files.userId, userId), isNull(files.merkle_hash)));

                // B. Soft Delete Jackal-linked files (Move to Graveyard)
                await db.update(files)
                    .set({
                        deleted_at: new Date(),
                        folderId: null,
                        share_token: null,
                        encrypted_file_path: null
                    })
                    .where(and(
                        eq(files.userId, userId),
                        isNotNull(files.merkle_hash),
                        ne(files.merkle_hash, 'UNKNOWN')
                    ));

                // C. Wipe Metadata & Structure
                await db.delete(folders).where(eq(folders.userId, userId));
                await db.delete(userCrypto).where(eq(userCrypto.userId, userId));

                // D. Anonymize User
                const anonymousEmail = `inactive_deleted_${userId}_${crypto.randomBytes(4).toString('hex')}@nest.internal`;
                await db.update(users)
                    .set({
                        email: anonymousEmail,
                        password_hash: 'DELETED',
                        is_banned: 1,
                        storage_used_bytes: 0
                    })
                    .where(eq(users.id, userId));

                logger.info(`[RETENTION] ✅ Scrubbed inactive account ${userId} (${user.email})`);
            } catch (err: any) {
                logger.error(`[RETENTION] ❌ Failed to scrub user ${userId}:`, err.message);
            }
        }

    } catch (err: any) {
        logger.error('[RETENTION] ❌ Critical error during retention sweep:', err.message);
    }
}

export function initRetentionWorker() {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    setTimeout(() => runAccountRetentionPolicy(), 60000);
    setInterval(() => runAccountRetentionPolicy(), TWENTY_FOUR_HOURS);
    logger.info('[RETENTION] Worker initialized (24h period)');
}
