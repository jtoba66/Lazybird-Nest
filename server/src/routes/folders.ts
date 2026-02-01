import express from 'express';
import { db } from '../db';
import { folders, files } from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { authenticateToken, AuthRequest } from '../middleware/auth';
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
    const { parentId } = req.query;

    try {
        let folderList;
        if (parentId !== undefined) {
            const parentIdValue = parentId === 'null' || parentId === '0' ? null : parseInt(parentId as string);
            folderList = await db.select()
                .from(folders)
                .where(and(
                    eq(folders.userId, userId),
                    parentIdValue === null ? isNull(folders.parentId) : eq(folders.parentId, parentIdValue)
                ))
                .orderBy(folders.created_at);
        } else {
            folderList = await db.select()
                .from(folders)
                .where(eq(folders.userId, userId))
                .orderBy(folders.created_at);
        }

        // Calculate stats for each folder
        const foldersWithStats = await Promise.all(folderList.map(async (folder) => {
            const [fileStats] = await db.select({
                count: sql<number>`count(*)`,
                total_size: sql<number>`coalesce(sum(${files.file_size}), 0)`
            }).from(files).where(and(
                eq(files.userId, userId),
                eq(files.folderId, folder.id),
                isNull(files.deleted_at)
            ));

            const [subfolderCount] = await db.select({
                count: sql<number>`count(*)`
            }).from(folders).where(and(
                eq(folders.userId, userId),
                eq(folders.parentId, folder.id)
            ));

            return {
                id: folder.id,
                parent_id: folder.parentId,
                name: `Folder ${folder.id}`,
                created_at: folder.created_at,
                file_count: Number(fileStats.count),
                subfolder_count: Number(subfolderCount.count),
                folder_size: Number(fileStats.total_size),
            };
        }));

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
        // Fix #8: Cascade delete - soft-delete all files inside the folder
        await db.update(files)
            .set({ deleted_at: new Date() })
            .where(and(
                eq(files.folderId, folderId),
                eq(files.userId, userId),
                isNull(files.deleted_at) // Only soft-delete files not already in trash
            ));

        // Check for subfolders (still block deletion if has subfolders)
        const [subfolderCount] = await db.select({ count: sql`count(*)` }).from(folders).where(and(eq(folders.parentId, folderId), eq(folders.userId, userId)));
        if (Number(subfolderCount.count) > 0) return res.status(400).json({ error: 'Contains subfolders. Please delete subfolders first.' });

        // Delete the folder itself
        await db.delete(folders).where(and(eq(folders.id, folderId), eq(folders.userId, userId)));

        logger.info(`[FOLDER-DELETE] Deleted folder ${folderId} and moved files to trash`);
        res.json({ success: true, message: 'Folder deleted. Files moved to trash.' });

    } catch (error) {
        logger.error('[FOLDER-DELETE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to delete folder' });
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
