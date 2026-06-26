import express from 'express';
import fs from 'fs';
import { db } from '../db';
import { folders, files, fileChunks, users, graveyard, graveyardChunks } from '../db/schema';
import { eq, and, isNull, isNotNull, inArray, sql, or, like, gte } from 'drizzle-orm';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getStorageProvider } from '../storage';
import logger from '../utils/logger';
import { bufferToBase64, base64ToBuffer } from '../crypto/keyManagement';

const router = express.Router();

// ============================================================================
// CREATE FOLDER (DB Record Only)
// ============================================================================

router.post('/create', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const { parentId, folderKeyEncrypted, folderKeyNonce, pathHash } = req.body;

    try {
        if (parentId && parentId !== '0') {
            const [parent] = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, parentId), eq(folders.userId, userId))).limit(1);
            if (!parent) return res.status(404).json({ error: 'Parent folder not found' });
        }

        const [newFolder] = await db.insert(folders).values({
            userId,
            parentId: parentId && parentId !== '0' ? parseInt(parentId) : null,
            folder_key_encrypted: folderKeyEncrypted ? base64ToBuffer(folderKeyEncrypted) : null as any,
            folder_key_nonce: folderKeyNonce ? base64ToBuffer(folderKeyNonce) : null as any,
            path_hash: pathHash || null
        }).returning({ id: folders.id });

        logger.info(`[FOLDER-CREATE] Created DB record: ${newFolder.id}`);

        res.json({
            success: true,
            folder_id: newFolder.id
        });

    } catch (error) {
        logger.error('[FOLDER-CREATE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to create folder record' });
    }
});

// ============================================================================
// LIST FOLDERS (IDs and Stats Only - NO NAMES)
// ============================================================================

router.get('/list', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const { parentId, includeSystem } = req.query;
    const shouldIncludeSystem = includeSystem === 'true';

    try {
        let folderList;
        if (parentId !== undefined) {
            const parentIdValue = parentId === 'null' || parentId === '0' ? null : parseInt(parentId as string);
            folderList = await db.select()
                .from(folders)
                .where(and(
                    eq(folders.userId, userId),
                    parentIdValue === null 
                        ? (shouldIncludeSystem ? isNull(folders.parentId) : and(isNull(folders.parentId), or(isNull(folders.path_hash), like(folders.path_hash, 'collab_%')))) 
                        : eq(folders.parentId, parentIdValue),
                    isNull(folders.deleted_at)
                ))
                .orderBy(folders.created_at);
        } else {
            folderList = await db.select()
                .from(folders)
                .where(and(
                    eq(folders.userId, userId), 
                    isNull(folders.deleted_at), 
                    shouldIncludeSystem ? undefined : or(isNull(folders.path_hash), like(folders.path_hash, 'collab_%'))
                ))
                .orderBy(folders.created_at);
        }

        const folderIds = folderList.map(f => f.id);
        const fileStatsMap = new Map<number, { count: number, total_size: number }>();
        const subfolderCountMap = new Map<number, number>();

        if (folderIds.length > 0) {
            // Bulk fetch file stats
            const allFileStats = await db.select({
                folderId: files.folderId,
                count: sql<number>`count(*)`,
                total_size: sql<number>`coalesce(sum(${files.file_size}), 0)`
            }).from(files).where(and(
                eq(files.userId, userId),
                inArray(files.folderId, folderIds),
                isNull(files.deleted_at)
            )).groupBy(files.folderId);

            allFileStats.forEach(stat => {
                if (stat.folderId) {
                    fileStatsMap.set(stat.folderId, {
                        count: Number(stat.count),
                        total_size: Number(stat.total_size)
                    });
                }
            });

            // Bulk fetch subfolder counts
            const allSubfolderStats = await db.select({
                parentId: folders.parentId,
                count: sql<number>`count(*)`
            }).from(folders).where(and(
                eq(folders.userId, userId),
                inArray(folders.parentId, folderIds),
                isNull(folders.deleted_at)
            )).groupBy(folders.parentId);

            allSubfolderStats.forEach(stat => {
                if (stat.parentId) {
                    subfolderCountMap.set(stat.parentId, Number(stat.count));
                }
            });
        }

        const foldersWithStats = folderList.map(folder => {
            const fStats = fileStatsMap.get(folder.id) || { count: 0, total_size: 0 };
            const sCount = subfolderCountMap.get(folder.id) || 0;

            return {
                id: folder.id,
                parent_id: folder.parentId,
                name: `Folder ${folder.id}`,
                created_at: folder.created_at,
                file_count: fStats.count,
                subfolder_count: sCount,
                folder_size: fStats.total_size,
                encrypted_folder_name: folder.encrypted_folder_name
            };
        });

        res.json({ folders: foldersWithStats });

    } catch (error) {
        logger.error('[FOLDER-LIST] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to list folders' });
    }
});

// ============================================================================
// DELETE FOLDER
// ============================================================================

router.delete('/:folderId', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const folderId = parseInt(req.params.folderId);

    try {
        // Gather the folder subtree so we can cascade the trash to the files inside it.
        // Without this, a "deleted" folder's files keep deleted_at = NULL and stay
        // downloadable / shareable (every file + share endpoint checks the FILE's flag,
        // not the folder's) — so trashing a folder wouldn't revoke a share on a file in it.
        const descendants = await db.execute(sql`
            WITH RECURSIVE subfolders AS (
                SELECT id FROM folders WHERE id = ${folderId} AND user_id = ${userId}
                UNION ALL
                SELECT f.id FROM folders f INNER JOIN subfolders s ON f.parent_id = s.id
            )
            SELECT id FROM subfolders
        `);
        const descendantRows = Array.isArray(descendants) ? descendants : (descendants as any).rows || [];
        const subtreeIds = descendantRows.map((r: any) => Number(r.id));
        if (subtreeIds.length === 0) return res.status(404).json({ error: 'Folder not found' });

        const now = new Date();
        await db.transaction(async (tx) => {
            // Cascade trash to currently-live files in the subtree. Only touch files that
            // aren't already trashed, so an independently-trashed file keeps its own
            // deleted_at (and restore can leave it in the trash).
            await tx.update(files)
                .set({ deleted_at: now })
                .where(and(inArray(files.folderId, subtreeIds), isNull(files.deleted_at)));
            // Soft-delete the parent folder; subfolders stay hidden via the ancestor.
            await tx.update(folders)
                .set({ deleted_at: now })
                .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
        });

        logger.info(`[FOLDER-DELETE] Soft-deleted folder ${folderId} + cascaded trash across ${subtreeIds.length} folders`);
        res.json({ success: true, message: 'Folder moved to trash.' });

    } catch (error) {
        logger.error('[FOLDER-DELETE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to delete folder' });
    }
});

// ============================================================================
// TRASH ENDPOINTS
// ============================================================================

router.get('/trash', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    try {
        const trashedFolders = await db.select()
            .from(folders)
            .where(and(
                eq(folders.userId, userId),
                isNotNull(folders.deleted_at)
            ))
            .orderBy(folders.deleted_at);
        res.json({ folders: trashedFolders });
    } catch (error) {
        logger.error('[FOLDER-TRASH] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to fetch trashed folders' });
    }
});

router.post('/restore/:folderId', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const folderId = parseInt(req.params.folderId);

    try {
        const [folder] = await db.select().from(folders)
            .where(and(eq(folders.id, folderId), eq(folders.userId, userId))).limit(1);
        if (!folder || !folder.deleted_at) return res.status(404).json({ error: 'Trashed folder not found' });
        const folderDeletedAt = folder.deleted_at;

        // Subtree to restore the files that were cascade-trashed with this folder.
        const descendants = await db.execute(sql`
            WITH RECURSIVE subfolders AS (
                SELECT id FROM folders WHERE id = ${folderId} AND user_id = ${userId}
                UNION ALL
                SELECT f.id FROM folders f INNER JOIN subfolders s ON f.parent_id = s.id
            )
            SELECT id FROM subfolders
        `);
        const descendantRows = Array.isArray(descendants) ? descendants : (descendants as any).rows || [];
        const subtreeIds = descendantRows.map((r: any) => Number(r.id));

        await db.transaction(async (tx) => {
            // Restore only files trashed at/after the folder's trash time (the cascade set);
            // files trashed independently earlier stay in the trash.
            if (subtreeIds.length > 0) {
                await tx.update(files)
                    .set({ deleted_at: null })
                    .where(and(inArray(files.folderId, subtreeIds), gte(files.deleted_at, folderDeletedAt)));
            }
            // Restoring the parent folder natively restores the entire intact tree.
            await tx.update(folders)
                .set({ deleted_at: null })
                .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
        });

        res.json({ success: true, message: 'Folder restored.' });
    } catch (error) {
        logger.error('[FOLDER-RESTORE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to restore folder' });
    }
});

// ============================================================================
// PERMANENT DELETE
// ============================================================================

router.delete('/:folderId/permanent', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const folderId = parseInt(req.params.folderId);

    try {
        // 1. Fetch folder and all subfolders using CTE
        const descendants = await db.execute(sql`
            WITH RECURSIVE subfolders AS (
                SELECT id FROM folders WHERE id = ${folderId} AND user_id = ${userId}
                UNION ALL
                SELECT f.id FROM folders f
                INNER JOIN subfolders s ON f.parent_id = s.id
            )
            SELECT id FROM subfolders
        `);
        const descendantRows = Array.isArray(descendants) ? descendants : (descendants as any).rows || [];
        const folderIdsToDelete = descendantRows.map((r: any) => Number(r.id));

        if (folderIdsToDelete.length === 0) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        // Fetch all files across all subfolders
        const filesToDelete = await db.select().from(files)
            .where(and(inArray(files.folderId, folderIdsToDelete), eq(files.userId, userId)));

        // 2. Permanently delete each file: remove the bytes from the storage backend,
        //    archive to graveyard, clean local temp copies, then delete DB rows and
        //    decrement quota (floored at 0). Mirrors DELETE /files/:id/permanent so the
        //    folder path no longer orphans bytes on storage or drives quota negative.
        for (const file of filesToDelete) {
            const provider = getStorageProvider(file.storage_provider);
            const storageKey = file.obsideo_key ?? file.jackal_fid;
            const chunks = file.is_chunked
                ? await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id))
                : [];

            // Delete bytes from the storage backend BEFORE removing DB rows.
            if (storageKey && !['pending', 'pending-chunks', 'chunked-complete'].includes(storageKey)) {
                if (file.is_chunked) {
                    for (const chunk of chunks) {
                        const chunkKey = chunk.obsideo_key ?? chunk.jackal_merkle;
                        if (chunkKey && chunkKey !== 'pending') {
                            const deleted = await provider.delete(chunkKey);
                            if (!deleted) logger.warn(`[FOLDER-PERM-DEL] Storage delete failed for chunk key ${chunkKey} (file ${file.id})`);
                        }
                    }
                } else {
                    const deleted = await provider.delete(storageKey);
                    if (!deleted) logger.warn(`[FOLDER-PERM-DEL] Storage delete failed for key ${storageKey} (file ${file.id})`);
                }
            }

            // Archive to graveyard + delete rows + decrement quota atomically.
            await db.transaction(async (tx) => {
                if (file.jackal_fid || file.merkle_hash || file.obsideo_key) {
                    const [gv] = await tx.insert(graveyard).values({
                        original_file_id: file.id,
                        user_id: file.userId,
                        filename: file.jackal_filename || 'unknown',
                        file_size: file.file_size,
                        jackal_fid: file.obsideo_key ?? file.jackal_fid,
                        merkle_hash: file.merkle_hash,
                        deletion_reason: 'user_permanent_delete'
                    }).returning({ id: graveyard.id });

                    if (chunks.length > 0) {
                        await tx.insert(graveyardChunks).values(
                            chunks.map(c => ({
                                graveyard_id: gv.id,
                                chunk_index: c.chunk_index,
                                jackal_merkle: c.obsideo_key ?? c.jackal_merkle,
                                size: c.size
                            }))
                        );
                    }
                }

                await tx.delete(fileChunks).where(eq(fileChunks.fileId, file.id));
                await tx.delete(files).where(eq(files.id, file.id));
                await tx.update(users)
                    .set({ storage_used_bytes: sql`GREATEST(0, ${users.storage_used_bytes} - ${file.file_size})` })
                    .where(eq(users.id, userId));
            });

            // Clean any lingering local temp copies (best-effort).
            try {
                if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) fs.unlinkSync(file.encrypted_file_path);
                for (const chunk of chunks) {
                    if (chunk.local_path && fs.existsSync(chunk.local_path)) fs.unlinkSync(chunk.local_path);
                }
            } catch (e: any) {
                logger.warn(`[FOLDER-PERM-DEL] Local temp cleanup issue for file ${file.id}: ${e.message}`);
            }
        }

        // 3. Delete the folder records (hard delete). 
        // This will cascade and delete associated dropZones and collabFolders records.
        await db.delete(folders).where(inArray(folders.id, folderIdsToDelete));

        res.json({ success: true, message: 'Folder permanently deleted.' });
    } catch (error) {
        logger.error('[FOLDER-PERM-DELETE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to permanently delete folder' });
    }
});

// ============================================================================
// GET FOLDER KEY (Proxy for retrieving encrypted keys)
// ============================================================================

router.get('/:folderId/key', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const folderId = req.params.folderId;

    try {
        let folder;
        if (folderId === 'null' || folderId === 'root' || !folderId || folderId === '0') {
            [folder] = await db.select().from(folders).where(and(eq(folders.userId, userId), isNull(folders.parentId))).limit(1);
        } else {
            [folder] = await db.select().from(folders).where(and(eq(folders.id, parseInt(folderId)), eq(folders.userId, userId))).limit(1);
        }

        if (!folder) return res.status(404).json({ error: 'Folder not found' });

        res.json({
            key: bufferToBase64(folder.folder_key_encrypted),
            nonce: bufferToBase64(folder.folder_key_nonce)
        });

    } catch (error) {
        logger.error('[FOLDER-KEY] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to get folder key' });
    }
});

router.put('/:folderId/move', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const folderId = parseInt(req.params.folderId);
    const { newParentId } = req.body;

    try {
        // Validate ownership
        const [folder] = await db.select().from(folders)
            .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
            .limit(1);

        if (!folder) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        // Fix L1: Prevent circular folder moves
        if (newParentId !== null) {
            // Check if newParentId is a descendant of folderId
            let currentId: number | null = newParentId;
            let depth = 0;
            const maxDepth = 50; // Prevent infinite loops

            while (currentId !== null && depth < maxDepth) {
                if (currentId === folderId) {
                    logger.warn(`[FOLDER-MOVE] Circular move attempt: folder ${folderId} -> parent ${newParentId}`);
                    return res.status(400).json({ error: 'Cannot move folder into its own subfolder (circular reference)' });
                }

                // Get parent of current folder
                const [parent] = await db.select({ parentId: folders.parentId })
                    .from(folders)
                    .where(and(eq(folders.id, currentId), eq(folders.userId, userId)))
                    .limit(1);

                if (!parent) break;
                currentId = parent.parentId;
                depth++;
            }

            // Verify new parent exists
            const [newParent] = await db.select().from(folders)
                .where(and(eq(folders.id, newParentId), eq(folders.userId, userId)))
                .limit(1);

            if (!newParent) {
                return res.status(404).json({ error: 'Target folder not found' });
            }
        }

        // Perform the move
        await db.update(folders)
            .set({ parentId: newParentId })
            .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));

        logger.info(`[FOLDER-MOVE] Moved folder ${folderId} to parent ${newParentId}`);
        res.json({ success: true, message: 'Folder moved successfully' });

    } catch (error) {
        logger.error('[FOLDER-MOVE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to move folder' });
    }
});

export default router;
