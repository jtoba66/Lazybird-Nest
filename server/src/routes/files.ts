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

        const isGodMode = req.user?.email === 'josephtoba29@gmail.com';

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

        // 2. Save file metadata to database FIRST
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
            encrypted_file_path: file.path
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
            meta: `file_${fileId}`
        });

        // 7. Queue upload to Jackal
        // 7. Queue upload to Jackal
        const tempFilePath = file.path;
        uploadQueue.add(async () => {
            logger.info(`[FILE-UP-BG] Starting upload task for file ${fileId}`);

            // PRE-FLIGHT CHECK: Verify if already uploaded (e.g. via manual retry)
            try {
                const [freshFile] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
                if (freshFile && freshFile.merkle_hash && freshFile.merkle_hash !== 'pending') {
                    logger.info(`[FILE-UP-BG] File ${fileId} already has Merkle (${freshFile.merkle_hash}). Skipping duplicate upload.`);
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        logger.info(`[FILE-UP-BG] Cleaned up temp file for skipped task ${fileId}`);
                    }
                    return;
                }
            } catch (err) {
                logger.error(`[FILE-UP-BG] Pre-flight check failed for ${fileId}`, err);
            }

            try {
                const { storage: jackalStorage } = await getJackalHandler();
                const jackalFilename = `${userId}_${fileId}_${crypto.randomUUID()}`;

                const fileSizeMB = file.size / (1024 * 1024);
                const timeoutMs = (15 * 60 * 1000) + (fileSizeMB * 5000);

                const result = await withTimeout(
                    uploadFileToJackal(jackalStorage, tempFilePath, jackalFilename),
                    timeoutMs,
                    `Jackal upload timed out after ${Math.round(timeoutMs / 1000)}s`
                );

                if (result.success && result.merkle_hash) {
                    await db.update(files)
                        .set({
                            jackal_fid: result.merkle_hash,
                            merkle_hash: result.merkle_hash,
                            jackal_filename: jackalFilename
                        })
                        .where(eq(files.id, fileId));

                    logger.info(`[FILE-UP-BG] ✅ File ${fileId} uploaded to Jackal (merkle: ${result.merkle_hash})`);

                    // Immediate Cleanup
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        logger.info(`[FILE-UP-BG] Cleaned up temp file for ${fileId}`);
                    }

                    // Background Verification
                    verifyOnGateway(result.merkle_hash).then(async (verified) => {
                        if (verified) {
                            await db.update(files)
                                .set({ is_gateway_verified: 1, encrypted_file_path: null })
                                .where(eq(files.id, fileId));
                        }
                    });
                }
            } catch (error: any) {
                logger.error(`[FILE-UP-BG] ❌ File ${fileId} Jackal upload exception:`, error.message);
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
        sendFileUploadedEmail(req.user!.email, filename).catch(console.error);

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
                const { storage: jackalStorage } = await getJackalHandler();
                const jackalFilename = fileRecord.jackal_filename;

                const result = await uploadFileToJackal(jackalStorage, tempFilePath, jackalFilename!);

                if (result.success && result.merkle_hash) {
                    await db.update(files)
                        .set({
                            jackal_fid: result.merkle_hash,
                            merkle_hash: result.merkle_hash,
                            is_gateway_verified: 0
                        })
                        .where(eq(files.id, fileId));

                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

                    verifyOnGateway(result.merkle_hash).then(async verified => {
                        if (verified) {
                            await db.update(files).set({ is_gateway_verified: 1, encrypted_file_path: null }).where(eq(files.id, fileId));
                        }
                    });
                }
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

        // Soft-delete: quota remains until permanent deletion (matches industry standard)
        await db.update(files).set({ deleted_at: new Date(), share_token: null }).where(eq(files.id, fileId));

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

        const chunks = file.is_chunked ? await db.select({
            index: fileChunks.chunk_index,
            size: fileChunks.size,
            nonce: fileChunks.nonce,
            jackal_merkle: fileChunks.jackal_merkle
        }).from(fileChunks).where(eq(fileChunks.fileId, file.id)).orderBy(fileChunks.chunk_index) : undefined;

        res.json({
            success: true,
            file_key_encrypted: bufferToBase64(file.file_key_encrypted),
            file_key_nonce: bufferToBase64(file.file_key_nonce),
            folder_key_encrypted: bufferToBase64(folder.folder_key_encrypted),
            folder_key_nonce: bufferToBase64(folder.folder_key_nonce),
            folder_id: file.folderId,
            jackal_fid: file.jackal_fid,
            merkle_hash: file.merkle_hash,
            is_gateway_verified: !!file.is_gateway_verified,
            chunks: chunks?.map(c => ({
                index: c.index,
                size: c.size,
                nonce: bufferToBase64(c.nonce),
                jackal_merkle: c.jackal_merkle
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

        // Transaction wrapper to prevent race conditions
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
                    deletion_reason: 'user_permanent_delete'
                }).returning({ id: graveyard.id });

                // Archive chunks if any
                if (file.is_chunked) {
                    const chunks = await tx.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
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

            // Delete from DB (Cascade should handle chunks, but we manually clean up physical files)
            await tx.delete(files).where(eq(files.id, fileId));
        });

        // Cleanup Physical Files (outside transaction - filesystem operations)
        if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
            fs.unlinkSync(file.encrypted_file_path);
        }

        // Cleanup Chunks (if any local)
        const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
        for (const chunk of chunks) {
            if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                fs.unlinkSync(chunk.local_path);
            }
        }

        // Update Quota
        await db.update(users).set({ storage_used_bytes: sql`GREATEST(0, ${users.storage_used_bytes} - ${file.file_size})` }).where(eq(users.id, userId));

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

        const chunks = file.is_chunked ? await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id)).orderBy(fileChunks.chunk_index) : undefined;

        // Fix M1: Log share download analytics
        await db.insert(analyticsEvents).values({
            type: 'share_download',
            bytes: file.file_size,
            meta: `file_${file.id}_token_${shareToken.substring(0, 8)}`
        });

        res.json({
            success: true,
            file_id: file.id,
            file_size: file.file_size,
            jackal_fid: file.jackal_fid,
            merkle_hash: file.merkle_hash,
            created_at: file.created_at,
            is_gateway_verified: !!file.is_gateway_verified,
            is_chunked: !!file.is_chunked,
            chunks: chunks?.map(c => ({
                index: c.chunk_index,
                size: c.size,
                nonce: bufferToBase64(c.nonce),
                jackal_merkle: c.jackal_merkle,
                status: (c.local_path && fs.existsSync(c.local_path)) ? 'local' : (c.jackal_merkle ? 'cloud' : 'pending')
            }))
        });

        await db.update(files).set({ last_accessed_at: new Date() }).where(eq(files.id, file.id));
    } catch (error) {
        logger.error('[SHARE-GET] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to access share link' });
    }
});

router.get('/share/:shareToken/chunk/:index', async (req, res) => {
    const { shareToken, index } = req.params;
    try {
        const [file] = await db.select({ id: files.id }).from(files).where(eq(files.share_token, shareToken)).limit(1);
        if (!file) return res.status(404).json({ error: 'Share link not found' });

        const [chunk] = await db.select().from(fileChunks).where(and(eq(fileChunks.fileId, file.id), eq(fileChunks.chunk_index, parseInt(index)))).limit(1);
        if (!chunk || !chunk.local_path || !fs.existsSync(chunk.local_path)) {
            return res.status(404).json({ error: 'Chunk not available on server' });
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', chunk.size);
        fs.createReadStream(chunk.local_path).pipe(res);
    } catch (error) {
        res.status(500).json({ error: 'Chunk access failed' });
    }
});

// ============================================================================
// CHUNKED UPLOAD (v3)
// ============================================================================

router.post('/upload/init', authenticateToken, uploadLimiter, validate(uploadInitSchema), async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const { filename, file_size, folderId, fileKeyEncrypted, fileKeyNonce } = req.body;

    try {
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Quota Logic
        const isGodMode = req.user?.email === 'josephtoba29@gmail.com';
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
                return res.status(404).json({ error: 'Target folder not found' });
            }
        }

        // IDEMPOTENCY CHECK: match by size, folder, and pending status
        // (Since filename is encrypted/opaque in jackal_filename, we rely on size + folder + user context)
        const [existingPending] = await db.select().from(files).where(and(
            eq(files.userId, userId),
            eq(files.file_size, file_size),
            folderId ? eq(files.folderId, parseInt(folderId)) : isNull(files.folderId),
            or(
                eq(files.jackal_fid, 'pending-chunks'),
                eq(files.merkle_hash, 'pending-chunks'),
                eq(files.jackal_fid, 'pending'), // Also check for simple pending uploads
                eq(files.merkle_hash, 'pending')
            ),
            isNull(files.deleted_at)
        )).limit(1);

        if (existingPending) {
            logger.info(`[UPLOAD-INIT] Resuming existing pending upload: ${existingPending.id}`);
            return res.json({ success: true, file_id: existingPending.id, share_token: existingPending.share_token, resumed: true });
        }

        const isChunked = file_size > 500 * 1024 * 1024; // Auto-select based on size or explicit flag

        const [newFile] = await db.insert(files).values({
            userId,
            jackal_fid: isChunked ? 'pending-chunks' : 'pending',
            merkle_hash: isChunked ? 'pending-chunks' : 'pending',
            file_size,
            folderId: folderId ? parseInt(folderId) : null,
            is_chunked: isChunked ? 1 : 0,
            chunk_count: 0,
            share_token: crypto.randomBytes(16).toString('hex'),
            jackal_filename: 'pending',
            file_key_encrypted: base64ToBuffer(fileKeyEncrypted),
            file_key_nonce: base64ToBuffer(fileKeyNonce)
        }).returning({ id: files.id, share_token: files.share_token, is_chunked: files.is_chunked });

        const jackalFilename = `${userId}_${newFile.id}_${crypto.randomUUID()}`;
        await db.update(files).set({ jackal_filename: jackalFilename }).where(eq(files.id, newFile.id));
        await db.update(users).set({ storage_used_bytes: sql`${users.storage_used_bytes} + ${file_size}` }).where(eq(users.id, userId));

        // Analytics Event
        await db.insert(analyticsEvents).values({
            type: 'upload',
            bytes: file_size,
            meta: `file_${newFile.id}`
        });

        res.json({ success: true, file_id: newFile.id, share_token: newFile.share_token, is_chunked: !!newFile.is_chunked });
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

        // Jackal Background Upload
        uploadQueue.add(async () => {
            try {
                const { storage: jackalStorage } = await getJackalHandler();
                const chunkJackalName = `${fileRecord.jackal_filename}_chunk_${chunk_index}`;

                // Double check if already uploaded (race condition protection)
                const [existing] = await db.select({ jackal_merkle: fileChunks.jackal_merkle }).from(fileChunks).where(eq(fileChunks.id, chunkId));
                if (existing?.jackal_merkle && existing.jackal_merkle !== 'pending') {
                    logger.info(`[UPLOAD-QUEUE] Chunk ${chunk_index} was already uploaded, skipping.`);
                    return;
                }

                const result = await uploadFileToJackal(jackalStorage, persistentPath, chunkJackalName);

                if (result.success && result.merkle_hash) {
                    await db.update(fileChunks).set({ jackal_merkle: result.merkle_hash, jackal_cid: result.cid || null }).where(eq(fileChunks.id, chunkId));
                    verifyOnGateway(result.merkle_hash).then(async verified => {
                        if (verified) {
                            await db.update(fileChunks).set({ is_gateway_verified: 1, local_path: null }).where(eq(fileChunks.id, chunkId));
                            if (fs.existsSync(persistentPath)) fs.unlinkSync(persistentPath);
                        }
                    });
                }
            } catch (e: any) {
                // Critical Fix: If we actually succeeded via event listener side-effect, IGNORE the error
                const [check] = await db.select({ jackal_merkle: fileChunks.jackal_merkle }).from(fileChunks).where(eq(fileChunks.id, chunkId));
                if (check?.jackal_merkle && check.jackal_merkle !== 'pending') {
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

        await db.update(files).set({
            jackal_fid: 'chunked-complete',
            chunk_count: chunks.length
        }).where(and(eq(files.id, fileId), eq(files.userId, userId)));

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
                jackal_merkle: c.jackal_merkle,
                size: c.size,
                nonce: bufferToBase64(c.nonce),
                is_gateway_verified: c.is_gateway_verified
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

        // Auto-hydration
        if (!chunkPath || !fs.existsSync(chunkPath)) {
            if (chunk.jackal_merkle && chunk.jackal_merkle !== 'pending') {
                const { downloadFileFromJackal } = await import('../jackal');
                const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_chunk_${chunk.id}_${Date.now()}`);
                const success = await downloadFileFromJackal(chunk.jackal_merkle, `chunk_${chunk.chunk_index}`, tempPath);
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

        logger.info(`[DEBUG-RAW] Found File: is_chunked=${file.is_chunked}, path=${file.encrypted_file_path}`);

        res.setHeader('Content-Type', 'application/octet-stream');

        if (file.is_chunked) {
            const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id)).orderBy(fileChunks.chunk_index);
            for (const chunk of chunks) {
                let chunkPath = chunk.local_path;
                if (!chunkPath || !fs.existsSync(chunkPath)) {
                    if (chunk.jackal_merkle && chunk.jackal_merkle !== 'pending') {
                        const { downloadFileFromJackal } = await import('../jackal');
                        const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_chunk_${chunk.id}`);
                        const success = await downloadFileFromJackal(chunk.jackal_merkle, `chunk_${chunk.chunk_index}`, tempPath);
                        if (success) chunkPath = tempPath;
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
            if (file.jackal_fid && file.jackal_fid !== 'pending') {
                logger.info(`[DEBUG-RAW] Hydrating monolithic file from Jackal: ${file.jackal_fid}`);
                const { downloadFileFromJackal } = await import('../jackal');
                const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_${file.id}_${Date.now()}`);

                // Use jackal_filename or fid as handle
                const handle = file.jackal_filename || `restored_file_${file.id}`;
                const success = await downloadFileFromJackal(file.jackal_fid, handle, tempPath);

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
