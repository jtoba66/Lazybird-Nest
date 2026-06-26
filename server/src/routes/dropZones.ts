import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { shareLimiter, pinLimiter, dropZoneUploadLimiter } from '../middleware/rateLimiter';
import { db } from '../db';
import { dropZones, dropZoneFiles, files, users, shareAuditLog, analyticsEvents, folders, collabFolders } from '../db/schema';
import { eq, and, isNull, sql, or, desc } from 'drizzle-orm';
import { env } from '../config/env';
import logger from '../utils/logger';
import { getStorageProvider } from '../storage';
import { withTimeout } from '../utils/promise';
import { uploadQueue } from '../utils/uploadQueue';
import { bufferToBase64, base64ToBuffer } from '../crypto/keyManagement';

const router = express.Router();

// Configure multer for guest uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `dropzone-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB limit
});

// Helper to verify PIN session token
const verifyPinToken = (dropZoneToken: string, sessionHeader: string | undefined): boolean => {
    if (!sessionHeader) return false;
    try {
        const decoded = jwt.verify(sessionHeader, env.JWT_SECRET, { algorithms: ['HS256'] }) as any;
        return decoded.dropZoneToken === dropZoneToken && decoded.role === 'drop_zone_uploader';
    } catch {
        return false;
    }
};

// ============================================================================
// HOST CLIENT ROUTES (Auth Required)
// ============================================================================

// 1. POST /api/drop-zones - Create a Drop Zone
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const {
        name,
        folder_id,
        require_pin,
        pin,
        expires_at,
        upload_notifications,
        drop_public_key,
        encrypted_drop_private_key,
        drop_private_key_nonce,
        custom_slug
    } = req.body;

    if (!name || !folder_id || !drop_public_key || !encrypted_drop_private_key || !drop_private_key_nonce) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
        // Hash PIN if provided
        let pin_hash = null;
        if (require_pin && pin) {
            pin_hash = await bcrypt.hash(pin, 10);
        }

        const token = crypto.randomBytes(16).toString('hex');
        
        let checkedSlug = null;
        if (custom_slug) {
            checkedSlug = custom_slug.toLowerCase();
        }

        // Verify folder is owned by host
        const [targetFolder] = await db.select().from(folders)
            .where(and(eq(folders.id, parseInt(folder_id)), eq(folders.userId, userId)))
            .limit(1);

        if (!targetFolder) {
            return res.status(403).json({ error: 'Folder not found or access denied' });
        }

        // Check if folder is already a Collab Folder or Drop Zone
        const [existingDropZone] = await db.select().from(dropZones).where(eq(dropZones.folderId, parseInt(folder_id))).limit(1);
        if (existingDropZone) return res.status(400).json({ error: 'This folder is already a Drop Zone' });
        
        const [existingCollab] = await db.select().from(collabFolders).where(eq(collabFolders.folderId, parseInt(folder_id))).limit(1);
        if (existingCollab) return res.status(400).json({ error: 'This folder is already a Collab Folder' });

        // Update folder key in folders table to drop zone key
        const dropZonePathHash = `dropzone_${token}`;
        await db.update(folders).set({
            path_hash: dropZonePathHash
        }).where(eq(folders.id, parseInt(folder_id)));

        const [newDropZone] = await db.insert(dropZones).values({
            userId,
            folderId: parseInt(folder_id),
            name,
            token,
            drop_public_key: base64ToBuffer(drop_public_key),
            encrypted_drop_private_key: base64ToBuffer(encrypted_drop_private_key),
            drop_private_key_nonce: base64ToBuffer(drop_private_key_nonce),
            require_pin: !!require_pin,
            pin_hash,
            upload_notifications: upload_notifications !== false,
            custom_slug: checkedSlug,
            expires_at: expires_at ? new Date(expires_at) : null
        }).returning();

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'drop_zone',
            share_id: newDropZone.id,
            action: 'link_created',
            actor: userId.toString(),
            timestamp: new Date()
        });

        res.status(201).json({
            success: true,
            id: newDropZone.id,
            token: newDropZone.token,
            drop_zone_url: `https://nest.lazybird.io/dz/${checkedSlug || token}`
        });

    } catch (error: any) {
        if (error.code === '23505' && (error.detail?.includes('custom_slug') || error.constraint?.includes('custom_slug') || error.message?.includes('custom_slug'))) {
            return res.status(400).json({ error: 'This custom slug is already taken. Please choose another.' });
        }
        logger.error('[DZ-CREATE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to create Drop Zone' });
    }
});

// 2. GET /api/drop-zones - List all host's Drop Zones
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;

    try {
        const zones = await db.select()
            .from(dropZones)
            .where(and(eq(dropZones.userId, userId), isNull(dropZones.revoked_at)))
            .orderBy(dropZones.created_at);

        const mappedZones = zones.map(zone => ({
            ...zone,
            drop_public_key: bufferToBase64(zone.drop_public_key),
            encrypted_private_key: bufferToBase64(zone.encrypted_drop_private_key),
            private_key_nonce: bufferToBase64(zone.drop_private_key_nonce)
        }));

        res.json({ success: true, drop_zones: mappedZones });
    } catch (error) {
        logger.error('[DZ-LIST] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve Drop Zones' });
    }
});

// 3. PATCH /api/drop-zones/:id - Update Drop Zone settings
router.patch('/:id', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    const { require_pin, pin, expires_at, upload_notifications, custom_slug } = req.body;

    try {
        const [dz] = await db.select().from(dropZones).where(and(eq(dropZones.id, id), eq(dropZones.userId, userId))).limit(1);
        if (!dz) return res.status(404).json({ error: 'Drop Zone not found or access denied' });

        const updates: any = {};

        if (require_pin !== undefined) {
            updates.require_pin = !!require_pin;
            if (!require_pin) {
                updates.pin_hash = null;
            }
        }

        if (pin) {
            updates.pin_hash = await bcrypt.hash(pin, 10);
        }

        if (expires_at !== undefined) {
            updates.expires_at = expires_at ? new Date(expires_at) : null;
        }

        if (upload_notifications !== undefined) {
            updates.upload_notifications = !!upload_notifications;
        }

        if (custom_slug !== undefined) {
            updates.custom_slug = custom_slug ? custom_slug.toLowerCase() : null;
        }

        await db.update(dropZones).set(updates).where(eq(dropZones.id, id));
        res.json({ success: true, message: 'Drop Zone settings updated successfully' });

    } catch (error) {
        logger.error('[DZ-PATCH] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to update Drop Zone' });
    }
});

// 4. DELETE /api/drop-zones/:id - Revoke a Drop Zone
router.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);

    try {
        const [dz] = await db.select().from(dropZones).where(and(eq(dropZones.id, id), eq(dropZones.userId, userId))).limit(1);
        if (!dz) return res.status(404).json({ error: 'Drop Zone not found or access denied' });

        await db.update(dropZones)
            .set({ revoked_at: new Date() })
            .where(eq(dropZones.id, id));

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'drop_zone',
            share_id: id,
            action: 'revoked',
            actor: userId.toString(),
            timestamp: new Date()
        });

        res.json({ success: true, message: 'Drop Zone link revoked successfully' });
    } catch (error) {
        logger.error('[DZ-DELETE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to revoke Drop Zone' });
    }
});

// 5. GET /api/drop-zones/:id/audit-log - View audit logs
router.get('/:id/audit-log', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    const format = req.query.format as string;

    try {
        const [dz] = await db.select().from(dropZones).where(and(eq(dropZones.id, id), eq(dropZones.userId, userId))).limit(1);
        if (!dz) return res.status(404).json({ error: 'Drop Zone not found or access denied' });

        const logs = await db.select()
            .from(shareAuditLog)
            .where(and(eq(shareAuditLog.share_type, 'drop_zone'), eq(shareAuditLog.share_id, id)))
            .orderBy(desc(shareAuditLog.timestamp));

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=dz_log_${id}.csv`);
            let csv = 'Action,Filename,Actor,Timestamp\n';
            logs.forEach(log => {
                csv += `"${log.action}","${log.filename || ''}","${log.actor || 'anonymous'}","${log.timestamp.toISOString()}"\n`;
            });
            return res.send(csv);
        }

        res.json({ success: true, logs });

    } catch (error) {
        logger.error('[DZ-AUDIT] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve audit logs' });
    }
});

// ============================================================================
// PUBLIC ANONYMOUS GUEST ROUTES (No Auth Required)
// ============================================================================

// 6. GET /api/drop-zones/:tokenOrSlug - Get public Drop Zone settings & key
router.get('/:tokenOrSlug', shareLimiter, async (req, res) => {
    const { tokenOrSlug } = req.params;
    const sessionToken = req.headers['x-dz-session'] as string;

    try {
        const [dz] = await db.select().from(dropZones)
            .where(
                and(
                    or(eq(dropZones.token, tokenOrSlug), eq(dropZones.custom_slug, tokenOrSlug)),
                    isNull(dropZones.revoked_at)
                )
            )
            .limit(1);

        if (!dz) {
            return res.status(410).json({ error: 'This link has been revoked or expired.', revoked: true });
        }

        // Check Expiry
        if (dz.expires_at && new Date(dz.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This link has expired.', expired: true });
        }

        // Check PIN Gate
        if (dz.require_pin) {
            const hasAccess = verifyPinToken(dz.token, sessionToken);
            if (!hasAccess) {
                return res.status(401).json({ error: 'PIN verification required', pin_required: true });
            }
        }

        // Log view
        await db.insert(shareAuditLog).values({
            share_type: 'drop_zone',
            share_id: dz.id,
            action: 'view',
            actor: 'anonymous',
            timestamp: new Date()
        });

        res.json({
            success: true,
            name: dz.name,
            drop_public_key: bufferToBase64(dz.drop_public_key)
        });

    } catch (error) {
        logger.error('[DZ-PUBLIC-GET] Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve Drop Zone details' });
    }
});

// 7. POST /api/drop-zones/:tokenOrSlug/verify-pin - Verify PIN
router.post('/:tokenOrSlug/verify-pin', shareLimiter, pinLimiter, async (req, res) => {
    const { tokenOrSlug } = req.params;
    const { pin } = req.body;

    if (!pin) return res.status(400).json({ error: 'PIN is required' });

    try {
        const [dz] = await db.select().from(dropZones)
            .where(
                and(
                    or(eq(dropZones.token, tokenOrSlug), eq(dropZones.custom_slug, tokenOrSlug)),
                    isNull(dropZones.revoked_at)
                )
            )
            .limit(1);

        if (!dz || !dz.pin_hash) {
            return res.status(404).json({ error: 'Drop Zone not found or PIN not required' });
        }

        const isMatch = await bcrypt.compare(pin, dz.pin_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Incorrect PIN. Please try again.' });
        }

        // Generate signed session token
        const token = jwt.sign(
            { dropZoneToken: dz.token, role: 'drop_zone_uploader' },
            env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({ success: true, session_token: token });

    } catch (error) {
        logger.error('[DZ-PIN-VERIFY] Failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 8. POST /api/drop-zones/:tokenOrSlug/upload - Upload file to Drop Zone (blind drop)
router.post('/:tokenOrSlug/upload', dropZoneUploadLimiter, upload.single('file'), async (req, res) => {
    const { tokenOrSlug } = req.params;
    const sessionToken = req.headers['x-dz-session'] as string;
    
    const {
        encrypted_file_key, // key encrypted with drop_public_key (base64)
        file_key_nonce,     // secretstream header (base64)
        file_size,
        encrypted_filename, // filename encrypted with drop_public_key (base64)
        encrypted_mime_type, // mime encrypted with drop_public_key (base64)
        sessionId           // Unique session ID for grouping
    } = req.body;

    const file = req.file;

    try {
        const [dz] = await db.select().from(dropZones)
            .where(
                and(
                    or(eq(dropZones.token, tokenOrSlug), eq(dropZones.custom_slug, tokenOrSlug)),
                    isNull(dropZones.revoked_at)
                )
            )
            .limit(1);

        if (!dz) {
            if (file) fs.unlinkSync(file.path);
            return res.status(410).json({ error: 'Drop Zone no longer available' });
        }

        // Validate PIN Gate
        if (dz.require_pin) {
            const hasAccess = verifyPinToken(dz.token, sessionToken);
            if (!hasAccess) {
                if (file) fs.unlinkSync(file.path);
                return res.status(401).json({ error: 'Access denied: PIN verification required' });
            }
        }

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        if (!encrypted_file_key || !file_key_nonce) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'Missing encryption parameters' });
        }

        // Use the authoritative number of bytes actually written to disk. The client
        // also sends file_size, but a guest could understate it to push the host over
        // quota — so never let the claimed value be smaller than the real upload.
        const size = Math.max(parseInt(file_size) || 0, file.size);

        // 1. Verify Host Storage Quota
        const [host] = await db.select().from(users).where(eq(users.id, dz.userId)).limit(1);
        if (!host) {
            fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'Host user not found' });
        }

        // Pre-check for fast failure
        if ((host.storage_used_bytes || 0) + size > (host.storage_quota_bytes || 0)) {
            fs.unlinkSync(file.path);
            logger.warn(`[DZ-UPLOAD] ❌ Host ${dz.userId} quota exceeded`);
            return res.status(413).json({ error: 'Upload failed: Host storage quota exceeded' });
        }

        // Transactional update to reserve storage securely
        const [updatedUser] = await db.update(users)
            .set({ storage_used_bytes: sql`${users.storage_used_bytes} + ${size}` })
            .where(
                and(
                    eq(users.id, dz.userId),
                    sql`${users.storage_used_bytes} + ${size} <= ${users.storage_quota_bytes}`
                )
            )
            .returning();

        if (!updatedUser) {
            fs.unlinkSync(file.path);
            return res.status(413).json({ error: 'Upload failed: Host storage quota exceeded concurrently' });
        }

        // 2. Insert record into `files` table so it shows up in File Manager
        const [newFile] = await db.insert(files).values({
            userId: dz.userId,
            jackal_fid: 'pending',
            merkle_hash: 'pending',
            jackal_filename: 'pending',
            file_size: size,
            folderId: dz.folderId,
            file_key_encrypted: base64ToBuffer(encrypted_file_key),
            file_key_nonce: base64ToBuffer(file_key_nonce),
            encrypted_file_path: file.path,
            encrypted_filename: encrypted_filename || null,
            encrypted_mime_type: encrypted_mime_type || null,
            storage_provider: env.STORAGE_PROVIDER,
            file_origin: 'drop_zone',
            upload_session_id: sessionId || null,
        }).returning({ id: files.id });

        // 3. Insert record into `drop_zone_files` table
        await db.insert(dropZoneFiles).values({
            dropZoneId: dz.id,
            encrypted_file_key: base64ToBuffer(encrypted_file_key),
            file_key_nonce: base64ToBuffer(file_key_nonce),
            storage_key: `files/${newFile.id}`,
            file_size: size
        });

        // Host Storage Used was already updated transactionally before insert

        // 5. Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'drop_zone',
            share_id: dz.id,
            action: 'upload',
            actor: 'guest',
            filename: `file_${newFile.id}`,
            timestamp: new Date()
        });

        // 6. Log general upload event
        await db.insert(analyticsEvents).values({
            type: 'upload',
            bytes: size,
            timestamp: new Date(),
            meta: `file_${newFile.id}_dz`
        });

        // 7. Queue upload to active storage provider
        const tempFilePath = file.path;
        const fileId = newFile.id;
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

                logger.info(`[DZ-UPLOAD-BG] Uploaded file ${fileId} to Obsideo`);
            } catch (err) {
                logger.error(`[DZ-UPLOAD-BG] Background upload failed for file ${fileId}:`, err);
            }
        });

        res.json({ success: true, message: 'Your file was received securely.' });

    } catch (error) {
        logger.error('[DZ-UPLOAD] Failed:', error);
        if (file) fs.unlink(file.path, () => {});
        res.status(500).json({ error: 'Internal server error during upload' });
    }
});

export default router;
