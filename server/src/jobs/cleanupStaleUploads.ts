import logger from '../utils/logger';
import { db } from '../db';
import { files, fileChunks, users } from '../db/schema';
import { eq, and, isNull, sql, lt } from 'drizzle-orm';
import fs from 'fs';

/**
 * Fix #4 (Orphan Chunks): Clean up abandoned chunked uploads
 * Runs every 6 hours to remove files stuck in 'pending-chunks' for 48+ hours
 * This only cleans up server-side orphans, no Jackal interaction
 */
export async function cleanupStaleUploads() {
    try {
        logger.info('[CRON] Starting stale upload cleanup...');

        // Find files stuck in pending-chunks state for 48+ hours
        const STALE_THRESHOLD = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago

        const staleFiles = await db.select()
            .from(files)
            .where(and(
                eq(files.jackal_fid, 'pending-chunks'),
                lt(files.created_at, STALE_THRESHOLD)
            ));

        if (staleFiles.length === 0) {
            logger.info('[CRON] No stale uploads found');
            return;
        }

        logger.info(`[CRON] Found ${staleFiles.length} stale uploads to clean`);

        for (const file of staleFiles) {
            try {
                // 1. Delete associated chunks from disk
                const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));

                for (const chunk of chunks) {
                    if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                        fs.unlinkSync(chunk.local_path);
                        logger.info(`[CRON] Deleted chunk file: ${chunk.local_path}`);
                    }
                }

                // 2. Delete chunk records (cascade will handle this, but explicit is better)
                await db.delete(fileChunks).where(eq(fileChunks.fileId, file.id));

                // 3. Delete file record
                await db.delete(files).where(eq(files.id, file.id));

                // 4. Refund quota to user
                await db.update(users)
                    .set({ storage_used_bytes: sql`GREATEST(0, ${users.storage_used_bytes} - ${file.file_size})` })
                    .where(eq(users.id, file.userId));

                logger.info(`[CRON] Cleaned stale upload file_id=${file.id}, refunded ${file.file_size} bytes to user ${file.userId}`);
            } catch (error: any) {
                logger.error(`[CRON] Failed to clean file_id=${file.id}:`, error.message);
            }
        }

        logger.info(`[CRON] Stale upload cleanup complete. Cleaned ${staleFiles.length} files`);
    } catch (error: any) {
        logger.error('[CRON] Stale upload cleanup failed:', error);
    }
}
