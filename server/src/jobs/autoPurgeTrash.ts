import logger from '../utils/logger';
import { db } from '../db';
import { files, fileChunks, graveyard, graveyardChunks, users, analyticsEvents } from '../db/schema';
import { eq, and, isNotNull, sql, lt } from 'drizzle-orm';
import { getStorageProvider } from '../storage';
import fs from 'fs';

/**
 * Auto-Purge Trash: permanently purge files soft-deleted more than 30 days ago.
 * FIX #1: Threshold corrected from 24 hours → 30 days.
 * FIX #2: Now calls provider.delete() to actually remove bytes from the storage backend.
 * Runs every hour via cron in server.ts.
 */
export async function autoPurgeTrash() {
    try {
        logger.info('[CRON] Starting auto-purge trash cleanup...');

        // FIX #1: 30 days, not 24 hours
        const PURGE_THRESHOLD = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const expiredFiles = await db.select()
            .from(files)
            .where(and(
                isNotNull(files.deleted_at),
                lt(files.deleted_at, PURGE_THRESHOLD)))
            .limit(100);

        if (expiredFiles.length === 0) {
            logger.info('[CRON] No expired trash items found');
            return;
        }

        logger.info(`[CRON] Found ${expiredFiles.length} expired trash items to purge`);

        for (const file of expiredFiles) {
            try {
                // FIX #2: Delete from storage backend BEFORE removing from DB.
                const provider = getStorageProvider(file.storage_provider);
                const storageKey = (file as any).obsideo_key ?? file.jackal_fid;

                if (storageKey && !['pending', 'pending-chunks', 'chunked-complete'].includes(storageKey)) {
                    if (file.is_chunked) {
                        const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                        for (const chunk of chunks) {
                            const chunkKey = (chunk as any).obsideo_key ?? chunk.jackal_merkle;
                            if (chunkKey && chunkKey !== 'pending') {
                                const deleted = await provider.delete(chunkKey);
                                if (!deleted) logger.warn(`[CRON] Storage delete failed for chunk ${chunkKey} (file ${file.id})`);
                            }
                        }
                    } else {
                        const deleted = await provider.delete(storageKey);
                        if (!deleted) logger.warn(`[CRON] Storage delete failed for key ${storageKey} (file ${file.id})`);
                    }
                }

                // Transaction: graveyard archival + deletion + quota decrement
                await db.transaction(async (tx) => {
                    if (file.jackal_fid || file.merkle_hash || (file as any).obsideo_key) {
                        const [gv] = await tx.insert(graveyard).values({
                            original_file_id: file.id,
                            user_id: file.userId,
                            filename: file.jackal_filename || 'unknown',
                            file_size: file.file_size,
                            jackal_fid: (file as any).obsideo_key ?? file.jackal_fid,
                            merkle_hash: file.merkle_hash,
                            deletion_reason: 'auto_purge_30d'
                        }).returning({ id: graveyard.id });

                        if (file.is_chunked) {
                            const chunks = await tx.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                            if (chunks.length > 0) {
                                await tx.insert(graveyardChunks).values(
                                    chunks.map(c => ({
                                        graveyard_id: gv.id,
                                        chunk_index: c.chunk_index,
                                        jackal_merkle: (c as any).obsideo_key ?? c.jackal_merkle,
                                        size: c.size
                                    }))
                                );
                            }
                        }
                    }

                    await tx.delete(files).where(eq(files.id, file.id));

                    await tx.update(users)
                        .set({ storage_used_bytes: sql`GREATEST(0, ${users.storage_used_bytes} - ${file.file_size})` })
                        .where(eq(users.id, file.userId));
                });

                // Cleanup any remaining local disk files
                if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                    fs.unlinkSync(file.encrypted_file_path);
                }

                const diskChunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                for (const chunk of diskChunks) {
                    if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                        fs.unlinkSync(chunk.local_path);
                    }
                }

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
