// Fix: chunked download 404 - detect is_chunked corruption via jackal_fid
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { injectMasterKey } from '../middleware/sessionKey';
import { db } from '../db';
import { files, folders, users, userCrypto, fileChunks, graveyard, graveyardChunks, analyticsEvents } from '../db/schema';
import { eq, and, isNull, sql, isNotNull, desc, asc, or } from 'drizzle-orm';
import { getJackalHandler, uploadFileToJackal, verifyOnGateway } from '../jackal';
import { getStorageProvider } from '../storage';
import { env } from '../config/env';
import logger from '../utils/logger';
import { uploadQueue } from '../utils/uploadQueue';
import { withTimeout } from '../utils/promise';
import {
    decryptMetadataBlob,
    encryptMetadataBlob,
    bufferToBase64,
    base64ToBuffer
} from '../crypto/keyManagement';

import { uploadLimiter, shareLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import {
    uploadInitSchema,
    moveFileSchema,
    listFilesSchema
} from '../schemas/file';
import {
    sendFileUploadedEmail,
    sendFileUploadFailedEmail,
    sendStorageQuotaWarning
} from '../services/email';
import { sendPushToUser } from '../services/pushNotifications';

const router = express.Router();

// Configure multer for encrypted file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `encrypted-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB limit
});

// ============================================================================
// UPLOAD FILE (v2 with Folder/File Key encryption)
// ============================================================================

router.post('/upload', authenticateToken, uploadLimiter, upload.single('file'), async (req: AuthRequest, res) => {
    const startTime = Date.now();
    const userId = req.user!.userId;

    logger.info(`[FILE-UP] Upload started for user: ${userId}`);

    try {
        const file = req.file;
        const {
            filename,           // Original filename (will be encrypted in metadata)
            folderId,          // Folder ID (null = root)
            fileKeyEncrypted,  // File key encrypted with Folder Key (base64)
            fileKeyNonce,      // Nonce for file key encryption (base64)
        } = req.body;

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        if (!fileKeyEncrypted || !fileKeyNonce) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'Missing encrypted file key' });
        }

        logger.info(`[FILE-UP] File received: ${filename} (${file.size} bytes, folder: ${folderId || 'root'})`);

        // 1. Check storage quota
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

        if (!user) {
            fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'User not found' });
        }

        const isGodMode = req.user?.role === 'admin';

        if (!isGodMode) {
            const TWO_GB = 2 * 1024 * 1024 * 1024;
            const TEN_GB = 10 * 1024 * 1024 * 1024;

            if (user.subscription_tier === 'free' && file.size > TWO_GB) {
                fs.unlinkSync(file.path);
                return res.status(400).json({ error: 'Free tier users cannot upload files larger than 2GB.' });
            }

            if (user.subscription_tier === 'pro' && file.size > TEN_GB) {
                fs.unlinkSync(file.path);
                return res.status(400).json({ error: 'Pro tier users cannot upload files larger than 10GB.' });
            }

            if ((user.storage_used_bytes || 0) + file.size > (user.storage_quota_bytes || 0)) {
                fs.unlinkSync(file.path);
                logger.warn(`[FILE-UP] ❌ Storage quota exceeded for user: ${userId}`);

                // Fix #11: Send quota warning email
                sendStorageQuotaWarning(req.user!.email).catch(console.error);

                return res.status(413).json({
                    error: 'Storage quota exceeded',
                    used: user.storage_used_bytes,
                    quota: user.storage_quota_bytes,
                    needed: file.size
                });
            }
        } else {
            const TEN_GB = 10 * 1024 * 1024 * 1024;
            if (file.size > TEN_GB) {
                fs.unlinkSync(file.path);
                return res.status(400).json({ error: 'God Mode users also have a 10GB individual file limit.' });
            }
            logger.info(`[FILE-UP] 🔓 God-mode bypass for ${req.user.email}`);
        }

        // 2. Validate target folder ownership before insert (skip for null = root)
        if (folderId) {
            const [folder] = await db.select({ id: folders.id })
                .from(folders)
                .where(and(eq(folders.id, parseInt(folderId)), eq(folders.userId, userId)))
                .limit(1);
            if (!folder) {
                fs.unlinkSync(file.path);
                logger.warn(`[FILE-UP] User ${userId} attempted upload to unowned folder ${folderId}`);
                return res.status(403).json({ error: 'Target folder not found or access denied' });
            }
        }

        // 3. Save file metadata to database FIRST
        const [newFile] = await db.insert(files).values({
            userId,
            jackal_fid: 'pending',
            merkle_hash: 'pending',
            jackal_filename: 'pending',
            file_size: file.size,
            folderId: folderId ? parseInt(folderId) : null,
            is_chunked: 0,
            chunk_count: 0,
            file_key_encrypted: base64ToBuffer(fileKeyEncrypted),
            file_key_nonce: base64ToBuffer(fileKeyNonce),
            encrypted_file_path: file.path,
            storage_provider: env.STORAGE_PROVIDER,
        }).returning({ id: files.id });

        const fileId = newFile.id;
        logger.info(`[FILE-UP] File record created with ID: ${fileId}`);

        // Update storage quota
        await db.update(users)
            .set({ storage_used_bytes: sql`${users.storage_used_bytes} + ${file.size}` })
            .where(eq(users.id, userId));

        // Fix #10: Log analytics AFTER quota validated (prevents drift)
        await db.insert(analyticsEvents).values({
            type: 'upload',
            bytes: file.size,
            timestamp: new Date(),
            meta: `file_${fileId}`
        });

        // 7. Queue upload to active storage provider
        const tempFilePath = file.path;
        uploadQueue.add(async () => {
            logger.info(`[FILE-UP-BG] Starting upload task for file ${fileId} via ${env.STORAGE_PROVIDER}`);

            // PRE-FLIGHT CHECK: Verify if already uploaded (e.g. via manual retry)
            try {
                const [freshFile] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
                if (freshFile && freshFile.merkle_hash && freshFile.merkle_hash !== 'pending') {
                    logger.info(`[FILE-UP-BG] File ${fileId} already uploaded. Skipping.`);
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    return;
                }
            } catch (err) {
                logger.error(`[FILE-UP-BG] Pre-flight check failed for ${fileId}`, err);
            }

            try {
                const provider = getStorageProvider();
                const objectKey = `files/${fileId}`;

                const fileSizeMB = file.size / (1024 * 1024);
                const timeoutMs = (15 * 60 * 1000) + (fileSizeMB * 5000);

                const result = await withTimeout(
                    provider.upload(tempFilePath, objectKey),
                    timeoutMs,
                    `Upload timed out after ${Math.round(timeoutMs / 1000)}s`
                );

                await db.update(files)
                    .set({
                        jackal_fid: result.merkle_root,
                        merkle_hash: result.merkle_root,
                        obsideo_key: objectKey,
                        is_gateway_verified: 1,
                        encrypted_file_path: null,
                    })
                    .where(eq(files.id, fileId));

                logger.info(`[FILE-UP-BG] ✅ File ${fileId} uploaded (merkle: ${result.merkle_root})`);

                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            } catch (error: any) {
                logger.error(`[FILE-UP-BG] ❌ File ${fileId} upload failed:`, error.message);
                await db.update(files)
                    .set({
                        retry_count: sql`${files.retry_count} + 1`,
                        last_retry_at: new Date().toISOString(),
                        failure_reason: error.message || 'Upload failed'
                    })
                    .where(eq(files.id, fileId));
            }
        });

        res.json({
            success: true,
            file_id: fileId,
            file_size: file.size
        });

        // 8. Send File Uploaded Email
        sendFileUploadedEmail(req.user!.email).catch(console.error);

        void sendPushToUser(userId, {
            category: 'transfer',
            title: 'Upload queued',
            body: `Nest queued ${filename || `file ${fileId}`} for upload.`,
            data: {
                event: 'upload_queued',
                fileId,
            }
        }).catch((pushError) => {
            logger.error('[FILE-UP] Failed to send transfer push', pushError);
        });

    } catch (error: any) {
        logger.error('[FILE-UP] ❌ Upload failed:', error);
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Upload failed', details: error.message });
    }
});

// ============================================================================
// UPLOAD BITS (Simple Upload for Metadata-First)
// ============================================================================

router.post('/:id/upload', authenticateToken, uploadLimiter, upload.single('file'), async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.id);

    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        const [fileRecord] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!fileRecord) {
            fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'File record not found' });
        }

        // Handle Jackal upload in background
        const tempFilePath = file.path;

        // CRITICAL FIX: Save local path immediately so download works during background upload
        await db.update(files).set({ encrypted_file_path: tempFilePath }).where(eq(files.id, fileId));

        uploadQueue.add(async () => {
            try {
                const provider = getStorageProvider();
                const objectKey = `files/${fileId}`;

                const result = await provider.upload(tempFilePath, objectKey);

                await db.update(files)
                    .set({
                        jackal_fid: result.merkle_root,
                        merkle_hash: result.merkle_root,
                        obsideo_key: objectKey,
                        is_gateway_verified: 1,
                        encrypted_file_path: null
                    })
                    .where(eq(files.id, fileId));

                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            } catch (e: any) {
                logger.error(`[FILE-UP-BITS] ❌ Failed:`, e);
            }
        });

        res.json({ success: true });
    } catch (error: any) {
        if (req.file?.path) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: error.message });
    }
});


// ============================================================================
// LIST FILES
// ============================================================================

router.get('/list', authenticateToken, validate(listFilesSchema), async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const folderIdStr = req.query.folderId as string;

    try {
        let folderId: number | null | undefined = undefined;
        if (folderIdStr !== undefined) {
            folderId = folderIdStr === 'null' ? null : parseInt(folderIdStr);
        }

        console.log(`[DEBUG-LIST] User: ${userId}, Requesting Folder: ${folderId}`);


        const conditions = [
            eq(files.userId, userId),
            isNull(files.deleted_at)
        ];

        if (folderId !== undefined) {
            if (folderId === null) {
                conditions.push(isNull(files.folderId));
            } else {
                conditions.push(eq(files.folderId, folderId));
            }
        }

        const query = db.select({
            id: files.id,
            jackal_fid: files.jackal_fid,
            merkle_hash: files.merkle_hash,
            jackal_filename: files.jackal_filename,
            file_size: files.file_size,
            folder_id: files.folderId,
            share_token: files.share_token,
            created_at: files.created_at,
            last_accessed_at: files.last_accessed_at,
            is_chunked: files.is_chunked,
            chunk_count: files.chunk_count
        }).from(files).where(and(...conditions));


        const fileList = await query.orderBy(desc(files.created_at));

        // Get current metadata version for sync
        const [cryptoData] = await db.select({ v: userCrypto.metadata_version })
            .from(userCrypto)
            .where(eq(userCrypto.userId, userId))
            .limit(1);

        if (cryptoData) {
            res.setHeader('X-Metadata-Version', cryptoData.v.toString());
            res.setHeader('Access-Control-Expose-Headers', 'X-Metadata-Version');
        }

        // Map to include a sanitized/extracted filename
        const mappedFiles = fileList.map(file => ({ ...file, filename: 'Encrypted File' }));

        res.json({ files: mappedFiles });

    } catch (error) {
        logger.error('[FILE-LIST] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to list files' });
    }
});

// ============================================================================
// LIST TRASH (Soft-deleted files)
// ============================================================================

router.get('/trash', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;

    try {
        const trashFiles = await db.select({
            id: files.id,
            jackal_fid: files.jackal_fid,
            merkle_hash: files.merkle_hash,
            jackal_filename: files.jackal_filename,
            file_size: files.file_size,
            folder_id: files.folderId,
            share_token: files.share_token,
            created_at: files.created_at,
            deleted_at: files.deleted_at,
            is_chunked: files.is_chunked,
            chunk_count: files.chunk_count
        })
            .from(files)
            .where(and(eq(files.userId, userId), isNotNull(files.deleted_at)))
            .orderBy(desc(files.deleted_at));

        const mappedTrash = trashFiles.map(file => ({ ...file, filename: 'Encrypted File' }));

        res.json({ files: mappedTrash });
    } catch (error) {
        logger.error('[FILE-TRASH] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to list trash' });
    }
});

// ============================================================================
// RESTORE FILE
// ============================================================================

router.post('/restore/:fileId', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.fileId);

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deleted_at))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found in trash' });

        // Restore: quota unchanged (already counted while in trash)
        await db.update(files).set({ deleted_at: null }).where(eq(files.id, fileId));

        res.json({ success: true, message: 'File restored' });
    } catch (error) {
        logger.error('[FILE-RESTORE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to restore file' });
    }
});

// ============================================================================
// DELETE FILE (Soft Delete)
// ============================================================================

router.delete('/:fileId', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.fileId);

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        // Soft-delete: set deleted_at and purge_after (30 days).
        // Quota is NOT decremented until purge_after fires — files in trash still count against quota.
        const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db.update(files)
            .set({ deleted_at: new Date(), share_token: null, purge_after: purgeAfter })
            .where(eq(files.id, fileId));

        res.json({ success: true, message: 'File deleted' });
    } catch (error) {
        logger.error('[FILE-DEL] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// ============================================================================
// DOWNLOAD FILE (Retrieve decryption info)
// ============================================================================

router.get('/download/:fileId', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.fileId);

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        let folder;
        if (file.folderId) {
            [folder] = await db.select().from(folders).where(and(eq(folders.id, file.folderId), eq(folders.userId, userId))).limit(1);
        } else {
            [folder] = await db.select().from(folders).where(and(eq(folders.userId, userId), isNull(folders.parentId))).limit(1);
        }
        if (!folder) return res.status(500).json({ error: 'Folder context not found' });

        // Fix: Detect chunked files even if is_chunked flag is wrong
        const isActuallyChunked = file.is_chunked || file.jackal_fid === 'chunked-complete';
        const chunks = isActuallyChunked ? await db.select({
            index: fileChunks.chunk_index,
            size: fileChunks.size,
            nonce: fileChunks.nonce,
            jackal_merkle: fileChunks.jackal_merkle,
            obsideo_key: fileChunks.obsideo_key
        }).from(fileChunks).where(eq(fileChunks.fileId, file.id)).orderBy(fileChunks.chunk_index) : undefined;

        res.json({
            success: true,
            file_key_encrypted: bufferToBase64(file.file_key_encrypted),
            file_key_nonce: bufferToBase64(file.file_key_nonce),
            folder_key_encrypted: bufferToBase64(folder.folder_key_encrypted),
            folder_key_nonce: bufferToBase64(folder.folder_key_nonce),
            folder_id: file.folderId,
            jackal_fid: file.obsideo_key ?? file.jackal_fid,
            merkle_hash: file.obsideo_key ?? file.merkle_hash,
            is_gateway_verified: file.storage_provider === 'jackal' ? !!file.is_gateway_verified : false,
            chunks: chunks?.map(c => ({
                index: c.index,
                size: c.size,
                nonce: bufferToBase64(c.nonce),
                jackal_merkle: c.obsideo_key ?? c.jackal_merkle
            }))
        });

    } catch (error) {
        logger.error('[FILE-DL] ❌ Download failed:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// ============================================================================
// MOVE FILE
// ============================================================================

router.put('/:fileId/move', authenticateToken, validate(moveFileSchema), async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.fileId);
    const { folderId, fileKeyEncrypted, fileKeyNonce } = req.body;

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        // Validate target folder ownership (skip for null = root, which is always valid)
        if (folderId !== null && folderId !== undefined) {
            const [folder] = await db.select({ id: folders.id })
                .from(folders)
                .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
                .limit(1);
            if (!folder) {
                logger.warn(`[FILE-MOVE] User ${userId} attempted to move file ${fileId} to unowned folder ${folderId}`);
                return res.status(403).json({ error: 'Target folder not found or access denied' });
            }
        }

        const updateData: any = { folderId: folderId || null };
        if (fileKeyEncrypted && fileKeyNonce) {
            updateData.file_key_encrypted = base64ToBuffer(fileKeyEncrypted);
            updateData.file_key_nonce = base64ToBuffer(fileKeyNonce);
        }

        await db.update(files).set(updateData).where(eq(files.id, fileId));
        res.json({ success: true, message: 'File moved' });
    } catch (error) {
        logger.error('[FILE-MOVE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to move file' });
    }
});

// ============================================================================
// SHARE LINK MANAGEMENT
// ============================================================================

router.post('/:id/share', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.id);

    try {
        // Check storage quota BEFORE sharing
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (user && (user.storage_used_bytes || 0) > (user.storage_quota_bytes || 0)) {
            return res.status(403).json({ error: 'Storage quota exceeded. Sharing is disabled.' });
        }

        const shareToken = crypto.randomBytes(16).toString('hex');
        const [result] = await db.update(files)
            .set({ share_token: shareToken })
            .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deleted_at)))
            .returning({ id: files.id });

        if (!result) return res.status(404).json({ error: 'File not found or deleted' });

        void sendPushToUser(userId, {
            category: 'share',
            title: 'Share link created',
            body: `Nest created a public share link for file ${fileId}.`,
            data: {
                event: 'share_created',
                fileId,
            }
        }).catch((pushError) => {
            logger.error('[FILE-SHARE] Failed to send push notification', pushError);
        });

        res.json({ success: true, share_token: shareToken, file_id: fileId });
    } catch (error) {
        logger.error('[FILE-SHARE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to create share link' });
    }
});

router.delete('/:id/share', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.id);

    try {
        await db.update(files).set({ share_token: null }).where(and(eq(files.id, fileId), eq(files.userId, userId)));

        void sendPushToUser(userId, {
            category: 'share',
            title: 'Share link revoked',
            body: `Nest revoked the public share link for file ${fileId}.`,
            data: {
                event: 'share_revoked',
                fileId,
            }
        }).catch((pushError) => {
            logger.error('[FILE-REVOKE] Failed to send push notification', pushError);
        });

        res.json({ success: true, message: 'Share link revoked' });
    } catch (error) {
        logger.error('[FILE-REVOKE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to revoke share link' });
    }
});

router.delete('/:id/permanent', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.id);

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        // FIX #3: Delete from storage backend BEFORE removing from DB.
        // If storage delete fails, log to graveyard for retry — don't block the user.
        const provider = getStorageProvider(file.storage_provider);
        const storageKey = file.obsideo_key ?? file.jackal_fid;

        if (storageKey && !['pending', 'pending-chunks', 'chunked-complete'].includes(storageKey)) {
            if (file.is_chunked) {
                const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
                for (const chunk of chunks) {
                    const chunkKey = chunk.obsideo_key ?? chunk.jackal_merkle;
                    if (chunkKey && chunkKey !== 'pending') {
                        const deleted = await provider.delete(chunkKey);
                        if (!deleted) logger.warn(`[FILE-PERM-DEL] Storage delete failed for chunk key ${chunkKey} (file ${fileId})`);
                    }
                }
            } else {
                const deleted = await provider.delete(storageKey);
                if (!deleted) logger.warn(`[FILE-PERM-DEL] Storage delete failed for key ${storageKey} (file ${fileId})`);
            }
        }

        // Transaction: archive to graveyard + delete DB row + decrement quota atomically
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

                if (file.is_chunked || file.jackal_fid === 'chunked-complete') {
                    const chunks = await tx.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
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
            }

            await tx.delete(files).where(eq(files.id, fileId));

            await tx.update(users)
                .set({ storage_used_bytes: sql`GREATEST(0, ${users.storage_used_bytes} - ${file.file_size})` })
                .where(eq(users.id, userId));
        });

        res.json({ success: true });
    } catch (error: any) {
        logger.error('[FILE-PERM-DEL] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to delete file permanently' });
    }
});

// ============================================================================
// CANCEL UPLOAD (Fix H2: Cleanup Orphaned Chunked Uploads)
// ============================================================================

router.delete('/:id/cancel', authenticateToken, async (req: AuthRequest, res) => {
    const fileId = parseInt(req.params.id);
    const userId = req.user!.userId;

    try {
        // 1. Get file and verify ownership
        const [file] = await db.select().from(files)
            .where(and(eq(files.id, fileId), eq(files.userId, userId)))
            .limit(1);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // 2. Delete chunk files from disk
        const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
        for (const chunk of chunks) {
            if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                try {
                    fs.unlinkSync(chunk.local_path);
                    logger.info(`[UPLOAD-CANCEL] Deleted chunk: ${chunk.local_path}`);
                } catch (e) {
                    logger.error(`[UPLOAD-CANCEL] Failed to delete chunk: ${chunk.local_path}`, e);
                }
            }
        }

        // 3. Delete encrypted file if exists
        if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
            try {
                fs.unlinkSync(file.encrypted_file_path);
            } catch (e) {
                logger.error(`[UPLOAD-CANCEL] Failed to delete encrypted file: ${file.encrypted_file_path}`, e);
            }
        }

        // 4. Delete from database (cascades to chunks)
        await db.delete(files).where(eq(files.id, fileId));

        // 5. Refund quota
        await db.update(users)
            .set({ storage_used_bytes: sql`GREATEST(0, ${users.storage_used_bytes} - ${file.file_size})` })
            .where(eq(users.id, userId));

        logger.info(`[UPLOAD-CANCEL] Cancelled upload file_id=${fileId}, refunded ${file.file_size} bytes`);

        res.json({ success: true, refunded_bytes: file.file_size });
    } catch (error: any) {
        logger.error('[UPLOAD-CANCEL] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to cancel upload' });
    }
});


// ============================================================================
// PUBLIC SHARE ACCESS
// ============================================================================


// Fix: Add missing endpoint for raw shared file downloads
router.get('/share/raw/:shareToken', shareLimiter, async (req, res) => {
    const { shareToken } = req.params;

    try {
        const [file] = await db.select().from(files).where(eq(files.share_token, shareToken)).limit(1);

        if (!file) {
            logger.warn(`[SHARE-RAW] Invalid token: ${shareToken.substring(0, 8)}`);
            return res.status(404).json({ error: 'Share link not found' });
        }

        if (file.deleted_at) {
            return res.status(410).json({ error: 'File is no longer available' });
        }

        // Log analytics
        await db.insert(analyticsEvents).values({
            type: 'share_download_raw',
            bytes: file.file_size,
            timestamp: new Date(),
            meta: `file_${file.id}_token_${shareToken.substring(0, 8)}`
        });

        let filePath = file.encrypted_file_path;

        // Auto-hydration logic (same as authenticated /raw)
        if (!filePath || !fs.existsSync(filePath)) {
            const storageKey = file.obsideo_key ?? file.jackal_fid;
            if (storageKey && storageKey !== 'pending') {
                const provider = getStorageProvider(file.storage_provider);
                const tempPath = path.join(__dirname, `../../uploads/temp_share_${file.id}_${Date.now()}`);

                const handle = file.jackal_filename || `shared_${file.id}`;
                const success = await provider.download(storageKey, handle, tempPath);

                if (success && fs.existsSync(tempPath)) {
                    const stream = fs.createReadStream(tempPath);
                    res.setHeader('Content-Type', 'application/octet-stream');

                    try {
                        const stats = fs.statSync(tempPath);
                        res.setHeader('Content-Length', stats.size);
                    } catch (e) {
                        // fallback
                    }

                    await new Promise<void>(resolve => {
                        stream.pipe(res);
                        stream.on('end', () => resolve());
                        stream.on('error', () => resolve());
                    });

                    fs.unlink(tempPath, () => { }); // Cleanup
                    return;
                }
            }
            return res.status(404).json({ error: 'File content unavailable' });
        }

        // Serve local file
        const stream = fs.createReadStream(filePath);
        res.setHeader('Content-Type', 'application/octet-stream');

        try {
            const stats = fs.statSync(filePath);
            res.setHeader('Content-Length', stats.size);
        } catch (e) {
            // fallback if stat fails
        }

        stream.pipe(res);

    } catch (error: any) {
        logger.error('[SHARE-RAW] Failed:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
    }
});


// Fix #9: Rate limit share link access
router.get('/share/:shareToken', shareLimiter, async (req, res) => {
    const { shareToken } = req.params;
    try {
        const [file] = await db.select().from(files).where(eq(files.share_token, shareToken)).limit(1);

        // Fix #7: Log failed share attempts for forensics
        if (!file) {
            logger.warn(`[SHARE-ATTEMPT] Invalid token attempt: ${shareToken.substring(0, 8)}... from IP: ${req.ip}`);
            return res.status(404).json({ error: 'Share link not found' });
        }

        // Fix H4: Validate file still exists (not permanently deleted)
        if (file.deleted_at) {
            logger.warn(`[SHARE-ATTEMPT] Attempted access to deleted file: ${file.id} via token ${shareToken.substring(0, 8)}`);
            return res.status(410).json({ error: 'This file is no longer available' });
        }

        // Fix: Detect chunked files even if is_chunked flag is wrong
        const isActuallyChunked = file.is_chunked || file.jackal_fid === 'chunked-complete';
        const chunks = isActuallyChunked ? await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id)).orderBy(fileChunks.chunk_index) : undefined;

        // Fix M1: Log share download analytics
        await db.insert(analyticsEvents).values({
            type: 'share_download',
            bytes: file.file_size,
            timestamp: new Date(),
            meta: `file_${file.id}_token_${shareToken.substring(0, 8)}`
        });

        res.json({
            success: true,
            file_id: file.id,
            file_size: file.file_size,
            jackal_fid: file.obsideo_key ?? file.jackal_fid,
            merkle_hash: file.obsideo_key ?? file.merkle_hash,
            created_at: file.created_at,
            is_gateway_verified: file.storage_provider === 'jackal' ? !!file.is_gateway_verified : false,
            is_chunked: !!isActuallyChunked,
            chunks: chunks?.map(c => ({
                index: c.chunk_index,
                size: c.size,
                nonce: bufferToBase64(c.nonce),
                jackal_merkle: c.obsideo_key ?? c.jackal_merkle,
                status: (c.local_path && fs.existsSync(c.local_path)) ? 'local' : ((c.obsideo_key ?? c.jackal_merkle) ? 'cloud' : 'pending')
            }))
        });

        await db.update(files).set({ last_accessed_at: new Date() }).where(eq(files.id, file.id));
    } catch (error) {
        logger.error('[SHARE-GET] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to access share link' });
    }
});


router.get('/share/:shareToken/chunk/:index', shareLimiter, async (req, res) => {
    const { shareToken, index } = req.params;
    try {
        const [file] = await db.select({ id: files.id, deleted_at: files.deleted_at, storage_provider: files.storage_provider }).from(files).where(eq(files.share_token, shareToken)).limit(1);
        if (!file) {
            logger.warn(`[SHARE-CHUNK] Invalid token attempt: ${shareToken.substring(0, 8)}... from IP: ${req.ip}`);
            return res.status(404).json({ error: 'Share link not found' });
        }
        if (file.deleted_at) {
            logger.warn(`[SHARE-CHUNK] Attempted access to deleted file via token ${shareToken.substring(0, 8)}`);
            return res.status(410).json({ error: 'This file is no longer available' });
        }

        const [chunk] = await db.select().from(fileChunks).where(and(eq(fileChunks.fileId, file.id), eq(fileChunks.chunk_index, parseInt(index)))).limit(1);

        if (!chunk) return res.status(404).json({ error: 'Chunk not found' });

        let chunkPath = chunk.local_path;
        let isTemp = false;

        // Auto-hydration for Shared Chunks (Fix #59)
        if (!chunkPath || !fs.existsSync(chunkPath)) {
            const storageKey = chunk.obsideo_key ?? chunk.jackal_merkle;
            if (storageKey && storageKey !== 'pending') {
                const provider = getStorageProvider(file.storage_provider);
                const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_share_${chunk.id}_${Date.now()}`);
                const success = await provider.download(storageKey, `chunk_${chunk.chunk_index}`, tempPath);
                if (success) {
                    chunkPath = tempPath;
                    isTemp = true;
                }
            }
        }

        if (chunkPath && fs.existsSync(chunkPath)) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', chunk.size); // Use DB size as hydration might differ slightly on disk if not closed properly

            const stream = fs.createReadStream(chunkPath);
            stream.pipe(res);

            stream.on('end', () => {
                if (isTemp) fs.unlink(chunkPath!, () => { });
            });
            stream.on('error', () => {
                if (isTemp) fs.unlink(chunkPath!, () => { });
            });
        } else {
            return res.status(404).json({ error: 'Chunk unavailable (missing locally and on cloud)' });
        }
    } catch (error) {
        logger.error('[SHARE-CHUNK] Failed:', error);
        res.status(500).json({ error: 'Chunk access failed' });
    }
});

// ============================================================================
// CHUNKED UPLOAD (v3)
// ============================================================================

router.post('/upload/init', authenticateToken, uploadLimiter, validate(uploadInitSchema), async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const { filename, file_size, folderId, fileKeyEncrypted, fileKeyNonce, sessionId } = req.body;

    try {
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Quota Logic
        const isGodMode = req.user?.role === 'admin';
        if (!isGodMode && (user.storage_used_bytes || 0) + file_size > (user.storage_quota_bytes || 0)) {
            return res.status(413).json({ error: 'Storage quota exceeded' });
        }

        // Fix M4: Validate folder existence before upload
        if (folderId) {
            const [folder] = await db.select().from(folders)
                .where(and(eq(folders.id, parseInt(folderId)), eq(folders.userId, userId)))
                .limit(1);
            if (!folder) {
                logger.warn(`[UPLOAD-INIT] Invalid folder ID: ${folderId} for user ${userId}`);
                return res.status(403).json({ error: 'Target folder not found or access denied' });
            }
        }

        // IDEMPOTENCY CHECK: Only apply if no sessionId provided (legacy clients)
        // When sessionId is provided, each upload is intentionally unique
        if (!sessionId) {
            const [existingPending] = await db.select().from(files).where(and(
                eq(files.userId, userId),
                eq(files.file_size, file_size),
                folderId ? eq(files.folderId, parseInt(folderId)) : isNull(files.folderId),
                or(
                    eq(files.jackal_fid, 'pending-chunks'),
                    eq(files.merkle_hash, 'pending-chunks'),
                    eq(files.jackal_fid, 'pending'),
                    eq(files.merkle_hash, 'pending')
                ),
                isNull(files.deleted_at)
            )).limit(1);

            if (existingPending) {
                logger.info(`[UPLOAD-INIT] Resuming existing pending upload: ${existingPending.id}`);
                return res.json({ success: true, file_id: existingPending.id, resumed: true });
            }
        } else {
            logger.info(`[UPLOAD-INIT] New upload with sessionId: ${sessionId.substring(0, 8)}...`);
        }

        const isChunked = file_size > 128 * 1024 * 1024; // 128MB threshold (mobile-safe)

        const [newFile] = await db.insert(files).values({
            userId,
            jackal_fid: isChunked ? 'pending-chunks' : 'pending',
            merkle_hash: isChunked ? 'pending-chunks' : 'pending',
            file_size,
            folderId: folderId ? parseInt(folderId) : null,
            is_chunked: isChunked ? 1 : 0,
            chunk_count: 0,
            // share_token is intentionally NOT set here - created on-demand when user shares
            jackal_filename: 'pending',
            file_key_encrypted: base64ToBuffer(fileKeyEncrypted),
            file_key_nonce: base64ToBuffer(fileKeyNonce),
            storage_provider: env.STORAGE_PROVIDER
        }).returning({ id: files.id, is_chunked: files.is_chunked });

        const jackalFilename = `${userId}_${newFile.id}_${crypto.randomUUID()}`;
        await db.update(files).set({ jackal_filename: jackalFilename }).where(eq(files.id, newFile.id));
        await db.update(users).set({ storage_used_bytes: sql`${users.storage_used_bytes} + ${file_size}` }).where(eq(users.id, userId));

        // Analytics Event
        await db.insert(analyticsEvents).values({
            type: 'upload',
            bytes: file_size,
            timestamp: new Date(),
            meta: `file_${newFile.id}`
        });

        res.json({ success: true, file_id: newFile.id, is_chunked: !!newFile.is_chunked });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/chunk', authenticateToken, upload.single('chunk'), async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.id);
    const { chunk_index, nonce } = req.body;

    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No chunk' });

        const [fileRecord] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!fileRecord) {
            fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'File not found' });
        }

        const chunksDir = path.join(__dirname, '../../uploads/chunks');
        if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });
        const persistentPath = path.join(chunksDir, `chunk_${fileId}_${chunk_index}_${crypto.randomBytes(4).toString('hex')}`);
        fs.renameSync(file.path, persistentPath);

        const chunkId = crypto.randomUUID();
        await db.insert(fileChunks).values({
            id: chunkId,
            fileId,
            chunk_index: parseInt(chunk_index),
            size: fs.statSync(persistentPath).size,
            nonce: base64ToBuffer(nonce),
            local_path: persistentPath,
            jackal_merkle: 'pending',
            is_gateway_verified: 0
        }).onConflictDoUpdate({
            target: [fileChunks.fileId, fileChunks.chunk_index],
            set: {
                id: chunkId, // Ensure background worker's UUID matches
                nonce: base64ToBuffer(nonce),
                local_path: persistentPath,
                size: fs.statSync(persistentPath).size,
                jackal_merkle: 'pending', // Force re-upload on retry
                is_gateway_verified: 0,
                failure_reason: null
            }
        });

        // chunk_count increment moved to /finish for accuracy (avoid double-counting retries)

        // Active Storage Provider Background Upload
        uploadQueue.add(async () => {
            try {
                const provider = getStorageProvider();
                const objectKey = `files/${fileId}/chunks/${chunk_index}`;

                // Double check if already uploaded (race condition protection)
                const [existing] = await db.select({ 
                    jackal_merkle: fileChunks.jackal_merkle,
                    obsideo_key: fileChunks.obsideo_key 
                }).from(fileChunks).where(eq(fileChunks.id, chunkId));
                if (existing && (existing.obsideo_key || (existing.jackal_merkle && existing.jackal_merkle !== 'pending'))) {
                    logger.info(`[UPLOAD-QUEUE] Chunk ${chunk_index} was already uploaded, skipping.`);
                    return;
                }

                const result = await provider.upload(persistentPath, objectKey);

                await db.update(fileChunks).set({ 
                    jackal_merkle: result.merkle_root, 
                    obsideo_key: objectKey,
                    is_gateway_verified: 1, 
                    local_path: null 
                }).where(eq(fileChunks.id, chunkId));

                if (fs.existsSync(persistentPath)) fs.unlinkSync(persistentPath);

                // Check if all chunks are now verified
                const [chunkStats] = await db.select({
                    total: sql`count(*)`,
                    verified: sql`sum(case when is_gateway_verified = 1 then 1 else 0 end)`
                }).from(fileChunks).where(eq(fileChunks.fileId, fileId));

                const [parentFile] = await db.select({ chunk_count: files.chunk_count }).from(files).where(eq(files.id, fileId));

                if (parentFile && parentFile.chunk_count && parentFile.chunk_count > 0 && Number(chunkStats.verified) >= parentFile.chunk_count) {
                    await db.update(files).set({
                        is_gateway_verified: 1,
                        merkle_hash: 'obsideo-chunks'
                    }).where(eq(files.id, fileId));
                }
            } catch (e: any) {
                // Critical Fix: If we actually succeeded via event listener side-effect, IGNORE the error
                const [check] = await db.select({ 
                    jackal_merkle: fileChunks.jackal_merkle,
                    obsideo_key: fileChunks.obsideo_key 
                }).from(fileChunks).where(eq(fileChunks.id, chunkId));
                if (check && (check.obsideo_key || (check.jackal_merkle && check.jackal_merkle !== 'pending'))) {
                    logger.info(`[UPLOAD-QUEUE] Error suppressed for chunk ${chunk_index} because upload actually succeeded: ${e.message}`);
                    return;
                }

                logger.error(`[UPLOAD-QUEUE] Chunk ${chunk_index} failed:`, e);
                await db.update(fileChunks)
                    .set({ failure_reason: e.message || e.errorText || 'Unknown upload error' })
                    .where(eq(fileChunks.id, chunkId));
            }
        });

        res.json({ success: true, status: 'buffered' });
    } catch (error: any) {
        if (req.file?.path) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/finish', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.id);
    try {
        // Calculate actual chunk count
        const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
        const verifiedChunks = chunks.filter(c => c.is_gateway_verified === 1).length;

        // Fix: Also set is_chunked=1 to prevent download 404s
        const isAllVerified = chunks.length > 0 && verifiedChunks === chunks.length;

        await db.update(files).set({
            jackal_fid: 'chunked-complete',
            chunk_count: chunks.length,
            is_chunked: 1,
            is_gateway_verified: isAllVerified ? 1 : 0,
            merkle_hash: isAllVerified ? 'obsideo-chunks' : 'pending-chunks'
        }).where(and(eq(files.id, fileId), eq(files.userId, userId)));

        void sendPushToUser(userId, {
            category: 'transfer',
            title: 'Chunked upload finalized',
            body: `Nest finalized ${chunks.length} chunks for file ${fileId}.`,
            data: {
                event: 'chunked_upload_finalized',
                fileId,
                chunkCount: chunks.length,
            }
        }).catch((pushError) => {
            logger.error('[FILE-UP-FINISH] Failed to send transfer push', pushError);
        });

        res.json({ success: true, chunk_count: chunks.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id/manifest', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.id);

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        const chunks = await db.select({
            id: fileChunks.id,
            chunk_index: fileChunks.chunk_index,
            jackal_merkle: fileChunks.jackal_merkle,
            obsideo_key: fileChunks.obsideo_key,
            size: fileChunks.size,
            nonce: fileChunks.nonce,
            is_gateway_verified: fileChunks.is_gateway_verified
        })
            .from(fileChunks)
            .where(eq(fileChunks.fileId, fileId))
            .orderBy(fileChunks.chunk_index);

        res.json({
            chunks: chunks.map(c => ({
                id: c.id,
                chunk_index: c.chunk_index,
                jackal_merkle: c.obsideo_key ?? c.jackal_merkle,
                size: c.size,
                nonce: bufferToBase64(c.nonce),
                is_gateway_verified: file.storage_provider === 'jackal' ? c.is_gateway_verified : 0
            }))
        });
    } catch (error: any) {
        logger.error('[MANIFEST] Failed:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id/chunk/:index', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.id);
    const chunkIndex = parseInt(req.params.index);

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        const [chunk] = await db.select().from(fileChunks)
            .where(and(eq(fileChunks.fileId, fileId), eq(fileChunks.chunk_index, chunkIndex)))
            .limit(1);

        if (!chunk) return res.status(404).json({ error: 'Chunk not found' });

        let chunkPath = chunk.local_path;
        let isTemp = false;

        // Auto-hydration or Direct Streaming
        if (!chunkPath || !fs.existsSync(chunkPath)) {
            const storageKey = chunk.obsideo_key ?? chunk.jackal_merkle;
            if (storageKey && storageKey !== 'pending') {
                const provider = getStorageProvider(file.storage_provider);

                // Direct Streaming (e.g. Obsideo)
                if (provider.getStream) {
                    const stream = await provider.getStream(storageKey);
                    if (stream) {
                        res.setHeader('Content-Type', 'application/octet-stream');
                        res.setHeader('X-Chunk-Nonce', bufferToBase64(chunk.nonce));
                        stream.pipe(res);
                        stream.on('error', (err) => {
                            logger.error(`[STREAM] Error fetching chunk ${chunk.chunk_index} from provider:`, err);
                            res.destroy(err);
                        });
                        return;
                    }
                }

                // Fallback to disk download (Jackal or if getStream fails)
                const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_chunk_${chunk.id}_${Date.now()}`);
                const success = await provider.download(storageKey, `chunk_${chunk.chunk_index}`, tempPath);
                if (success) {
                    chunkPath = tempPath;
                    isTemp = true;
                }
            }
        }

        if (chunkPath && fs.existsSync(chunkPath)) {
            const stream = fs.createReadStream(chunkPath);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('X-Chunk-Nonce', bufferToBase64(chunk.nonce));

            stream.pipe(res);
            stream.on('end', () => {
                if (isTemp) fs.unlink(chunkPath!, () => { });
            });
            stream.on('error', () => {
                if (isTemp) fs.unlink(chunkPath!, () => { });
            });
        } else {
            res.status(404).json({ error: 'Chunk missing locally and on cloud' });
        }

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// RAW STREAMING (Failover)
// ============================================================================

router.get('/raw/:fileId', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const fileId = parseInt(req.params.fileId);

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);

        logger.info(`[DEBUG-RAW] Request for File ${fileId} by User ${userId}`);

        if (!file) {
            logger.error(`[DEBUG-RAW] ❌ File record not found for user ${userId} file ${fileId}`);
            return res.status(404).json({ error: 'File not found' });
        }

        logger.info(`[DEBUG-RAW] Found File: is_chunked=${file.is_chunked}, path=${file.encrypted_file_path}, fid=${file.jackal_fid}`);

        res.setHeader('Content-Type', 'application/octet-stream');

        // Fix: Detect chunked files even if is_chunked flag is wrong
        const isActuallyChunked = file.is_chunked || file.jackal_fid === 'chunked-complete';
        if (isActuallyChunked) {
            const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id)).orderBy(fileChunks.chunk_index);
            for (const chunk of chunks) {
                let chunkPath = chunk.local_path;
                if (!chunkPath || !fs.existsSync(chunkPath)) {
                    const storageKey = chunk.obsideo_key ?? chunk.jackal_merkle;
                    if (storageKey && storageKey !== 'pending') {
                        const provider = getStorageProvider(file.storage_provider);
                        
                        // Direct Streaming
                        if (provider.getStream) {
                            const stream = await provider.getStream(storageKey);
                            if (stream) {
                                logger.info(`[STREAM-RAW] Serving Chunk ${chunk.chunk_index} via direct stream`);
                                await new Promise((r, reject) => {
                                    stream.pipe(res, { end: false });
                                    stream.on('end', () => r(null));
                                    stream.on('error', reject);
                                });
                                continue;
                            }
                        }
                        
                        const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_chunk_${chunk.id}`);
                        const success = await provider.download(storageKey, `chunk_${chunk.chunk_index}`, tempPath);
                        if (success && fs.existsSync(tempPath)) chunkPath = tempPath;
                    }
                }
                if (!chunkPath) throw new Error("Missing chunk");

                const stats = fs.statSync(chunkPath);
                logger.info(`[STREAM-RAW] Serving Chunk ${chunk.chunk_index}: Size=${stats.size} | Nonce=${bufferToBase64(chunk.nonce).substring(0, 10)}... (db size: ${chunk.size})`);

                const chunkStream = fs.createReadStream(chunkPath);
                await new Promise(r => {
                    chunkStream.pipe(res, { end: false });
                    chunkStream.on('end', () => r(null));
                });
                if (chunkPath.includes('temp_hydrate')) fs.unlink(chunkPath, () => { });
            }
            res.end();
            return;
        }

        let filePath = file.encrypted_file_path;

        // Auto-hydration for Monolithic Files
        if (!filePath || !fs.existsSync(filePath)) {
            const storageKey = file.obsideo_key ?? file.jackal_fid;
            if (storageKey && storageKey !== 'pending') {
                logger.info(`[DEBUG-RAW] Hydrating monolithic file: ${storageKey}`);
                const provider = getStorageProvider(file.storage_provider);
                const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_${file.id}_${Date.now()}`);

                // Use jackal_filename or fid as handle
                const handle = file.jackal_filename || `restored_file_${file.id}`;
                const success = await provider.download(storageKey, handle, tempPath);

                if (success && fs.existsSync(tempPath)) {
                    logger.info(`[DEBUG-RAW] Hydration successful for file ${fileId}`);
                    filePath = tempPath;
                } else {
                    logger.error(`[DEBUG-RAW] Hydration failed for file ${fileId}`);
                }
            }
        }

        if (filePath && fs.existsSync(filePath)) {
            const stream = fs.createReadStream(filePath);
            await new Promise(r => {
                stream.pipe(res);
                stream.on('end', () => r(null));
                stream.on('error', (err) => {
                    logger.error('Stream error:', err);
                    r(null);
                });
            });

            // Cleanup temp file if it was hydrated
            if (filePath.includes('temp_hydrate_')) {
                fs.unlink(filePath, () => { });
            }
        } else {
            logger.error(`[DEBUG-RAW] ❌ Local file missing: ${filePath}. JackalFID: ${file.jackal_fid}`);

            // Fix #13: Enhanced telemetry for hydration failures
            await db.insert(analyticsEvents).values({
                type: 'hydration_failed',
                bytes: 0,
                timestamp: new Date(),
                meta: `file_${fileId}`
            });

            if (!file.jackal_fid || file.jackal_fid === 'pending') {
                return res.status(404).json({
                    error: 'File unavailable',
                    reason: 'upload_incomplete',
                    suggestion: 'This file upload did not complete. Please delete and re-upload.'
                });
            }

            return res.status(404).json({
                error: 'File unavailable',
                reason: 'hydration_failed',
                suggestion: 'File could not be retrieved from storage. Try again in a few minutes or contact support.'
            });
        }
    } catch (error: any) {
        if (!res.headersSent) res.status(500).json({ error: error.message });
        else res.end();
    }
});

router.delete('/:id/cancel', authenticateToken, injectMasterKey, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const masterKey = (req as any).masterKey;
    const fileId = parseInt(req.params.id);

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
        if (!file || file.jackal_fid !== 'pending-chunks') return res.status(404).json({ error: 'Pending file not found' });

        await db.delete(files).where(eq(files.id, fileId));
        const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
        for (const chunk of chunks) {
            if (chunk.local_path && fs.existsSync(chunk.local_path)) fs.unlinkSync(chunk.local_path);
        }
        await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));
        await db.update(users).set({ storage_used_bytes: sql`${users.storage_used_bytes} - ${file.file_size}` }).where(eq(users.id, userId));

        // Metadata cleanup
        const [cryptoData] = await db.select().from(userCrypto).where(eq(userCrypto.userId, userId)).limit(1);
        if (cryptoData && masterKey) {
            const metadata = decryptMetadataBlob(cryptoData.metadata_blob, cryptoData.metadata_nonce, masterKey);
            if (metadata.files[fileId.toString()]) {
                delete metadata.files[fileId.toString()];
                const { encrypted, nonce } = encryptMetadataBlob(metadata, masterKey);
                await db.update(userCrypto).set({ metadata_blob: encrypted, metadata_nonce: nonce }).where(eq(userCrypto.userId, userId));
            }
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
