import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { shareLimiter } from '../middleware/rateLimiter';
import { db } from '../db';
import { collabFolders, collabAccessList, collabOtpSessions, collabGuestSessions, sharedWithMe, folders, files, users, shareAuditLog, analyticsEvents, fileChunks, dropZones } from '../db/schema';
import { eq, and, isNull, sql, or, desc, inArray } from 'drizzle-orm';
import { env } from '../config/env';
import logger from '../utils/logger';
import { getStorageProvider } from '../storage';
import { withTimeout } from '../utils/promise';
import { uploadQueue } from '../utils/uploadQueue';
import { bufferToBase64, base64ToBuffer } from '../crypto/keyManagement';
import { sendEmail } from '../services/email';
import { collabOtpEmail } from '../services/email-templates';

const hostRouter = express.Router();
const guestRouter = express.Router();

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
        cb(null, `collab-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB limit
});

// Helper to verify guest session token or logged in user collab access
const verifyCollabAccess = async (req: express.Request, collabTokenOrSlug: string): Promise<{ collabId: number; email: string } | null> => {
    if (!collabTokenOrSlug) return null;

    try {
        // Find collab folder by token or slug
        const [collab] = await db.select()
            .from(collabFolders)
            .where(
                and(
                    or(eq(collabFolders.token, collabTokenOrSlug), eq(collabFolders.custom_slug, collabTokenOrSlug)),
                    isNull(collabFolders.revoked_at)
                )
            )
            .limit(1);

        if (!collab) return null;

        // Check expiry
        if (collab.expires_at && new Date(collab.expires_at) < new Date()) {
            return null;
        }

        // 1. Check guest session token from x-collab-session header or query param
        const sessionToken = (req.headers['x-collab-session'] as string) || (req.query.session_token as string);
        if (sessionToken) {
            try {
                const decoded = jwt.verify(sessionToken, env.JWT_SECRET, { algorithms: ['HS256'] }) as any;
                if (decoded.role === 'collab_guest' && decoded.collabId === collab.id) {
                    const [session] = await db.select()
                        .from(collabGuestSessions)
                        .where(
                            and(
                                eq(collabGuestSessions.session_token, sessionToken),
                                eq(collabGuestSessions.email, decoded.email),
                                eq(collabGuestSessions.collabId, collab.id)
                            )
                        )
                        .limit(1);

                    if (session && new Date(session.expires_at) >= new Date()) {
                        return { collabId: collab.id, email: session.email };
                    }
                }
            } catch (err) {
                // Ignore and proceed to authorization header
            }
        }

        // 2. Check standard JWT authorization header for logged in user
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader && authHeader.split(' ')[1];
        if (bearerToken) {
            try {
                const decoded = jwt.verify(bearerToken, env.JWT_SECRET, { algorithms: ['HS256'] }) as any;
                if (decoded && decoded.userId) {
                    // Check if they are the owner/host
                    if (collab.userId === decoded.userId) {
                        return { collabId: collab.id, email: decoded.email };
                    }
                    // Check access list
                    const [access] = await db.select()
                        .from(collabAccessList)
                        .where(
                            and(
                                eq(collabAccessList.collabId, collab.id),
                                eq(collabAccessList.email, decoded.email.trim().toLowerCase())
                            )
                        )
                        .limit(1);
                    if (access) {
                        return { collabId: collab.id, email: decoded.email };
                    }
                }
            } catch (err) {
                // Ignore
            }
        }

        return null;
    } catch (error) {
        logger.error('[VERIFY-COLLAB-ACCESS] Error:', error);
        return null;
    }
};

const getCollabFolderIds = async (collabRootFolderId: number): Promise<number[]> => {
    const descendants = await db.execute(sql`
        WITH RECURSIVE subfolders AS (
            SELECT id FROM folders WHERE id = ${collabRootFolderId}
            UNION ALL
            SELECT f.id FROM folders f
            INNER JOIN subfolders s ON f.parent_id = s.id
        )
        SELECT id FROM subfolders
    `);
    const descendantRows = Array.isArray(descendants) ? descendants : (descendants as any).rows || [];
    const folderIds = descendantRows.map((r: any) => Number(r.id));
    if (folderIds.length === 0) folderIds.push(collabRootFolderId);
    return folderIds;
};

// ============================================================================
// HOST CLIENT ROUTES (Auth Required)
// ============================================================================

// 15. GET /api/shared-with-me - List all collab folders shared with logged in user
hostRouter.get('/shared-with-me', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;

    try {
        // Query shared_with_me table joined with collab_folders
        const shared = await db.select({
            id: collabFolders.id,
            name: collabFolders.name,
            token: collabFolders.token,
            folder_id: collabFolders.folderId,
            encrypted_collab_key: sharedWithMe.encrypted_collab_key,
            collab_key_nonce: sharedWithMe.collab_key_nonce,
            owner_email: users.email
        })
        .from(sharedWithMe)
        .innerJoin(collabFolders, eq(sharedWithMe.collabId, collabFolders.id))
        .innerJoin(users, eq(collabFolders.userId, users.id))
        .where(eq(sharedWithMe.userId, userId));

        res.json({
            success: true,
            shared_folders: shared.map(f => ({
                id: f.id,
                name: f.name,
                token: f.token,
                folder_id: f.folder_id,
                encrypted_collab_key: bufferToBase64(f.encrypted_collab_key),
                collab_key_nonce: bufferToBase64(f.collab_key_nonce),
                owner_email: f.owner_email
            }))
        });

    } catch (error) {
        logger.error('[SHARED-WITH-ME] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve shared folders' });
    }
});

// 1. POST /api/collab-folders - Create/convert collab folder
hostRouter.post('/', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const {
        name,
        folder_id,
        emails, // array of approved emails
        host_encrypted_collab_key,
        host_collab_key_nonce,
        link_encrypted_collab_key,
        link_collab_key_nonce,
        require_pin,
        pin,
        strict_mode,
        activity_notifications,
        custom_slug,
        expires_at
    } = req.body;

    if (!name || !folder_id || !host_encrypted_collab_key || !host_collab_key_nonce || !link_encrypted_collab_key || !link_collab_key_nonce) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
        let pin_hash = null;
        if (require_pin && pin) {
            pin_hash = await bcrypt.hash(pin, 10);
        }

        const token = crypto.randomBytes(16).toString('hex');
        
        let checkedSlug = null;
        if (custom_slug) {
            checkedSlug = custom_slug.toLowerCase();
        }

        // Update folder key in folders table to collab key ONLY if user owns it
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

        // Create Collab Folder record
        const [newCollab] = await db.insert(collabFolders).values({
            userId,
            folderId: parseInt(folder_id),
            name,
            token,
            host_encrypted_collab_key: base64ToBuffer(host_encrypted_collab_key),
            host_collab_key_nonce: base64ToBuffer(host_collab_key_nonce),
            link_encrypted_collab_key: base64ToBuffer(link_encrypted_collab_key),
            link_collab_key_nonce: base64ToBuffer(link_collab_key_nonce),
            require_pin: !!require_pin,
            pin_hash,
            strict_mode: !!strict_mode,
            activity_notifications: activity_notifications !== false,
            custom_slug: checkedSlug,
            expires_at: expires_at ? new Date(expires_at) : null
        }).returning();

        await db.update(folders)
            .set({
                folder_key_encrypted: base64ToBuffer(host_encrypted_collab_key),
                folder_key_nonce: base64ToBuffer(host_collab_key_nonce)
            })
            .where(eq(folders.id, parseInt(folder_id)));

        // Add emails to access list
        if (emails && Array.isArray(emails)) {
            for (const email of emails) {
                if (email && email.trim() !== '') {
                    await db.insert(collabAccessList).values({
                        collabId: newCollab.id,
                        email: email.trim().toLowerCase()
                    }).onConflictDoNothing();

                    // Log email added
                    await db.insert(shareAuditLog).values({
                        share_type: 'collab_folder',
                        share_id: newCollab.id,
                        action: 'email_added',
                        actor: userId.toString(),
                        filename: email.trim().toLowerCase(),
                        timestamp: new Date()
                    });
                }
            }
        }

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: newCollab.id,
            action: 'link_created',
            actor: userId.toString(),
            timestamp: new Date()
        });

        res.status(201).json({
            success: true,
            id: newCollab.id,
            token: newCollab.token,
            collab_url: `https://nest.lazybird.io/collab/${checkedSlug || token}`
        });

    } catch (error: any) {
        if (error.code === '23505' && (error.detail?.includes('custom_slug') || error.constraint?.includes('custom_slug') || error.message?.includes('custom_slug'))) {
            return res.status(400).json({ error: 'This custom slug is already taken. Please choose another.' });
        }
        logger.error('[COLLAB-CREATE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to create Collab Folder' });
    }
});

// 2. GET /api/collab-folders - List all host's Collab Folders
hostRouter.get('/', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;

    try {
        const foldersList = await db.select({
            id: collabFolders.id,
            folderId: collabFolders.folderId,
            name: collabFolders.name,
            token: collabFolders.token,
            custom_slug: collabFolders.custom_slug,
            require_pin: collabFolders.require_pin,
            strict_mode: collabFolders.strict_mode,
            activity_notifications: collabFolders.activity_notifications,
            expires_at: collabFolders.expires_at,
            created_at: collabFolders.created_at,
            userId: collabFolders.userId
        })
            .from(collabFolders)
            .where(and(eq(collabFolders.userId, userId), isNull(collabFolders.revoked_at)))
            .orderBy(collabFolders.created_at);

        res.json({ success: true, collab_folders: foldersList });
    } catch (error) {
        logger.error('[COLLAB-LIST] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve Collab Folders' });
    }
});

// 3. POST /api/collab-folders/:id/add-to-nest - Logged-in Nest User adds shared folder
hostRouter.post('/:id/add-to-nest', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const collabId = parseInt(req.params.id);
    const { encrypted_collab_key, collab_key_nonce } = req.body;

    if (!encrypted_collab_key || !collab_key_nonce) {
        return res.status(400).json({ error: 'Missing encryption parameters' });
    }

    try {
        // Verify user email is in the access list for this Collab Folder
        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const [access] = await db.select()
            .from(collabAccessList)
            .where(
                and(
                    eq(collabAccessList.collabId, collabId),
                    eq(collabAccessList.email, req.user!.email)
                )
            )
            .limit(1);

        if (!access && collab.userId !== userId) {
            if (collab.strict_mode) {
                return res.status(403).json({ error: 'Access denied: Email not in allowed list' });
            }
            // If not strict mode, anyone with the link (and thus the keys) can add it to their nest.
        }

        // Store re-encrypted collab key in shared_with_me table
        await db.insert(sharedWithMe).values({
            userId,
            collabId,
            encrypted_collab_key: base64ToBuffer(encrypted_collab_key),
            collab_key_nonce: base64ToBuffer(collab_key_nonce)
        }).onConflictDoUpdate({
            target: [sharedWithMe.userId, sharedWithMe.collabId],
            set: {
                encrypted_collab_key: base64ToBuffer(encrypted_collab_key),
                collab_key_nonce: base64ToBuffer(collab_key_nonce),
                pinned_at: new Date()
            }
        });

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collabId,
            action: 'access_granted',
            actor: req.user!.email,
            timestamp: new Date()
        });

        res.json({ success: true, message: 'Folder added to your Nest' });

    } catch (error) {
        logger.error('[COLLAB-ADD-NEST] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to add folder to Nest' });
    }
});

// 4. GET /api/collab-folders/:id/audit-log - View audit log
hostRouter.get('/:id/audit-log', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    const format = req.query.format as string;

    try {
        const [collab] = await db.select().from(collabFolders).where(and(eq(collabFolders.id, id), eq(collabFolders.userId, userId))).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found or access denied' });

        const logs = await db.select()
            .from(shareAuditLog)
            .where(and(eq(shareAuditLog.share_type, 'collab_folder'), eq(shareAuditLog.share_id, id)))
            .orderBy(desc(shareAuditLog.timestamp));

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=collab_log_${id}.csv`);
            let csv = 'Action,Filename,Actor,Timestamp\n';
            logs.forEach(log => {
                csv += `"${log.action}","${log.filename || ''}","${log.actor || 'anonymous'}","${log.timestamp.toISOString()}"\n`;
            });
            return res.send(csv);
        }

        res.json({ success: true, logs });

    } catch (error) {
        logger.error('[COLLAB-AUDIT] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve audit logs' });
    }
});

// 4.5 PATCH /api/collab-folders/:id/link-key - Regenerate the link key payload
hostRouter.patch('/:id/link-key', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    const { link_encrypted_collab_key, link_collab_key_nonce } = req.body;

    if (!link_encrypted_collab_key || !link_collab_key_nonce) {
        return res.status(400).json({ error: 'Missing encrypted key payload' });
    }

    let encryptedKeyBuffer: Buffer;
    let nonceBuffer: Buffer;
    try {
        encryptedKeyBuffer = base64ToBuffer(link_encrypted_collab_key);
        nonceBuffer = base64ToBuffer(link_collab_key_nonce);
    } catch (err) {
        return res.status(400).json({ error: 'Malformed encrypted key payload format' });
    }

    try {
        const [collab] = await db.select().from(collabFolders).where(and(eq(collabFolders.id, id), eq(collabFolders.userId, userId))).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab Folder not found or access denied' });

        await db.update(collabFolders)
            .set({
                link_encrypted_collab_key: encryptedKeyBuffer,
                link_collab_key_nonce: nonceBuffer
            })
            .where(eq(collabFolders.id, id));

        // Log audit event
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: id,
            action: 'settings_updated',
            actor: userId.toString(),
            timestamp: new Date()
        });

        res.json({ success: true, message: 'Link key regenerated successfully' });
    } catch (error) {
        logger.error('[COLLAB-LINK-REGENERATE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to regenerate link key' });
    }
});

// 4.6 GET /api/collab-folders/:id/host-key - Fetch the host encrypted key for regeneration
hostRouter.get('/:id/host-key', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);

    try {
        const [collab] = await db.select({
            host_encrypted_collab_key: collabFolders.host_encrypted_collab_key,
            host_collab_key_nonce: collabFolders.host_collab_key_nonce
        }).from(collabFolders).where(and(eq(collabFolders.id, id), eq(collabFolders.userId, userId))).limit(1);

        if (!collab) return res.status(404).json({ error: 'Collab Folder not found or access denied' });

        res.json({
            success: true,
            host_encrypted_collab_key: bufferToBase64(collab.host_encrypted_collab_key),
            host_collab_key_nonce: bufferToBase64(collab.host_collab_key_nonce)
        });
    } catch (error) {
        logger.error('[COLLAB-HOST-KEY] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve host key payload' });
    }
});

// 4.7 GET /api/collab-folders/by-token/:token/keys - Fetch keys for auto-nesting (authenticated)
hostRouter.get('/by-token/:token/keys', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const email = req.user!.email;
    const { token } = req.params;

    try {
        const [collab] = await db.select().from(collabFolders)
            .where(
                and(
                    or(eq(collabFolders.token, token), eq(collabFolders.custom_slug, token)),
                    isNull(collabFolders.revoked_at)
                )
            ).limit(1);

        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        // Check if host
        let hasAccess = collab.userId === userId;

        if (!hasAccess) {
            // Check access list
            const [access] = await db.select().from(collabAccessList)
                .where(and(eq(collabAccessList.collabId, collab.id), eq(collabAccessList.email, email)))
                .limit(1);
            if (access) hasAccess = true;
        }

        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({
            success: true,
            id: collab.id,
            folder_id: collab.folderId,
            name: collab.name,
            link_encrypted_collab_key: bufferToBase64(collab.link_encrypted_collab_key),
            link_collab_key_nonce: bufferToBase64(collab.link_collab_key_nonce)
        });
    } catch (error) {
        logger.error('[COLLAB-TOKEN-KEYS] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve collaboration keys' });
    }
});

// 5. PATCH /api/collab-folders/:id - Update Collab settings & access list
hostRouter.patch('/:id', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    const { require_pin, pin, expires_at, activity_notifications, custom_slug, emails } = req.body;

    try {
        const [collab] = await db.select().from(collabFolders).where(and(eq(collabFolders.id, id), eq(collabFolders.userId, userId))).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab Folder not found or access denied' });

        const updates: any = {};

        if (require_pin !== undefined) {
            updates.require_pin = !!require_pin;
            if (!require_pin) updates.pin_hash = null;
        }

        if (pin) {
            updates.pin_hash = await bcrypt.hash(pin, 10);
        }

        if (expires_at !== undefined) {
            updates.expires_at = expires_at ? new Date(expires_at) : null;
        }

        if (activity_notifications !== undefined) {
            updates.activity_notifications = !!activity_notifications;
        }

        if (custom_slug !== undefined) {
            updates.custom_slug = custom_slug ? custom_slug.toLowerCase() : null;
        }

        await db.update(collabFolders).set(updates).where(eq(collabFolders.id, id));

        // Manage access list emails if provided
        if (emails && Array.isArray(emails)) {
            const cleanEmails = emails.map(e => e.trim().toLowerCase()).filter(e => e !== '');
            
            // Get current access list
            const currentList = await db.select({ email: collabAccessList.email })
                .from(collabAccessList)
                .where(eq(collabAccessList.collabId, id));
            
            const currentEmails = currentList.map(r => r.email);

            // Add new emails
            for (const email of cleanEmails) {
                if (!currentEmails.includes(email)) {
                    await db.insert(collabAccessList).values({ collabId: id, email }).onConflictDoNothing();
                    await db.insert(shareAuditLog).values({
                        share_type: 'collab_folder',
                        share_id: id,
                        action: 'email_added',
                        actor: userId.toString(),
                        filename: email,
                        timestamp: new Date()
                    });
                }
            }

            // Remove dropped emails
            for (const email of currentEmails) {
                if (!cleanEmails.includes(email)) {
                    await db.delete(collabAccessList).where(and(eq(collabAccessList.collabId, id), eq(collabAccessList.email, email)));
                    await db.insert(shareAuditLog).values({
                        share_type: 'collab_folder',
                        share_id: id,
                        action: 'email_removed',
                        actor: userId.toString(),
                        filename: email,
                        timestamp: new Date()
                    });

                    // Revoke guest session tokens for removed emails
                    await db.delete(collabGuestSessions).where(and(eq(collabGuestSessions.collabId, id), eq(collabGuestSessions.email, email)));
                }
            }
        }

        res.json({ success: true, message: 'Collab Folder updated successfully' });

    } catch (error) {
        logger.error('[COLLAB-PATCH] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to update Collab Folder' });
    }
});

// 6. DELETE /api/collab-folders/:id - Revoke a Collab Folder
hostRouter.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);

    try {
        const [collab] = await db.select().from(collabFolders).where(and(eq(collabFolders.id, id), eq(collabFolders.userId, userId))).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab Folder not found or access denied' });

        await db.update(collabFolders)
            .set({ revoked_at: new Date() })
            .where(eq(collabFolders.id, id));

        // Delete guest sessions
        await db.delete(collabGuestSessions).where(eq(collabGuestSessions.collabId, id));

        // Clean up "Shared With Me" entries for recipients who pinned this folder —
        // otherwise they keep orphan rows that error on access after revocation.
        await db.delete(sharedWithMe).where(eq(sharedWithMe.collabId, id));

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: id,
            action: 'revoked',
            actor: userId.toString(),
            timestamp: new Date()
        });

        res.json({ success: true, message: 'Collab Folder revoked successfully' });
    } catch (error) {
        logger.error('[COLLAB-DELETE] ❌ Failed:', error);
        res.status(500).json({ error: 'Failed to revoke Collab Folder' });
    }
});

// ============================================================================
// PUBLIC ANONYMOUS COLLABORATOR ROUTES (No Auth Required)
// ============================================================================

// 7. GET /api/collab/:tokenOrSlug - Get public onboarding details
guestRouter.get('/:tokenOrSlug', shareLimiter, async (req, res) => {
    const { tokenOrSlug } = req.params;

    try {
        const [collab] = await db.select({
            id: collabFolders.id,
            folderId: collabFolders.folderId,
            name: collabFolders.name,
            token: collabFolders.token,
            require_pin: collabFolders.require_pin,
            strict_mode: collabFolders.strict_mode,
            link_encrypted_collab_key: collabFolders.link_encrypted_collab_key,
            link_collab_key_nonce: collabFolders.link_collab_key_nonce,
            userId: collabFolders.userId,
            expires_at: collabFolders.expires_at,
            revoked_at: collabFolders.revoked_at
        })
        .from(collabFolders)
        .where(
            and(
                or(eq(collabFolders.token, tokenOrSlug), eq(collabFolders.custom_slug, tokenOrSlug)),
                isNull(collabFolders.revoked_at)
            )
        )
        .limit(1);

        if (!collab) {
            return res.status(410).json({ error: 'This Collab Folder link is no longer available.', revoked: true });
        }

        // Check expiry
        if (collab.expires_at && new Date(collab.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This Collab Folder link has expired.', expired: true });
        }

        // Fetch host email for display
        const [host] = await db.select({ email: users.email }).from(users).where(eq(users.id, collab.userId)).limit(1);

        res.json({
            success: true,
            id: collab.id,
            folder_id: collab.folderId,
            name: collab.name,
            host_display: host?.email || 'Host',
            require_pin: collab.require_pin,
            strict_mode: collab.strict_mode
        });

    } catch (error) {
        logger.error('[COLLAB-PUBLIC-GET] Failed:', error);
        res.status(500).json({ error: 'Failed to load Collab Folder onboarding' });
    }
});

// 8. POST /api/collab/:tokenOrSlug/otp/request - Send OTP to guest email
guestRouter.post('/:tokenOrSlug/otp/request', shareLimiter, async (req, res) => {
    const { tokenOrSlug } = req.params;
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: 'Email address is required' });
    const cleanEmail = email.trim().toLowerCase();

    try {
        const [collab] = await db.select().from(collabFolders)
            .where(
                and(
                    or(eq(collabFolders.token, tokenOrSlug), eq(collabFolders.custom_slug, tokenOrSlug)),
                    isNull(collabFolders.revoked_at)
                )
            )
            .limit(1);

        if (!collab) return res.status(404).json({ error: 'Collab Folder not found' });

        if (collab.strict_mode) {
            return res.status(403).json({ error: 'This folder is in Strict Mode and requires a registered Nest account to access. Please log in.' });
        }

        // A. Verify email is in approved access list
        const [access] = await db.select()
            .from(collabAccessList)
            .where(and(eq(collabAccessList.collabId, collab.id), eq(collabAccessList.email, cleanEmail)))
            .limit(1);

        if (!access) {
            logger.warn(`[COLLAB-OTP] Access denied to email ${cleanEmail} for folder ${collab.id}`);
            return res.status(403).json({ error: 'Access denied: Email is not in the approved guest list.' });
        }

        // B. Rate limiting: max 3 OTP requests per email per hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const [recentSends] = await db.select({ count: sql`count(*)` })
            .from(collabOtpSessions)
            .where(
                and(
                    eq(collabOtpSessions.collabId, collab.id),
                    eq(collabOtpSessions.email, cleanEmail),
                    sql`${collabOtpSessions.created_at} > ${oneHourAgo.toISOString()}`
                )
            );

        if (Number(recentSends.count) >= 3) {
            return res.status(429).json({ error: 'Too many verification attempts. Please wait 1 hour.' });
        }

        // C. Generate 6-digit random code securely
        const code = crypto.randomInt(100000, 1000000).toString();
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

        // Store OTP session
        await db.insert(collabOtpSessions).values({
            collabId: collab.id,
            email: cleanEmail,
            code_hash: codeHash,
            expires_at: expiry
        });

        // Fetch host email for templates
        const [host] = await db.select({ email: users.email }).from(users).where(eq(users.id, collab.userId)).limit(1);

        // D. Send SMTP email
        const mailSent = await sendEmail({
            to: cleanEmail,
            subject: `Collab Verification Code: ${code} - Nest`,
            html: collabOtpEmail(code, collab.name, host?.email || 'A Nest User')
        });

        if (!mailSent) {
            // In dev mode, print OTP in console so development is not blocked
            if (env.NODE_ENV === 'development') {
                logger.info(`[DEV-OTP] Verification code for ${cleanEmail} is: ${code}`);
            }
        }

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'otp_sent',
            actor: cleanEmail,
            timestamp: new Date()
        });

        res.json({ success: true, message: 'Verification code sent to your email.' });

    } catch (error) {
        logger.error('[COLLAB-OTP-REQ] Failed:', error);
        res.status(500).json({ error: 'Failed to send verification code' });
    }
});

// 9. POST /api/collab/:tokenOrSlug/otp/verify - Verify OTP and issue guest session
guestRouter.post('/:tokenOrSlug/otp/verify', shareLimiter, async (req, res) => {
    const { tokenOrSlug } = req.params;
    const { email, code } = req.body;

    if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });
    const cleanEmail = email.trim().toLowerCase();

    try {
        const [collab] = await db.select().from(collabFolders)
            .where(
                and(
                    or(eq(collabFolders.token, tokenOrSlug), eq(collabFolders.custom_slug, tokenOrSlug)),
                    isNull(collabFolders.revoked_at)
                )
            )
            .limit(1);

        if (!collab) return res.status(404).json({ error: 'Collab Folder not found' });

        if (collab.strict_mode) {
            return res.status(403).json({ error: 'This folder is in Strict Mode and requires a registered Nest account to access. Please log in.' });
        }

        // Retrieve most recent OTP session
        const [session] = await db.select()
            .from(collabOtpSessions)
            .where(
                and(
                    eq(collabOtpSessions.collabId, collab.id),
                    eq(collabOtpSessions.email, cleanEmail),
                    isNull(collabOtpSessions.verified_at)
                )
            )
            .orderBy(desc(collabOtpSessions.created_at))
            .limit(1);

        if (!session) {
            return res.status(400).json({ error: 'Verification code not found or already verified.' });
        }

        // Check Expiry
        if (new Date(session.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
        }

        // Check attempts
        if (session.attempts >= 5) {
            return res.status(429).json({ error: 'Too many failed attempts. Code locked.' });
        }

        // Compare codes
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        if (session.code_hash !== codeHash) {
            // Increment attempts
            await db.update(collabOtpSessions)
                .set({ attempts: session.attempts + 1 })
                .where(eq(collabOtpSessions.id, session.id));
            return res.status(401).json({ error: 'Incorrect verification code. Please try again.' });
        }

        // Mark OTP session as verified
        await db.update(collabOtpSessions)
            .set({ verified_at: new Date() })
            .where(eq(collabOtpSessions.id, session.id));

        // Generate Guest Session Token (8 hours duration)
        const sessionToken = jwt.sign(
            { email: cleanEmail, collabId: collab.id, role: 'collab_guest' },
            env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Store guest session in DB
        await db.insert(collabGuestSessions).values({
            collabId: collab.id,
            email: cleanEmail,
            session_token: sessionToken,
            expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000)
        });

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'otp_verified',
            actor: cleanEmail,
            timestamp: new Date()
        });

        res.json({
            success: true,
            id: collab.id,
            folder_id: collab.folderId,
            session_token: sessionToken,
            link_encrypted_collab_key: bufferToBase64(collab.link_encrypted_collab_key),
            link_collab_key_nonce: bufferToBase64(collab.link_collab_key_nonce)
        });

    } catch (error) {
        logger.error('[COLLAB-OTP-VERIFY] Failed:', error);
        res.status(500).json({ error: 'Internal verification error' });
    }
});

// ============================================================================
// PUBLIC AUTHENTICATED GUEST ROUTES (Guest Token Required)
// ============================================================================

// 10. GET /api/collab/:token/files - Public collaborative file list (polling)
guestRouter.get('/:token/files', shareLimiter, async (req, res) => {
    const { token } = req.params;

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select({ folderId: collabFolders.folderId })
            .from(collabFolders)
            .where(eq(collabFolders.id, session.collabId))
            .limit(1);

        // 1. Recursive CTE to find all subfolder IDs under the collab root
        const folderIds = await getCollabFolderIds(collab.folderId);

        // Fetch all subfolders (excluding the root itself)
        const subfoldersList = await db.select({
            id: folders.id,
            parentId: folders.parentId,
            created_at: folders.created_at,
            encrypted_folder_name: folders.encrypted_folder_name
        })
        .from(folders)
        .where(
            and(
                inArray(folders.parentId, folderIds),
                sql`${folders.id} != ${collab.folderId}`
            )
        )
        .orderBy(desc(folders.created_at))
        .limit(1000);

        // Fetch all files in any of these subfolders
        const filesList = await db.select({
            id: files.id,
            file_size: files.file_size,
            file_key_encrypted: files.file_key_encrypted,
            file_key_nonce: files.file_key_nonce,
            encrypted_filename: files.encrypted_filename,
            encrypted_mime_type: files.encrypted_mime_type,
            jackal_fid: files.obsideo_key,
            merkle_hash: files.merkle_hash,
            created_at: files.created_at,
            is_chunked: files.is_chunked,
            folderId: files.folderId
        })
        .from(files)
        .where(
            and(
                inArray(files.folderId, folderIds),
                isNull(files.deleted_at)
            )
        )
        .orderBy(desc(files.created_at))
        .limit(3000);

        res.json({
            success: true,
            collab_root_id: collab.folderId,
            folders: subfoldersList.map(f => ({
                id: f.id,
                parent_id: f.parentId,
                encrypted_folder_name: f.encrypted_folder_name,
                created_at: f.created_at
            })),
            files: filesList.map(f => ({
                id: f.id,
                file_size: f.file_size,
                file_key_encrypted: bufferToBase64(f.file_key_encrypted),
                file_key_nonce: bufferToBase64(f.file_key_nonce),
                encrypted_filename: f.encrypted_filename,
                encrypted_mime_type: f.encrypted_mime_type,
                obsideo_key: f.jackal_fid,
                merkle_hash: f.merkle_hash,
                is_chunked: !!f.is_chunked,
                created_at: f.created_at,
                folder_id: f.folderId
            }))
        });

    } catch (error) {
        logger.error('[COLLAB-FILES-GET] Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve files' });
    }
});

// 11. POST /api/collab/:token/upload - Guest uploads collaborative file
guestRouter.post('/:token/upload', shareLimiter, upload.single('file'), async (req, res) => {
    const { token } = req.params;
    
    const {
        encrypted_file_key,
        file_key_nonce,
        file_size,
        encrypted_filename,
        encrypted_mime_type,
        folder_id, // Target subfolder or null (null = root collab folder)
        sessionId
    } = req.body;

    const file = req.file;

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) {
            if (file) fs.unlinkSync(file.path);
            return res.status(401).json({ error: 'Unauthorized collab session' });
        }

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) {
            if (file) fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'Collab folder not found' });
        }

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const size = parseInt(file_size) || file.size;

        // Verify storage quota of host
        const [host] = await db.select().from(users).where(eq(users.id, collab.userId)).limit(1);
        if (!host) {
            fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'Host not found' });
        }

        // Pre-check for fast failure
        if ((host.storage_used_bytes || 0) + size > (host.storage_quota_bytes || 0)) {
            fs.unlinkSync(file.path);
            logger.warn(`[COLLAB-UPLOAD] ❌ Host ${collab.userId} quota exceeded`);
            return res.status(413).json({ error: 'Upload failed: Owner storage quota exceeded' });
        }

        // Transactional update to reserve storage securely
        const [updatedUser] = await db.update(users)
            .set({ storage_used_bytes: sql`${users.storage_used_bytes} + ${size}` })
            .where(
                and(
                    eq(users.id, collab.userId),
                    sql`${users.storage_used_bytes} + ${size} <= ${users.storage_quota_bytes}`
                )
            )
            .returning();

        if (!updatedUser) {
            fs.unlinkSync(file.path);
            return res.status(413).json({ error: 'Upload failed: Owner storage quota exceeded concurrently' });
        }

        // Determine target folder ID (default to collab root folderId)
        const targetFolderId = folder_id ? parseInt(folder_id) : collab.folderId;

        // Verify boundary traversal
        const allowedFolderIds = await getCollabFolderIds(collab.folderId);
        if (!allowedFolderIds.includes(targetFolderId)) {
            if (file) fs.unlinkSync(file.path);
            return res.status(403).json({ error: 'Upload denied: Target folder is outside collaboration boundary' });
        }

        // Insert into files table
        const [newFile] = await db.insert(files).values({
            userId: collab.userId,
            jackal_fid: 'pending',
            merkle_hash: 'pending',
            jackal_filename: 'pending',
            file_size: size,
            folderId: targetFolderId,
            file_key_encrypted: base64ToBuffer(encrypted_file_key),
            file_key_nonce: base64ToBuffer(file_key_nonce),
            encrypted_file_path: file.path,
            encrypted_filename: encrypted_filename || null,
            encrypted_mime_type: encrypted_mime_type || null,
            storage_provider: env.STORAGE_PROVIDER,
            file_origin: 'collab',
            upload_session_id: sessionId || null,
        }).returning({ id: files.id });

        // Host storage limit was already updated transactionally before insert

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'upload',
            actor: session.email,
            filename: `file_${newFile.id}`,
            timestamp: new Date()
        });

        // Log upload analytics
        await db.insert(analyticsEvents).values({
            type: 'upload',
            bytes: size,
            timestamp: new Date(),
            meta: `file_${newFile.id}_collab`
        });

        // Queue upload to active storage provider
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

                logger.info(`[COLLAB-UPLOAD-BG] Uploaded file ${fileId} to Obsideo`);
            } catch (err) {
                logger.error(`[COLLAB-UPLOAD-BG] Background upload failed for file ${fileId}:`, err);
            }
        });

        res.json({ success: true, message: 'File uploaded successfully' });

    } catch (error) {
        logger.error('[COLLAB-UPLOAD] Failed:', error);
        if (file) fs.unlink(file.path, () => {});
        res.status(500).json({ error: 'Internal server error during upload' });
    }
});


// ============================================================================
// CHUNKED UPLOAD FOR COLLAB FOLDERS
// ============================================================================

guestRouter.post('/:token/upload/init', shareLimiter, async (req, res) => {
    const { token } = req.params;
    const {
        file_size,
        folder_id,
        encrypted_file_key,
        file_key_nonce,
        sessionId
    } = req.body;

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const size = parseInt(file_size);
        if (isNaN(size)) return res.status(400).json({ error: 'Invalid file_size' });

        // Verify storage quota of host
        const [host] = await db.select().from(users).where(eq(users.id, collab.userId)).limit(1);
        if (!host) return res.status(404).json({ error: 'Host not found' });

        if ((host.storage_used_bytes || 0) + size > (host.storage_quota_bytes || 0)) {
            logger.warn(`[COLLAB-UPLOAD-INIT] ❌ Host ${collab.userId} quota exceeded`);
            return res.status(413).json({ error: 'Storage quota exceeded' });
        }

        // Determine target folder ID (default to collab root folderId)
        const targetFolderId = folder_id ? parseInt(folder_id) : collab.folderId;

        if (!sessionId) {
            const [existingPending] = await db.select().from(files).where(and(
                eq(files.userId, collab.userId),
                eq(files.file_size, size),
                eq(files.folderId, targetFolderId),
                or(
                    eq(files.jackal_fid, 'pending-chunks'),
                    eq(files.merkle_hash, 'pending-chunks')
                ),
                isNull(files.deleted_at)
            )).limit(1);

            if (existingPending) {
                logger.info(`[COLLAB-UPLOAD-INIT] Resuming existing pending upload: ${existingPending.id}`);
                return res.json({ success: true, file_id: existingPending.id, resumed: true });
            }
        }

        const [newFile] = await db.insert(files).values({
            userId: collab.userId,
            jackal_fid: 'pending-chunks',
            merkle_hash: 'pending-chunks',
            jackal_filename: 'pending',
            file_size: size,
            folderId: targetFolderId,
            is_chunked: 1,
            chunk_count: 0,
            file_key_encrypted: base64ToBuffer(encrypted_file_key),
            file_key_nonce: base64ToBuffer(file_key_nonce),
            storage_provider: env.STORAGE_PROVIDER,
            file_origin: 'collab',
            upload_session_id: sessionId || null,
        }).returning({ id: files.id });

        const jackalFilename = `${collab.userId}_${newFile.id}_${crypto.randomUUID()}`;
        await db.update(files).set({ jackal_filename: jackalFilename }).where(eq(files.id, newFile.id));
        await db.update(users).set({ storage_used_bytes: sql`${users.storage_used_bytes} + ${size}` }).where(eq(users.id, collab.userId));

        // Analytics Event
        await db.insert(analyticsEvents).values({
            type: 'upload',
            bytes: size,
            timestamp: new Date(),
            meta: `file_${newFile.id}_collab`
        });

        res.json({ success: true, file_id: newFile.id, is_chunked: true });
    } catch (error: any) {
        logger.error('[COLLAB-UPLOAD-INIT] Failed:', error);
        res.status(500).json({ error: error.message });
    }
});

guestRouter.post('/:token/upload/chunk', shareLimiter, upload.single('chunk'), async (req, res) => {
    const { token } = req.params;
    const { file_id, chunk_index, nonce } = req.body;
    const fileId = parseInt(file_id);

    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No chunk' });

        const session = await verifyCollabAccess(req, token);
        if (!session) {
            fs.unlinkSync(file.path);
            return res.status(401).json({ error: 'Unauthorized collab session' });
        }

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) {
            fs.unlinkSync(file.path);
            return res.status(404).json({ error: 'Collab folder not found' });
        }

        const [fileRecord] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, collab.userId))).limit(1);
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
                id: chunkId,
                nonce: base64ToBuffer(nonce),
                local_path: persistentPath,
                size: fs.statSync(persistentPath).size,
                jackal_merkle: 'pending',
                is_gateway_verified: 0,
                failure_reason: null
            }
        });

        // Background Upload
        uploadQueue.add(async () => {
            try {
                const provider = getStorageProvider();
                const objectKey = `files/${fileId}/chunks/${chunk_index}`;

                const [existing] = await db.select({ 
                    jackal_merkle: fileChunks.jackal_merkle,
                    obsideo_key: fileChunks.obsideo_key 
                }).from(fileChunks).where(eq(fileChunks.id, chunkId));
                if (existing && (existing.obsideo_key || (existing.jackal_merkle && existing.jackal_merkle !== 'pending'))) return;

                const result = await provider.upload(persistentPath, objectKey);
                await db.update(fileChunks).set({
                    jackal_merkle: result.merkle_root,
                    obsideo_key: objectKey,
                    is_gateway_verified: 1,
                    local_path: null
                }).where(eq(fileChunks.id, chunkId));

                fs.unlink(persistentPath, () => {});
            } catch (err: any) {
                logger.error(`[COLLAB-CHUNK-UP] Chunk ${chunk_index} upload failed:`, err);
                await db.update(fileChunks).set({ failure_reason: err.message || 'Storage error' }).where(eq(fileChunks.id, chunkId));
            }
        });

        res.json({ success: true, message: `Chunk ${chunk_index} queued` });
    } catch (error: any) {
        logger.error('[COLLAB-CHUNK-UP] Failed:', error);
        res.status(500).json({ error: error.message });
    }
});

guestRouter.post('/:token/upload/finish', shareLimiter, async (req, res) => {
    const { token } = req.params;
    const { file_id, encrypted_filename, encrypted_mime_type } = req.body;
    const fileId = parseInt(file_id);

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
        const verifiedChunks = chunks.filter(c => c.is_gateway_verified === 1).length;
        const isAllVerified = chunks.length > 0 && verifiedChunks === chunks.length;

        await db.update(files).set({
            jackal_fid: 'chunked-complete',
            chunk_count: chunks.length,
            is_chunked: 1,
            is_gateway_verified: isAllVerified ? 1 : 0,
            merkle_hash: isAllVerified ? 'obsideo-chunks' : 'pending-chunks',
            encrypted_filename: encrypted_filename || null,
            encrypted_mime_type: encrypted_mime_type || null
        }).where(and(eq(files.id, fileId), eq(files.userId, collab.userId)));

        // Audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'upload',
            actor: session.email,
            filename: `file_${fileId}`,
            timestamp: new Date()
        });

        res.json({ success: true, chunk_count: chunks.length });
    } catch (error: any) {
        logger.error('[COLLAB-UPLOAD-FINISH] Failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// 12. POST /api/collab/:token/folders - Guest creates subfolder
guestRouter.post('/:token/folders', shareLimiter, async (req, res) => {
    const { token } = req.params;
    const { folder_name_encrypted, parent_id } = req.body;

    if (!folder_name_encrypted) return res.status(400).json({ error: 'Folder name is required' });

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const targetParentId = parent_id ? parseInt(parent_id) : collab.folderId;

        // Verify boundary traversal
        const allowedFolderIds = await getCollabFolderIds(collab.folderId);
        if (!allowedFolderIds.includes(targetParentId)) {
            return res.status(403).json({ error: 'Folder creation denied: Target parent is outside collaboration boundary' });
        }

        // In Collab Folder, subfolder keys are Collab Key itself.
        // We'll set the folder_key_encrypted to the collab folder's host collab key
        // So that it resolves correctly!
        const [newSubfolder] = await db.insert(folders).values({
            userId: collab.userId,
            parentId: targetParentId,
            path_hash: crypto.randomBytes(16).toString('hex'),
            folder_key_encrypted: collab.host_encrypted_collab_key, // Re-use collab key
            folder_key_nonce: collab.host_collab_key_nonce,
            encrypted_folder_name: folder_name_encrypted
        }).returning({ id: folders.id });

        res.json({ success: true, folder_id: newSubfolder.id });

    } catch (error) {
        logger.error('[COLLAB-FOLDER-CREATE] Failed:', error);
        res.status(500).json({ error: 'Failed to create subfolder' });
    }
});

// 13. DELETE /api/collab/:token/files/:fileId - Guest soft deletes a file
guestRouter.delete('/:token/files/:fileId', shareLimiter, async (req, res) => {
    const { token, fileId } = req.params;

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const fid = parseInt(fileId);
        const folderIds = await getCollabFolderIds(collab.folderId);

        // Soft delete: move file to trash
        await db.update(files)
            .set({ deleted_at: new Date() })
            .where(and(eq(files.id, fid), inArray(files.folderId, folderIds)));

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'delete',
            actor: session.email,
            filename: `file_${fid}`,
            timestamp: new Date()
        });

        res.json({ success: true, message: 'File moved to owner\'s Trash' });

    } catch (error) {
        logger.error('[COLLAB-FILE-DELETE] Failed:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// 14. PATCH /api/collab/:token/files/:fileId - Guest renames a file
guestRouter.patch('/:token/files/:fileId', shareLimiter, async (req, res) => {
    const { token, fileId } = req.params;
    const { new_filename_encrypted } = req.body;

    if (!new_filename_encrypted) return res.status(400).json({ error: 'New filename is required' });

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const fid = parseInt(fileId);
        const folderIds = await getCollabFolderIds(collab.folderId);

        await db.update(files)
            .set({ encrypted_filename: new_filename_encrypted })
            .where(and(eq(files.id, fid), inArray(files.folderId, folderIds)));

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'rename',
            actor: session.email,
            filename: `file_${fid}`,
            timestamp: new Date()
        });

        res.json({ success: true, message: 'File renamed successfully' });

    } catch (error) {
        logger.error('[COLLAB-FILE-RENAME] Failed:', error);
        res.status(500).json({ error: 'Failed to rename file' });
    }
});

// 14.0 GET /api/collab/:token/files/:fileId - Get guest file details including chunks
guestRouter.get('/:token/files/:fileId', shareLimiter, async (req, res) => {
    const { token, fileId } = req.params;

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const fid = parseInt(fileId);
        const folderIds = await getCollabFolderIds(collab.folderId);
        const [file] = await db.select().from(files).where(and(eq(files.id, fid), inArray(files.folderId, folderIds), isNull(files.deleted_at))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        const isActuallyChunked = file.is_chunked || file.jackal_fid === 'chunked-complete';
        let chunks: any[] = [];
        if (isActuallyChunked) {
            const dbChunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id)).orderBy(fileChunks.chunk_index);
            chunks = dbChunks.map(c => ({
                index: c.chunk_index,
                size: c.size,
                nonce: bufferToBase64(c.nonce),
                jackal_merkle: c.obsideo_key ?? c.jackal_merkle,
                status: (c.local_path && fs.existsSync(c.local_path)) ? 'local' : ((c.obsideo_key ?? c.jackal_merkle) ? 'cloud' : 'pending')
            }));
        }

        res.json({
            success: true,
            id: file.id,
            file_size: file.file_size,
            encrypted_filename: file.encrypted_filename,
            encrypted_mime_type: file.encrypted_mime_type,
            file_key_encrypted: bufferToBase64(file.file_key_encrypted),
            file_key_nonce: bufferToBase64(file.file_key_nonce),
            is_chunked: !!isActuallyChunked,
            chunks
        });

    } catch (error) {
        logger.error('[COLLAB-FILE-GET-DETAILS] Failed:', error);
        res.status(500).json({ error: 'Failed to retrieve file details' });
    }
});

// 14.1 GET /api/collab/:token/files/:fileId/raw - Download guest file raw (non-chunked proxy fallback)
guestRouter.get('/:token/files/:fileId/raw', shareLimiter, async (req, res) => {
    const { token, fileId } = req.params;

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const fid = parseInt(fileId);
        const folderIds = await getCollabFolderIds(collab.folderId);
        const [file] = await db.select().from(files).where(and(eq(files.id, fid), inArray(files.folderId, folderIds), isNull(files.deleted_at))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        // Check if it's chunked
        if (file.is_chunked) {
            return res.status(400).json({ error: 'Use chunked download for this file' });
        }

        const storageKey = file.obsideo_key ?? file.jackal_fid;
        if (!storageKey || storageKey === 'pending') {
            if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Length', file.file_size);
                return fs.createReadStream(file.encrypted_file_path).pipe(res);
            }
            return res.status(404).json({ error: 'File content not available' });
        }

        const provider = getStorageProvider(file.storage_provider);
        const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_collab_${file.id}_${Date.now()}`);
        const success = await provider.download(storageKey, `file_${file.id}`, tempPath);
        if (!success) {
            return res.status(500).json({ error: 'Failed to download file from storage' });
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', file.file_size);
        const stream = fs.createReadStream(tempPath);
        stream.on('end', () => {
            fs.unlink(tempPath, () => {});
        });
        stream.pipe(res);

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'download',
            actor: session.email,
            filename: `file_${fid}`,
            timestamp: new Date()
        });

    } catch (error) {
        logger.error('[COLLAB-FILE-RAW] Failed:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// 14.2 GET /api/collab/:token/files/:fileId/chunk/:index - Download guest file chunk
guestRouter.get('/:token/files/:fileId/chunk/:index', shareLimiter, async (req, res) => {
    const { token, fileId, index } = req.params;

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const fid = parseInt(fileId);
        const folderIds = await getCollabFolderIds(collab.folderId);
        const [file] = await db.select().from(files).where(and(eq(files.id, fid), inArray(files.folderId, folderIds), isNull(files.deleted_at))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });

        const chunkIndex = parseInt(index);

        // Log download on first chunk
        if (chunkIndex === 0) {
            await db.insert(shareAuditLog).values({
                share_type: 'collab_folder',
                share_id: collab.id,
                action: 'download',
                actor: session.email,
                filename: `file_${fid}`,
                timestamp: new Date()
            });
        }

        const [chunk] = await db.select().from(fileChunks)
            .where(and(eq(fileChunks.fileId, file.id), eq(fileChunks.chunk_index, chunkIndex)))
            .limit(1);

        if (!chunk) return res.status(404).json({ error: 'Chunk not found' });

        let chunkPath = chunk.local_path;
        let isTemp = false;

        if (!chunkPath || !fs.existsSync(chunkPath)) {
            const storageKey = chunk.obsideo_key ?? chunk.jackal_merkle;
            if (storageKey && storageKey !== 'pending') {
                const provider = getStorageProvider(file.storage_provider);
                const tempPath = path.join(__dirname, `../../uploads/temp_hydrate_collab_chunk_${chunk.id}_${Date.now()}`);
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
            if (isTemp) {
                stream.on('end', () => {
                    fs.unlink(chunkPath!, () => {});
                });
            }
            stream.pipe(res);
        } else {
            res.status(404).json({ error: 'Chunk file not available on disk or storage' });
        }

    } catch (error) {
        logger.error('[COLLAB-FILE-CHUNK] Failed:', error);
        res.status(500).json({ error: 'Failed to download chunk' });
    }
});

// 14.3 DELETE /api/collab/:token/folders/:folderId - Guest deletes a subfolder
guestRouter.delete('/:token/folders/:folderId', shareLimiter, async (req, res) => {
    const { token, folderId } = req.params;

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const fid = parseInt(folderId);

        // Enforce collaboration boundary: a guest may only delete a SUBfolder that
        // lives inside this collab folder's subtree — never an arbitrary folder owned
        // by the host, and never the collab root itself. (Without this, a guest could
        // delete any of the host's folders by id.)
        const allowedFolderIds = await getCollabFolderIds(collab.folderId);
        if (fid === collab.folderId || !allowedFolderIds.includes(fid)) {
            return res.status(403).json({ error: 'Folder is outside the collaboration boundary' });
        }

        // Block if has subfolders
        const [subfolderCount] = await db.select({ count: sql`count(*)` }).from(folders).where(eq(folders.parentId, fid));
        if (Number(subfolderCount.count) > 0) {
            return res.status(400).json({ error: 'Contains subfolders. Please delete subfolders first.' });
        }

        // Soft-delete files inside this subfolder
        await db.update(files)
            .set({ deleted_at: new Date() })
            .where(and(eq(files.folderId, fid), eq(files.userId, collab.userId)));

        // Delete the subfolder itself
        await db.delete(folders)
            .where(and(eq(folders.id, fid), eq(folders.userId, collab.userId)));

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'delete_folder',
            actor: session.email,
            filename: `folder_${fid}`,
            timestamp: new Date()
        });

        res.json({ success: true, message: 'Folder deleted successfully' });

    } catch (error) {
        logger.error('[COLLAB-FOLDER-DELETE] Failed:', error);
        res.status(500).json({ error: 'Failed to delete folder' });
    }
});

// 14.4 PATCH /api/collab/:token/folders/:folderId - Guest renames a subfolder
guestRouter.patch('/:token/folders/:folderId', shareLimiter, async (req, res) => {
    const { token, folderId } = req.params;
    const { new_foldername_encrypted } = req.body;

    if (!new_foldername_encrypted) return res.status(400).json({ error: 'New folder name is required' });

    try {
        const session = await verifyCollabAccess(req, token);
        if (!session) return res.status(401).json({ error: 'Unauthorized collab session' });

        const [collab] = await db.select().from(collabFolders).where(eq(collabFolders.id, session.collabId)).limit(1);
        if (!collab) return res.status(404).json({ error: 'Collab folder not found' });

        const fid = parseInt(folderId);

        // Enforce collaboration boundary: a guest may only rename a SUBfolder inside
        // this collab folder's subtree — never an arbitrary host folder, nor the root.
        const allowedFolderIds = await getCollabFolderIds(collab.folderId);
        if (fid === collab.folderId || !allowedFolderIds.includes(fid)) {
            return res.status(403).json({ error: 'Folder is outside the collaboration boundary' });
        }

        await db.update(folders)
            .set({ encrypted_folder_name: new_foldername_encrypted })
            .where(and(eq(folders.id, fid), eq(folders.userId, collab.userId)));

        // Log audit log
        await db.insert(shareAuditLog).values({
            share_type: 'collab_folder',
            share_id: collab.id,
            action: 'rename_folder',
            actor: session.email,
            filename: `folder_${fid}`,
            timestamp: new Date()
        });

        res.json({ success: true, message: 'Folder renamed successfully' });

    } catch (error) {
        logger.error('[COLLAB-FOLDER-RENAME] Failed:', error);
        res.status(500).json({ error: 'Failed to rename folder' });
    }
});

export { hostRouter, guestRouter };


