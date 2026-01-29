import { db } from '../db';
import { files as filesTable } from '../db/schema';
import { eq, and, sql, isNotNull, lt } from 'drizzle-orm';
import fs from 'fs';
import logger from '../utils/logger';

/**
 * Trash Reaper Service
 * Automatically purges files that have been in the trash for more than 24 hours.
 */
export class TrashReaperService {
    private static interval: NodeJS.Timeout | null = null;
    private static INTERVAL_MS = 60 * 60 * 1000; // Run once per hour

    static start() {
        if (this.interval) return;
        logger.info('[Reaper] Trash Reaper service started');
        this.purge();
        this.interval = setInterval(() => this.purge(), this.INTERVAL_MS);
    }

    static stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger.info('[Reaper] Trash Reaper service stopped');
        }
    }

    private static async purge() {
        logger.info('[Reaper] Starting trash purge cycle...');
        const startTime = Date.now();

        try {
            // Find files deleted more than 24 hours ago
            const expiredFiles = await db.select({
                id: filesTable.id,
                encrypted_file_path: filesTable.encrypted_file_path,
                file_size: filesTable.file_size,
                userId: filesTable.userId,
                merkle_hash: filesTable.merkle_hash
            })
                .from(filesTable)
                .where(and(
                    isNotNull(filesTable.deleted_at),
                    sql`${filesTable.deleted_at} < now() - interval '24 hours'`
                ));

            if (expiredFiles.length === 0) {
                logger.info('[Reaper] No expired files found in trash');
                return;
            }

            logger.info(`[Reaper] Found ${expiredFiles.length} expired files to purge`);

            for (const file of expiredFiles) {
                try {
                    if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                        fs.unlinkSync(file.encrypted_file_path);
                        logger.info(`[Reaper] Physical delete local file: ${file.encrypted_file_path}`);
                    }

                    await db.delete(filesTable).where(eq(filesTable.id, file.id));
                    logger.info(`[Reaper] Permanent delete record for file ${file.id}`);

                } catch (fileErr: any) {
                    logger.error(`[Reaper] Failed to purge file ${file.id}:`, fileErr.message);
                }
            }

            const duration = Date.now() - startTime;
            logger.info(`[Reaper] Purge cycle completed in ${duration}ms`);

        } catch (err: any) {
            logger.error('[Reaper] Purge cycle failed:', err.message);
        }
    }
}
