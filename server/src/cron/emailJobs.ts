import cron from 'node-cron';
import { db } from '../db';
import { users, files, analyticsEvents } from '../db/schema';
import { eq, and, gt, desc, sql, inArray } from 'drizzle-orm';
import logger from '../utils/logger';
import { sendShareLinkDigestEmail, sendAccountInactiveEmail } from '../services/email';

/**
 * Weekly Share Link Digest
 * Runs every Monday at 9:00 AM UTC
 */
export const shareLinkDigestJob = cron.schedule('0 9 * * 1', async () => {
    logger.info('[CRON-SHARE-DIGEST] Starting weekly share link digest...');

    try {
        // 1. Get stats for last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Find users who had their files downloaded via share links in last 7 days
        // We look at analytics events of type 'share_download'
        const recentDownloads = await db.select({
            meta: analyticsEvents.meta,
            count: sql<number>`count(*)`
        })
            .from(analyticsEvents)
            .where(and(
                eq(analyticsEvents.type, 'share_download'),
                gt(analyticsEvents.timestamp, sevenDaysAgo)
            ))
            .groupBy(analyticsEvents.meta);

        // Parse meta to get file IDs and aggregate by user
        // Meta format: "file_{fileId}_token_{token}"
        const userDownloads: Record<number, { totalDownloads: number, topFileId: number, maxFileDownloads: number }> = {};

        // This map helps us avoiding N+1 queries for file ownership
        const fileIdToDownloads: Record<number, number> = {};

        for (const record of recentDownloads) {
            const match = record.meta?.match(/file_(\d+)_token/);
            if (match && match[1]) {
                const fileId = parseInt(match[1]);
                fileIdToDownloads[fileId] = (fileIdToDownloads[fileId] || 0) + Number(record.count);
            }
        }

        const fileIds = Object.keys(fileIdToDownloads).map(Number);
        if (fileIds.length === 0) {
            logger.info('[CRON-SHARE-DIGEST] No share downloads this week');
            return;
        }

        // Batch fetch file owners
        // Breaking into chunks of 1000 to avoid query parameter limits if necessary, 
        // but for now simple inArray is fine for moderate scale
        const fileOwners = await db.select({
            fileId: files.id,
            userId: files.userId
        })
            .from(files)
            .where(inArray(files.id, fileIds));

        // Aggregate by user
        for (const file of fileOwners) {
            const downloads = fileIdToDownloads[file.fileId];

            if (!userDownloads[file.userId]) {
                userDownloads[file.userId] = { totalDownloads: 0, topFileId: file.fileId, maxFileDownloads: 0 };
            }

            userDownloads[file.userId].totalDownloads += downloads;

            if (downloads > userDownloads[file.userId].maxFileDownloads) {
                userDownloads[file.userId].maxFileDownloads = downloads;
                userDownloads[file.userId].topFileId = file.fileId;
            }
        }

        // Send Emails
        for (const [userIdStr, stats] of Object.entries(userDownloads)) {
            const userId = parseInt(userIdStr);
            const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);

            if (user?.email) {
                await sendShareLinkDigestEmail(
                    user.email,
                    stats.totalDownloads,
                    stats.maxFileDownloads // Downloads of the most popular file
                ).catch(err => logger.error(`[CRON-SHARE-DIGEST] Failed to send to user ${userId}:`, err));
            }
        }

        logger.info(`[CRON-SHARE-DIGEST] Completed. Sent digests to ${Object.keys(userDownloads).length} users.`);

    } catch (error) {
        logger.error('[CRON-SHARE-DIGEST] ❌ Failed:', error);
    }
});

/**
 * Account Inactive Nudge
 * Runs every Wednesday at 10:00 AM UTC
 * Target: Users inactive for > 30 days
 */
export const accountInactiveJob = cron.schedule('0 10 * * 3', async () => {
    logger.info('[CRON-INACTIVE] Starting inactive user check...');

    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Find users last accessed > 30 days ago AND haven't been emailed recently
        // For simplicity, we'll just check last_accessed_at. 
        // To avoid spamming, we should ideally track 'last_inactive_email_sent_at'
        // For now, let's just query users inactive for 30-37 days (a 1-week specific window) 
        // ensuring they only get it once per inactivity period roughly.

        const thirtySevenDaysAgo = new Date();
        thirtySevenDaysAgo.setDate(thirtySevenDaysAgo.getDate() - 37);

        const inactiveUsers = await db.select({
            id: users.id,
            email: users.email
        })
            .from(users)
            .where(and(
                gt(users.last_accessed_at, thirtySevenDaysAgo),
                sql`${users.last_accessed_at} < ${thirtyDaysAgo}`
            ));

        logger.info(`[CRON-INACTIVE] Found ${inactiveUsers.length} inactive users in the 30-37 day window.`);

        for (const user of inactiveUsers) {
            await sendAccountInactiveEmail(user.email)
                .catch(err => logger.error(`[CRON-INACTIVE] Failed to send to ${user.id}:`, err));
        }

    } catch (error) {
        logger.error('[CRON-INACTIVE] ❌ Failed:', error);
    }
});
