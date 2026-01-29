import { db } from '../db';
import { files as filesTable, users, fileChunks } from '../db/schema';
import { eq, and, sql, isNull, inArray, or } from 'drizzle-orm';
import fs from 'fs';
import logger from '../utils/logger';

/**
 * UploadCleanupService
 * Automatically monitors and cleans up "stale" uploads that never finished.
 * This ensures that if a user closes their browser or loses connection, 
 * the "pending" records and reserved quota are eventually released.
 */
export class UploadCleanupService {
    private static interval: NodeJS.Timeout | null = null;
    private static readonly STALE_THRESHOLD_HOURS = 24;
    private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

    static start() {
        if (this.interval) return;
        logger.info('[CLEANUP-SERVICE] Starting stale upload guardian...');
        // Run once on startup after 30 seconds
        setTimeout(() => this.cleanup(), 30000);
        this.interval = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL_MS);
    }

    static stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    private static async cleanup() {
        logger.info('[CLEANUP-SERVICE] Scanning for stale uploads...');

        try {
            // 1. Find files in 'pending-chunks' or 'pending' state older than threshold
            const staleFiles = await db.select({
                id: filesTable.id,
                userId: filesTable.userId,
                file_size: filesTable.file_size
            })
                .from(filesTable)
                .innerJoin(users, eq(filesTable.userId, users.id))
                .where(and(
                    or(
                        eq(filesTable.jackal_fid, 'pending-chunks'),
                        eq(filesTable.jackal_fid, 'pending')
                    ),
                    sql`${filesTable.created_at} < now() - interval '24 hours'`
                ));

            if (staleFiles.length === 0) {
                logger.debug('[CLEANUP-SERVICE] No stale uploads found.');
                return;
            }

            logger.info(`[CLEANUP-SERVICE] Found ${staleFiles.length} stale uploads. Cleaning up...`);

            for (const file of staleFiles) {
                const fileId = file.id;
                const userId = file.userId;

                logger.info(`[CLEANUP-SERVICE] Reclaiming record ${fileId} for user ${userId}`);

                // A. Reclaim Quota
                await db.update(users)
                    .set({ storage_used_bytes: sql`${users.storage_used_bytes} - ${file.file_size}` })
                    .where(eq(users.id, userId));

                // B. Hard Delete Local Chunks
                const chunks = await db.select({ local_path: fileChunks.local_path }).from(fileChunks).where(eq(fileChunks.fileId, fileId));
                for (const chunk of chunks) {
                    if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                        try {
                            fs.unlinkSync(chunk.local_path);
                        } catch (err) {
                            logger.error(`[CLEANUP-SERVICE] Failed to delete chunk file: ${chunk.local_path}`, err);
                        }
                    }
                }
                await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));

                // D. Hard Delete File Record
                await db.delete(filesTable).where(eq(filesTable.id, fileId));

                logger.info(`[CLEANUP-SERVICE] ✅ Successfully purged stale upload ${fileId}`);
            }

        } catch (error) {
            logger.error('[CLEANUP-SERVICE] ❌ Fatal error during cleanup cycle:', error);
        }
    }
}
