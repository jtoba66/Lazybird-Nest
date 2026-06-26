import logger from '../utils/logger';
import { db } from '../db';
import { files, fileChunks, graveyard, graveyardChunks, users, analyticsEvents, folders } from '../db/schema';
import { eq, and, isNotNull, sql, lt, inArray } from 'drizzle-orm';
import { getStorageProvider } from '../storage';
import fs from 'fs';

/**
 * Auto-Purge Trash: permanently purge files soft-deleted more than 30 days ago.
 * FIX #1: Threshold corrected from 24 hours → 30 days.
 * FIX #2: Now calls provider.delete() to actually remove bytes from the storage backend.
 * FIX #3: Now supports "True Nest" recursive trashing. Finds expired top-level folders, recursively gathers all nested files, and hard deletes the folders.
 * Runs every hour via cron in server.ts.
 */
export async function autoPurgeTrash() {
    try {
        logger.info('[CRON] Starting auto-purge trash cleanup...');

        const PURGE_THRESHOLD = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // 1. Gather all individually deleted files
        const expiredFiles = await db.select()
            .from(files)
            .where(and(
                isNotNull(files.deleted_at),
                lt(files.deleted_at, PURGE_THRESHOLD)))
            .limit(100);

        // 2. Gather all expired folders
        const expiredFolders = await db.select()
            .from(folders)
            .where(and(
                isNotNull(folders.deleted_at),
                lt(folders.deleted_at, PURGE_THRESHOLD)
            ))
            .limit(50);

        // We will store folder IDs to delete AFTER their files are successfully deleted
        const folderIdsToHardDelete: number[] = [];

        for (const folder of expiredFolders) {
            try {
                // Find folder and all subfolders using CTE
                const descendants = await db.execute(sql`
                    WITH RECURSIVE subfolders AS (
                        SELECT id FROM folders WHERE id = ${folder.id}
                        UNION ALL
                        SELECT f.id FROM folders f
                        INNER JOIN subfolders s ON f.parent_id = s.id
                    )
                    SELECT id FROM subfolders
                `);
                const descendantRows = Array.isArray(descendants) ? descendants : (descendants as any).rows || [];
                const folderIds = descendantRows.map((r: any) => Number(r.id));

                if (folderIds.length > 0) {
                    folderIdsToHardDelete.push(...folderIds);

                    // Fetch all files across all subfolders
                    const nestedFiles = await db.select().from(files)
                        .where(inArray(files.folderId, folderIds));

                    // Add them to the execution queue if they aren't already in there
                    for (const nf of nestedFiles) {
                        if (!expiredFiles.find(ef => ef.id === nf.id)) {
                            expiredFiles.push(nf);
                        }
                    }
                }
            } catch (error: any) {
                logger.error(`[CRON] Failed to gather recursive files for folder ${folder.id}:`, error.message);
            }
        }

        if (expiredFiles.length === 0 && folderIdsToHardDelete.length === 0) {
            logger.info('[CRON] No expired trash items found');
            return;
        }

        logger.info(`[CRON] Found ${expiredFiles.length} expired files and ${folderIdsToHardDelete.length} expired folders to purge`);

        // 3. Hard delete all gathered files
        for (const file of expiredFiles) {
            try {
                // Delete from storage backend BEFORE removing from DB.
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

                // Pre-fetch chunks before they are cascade-deleted by the transaction
                const diskChunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));

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

                        if (file.is_chunked && diskChunks.length > 0) {
                            await tx.insert(graveyardChunks).values(
                                diskChunks.map(c => ({
                                    graveyard_id: gv.id,
                                    chunk_index: c.chunk_index,
                                    jackal_merkle: (c as any).obsideo_key ?? c.jackal_merkle,
                                    size: c.size
                                }))
                            );
                        }
                    }

                    await tx.delete(files).where(eq(files.id, file.id));

                    await tx.update(users)
                        .set({ storage_used_bytes: sql`GREATEST(0, ${users.storage_used_bytes} - ${file.file_size})` })
                        .where(eq(users.id, file.userId));
                });

                // Cleanup any remaining local disk files (with individual try/catch blocks so one failure doesn't skip the rest)
                if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                    try { 
                        fs.unlinkSync(file.encrypted_file_path); 
                    } catch (e: any) { 
                        logger.error(`[CRON] Failed to delete encrypted_file_path for file_id=${file.id}: ${e.message}`); 
                    }
                }

                for (const chunk of diskChunks) {
                    if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                        try { 
                            fs.unlinkSync(chunk.local_path); 
                        } catch (e: any) { 
                            logger.error(`[CRON] Failed to delete chunk file for file_id=${file.id}: ${e.message}`); 
                        }
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

        // 4. Hard delete the expired folders (using a unique set to prevent duplicate deletes)
        if (folderIdsToHardDelete.length > 0) {
            const uniqueFolderIds = [...new Set(folderIdsToHardDelete)];
            await db.delete(folders).where(inArray(folders.id, uniqueFolderIds));
            logger.info(`[CRON] Hard deleted ${uniqueFolderIds.length} expired folders.`);
        }

        logger.info(`[CRON] Auto-purge trash complete.`);
    } catch (error: any) {
        logger.error('[CRON] Auto-purge trash failed:', error);
    }
}
