import express from 'express';
import { db } from '../db';
import { files, users, fileChunks, folders, graveyard, graveyardChunks, analyticsEvents } from '../db/schema';
import { eq, and, isNull, sql, isNotNull, desc, count, sum } from 'drizzle-orm';
import { PRICING } from '../config/pricing';
import { authenticateToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import os from 'os';
import { getJackalHandler, uploadFileToJackal, verifyOnGateway } from '../jackal';
import { withTimeout } from '../utils/promise';
import logger from '../utils/logger';
import fs from 'fs';
import { uploadQueue } from '../utils/uploadQueue';
import { retryFileUpload, retryChunkUploads } from '../utils/retryHandler';

const router = express.Router();

// Helper for blob counting
const getBlobStats = async () => {
    const chunkCount = (await db.select({ count: count() }).from(fileChunks))[0].count;
    const simpleFileCount = (await db.select({ count: count() }).from(files).where(sql`${files.is_chunked} = 0`))[0].count;
    const totalBlobs = Number(chunkCount) + Number(simpleFileCount);

    const uploadedChunks = (await db.select({ count: count() })
        .from(fileChunks)
        .where(and(
            isNotNull(fileChunks.jackal_merkle),
            sql`${fileChunks.jackal_merkle} != 'pending'`,
            sql`${fileChunks.jackal_merkle} != ''`
        )))[0].count;

    const uploadedSimpleFiles = (await db.select({ count: count() })
        .from(files)
        .where(and(
            sql`${files.is_chunked} = 0`,
            isNotNull(files.jackal_fid),
            sql`${files.jackal_fid} != 'pending'`,
            sql`${files.jackal_fid} != 'pending-chunks'`,
            sql`${files.jackal_fid} != ''`
        )))[0].count;

    const totalUploadedBlobs = Number(uploadedChunks) + Number(uploadedSimpleFiles);

    return { totalBlobs, totalUploadedBlobs, pendingBlobs: totalBlobs - totalUploadedBlobs };
};

router.get('/system', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { totalBlobs } = await getBlobStats();
        const totalUsers = (await db.select({ count: count() }).from(users))[0].count;
        const totalFolders = (await db.select({ count: count() }).from(folders))[0].count;

        // Use COALESCE to ensure we get 0 instead of null
        const totalStorageRes = await db.select({
            sum: sql<number>`COALESCE(SUM(${files.file_size}), 0)`
        })
            .from(files)
            .where(isNull(files.deleted_at));

        const totalStorage = totalStorageRes[0].sum;

        res.json({
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem(),
                usedPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
            },
            uptime: os.uptime(),
            load: os.loadavg(),
            database: {
                totalFiles: Number(totalBlobs),
                totalUsers: Number(totalUsers),
                totalFolders: Number(totalFolders),
                totalStorage: Number(totalStorage || 0)
            }
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/analytics', authenticateToken, requireAdmin, async (req, res) => {
    try {


        const [recentUploads] = await db.select({ count: sql<number>`count(*)` })
            .from(files)
            .where(and(
                isNull(files.deleted_at),
                sql`${files.created_at} >= now() - interval '24 hours'`
            ));

        const storageByUser = await db.select({
            email: users.email,
            file_count: sql<number>`count(${files.id})`,
            total_storage: sql<number>`coalesce(sum(${files.file_size}), 0)`
        })
            .from(users)
            .leftJoin(files, and(eq(users.id, files.userId), isNull(files.deleted_at)))
            .groupBy(users.id, users.email)
            .orderBy(desc(sql`coalesce(sum(${files.file_size}), 0)`))
            .limit(10);

        // 1. Jackal Blobs (Verified on Network)
        // Count confirmed files + confirmed chunks (excluding graveyard)
        const [verifiedFiles] = await db.select({ count: sql<number>`count(*)` })
            .from(files)
            .where(and(eq(files.is_gateway_verified, 1), eq(files.is_chunked, 0)));

        const [verifiedChunks] = await db.select({ count: sql<number>`count(*)` })
            .from(fileChunks)
            .where(eq(fileChunks.is_gateway_verified, 1));

        const jackalBlobs = Number(verifiedFiles.count) + Number(verifiedChunks.count);

        // 2. Pending Blobs (Waiting for Upload)
        // Count unverified files + unverified chunks (excluding graveyard)
        const [pendingFiles] = await db.select({ count: sql<number>`count(*)` })
            .from(files)
            .where(and(eq(files.is_gateway_verified, 0), eq(files.is_chunked, 0)));

        const [pendingChunks] = await db.select({ count: sql<number>`count(*)` })
            .from(fileChunks)
            .where(eq(fileChunks.is_gateway_verified, 0));

        const pendingBlobs = Number(pendingFiles.count) + Number(pendingChunks.count);

        // 3. Graveyard Blobs (Waiting for Prune)
        // Count graveyard files + graveyard chunks
        const [graveyardFiles] = await db.select({ count: sql<number>`count(*)` }).from(graveyard);
        const [graveyardChunkCount] = await db.select({ count: sql<number>`count(*)` }).from(graveyardChunks);

        const graveyardBlobs = Number(graveyardFiles.count) + Number(graveyardChunkCount.count);

        const totalBlobs = jackalBlobs + pendingBlobs + graveyardBlobs;

        res.json({
            jackal: {
                total: totalBlobs,       // Total Network Footprint
                active: jackalBlobs,     // "Secured"
                pending: pendingBlobs,   // "Queue"
                graveyard: graveyardBlobs // "Trash"
            },
            storage: storageByUser,
            recent: {
                uploads24h: Number(recentUploads.count)
            }
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/failed-uploads', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const failed = await db.select({
            id: files.id,
            user_email: users.email,
            jackal_filename: files.jackal_filename,
            file_size: files.file_size,
            merkle_hash: files.merkle_hash,
            created_at: files.created_at,
            encrypted_file_path: files.encrypted_file_path,
            retry_count: files.retry_count,
            is_chunked: files.is_chunked
        })
            .from(files)
            .innerJoin(users, eq(files.userId, users.id))
            .where(and(
                isNull(files.deleted_at),
                sql`${files.retry_count} > 0`,
                eq(files.is_gateway_verified, 0)
            ))
            .limit(50);

        const mappedFailed = failed.map(file => ({
            ...file,
            storage_id: file.jackal_filename || file.merkle_hash || 'Unknown',
            storage_type: file.is_chunked ? 'blob' : 'single'
        }));

        res.json(mappedFailed);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/files', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const fileList = await db.select({
            id: files.id,
            userId: files.userId,
            jackal_fid: files.jackal_fid,
            merkle_hash: files.merkle_hash,
            jackal_filename: files.jackal_filename,
            file_size: files.file_size,
            folderId: files.folderId,
            is_chunked: files.is_chunked,
            chunk_count: files.chunk_count,
            created_at: files.created_at,
            retry_count: files.retry_count,
            is_gateway_verified: files.is_gateway_verified,
            encrypted_file_path: files.encrypted_file_path,
            user_email: users.email,
            folder_parent: folders.parentId
        })
            .from(files)
            .innerJoin(users, eq(files.userId, users.id))
            .leftJoin(folders, eq(files.folderId, folders.id))
            .where(isNull(files.deleted_at))
            .orderBy(desc(files.created_at));

        const enhancedFiles = await Promise.all(fileList.map(async (file: any) => {
            let jackal_status: 'pending' | 'verifying' | 'uploaded';
            let chunk_progress = null;

            if (file.is_chunked) {
                const [chunkStats] = await db.select({
                    total: sql<number>`count(*)`,
                    verified: sql<number>`sum(case when ${fileChunks.is_gateway_verified} = 1 then 1 else 0 end)`,
                    verifying: sql<number>`sum(case when ${fileChunks.jackal_merkle} is not null and ${fileChunks.is_gateway_verified} = 0 then 1 else 0 end)`
                }).from(fileChunks).where(eq(fileChunks.fileId, file.id));

                const total = Number(chunkStats.total) || 0;
                const verified = Number(chunkStats.verified) || 0;
                const verifying = Number(chunkStats.verifying) || 0;

                chunk_progress = { total, verified, verifying, pending: total - verified - verifying };

                if (verified === total && total > 0) jackal_status = 'uploaded';
                else if (verifying > 0 || verified > 0) jackal_status = 'verifying';
                else jackal_status = 'pending';
            } else {
                if (file.is_gateway_verified === 1) jackal_status = 'uploaded';
                else if (file.merkle_hash && file.merkle_hash !== 'UNKNOWN' && file.merkle_hash !== 'pending') jackal_status = 'verifying';
                else jackal_status = 'pending';
            }

            return {
                ...file,
                storage_id: file.jackal_filename || file.merkle_hash || 'pending',
                storage_type: file.is_chunked ? 'blob' : 'single',
                jackal_status,
                chunk_progress,
                can_retry: jackal_status !== 'uploaded' && (file.retry_count || 0) < 3
            };
        }));

        res.json(enhancedFiles);
    } catch (err: any) {
        logger.error('[ADMIN] Error fetching files:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userList = await db.select({
            id: users.id,
            email: users.email,
            created_at: users.created_at,
            storage_used_bytes: users.storage_used_bytes,
            storage_quota_bytes: users.storage_quota_bytes,
            is_banned: users.is_banned,
            subscription_tier: users.subscription_tier,
            file_count: sql<number>`count(distinct ${files.id})`,
            folder_count: sql<number>`count(distinct ${folders.id})`
        })
            .from(users)
            .leftJoin(files, eq(users.id, files.userId))
            .leftJoin(folders, eq(users.id, folders.userId))
            .groupBy(users.id)
            .orderBy(desc(users.created_at));

        res.json(userList);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/graveyard', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const softDeleted = await db.select({
            id: files.id,
            user_email: users.email,
            jackal_filename: files.jackal_filename,
            merkle_hash: files.merkle_hash,
            file_size: files.file_size,
            is_chunked: files.is_chunked,
            chunk_count: files.chunk_count,
            deleted_at: files.deleted_at
        })
            .from(files)
            .innerJoin(users, eq(files.userId, users.id))
            .where(isNotNull(files.deleted_at))
            .limit(100);

        const archived = await db.select({
            id: graveyard.id,
            user_email: users.email,
            jackal_filename: graveyard.filename,
            merkle_hash: graveyard.merkle_hash,
            file_size: graveyard.file_size,
            deleted_at: graveyard.deleted_at,
            jackal_fid: graveyard.jackal_fid,
            chunk_count: sql<number>`(SELECT count(*)::int FROM ${graveyardChunks} WHERE ${graveyardChunks.graveyard_id} = ${graveyard.id})`
        })
            .from(graveyard)
            .leftJoin(users, eq(graveyard.user_id, users.id))
            .limit(100);

        const combined = [
            ...softDeleted.map(f => ({
                ...f,
                type: 'soft',
                storage_type: f.is_chunked ? 'blob' : 'single',
                storage_id: f.jackal_filename || f.merkle_hash || 'pending'
            })),
            ...archived.map(a => {
                const isBlob = (a.jackal_fid === 'chunked-complete' || !a.jackal_fid || a.merkle_hash === 'pending-chunks') && !!a.merkle_hash;
                return {
                    ...a,
                    type: 'permanent',
                    storage_id: a.jackal_filename || a.merkle_hash || 'archived',
                    storage_type: isBlob ? 'blob' : 'single',
                    is_chunked: isBlob ? 1 : 0,
                    chunk_count: a.chunk_count || 0
                };
            })
        ].sort((a, b) => {
            const dateA = a.deleted_at ? new Date(a.deleted_at).getTime() : 0;
            const dateB = b.deleted_at ? new Date(b.deleted_at).getTime() : 0;
            return dateB - dateA;
        });

        res.json(combined);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/files/:id/retry', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { chunkIds } = req.body;
    try {
        const [file] = await db.select().from(files).where(and(eq(files.id, parseInt(id)), isNull(files.deleted_at))).limit(1);
        if (!file) return res.status(404).json({ error: 'File not found' });
        if (file.is_chunked) await retryChunkUploads(parseInt(id), chunkIds);
        else await retryFileUpload(parseInt(id));
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/retry-all-failed', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const failedFiles = await db.select().from(files).where(and(isNull(files.deleted_at), sql`${files.retry_count} < 3`));
        let queuedCount = 0;
        for (const file of failedFiles) {
            try {
                if (file.is_chunked) await retryChunkUploads(file.id);
                else await retryFileUpload(file.id);
                queuedCount++;
            } catch (e) { }
        }
        res.json({ success: true, queued: queuedCount, total: failedFiles.length });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const userId = parseInt(id);
        await db.delete(files).where(eq(files.userId, userId));
        await db.delete(folders).where(eq(folders.userId, userId));
        await db.delete(fileChunks).where(eq(fileChunks.fileId, sql`(select id from files where user_id = ${userId})`)); // This is a bit complex, actually onDelete cascade handles most
        // Re-check: file_chunks has references to files.id which has references to users.id.
        // If we delete from files, file_chunks will be deleted if ON DELETE CASCADE is set.
        // Our schema.ts has onDelete: 'cascade' for files.userId and fileChunks.fileId.
        // So deleting from users will cascade to everything.

        await db.delete(users).where(eq(users.id, userId));
        res.json({ message: 'User deleted' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/users/:id/ban', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const newBanStatus = user.is_banned === 1 ? 0 : 1;
        await db.update(users).set({ is_banned: newBanStatus }).where(eq(users.id, userId));

        res.json({ success: true, is_banned: newBanStatus });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/users/:id/tier', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const newTier = user.subscription_tier === 'pro' ? 'free' : 'pro';
        const newQuota = newTier === 'pro' ? PRICING.pro.storage : PRICING.free.storage;

        await db.update(users).set({
            subscription_tier: newTier,
            storage_quota_bytes: newQuota
        }).where(eq(users.id, userId));

        // Log Analytics Event
        await db.insert(analyticsEvents).values({
            type: newTier === 'pro' ? 'user_upgrade' : 'user_downgrade',
            bytes: 1,
            meta: `user_${userId}`
        });

        res.json({ success: true, tier: newTier, quota: newQuota });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/users/:id/purge', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // 1. Get all files for this user
        const userFiles = await db.select().from(files).where(and(eq(files.userId, userId), isNull(files.deleted_at)));

        if (userFiles.length === 0) {
            return res.json({ success: true, message: 'User has no active files to purge' });
        }

        // 2. Move each file to graveyard
        for (const file of userFiles) {
            const [gv] = await db.insert(graveyard).values({
                original_file_id: file.id,
                user_id: file.userId,
                filename: file.jackal_filename || 'unknown',
                file_size: file.file_size,
                jackal_fid: file.jackal_fid,
                merkle_hash: file.merkle_hash,
                original_created_at: file.created_at,
                deletion_reason: 'admin_purge'
            }).returning({ id: graveyard.id });

            if (file.is_chunked) {
                const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                if (chunks.length > 0) {
                    await db.insert(graveyardChunks).values(
                        chunks.map(c => ({
                            graveyard_id: gv.id,
                            chunk_index: c.chunk_index,
                            jackal_merkle: c.jackal_merkle,
                            size: c.size
                        }))
                    );
                }
            }

            // Soft delete the file record and clear local path
            await db.update(files)
                .set({ deleted_at: new Date(), folderId: null, encrypted_file_path: null })
                .where(eq(files.id, file.id));
        }

        // 3. Reset user storage used
        await db.update(users).set({ storage_used_bytes: 0 }).where(eq(users.id, userId));

        res.json({ success: true, purged_count: userFiles.length });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/graveyard', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // 1. Fetch soft-deleted files from 'files' table
        const softDeleted = await db.select({
            id: files.id,
            user_email: users.email,
            jackal_filename: files.jackal_filename,
            merkle_hash: files.merkle_hash,
            file_size: files.file_size,
            is_chunked: files.is_chunked,
            chunk_count: files.chunk_count,
            deleted_at: files.deleted_at
        })
            .from(files)
            .innerJoin(users, eq(files.userId, users.id))
            .where(isNotNull(files.deleted_at))
            .limit(100);

        // 2. Fetch permanently-archived files from 'graveyard' table
        const archived = await db.select({
            id: graveyard.id,
            user_email: users.email,
            jackal_filename: graveyard.filename,
            merkle_hash: graveyard.merkle_hash,
            file_size: graveyard.file_size,
            deleted_at: graveyard.deleted_at,
            jackal_fid: graveyard.jackal_fid,
            chunk_count: sql<number>`(SELECT count(*)::int FROM ${graveyardChunks} WHERE ${graveyardChunks.graveyard_id} = ${graveyard.id})`
        })
            .from(graveyard)
            .leftJoin(users, eq(graveyard.user_id, users.id))
            .limit(100);

        // 3. Combine and Format
        const combined = [
            ...softDeleted.map(f => ({
                ...f,
                type: 'soft',
                storage_type: f.is_chunked ? 'blob' : 'single',
                storage_id: f.jackal_filename || f.merkle_hash || 'pending'
            })),
            ...archived.map(a => {
                const isBlob = (a.jackal_fid === 'chunked-complete' || !a.jackal_fid || a.merkle_hash === 'pending-chunks') && !!a.merkle_hash;
                return {
                    ...a,
                    type: 'permanent',
                    storage_id: a.jackal_filename || a.merkle_hash || 'archived',
                    storage_type: isBlob ? 'blob' : 'single',
                    is_chunked: isBlob ? 1 : 0,
                    chunk_count: a.chunk_count || 0
                };
            })
        ].sort((a, b) => {
            const dateA = a.deleted_at ? new Date(a.deleted_at).getTime() : 0;
            const dateB = b.deleted_at ? new Date(b.deleted_at).getTime() : 0;
            return dateB - dateA;
        });

        res.json(combined);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// CHUNK INSPECTOR ENDPOINTS
// ==========================================

router.get('/graveyard/:id/chunks', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const graveyardId = parseInt(req.params.id);
        if (isNaN(graveyardId)) return res.status(400).json({ error: 'Invalid graveyard ID' });

        const chunks = await db.select()
            .from(graveyardChunks)
            .where(eq(graveyardChunks.graveyard_id, graveyardId))
            .orderBy(graveyardChunks.chunk_index);

        res.json(chunks);
    } catch (err: any) {
        console.error('[ADMIN] Fetch graveyard chunks failed:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/files/:id/chunks', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const fileId = parseInt(req.params.id);
        if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

        const chunks = await db.select()
            .from(fileChunks)
            .where(eq(fileChunks.fileId, fileId))
            .orderBy(fileChunks.chunk_index);

        res.json(chunks);
    } catch (err: any) {
        console.error('[ADMIN] Fetch chunks failed:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/chunks/:id/verify', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const chunkId = req.params.id; // UUID is string
        if (!chunkId) return res.status(400).json({ error: 'Invalid chunk ID' });

        // 1. Get Chunk
        const chunk = await db.query.fileChunks.findFirst({
            where: eq(fileChunks.id, chunkId)
        });

        if (!chunk) return res.status(404).json({ error: 'Chunk not found' });
        if (!chunk.jackal_merkle) return res.status(400).json({ error: 'Chunk has no Merkle Hash (not uploaded yet)' });

        // 2. Verify on Gateway
        const verified = await verifyOnGateway(chunk.jackal_merkle);

        if (verified) {
            // 3. Update Status
            await db.update(fileChunks)
                .set({ is_gateway_verified: 1 })
                .where(eq(fileChunks.id, chunkId));

            // 4. Check if ALL chunks for this file are now verified? (Optional "Smart" Logic)
            // For now, let the periodic job handle the parent file status or do it later if requested.

            res.json({ success: true, verified: true });
        } else {
            res.json({ success: true, verified: false, message: 'Gateway returned 404 for this hash' });
        }

    } catch (err: any) {
        console.error('[ADMIN] Verify chunk failed:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/files/:id/retry-upload', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const fileId = parseInt(req.params.id);
        if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

        // Use the existing utility
        await retryFileUpload(fileId);

        res.json({ success: true, queued: true });
    } catch (err: any) {
        console.error('[ADMIN] Retry file upload failed:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/chunks/:id/retry', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const chunkId = req.params.id;
        if (!chunkId) return res.status(400).json({ error: 'Invalid chunk ID' });

        // 1. Get Chunk
        const chunk = await db.query.fileChunks.findFirst({
            where: eq(fileChunks.id, chunkId)
        });

        if (!chunk) return res.status(404).json({ error: 'Chunk not found' });
        if (!chunk.local_path || !fs.existsSync(chunk.local_path)) {
            return res.status(400).json({ error: 'Local chunk file missing. Cannot retry.' });
        }

        // 2. Init Jackal
        const { storage } = await getJackalHandler();

        // 3. Upload
        const filenameFragment = `${chunk.fileId}_chunk_${chunk.chunk_index}`;
        const result = await uploadFileToJackal(storage, chunk.local_path, filenameFragment);

        if (result.success && result.merkle_hash) {
            // 4. Update DB
            await db.update(fileChunks)
                .set({
                    jackal_merkle: result.merkle_hash,
                    jackal_cid: result.cid,
                    retry_count: (chunk.retry_count || 0) + 1,
                    last_retry_at: new Date().toISOString(),
                    is_gateway_verified: 0 // Require re-verification
                })
                .where(eq(fileChunks.id, chunkId));

            // Clean up local file immediately on success
            if (fs.existsSync(chunk.local_path)) {
                try {
                    fs.unlinkSync(chunk.local_path);
                    console.log(`[ADMIN] Cleaned up local chunk file: ${chunk.local_path}`);
                } catch (e) {
                    console.warn(`[ADMIN] Failed to delete local chunk file: ${e}`);
                }
            }

            res.json({ success: true, merkle: result.merkle_hash });
        } else {
            res.status(500).json({ error: 'Jackal upload returned failure' });
        }

    } catch (err: any) {
        console.error('[ADMIN] ❌ Retry chunk failed!');
        console.error('Chunk ID:', req.params.id);
        console.error('Error:', err);
        if (err.stack) console.error('Stack:', err.stack);
        res.status(500).json({ error: err.message || 'Internal server error during chunk retry' });
    }
});

// Analytics History Endpoint
router.get('/analytics/history', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const range = (req.query.range as string) || '7d';
        let interval = 'day';
        let lookbackDays = 7;

        if (range === '24h') {
            interval = 'hour';
            lookbackDays = 1;
        } else if (range === '30d') {
            interval = 'day';
            lookbackDays = 30;
        }

        // 0. Auto-Backfill Check (Event Sourcing Init)
        const [evtCount] = await db.select({ count: sql<number>`count(*)` }).from(analyticsEvents);
        if (Number(evtCount.count) === 0) {
            logger.info('[ANALYTICS] Empty events table, running backfill...');
            const backfillEvents: any[] = [];

            // Backfill Active Files
            const existingFiles = await db.select().from(files);
            for (const f of existingFiles) {
                backfillEvents.push({
                    type: 'upload',
                    bytes: f.file_size,
                    timestamp: f.created_at || new Date(),
                    meta: `backfill_file_${f.id}`
                });
            }

            // Backfill Graveyard (Treat as active uploads until pruned)
            const existingGraveyard = await db.select().from(graveyard);
            for (const g of existingGraveyard) {
                backfillEvents.push({
                    type: 'upload',
                    bytes: g.file_size || 0,
                    timestamp: g.original_created_at || g.deleted_at || new Date(),
                    meta: `backfill_gv_${g.id}`
                });
            }

            if (backfillEvents.length > 0) {
                // Chunk insert to avoid limits
                const chunkSize = 100;
                for (let i = 0; i < backfillEvents.length; i += chunkSize) {
                    await db.insert(analyticsEvents).values(backfillEvents.slice(i, i + chunkSize));
                }
            }
            logger.info(`[ANALYTICS] Backfilled ${backfillEvents.length} events.`);
        }

        // 1. Calculate CURRENT TOTAL storage (sum of ALL storage events)
        // Note: 'upload' events have positive bytes, 'prune' events have negative bytes
        const currentTotalResult = await db.execute(sql`
            SELECT COALESCE(SUM(bytes), 0) as total
            FROM analytics_events
            WHERE type IN ('upload', 'prune')
        `);
        const currentTotal = Math.max(0, Number((currentTotalResult as any)[0]?.total || 0));

        // 2. Calculate baseline (storage that existed BEFORE the lookback window)
        const baselineResult = await db.execute(sql`
            SELECT COALESCE(SUM(bytes), 0) as total
            FROM analytics_events
            WHERE type IN ('upload', 'prune')
            AND timestamp < NOW() - INTERVAL '${sql.raw(lookbackDays.toString())} days'
        `);
        const baseline = Number((baselineResult as any)[0]?.total || 0);

        // 3. Get time-bucketed data within the lookback window with running cumulative sum
        const history = await db.execute(sql`
            SELECT 
                date_trunc(${sql.raw(`'${interval}'`)}, timestamp) as date,
                SUM(SUM(bytes)) 
                    OVER (ORDER BY date_trunc(${sql.raw(`'${interval}'`)}, timestamp)) as delta
            FROM analytics_events
            WHERE type IN ('upload', 'prune')
            AND timestamp >= NOW() - INTERVAL '${sql.raw(lookbackDays.toString())} days'
            GROUP BY date_trunc(${sql.raw(`'${interval}'`)}, timestamp)
            ORDER BY 1 ASC
        `);

        // 4. Add baseline to each data point to get absolute storage at that time
        const formattedHistory = (history as any[]).map((row: any) => ({
            date: row.date,
            bytes: Math.max(0, baseline + Number(row.delta || 0))
        }));

        // 5. ALWAYS add "now" as the final data point showing current total storage
        // This ensures the graph never ends at 0 when files still exist
        const now = new Date();
        const lastHistoryDate = formattedHistory.length > 0
            ? new Date(formattedHistory[formattedHistory.length - 1].date)
            : null;

        // Only add if "now" is different from the last data point's date
        if (!lastHistoryDate || now.getTime() - lastHistoryDate.getTime() > 3600000) { // 1 hour threshold
            formattedHistory.push({
                date: now.toISOString(),
                bytes: currentTotal
            });
        } else {
            // Update the last point to show current total (in case of drift)
            formattedHistory[formattedHistory.length - 1].bytes = currentTotal;
        }

        // Ensure at least one data point for chart rendering
        if (formattedHistory.length === 0) {
            formattedHistory.push({
                date: now.toISOString(),
                bytes: currentTotal
            });
        }

        logger.info(`[ANALYTICS-DEBUG] Range: ${range}, Baseline: ${baseline}, CurrentTotal: ${currentTotal}, Data points: ${formattedHistory.length}, Last: ${JSON.stringify(formattedHistory[formattedHistory.length - 1])}`);
        res.json(formattedHistory);

    } catch (err: any) {
        logger.error('[ADMIN-Analytics] ❌ History failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// User Growth Analytics
router.get('/analytics/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const range = (req.query.range as string) || '30d'; // Default longer range for users
        let interval = 'day';
        let lookbackDays = 30;

        if (range === '24h') {
            interval = 'hour';
            lookbackDays = 1;
        } else if (range === '7d') {
            interval = 'day';
            lookbackDays = 7;
        } else if (range === '90d') {
            interval = 'week';
            lookbackDays = 90;
        }

        // 0. Auto-Backfill Check
        const [uCountRes] = await db.select({ count: sql<number>`count(*)` }).from(users);
        const [sCountRes] = await db.select({ count: sql<number>`count(*)` })
            .from(analyticsEvents)
            .where(eq(analyticsEvents.type, 'user_signup'));

        const actualUserCount = Number(uCountRes?.count || 0);
        const recordedSignupEvents = Number(sCountRes?.count || 0);

        logger.info(`[ANALYTICS] Backfill check: ${actualUserCount} users in DB vs ${recordedSignupEvents} signup events recorded.`);

        if (actualUserCount > recordedSignupEvents) {
            logger.info(`[ANALYTICS] User count mismatch (${actualUserCount} vs ${recordedSignupEvents}), running/resuming backfill...`);
            const backfillEvents: any[] = [];

            const allUsers = await db.select().from(users);

            // Get already recorded meta to avoid duplicates
            const existingMeta = await db.select({ meta: analyticsEvents.meta })
                .from(analyticsEvents)
                .where(sql`${analyticsEvents.type} IN ('user_signup', 'user_upgrade')`);
            const metaSet = new Set(existingMeta.map(m => m.meta));

            for (const u of allUsers) {
                const signupMeta = `backfill_user_${u.id}`;
                if (!metaSet.has(signupMeta)) {
                    backfillEvents.push({
                        type: 'user_signup',
                        bytes: 1,
                        timestamp: u.created_at || new Date(),
                        meta: signupMeta
                    });
                }

                if (u.subscription_tier === 'pro') {
                    const upgradeMeta = `backfill_user_paid_${u.id}`;
                    if (!metaSet.has(upgradeMeta)) {
                        backfillEvents.push({
                            type: 'user_upgrade',
                            bytes: 1,
                            timestamp: u.created_at || new Date(),
                            meta: upgradeMeta
                        });
                    }
                }
            }

            if (backfillEvents.length > 0) {
                const chunkSize = 100;
                for (let i = 0; i < backfillEvents.length; i += chunkSize) {
                    await db.insert(analyticsEvents).values(backfillEvents.slice(i, i + chunkSize));
                }
                logger.info(`[ANALYTICS] Inserted ${backfillEvents.length} missing backfill events.`);
            }
        }

        // 1. Calculate Baselines
        const baselineTotalSelect = sql`
            SELECT COALESCE(SUM(CASE 
                WHEN type = 'user_signup' THEN bytes 
                WHEN type = 'user_delete' THEN -bytes 
                ELSE 0 END), 0) as total
            FROM analytics_events
            WHERE timestamp < NOW() - INTERVAL '${sql.raw(lookbackDays.toString())} days'
        `;
        const baselineTotal = await db.execute(baselineTotalSelect);

        const baselinePaidSelect = sql`
            SELECT COALESCE(SUM(CASE 
                WHEN type = 'user_upgrade' THEN bytes 
                WHEN type = 'user_downgrade' THEN -bytes 
                ELSE 0 END), 0) as total
            FROM analytics_events
            WHERE timestamp < NOW() - INTERVAL '${sql.raw(lookbackDays.toString())} days'
        `;
        const baselinePaid = await db.execute(baselinePaidSelect);

        logger.info(`[ANALYTICS-DEBUG] Baselines - Total RAW: ${JSON.stringify(baselineTotal)}, Paid RAW: ${JSON.stringify(baselinePaid)}`);

        // Handle both possible drizzle execute return formats (array or {rows: array})
        const getBaselineValue = (res: any) => {
            const row = Array.isArray(res) ? res[0] : res.rows?.[0];
            return Number(row?.total || 0);
        };

        let runningTotal = getBaselineValue(baselineTotal);
        let runningPaid = getBaselineValue(baselinePaid);

        logger.info(`[ANALYTICS-DEBUG] Calculated initial totals: Total=${runningTotal}, Paid=${runningPaid}`);

        // 2. Fetch Deltas
        const deltasSelect = sql`
            SELECT 
                date_trunc(${sql.raw(`'${interval}'`)}, timestamp) as date,
                SUM(CASE 
                    WHEN type = 'user_signup' THEN bytes 
                    WHEN type = 'user_delete' THEN -bytes 
                    ELSE 0 END) as total_delta,
                SUM(CASE 
                    WHEN type = 'user_upgrade' THEN bytes 
                    WHEN type = 'user_downgrade' THEN -bytes 
                    ELSE 0 END) as paid_delta
            FROM analytics_events
            WHERE timestamp >= NOW() - INTERVAL '${sql.raw(lookbackDays.toString())} days'
            GROUP BY 1
            ORDER BY 1 ASC
        `;
        const deltas = await db.execute(deltasSelect);
        const deltaRows = Array.isArray(deltas) ? deltas : (deltas as any).rows || [];

        logger.info(`[ANALYTICS-DEBUG] Deltas found: ${deltaRows.length}`);

        // 3. Accumulate
        const history: any[] = [];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - lookbackDays);

        // Always add the baseline point at the start of the window
        history.push({
            date: startDate.toISOString(),
            total: runningTotal,
            paid: runningPaid
        });

        deltaRows.forEach((row: any) => {
            runningTotal += Number(row.total_delta || 0);
            runningPaid += Number(row.paid_delta || 0);
            history.push({
                date: row.date,
                total: runningTotal,
                paid: runningPaid
            });
        });

        // Always add a final point for current time to ensure the line extends to "now"
        history.push({
            date: new Date().toISOString(),
            total: runningTotal,
            paid: runningPaid
        });

        res.json(history);

    } catch (err: any) {
        logger.error('[ANALYTICS] Users failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// Analytics Pulse Endpoint (Recent Activity)
router.get('/analytics/pulse', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const recentFiles = await db.select({
            id: files.id,
            hash: files.jackal_fid,
            jackal_filename: files.jackal_filename,
            size: files.file_size,
            created_at: files.created_at,
        })
            .from(files)
            .orderBy(desc(files.created_at))
            .limit(20);

        const recentChunks = await db.select({
            id: fileChunks.id,
            hash: fileChunks.jackal_merkle,
            size: fileChunks.size,
            created_at: fileChunks.created_at,
        })
            .from(fileChunks)
            .orderBy(desc(fileChunks.created_at))
            .limit(20);

        const merged = [
            ...recentFiles.map(f => ({
                ...f,
                type: 'file',
                storage_type: 'single', // We'll assume single for pulse unless we join chunks
                storage_id: f.jackal_filename || f.hash || 'Unknown'
            })),
            ...recentChunks.map(c => ({
                ...c,
                type: 'chunk',
                storage_type: 'blob',
                storage_id: c.hash || 'pending'
            }))
        ].sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateB - dateA;
        });

        res.json(merged);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Prune Graveyard Item (Final Delete from Network)
router.delete('/graveyard/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const [item] = await db.select().from(graveyard).where(eq(graveyard.id, id)).limit(1);
        if (!item) return res.status(404).json({ error: 'Item not found' });

        // TODO: Call Jackal to delete file from network (requires admin mnemonic or file owner signature)
        // For now, we just remove record and log event (simulating prune)

        await db.delete(graveyard).where(eq(graveyard.id, id));

        // Analytics Event (Prune)
        await db.insert(analyticsEvents).values({
            type: 'prune',
            bytes: item.file_size || 0,
            meta: `prune_gv_${id}`
        });

        res.json({ success: true });
    } catch (err: any) {
        logger.error('[ADMIN-PRUNE] Failed:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
