import logger from '../utils/logger';
import { db } from '../db';
import { files, fileChunks, graveyard, graveyardChunks, users, analyticsEvents } from '../db/schema';
import { eq, and, isNotNull, sql, lt } from 'drizzle-orm';
import fs from 'fs';

/**
 * Fix #6 (Auto-Prune Trash): Automatically delete files older than 24 hours in trash
 * Runs every hour to enforce the 24-hour trash retention policy
 */
export async function autoPurgeTrash() {
    try {
        logger.info('[CRON] Starting auto-purge trash cleanup...');

        // Find files soft-deleted more than 24 hours ago
        const PURGE_THRESHOLD = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

        const expiredFiles = await db.select()
            .from(files)
            .where(and(
                isNotNull(files.deleted_at),
                lt(files.deleted_at, PURGE_THRESHOLD)))
            .limit(100); // Process in batches to avoid overwhelming the DB

        if (expiredFiles.length === 0) {
            logger.info('[CRON] No expired trash items found');
            return;
        }

        logger.info(`[CRON] Found ${expiredFiles.length} expired trash items to purge`);

        for (const file of expiredFiles) {
            try {
                // Transaction: graveyard archival + deletion (reuses existing permanent delete logic)
                await db.transaction(async (tx) => {
                    // Archive to Graveyard (if it has Jackal data)
                    if (file.jackal_fid || file.merkle_hash) {
                        const [gv] = await tx.insert(graveyard).values({
                            original_file_id: file.id,
                            user_id: file.userId,
                            filename: file.jackal_filename || 'unknown',
                            file_size: file.file_size,
                            jackal_fid: file.jackal_fid,
                            merkle_hash: file.merkle_hash,
                            deletion_reason: 'auto_purge_24h'
                        }).returning({ id: graveyard.id });

                        // Archive chunks if any
                        if (file.is_chunked) {
                            const chunks = await tx.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                            if (chunks.length > 0) {
                                await tx.insert(graveyardChunks).values(
                                    chunks.map(c => ({
                                        graveyard_id: gv.id,
                                        chunk_index: c.chunk_index,
                                        jackal_merkle: c.jackal_merkle,
                                        size: c.size
                                    }))
                                );
                            }
                        }
                    }

                    // Delete file from DB
                    await tx.delete(files).where(eq(files.id, file.id));
                });

                // Cleanup physical files (outside transaction)
                if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                    fs.unlinkSync(file.encrypted_file_path);
                }

                // Cleanup chunks
                const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                for (const chunk of chunks) {
                    if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                        fs.unlinkSync(chunk.local_path);
                    }
                }

                // Update quota (decrement now that it's permanently deleted)
                await db.update(users)
                    .set({ storage_used_bytes: sql`GREATEST(0, ${users.storage_used_bytes} - ${file.file_size})` })
                    .where(eq(users.id, file.userId));

                // Log analytics event for storage purge
                await db.insert(analyticsEvents).values({
                    type: 'prune',
                    bytes: -file.file_size,
                    meta: `auto_purge_file_${file.id}`
                });

                logger.info(`[CRON] Auto-purged file_id=${file.id}, freed ${file.file_size} bytes from user ${file.userId}`);
            } catch (error: any) {
                logger.error(`[CRON] Failed to purge file_id=${file.id}:`, error.message);
            }
        }

        logger.info(`[CRON] Auto-purge trash complete. Purged ${expiredFiles.length} files`);
    } catch (error: any) {
        logger.error('[CRON] Auto-purge trash failed:', error);
    }
}
