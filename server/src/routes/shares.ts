import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { shareLimiter } from '../middleware/rateLimiter';
import { db } from '../db';
import { files, collabFolders, collabAccessList, dropZones, dropZoneFiles, shareAuditLog, fileChunks } from '../db/schema';
import { eq, and, isNull, sql, or, isNotNull, desc, inArray } from 'drizzle-orm';
import { env } from '../config/env';
import logger from '../utils/logger';
import { getStorageProvider } from '../storage';
import { bufferToBase64 } from '../crypto/keyManagement';

const router = express.Router();

const RESERVED_SLUGS = new Set([
    'shares', 'share', 's', 'dz', 'collab', 'api', 'auth', 'billing', 'files', 'folders', 'storage', 'admin',
    'login', 'signup', 'register', 'dashboard', 'settings', 'shared', 'obsideo', 'jackal', 'raw', 'download',
    'health', 'webhook', 'static', 'public', 'assets', 'favicon', 'og-card'
]);

// Helper to verify password token
const verifyPasswordToken = (shareToken: string, authHeader: string | undefined): boolean => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as any;
        return decoded.shareToken === shareToken && decoded.role === 'share_viewer';
    } catch {
        return false;
    }
};

// ============================================================================
// CLIENT ENDPOINTS (Auth Required)
// ============================================================================

// 1. GET /api/shares - Get unified list of all active shares
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;

    try {
        // A. Fetch Standard Links (files owned by user with share_token or custom_slug)
        const standardLinks = await db.select({
            id: files.id,
            share_token: files.share_token,
            custom_slug: files.share_custom_slug,
            file_size: files.file_size,
            share_expires_at: files.share_expires_at,
            share_max_downloads: files.share_max_downloads,
            share_download_count: files.share_download_count,
            created_at: files.created_at,
            has_password: sql<boolean>`CASE WHEN ${files.share_password_hash} IS NOT NULL THEN true ELSE false END`
        })
        .from(files)
        .where(
            and(
                eq(files.userId, userId),
                isNull(files.deleted_at),
                or(isNotNull(files.share_token), isNotNull(files.share_custom_slug))
            )
        );

        // B. Fetch Drop Zones
        const activeDropZones = await db.select({
            id: dropZones.id,
            name: dropZones.name,
            token: dropZones.token,
            custom_slug: dropZones.custom_slug,
            require_pin: dropZones.require_pin,
            expires_at: dropZones.expires_at,
            created_at: dropZones.created_at
        })
        .from(dropZones)
        .where(and(eq(dropZones.userId, userId), isNull(dropZones.revoked_at)));

        // C. Fetch Collab Folders
        const activeCollabFolders = await db.select({
            id: collabFolders.id,
            name: collabFolders.name,
            token: collabFolders.token,
            folder_id: collabFolders.folderId,
            custom_slug: collabFolders.custom_slug,
            require_pin: collabFolders.require_pin,
            strict_mode: collabFolders.strict_mode,
            expires_at: collabFolders.expires_at,
            created_at: collabFolders.created_at
        })
        .from(collabFolders)
        .where(and(eq(collabFolders.userId, userId), isNull(collabFolders.revoked_at)));

        // Build audit log aggregations
        // 1. Standard Link views / downloads
        const fileIds = standardLinks.map(l => l.id);
        const dzIds = activeDropZones.map(dz => dz.id);
        const collabIds = activeCollabFolders.map(c => c.id);

        let whereClause = sql`FALSE`;
        if (fileIds.length > 0) {
            whereClause = or(whereClause, and(eq(shareAuditLog.share_type, 'standard_link'), inArray(shareAuditLog.share_id, fileIds)))!;
        }
        if (dzIds.length > 0) {
            whereClause = or(whereClause, and(eq(shareAuditLog.share_type, 'drop_zone'), inArray(shareAuditLog.share_id, dzIds)))!;
        }
        if (collabIds.length > 0) {
            whereClause = or(whereClause, and(eq(shareAuditLog.share_type, 'collab_folder'), inArray(shareAuditLog.share_id, collabIds)))!;
        }

        let auditStats: any[] = [];
        if (fileIds.length > 0 || dzIds.length > 0 || collabIds.length > 0) {
            auditStats = await db.select({
                share_id: shareAuditLog.share_id,
                share_type: shareAuditLog.share_type,
                action: shareAuditLog.action,
                count: sql<number>`count(*)::int`
            })
            .from(shareAuditLog)
            .where(whereClause)
            .groupBy(shareAuditLog.share_id, shareAuditLog.share_type, shareAuditLog.action);
        }

        // Map audit stats for quick lookup
        const statsMap: Record<string, Record<string, number>> = {};
        auditStats.forEach(stat => {
            const key = `${stat.share_type}_${stat.share_id}`;
            if (!statsMap[key]) statsMap[key] = {};
            statsMap[key][stat.action] = stat.count;
        });

        // 2. Drop Zone files count — scoped to this user's drop zones only
        // (without the WHERE this scanned the entire drop_zone_files table).
        let dzFileStats: { drop_zone_id: number; count: number }[] = [];
        if (dzIds.length > 0) {
            dzFileStats = await db.select({
                drop_zone_id: dropZoneFiles.dropZoneId,
                count: sql<number>`count(*)::int`
            })
            .from(dropZoneFiles)
            .where(inArray(dropZoneFiles.dropZoneId, dzIds))
            .groupBy(dropZoneFiles.dropZoneId);
        }

        const dzFilesMap: Record<number, number> = {};
        dzFileStats.forEach(stat => {
            dzFilesMap[stat.drop_zone_id] = stat.count;
        });

        // 3. Collab Folder access emails list — scoped to this user's collab folders
        // only (without the WHERE this scanned the entire collab_access_list table).
        let collabEmails: { collab_id: number; email: string }[] = [];
        if (collabIds.length > 0) {
            collabEmails = await db.select({
                collab_id: collabAccessList.collabId,
                email: collabAccessList.email
            })
            .from(collabAccessList)
            .where(inArray(collabAccessList.collabId, collabIds));
        }

        const collabEmailsMap: Record<number, string[]> = {};
        collabEmails.forEach(record => {
            if (!collabEmailsMap[record.collab_id]) collabEmailsMap[record.collab_id] = [];
            collabEmailsMap[record.collab_id].push(record.email);
        });

        // D. Combine and normalize response rows
        const normalizedRows = [
            ...standardLinks.map(link => {
                const statsKey = `standard_link_${link.id}`;
                const views = statsMap[statsKey]?.['view'] || 0;
                const downloads = statsMap[statsKey]?.['download'] || link.share_download_count || 0;
                
                // Determine status badge
                let status = 'active';
                if (link.share_max_downloads === 1) {
                    status = 'ghost';
                }
                if (link.share_expires_at && new Date(link.share_expires_at) < new Date()) {
                    status = 'expired';
                }

                return {
                    id: link.id,
                    type: 'standard_link',
                    token: link.share_token,
                    custom_slug: link.custom_slug,
                    size: link.file_size,
                    has_password: link.has_password,
                    expires_at: link.share_expires_at,
                    max_downloads: link.share_max_downloads,
                    views,
                    downloads,
                    status,
                    created_at: link.created_at
                };
            }),
            ...activeDropZones.map(dz => {
                const statsKey = `drop_zone_${dz.id}`;
                const views = statsMap[statsKey]?.['view'] || 0;
                const filesCount = dzFilesMap[dz.id] || 0;
                
                let status = 'active';
                if (dz.expires_at && new Date(dz.expires_at) < new Date()) {
                    status = 'expired';
                }

                return {
                    id: dz.id,
                    type: 'drop_zone',
                    token: dz.token,
                    name: dz.name,
                    custom_slug: dz.custom_slug,
                    has_password: dz.require_pin, // PIN is the password for drop zones
                    expires_at: dz.expires_at,
                    views,
                    files_received: filesCount,
                    status,
                    created_at: dz.created_at
                };
            }),
            ...activeCollabFolders.map(collab => {
                const statsKey = `collab_folder_${collab.id}`;
                const views = statsMap[statsKey]?.['view'] || 0;
                const collaborators = collabEmailsMap[collab.id] || [];

                let status = 'active';
                if (collab.expires_at && new Date(collab.expires_at) < new Date()) {
                    status = 'expired';
                }

                return {
                    id: collab.id,
                    type: 'collab_folder',
                    token: collab.token,
                    name: collab.name,
                    folder_id: collab.folder_id,
                    custom_slug: collab.custom_slug,
                    has_password: collab.require_pin,
                    strict_mode: collab.strict_mode,
                    expires_at: collab.expires_at,
                    views,
                    collaborators,
                    status,
                    created_at: collab.created_at
                };
            })
        ];

        // Sort: default to newest
        normalizedRows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

        res.json({ success: true, shares: normalizedRows });
    } catch (error) {
        logger.error('[SHARES-GET-ALL] Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve shares list' });
    }
});

// 2. GET /api/shares/slug-check - Check custom slug availability
router.get('/slug-check', authenticateToken, async (req: AuthRequest, res) => {
    const slug = req.query.slug as string;
    if (!slug) return res.status(400).json({ error: 'Slug parameter is required' });

    // Validate characters
    if (!/^[a-zA-Z0-9-_]+$/.test(slug)) {
        return res.json({ available: false, reason: 'Invalid characters. Only letters, numbers, dashes, and underscores allowed.' });
    }

    if (RESERVED_SLUGS.has(slug.toLowerCase())) {
        return res.json({ available: false, reason: 'Reserved word' });
    }

    try {
        // Check standard links
        const [existingFile] = await db.select({ id: files.id })
            .from(files)
            .where(eq(files.share_custom_slug, slug))
            .limit(1);
        if (existingFile) return res.json({ available: false, reason: 'Slug already taken' });

        // Check drop zones
        const [existingDz] = await db.select({ id: dropZones.id })
            .from(dropZones)
            .where(eq(dropZones.custom_slug, slug))
            .limit(1);
        if (existingDz) return res.json({ available: false, reason: 'Slug already taken' });

        // Check collab folders
        const [existingCollab] = await db.select({ id: collabFolders.id })
            .from(collabFolders)
            .where(eq(collabFolders.custom_slug, slug))
            .limit(1);
        if (existingCollab) return res.json({ available: false, reason: 'Slug already taken' });

        res.json({ available: true });
    } catch (error) {
        logger.error('[SHARES-SLUG-CHECK] Failed:', error);
        res.status(500).json({ error: 'Failed to check slug availability' });
    }
});

// ============================================================================
// PUBLIC ACCESS ENDPOINTS (No Auth Required)
// ============================================================================

// 3. GET /api/shares/s/:tokenOrSlug - Get public share metadata
router.get('/s/:tokenOrSlug', shareLimiter, async (req, res) => {
    const { tokenOrSlug } = req.params;
    const authHeader = req.headers.authorization;

    try {
        // Query by share_token or custom_slug
        const [file] = await db.select().from(files)
            .where(
                and(
                    or(eq(files.share_token, tokenOrSlug), eq(files.share_custom_slug, tokenOrSlug)),
                    isNull(files.deleted_at)
                )
            )
            .limit(1);

        if (!file || !file.share_token) {
            return res.status(410).json({ error: 'This link has been revoked by the owner.', revoked: true });
        }

        // Check Expiry
        if (file.share_expires_at && new Date(file.share_expires_at) < new Date()) {
            return res.status(410).json({ error: 'This link has expired.', expired: true });
        }

        // Check Download Limit
        if (file.share_max_downloads && file.share_download_count >= file.share_max_downloads) {
            return res.status(410).json({ error: 'This link is no longer available — the maximum number of downloads has been reached.', limit_reached: true });
        }

        // Check Password protection
        const isProtected = file.share_password_hash !== null;
        if (isProtected) {
            const hasAccess = verifyPasswordToken(file.share_token, authHeader);
            if (!hasAccess) {
                return res.status(401).json({ error: 'Password required', password_required: true });
            }
        }

        // Log audit view event
        await db.insert(shareAuditLog).values({
            share_type: 'standard_link',
            share_id: file.id,
            action: 'view',
            actor: 'anonymous',
            timestamp: new Date()
        });

        const isActuallyChunked = file.is_chunked || file.jackal_fid === 'chunked-complete';
        const chunks = isActuallyChunked ? await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id)).orderBy(fileChunks.chunk_index) : undefined;

        // Return public file info
        res.json({
            success: true,
            file_id: file.id,
            share_token: file.share_token,
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

    } catch (error) {
        logger.error('[SHARES-PUBLIC-GET] Failed:', error);
        res.status(500).json({ error: 'Failed to access share link' });
    }
});

// 3.1 GET /api/shares/s/:tokenOrSlug/chunk/:index - Download share link chunk
router.get('/s/:tokenOrSlug/chunk/:index', shareLimiter, async (req, res) => {
    const { tokenOrSlug, index } = req.params;
    const authHeader = req.headers.authorization || (req.query.token ? `Bearer ${req.query.token}` : undefined);

    try {
        const [file] = await db.select().from(files)
            .where(
                and(
                    or(eq(files.share_token, tokenOrSlug), eq(files.share_custom_slug, tokenOrSlug)),
                    isNull(files.deleted_at)
                )
            )
            .limit(1);

        if (!file || !file.share_token) {
            return res.status(410).json({ error: 'This link has been revoked by the owner.', revoked: true });
        }

        // Check Expiry
        if (file.share_expires_at && new Date(file.share_expires_at) < new Date()) {
            return res.status(410).json({ error: 'This link has expired.', expired: true });
        }

        // Check Download Limit
        if (file.share_max_downloads && file.share_download_count >= file.share_max_downloads) {
            return res.status(410).json({ error: 'This link is no longer available — the maximum number of downloads has been reached.', limit_reached: true });
        }

        // Check Password protection
        if (file.share_password_hash !== null) {
            const hasAccess = verifyPasswordToken(file.share_token, authHeader);
            if (!hasAccess) {
                return res.status(401).json({ error: 'Access denied: Password verification required' });
            }
        }

        const chunkIndex = parseInt(index);

        // Increment Download Count & Check Max ONLY on first chunk!
        if (chunkIndex === 0) {
            const isGhostLink = file.share_max_downloads === 1;

            let updateWhereClause = eq(files.id, file.id);
            if (file.share_max_downloads) {
                updateWhereClause = and(updateWhereClause, sql`${files.share_download_count} < ${file.share_max_downloads}`)!;
            }

            const [updatedFile] = await db.update(files)
                .set({ 
                    share_download_count: sql<number>`${files.share_download_count} + 1`,
                    ...(isGhostLink ? { share_token: null, share_custom_slug: null } : {})
                })
                .where(updateWhereClause)
                .returning();
            
            if (!updatedFile) {
                return res.status(410).json({ error: 'This link is no longer available — the maximum number of downloads has been reached.', limit_reached: true });
            }

            // Log audit download event
            await db.insert(shareAuditLog).values({
                share_type: 'standard_link',
                share_id: file.id,
                action: 'download',
                actor: 'anonymous',
                filename: file.jackal_filename || `file_${file.id}`,
                timestamp: new Date()
            });

            if (isGhostLink) {
                logger.info(`[GHOST-LINK] Link auto-revoked after 1 download (chunked): File ID ${file.id}`);
            }
        }

        const [chunk] = await db.select().from(fileChunks)
            .where(and(eq(fileChunks.fileId, file.id), eq(fileChunks.chunk_index, chunkIndex)))
            .limit(1);

        if (!chunk) return res.status(404).json({ error: 'Chunk not found' });

        let chunkPath = chunk.local_path;
        let isTemp = false;

        // Auto-hydration for Shared Chunks
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
            res.setHeader('Content-Length', chunk.size);

            const stream = fs.createReadStream(chunkPath);
            stream.pipe(res);

            stream.on('end', () => {
                if (isTemp) fs.unlink(chunkPath!, () => { });
            });
            stream.on('error', () => {
                if (isTemp) fs.unlink(chunkPath!, () => { });
            });
        } else {
            return res.status(404).json({ error: 'Chunk unavailable' });
        }
    } catch (error) {
        logger.error('[SHARE-CHUNK] Failed:', error);
        res.status(500).json({ error: 'Chunk access failed' });
    }
});

// 4. POST /api/shares/s/:tokenOrSlug/verify-password - Verify password and return a temporary token
router.post('/s/:tokenOrSlug/verify-password', shareLimiter, async (req, res) => {
    const { tokenOrSlug } = req.params;
    const { password } = req.body;

    if (!password) return res.status(400).json({ error: 'Password is required' });

    try {
        const [file] = await db.select().from(files)
            .where(
                and(
                    or(eq(files.share_token, tokenOrSlug), eq(files.share_custom_slug, tokenOrSlug)),
                    isNull(files.deleted_at)
                )
            )
            .limit(1);

        if (!file || !file.share_token) {
            return res.status(404).json({ error: 'Share link not found' });
        }

        if (!file.share_password_hash) {
            return res.status(400).json({ error: 'This share link is not password protected' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, file.share_password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Incorrect password. Please try again.' });
        }

        // Generate stateless JWT token
        const token = jwt.sign(
            { shareToken: file.share_token, role: 'share_viewer' },
            env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({ success: true, token });
    } catch (error) {
        logger.error('[SHARES-PW-VERIFY] Failed:', error);
        res.status(500).json({ error: 'Internal server error during verification' });
    }
});

// 5. GET /api/shares/s/:tokenOrSlug/raw - Download raw file bytes
router.get('/s/:tokenOrSlug/raw', shareLimiter, async (req, res) => {
    const { tokenOrSlug } = req.params;
    const authHeader = req.headers.authorization || (req.query.token ? `Bearer ${req.query.token}` : undefined);

    try {
        const [file] = await db.select().from(files)
            .where(
                and(
                    or(eq(files.share_token, tokenOrSlug), eq(files.share_custom_slug, tokenOrSlug)),
                    isNull(files.deleted_at)
                )
            )
            .limit(1);

        if (!file || !file.share_token) {
            return res.status(410).json({ error: 'This link has been revoked by the owner.', revoked: true });
        }

        // Check Expiry
        if (file.share_expires_at && new Date(file.share_expires_at) < new Date()) {
            return res.status(410).json({ error: 'This link has expired.', expired: true });
        }

        // Check Download Limit
        if (file.share_max_downloads && file.share_download_count >= file.share_max_downloads) {
            return res.status(410).json({ error: 'This link is no longer available — the maximum number of downloads has been reached.', limit_reached: true });
        }

        // Check Password protection
        if (file.share_password_hash !== null) {
            const hasAccess = verifyPasswordToken(file.share_token, authHeader);
            if (!hasAccess) {
                return res.status(401).json({ error: 'Access denied: Password verification required' });
            }
        }

        // Increment Download Count & Check Max
        const isGhostLink = file.share_max_downloads === 1;

        let updateWhereClause = eq(files.id, file.id);
        if (file.share_max_downloads) {
            updateWhereClause = and(updateWhereClause, sql`${files.share_download_count} < ${file.share_max_downloads}`)!;
        }

        const [updatedFile] = await db.update(files)
            .set({ 
                share_download_count: sql<number>`${files.share_download_count} + 1`,
                ...(isGhostLink ? { share_token: null, share_custom_slug: null } : {})
            })
            .where(updateWhereClause)
            .returning();
        
        if (!updatedFile) {
            return res.status(410).json({ error: 'This link is no longer available — the maximum number of downloads has been reached.', limit_reached: true });
        }

        // Log audit download event
        await db.insert(shareAuditLog).values({
            share_type: 'standard_link',
            share_id: file.id,
            action: 'download',
            actor: 'anonymous',
            filename: file.jackal_filename || `file_${file.id}`,
            timestamp: new Date()
        });

        if (isGhostLink) {
            logger.info(`[GHOST-LINK] Link auto-revoked after 1 download: File ID ${file.id}`);
        }

        let filePath = file.encrypted_file_path;

        // Auto-hydration from Obsideo/Jackal if local file doesn't exist
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
                    } catch (e) { }

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
        } catch (e) { }

        stream.pipe(res);

    } catch (error) {
        logger.error('[SHARES-PUBLIC-RAW] Failed:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error during download' });
    }
});

// 6. GET /api/shares/:id/audit-log - View audit logs for standard link
router.get('/:id/audit-log', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    const format = req.query.format as string;

    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, id), eq(files.userId, userId))).limit(1);
        if (!file) return res.status(404).json({ error: 'Share link not found or access denied' });

        const logs = await db.select()
            .from(shareAuditLog)
            .where(and(eq(shareAuditLog.share_type, 'standard_link'), eq(shareAuditLog.share_id, id)))
            .orderBy(desc(shareAuditLog.timestamp));

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=share_log_${id}.csv`);
            let csv = 'Action,Filename,Actor,Timestamp\n';
            logs.forEach(log => {
                csv += `"${log.action}","${log.filename || ''}","${log.actor || 'anonymous'}","${log.timestamp.toISOString()}"\n`;
            });
            return res.send(csv);
        }

        res.json({ success: true, logs });

    } catch (error) {
        logger.error('[SHARE-AUDIT] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve audit logs' });
    }
});

export default router;
