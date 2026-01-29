import express from 'express';
import { db } from '../db';
import { files, users, folders, fileChunks } from '../db/schema';
import { eq, and, isNull, sql, isNotNull, desc, count, sum } from 'drizzle-orm';
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

router.get('/system', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const totalFiles = (await db.select({ count: count() }).from(files))[0].count;
        const totalUsers = (await db.select({ count: count() }).from(users))[0].count;
        const totalFolders = (await db.select({ count: count() }).from(folders))[0].count;
        const totalStorage = (await db.select({ sum: sum(files.file_size) }).from(files))[0].sum;

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
                totalFiles: Number(totalFiles),
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
        // Mock analytics or simple stats for now
        const totalFiles = (await db.select({ count: count() }).from(files))[0].count;
        const totalUploaded = (await db.select({ count: count() }).from(files).where(isNotNull(files.merkle_hash)))[0].count;

        res.json({
            jackal: {
                total: Number(totalFiles),
                uploaded: Number(totalUploaded),
                failed: 0, // Need a query for failed uploads
                uploadRate: totalFiles > 0 ? Math.round((Number(totalUploaded) / Number(totalFiles)) * 100) : 0
            },
            recent: {
                uploads24h: 0 // Placeholder
            }
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/failed-uploads', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Define failed as > 3 retries or older than 1 hour pending?
        // For now, just return files with retry_count > 0 and not verified
        const failed = await db.select({
            id: files.id,
            user_email: users.email,
            filename: files.jackal_filename,
            file_size: files.file_size,
            merkle_hash: files.merkle_hash,
            created_at: files.created_at,
            encrypted_file_path: files.encrypted_file_path,
            retry_count: files.retry_count
        })
            .from(files)
            .innerJoin(users, eq(files.userId, users.id))
            .where(and(
                isNull(files.deleted_at),
                sql`${files.retry_count} > 0`,
                eq(files.is_gateway_verified, 0)
            ))
            .limit(50);

        res.json(failed);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/graveyard', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const deleted = await db.select({
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
            .orderBy(desc(files.deleted_at))
            .limit(50);

        res.json(deleted);
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

            return { ...file, jackal_status, chunk_progress, can_retry: jackal_status !== 'uploaded' && (file.retry_count || 0) < 3 };
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

router.get('/system', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [fileStats] = await db.select({ count: sql<number>`count(*)` }).from(files);
        const [userStats] = await db.select({ count: sql<number>`count(*)` }).from(users);
        const [folderStats] = await db.select({ count: sql<number>`count(*)` }).from(folders);
        const [storageStats] = await db.select({ total: sql<number>`coalesce(sum(${files.file_size}), 0)` }).from(files);

        res.json({
            memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem(), usedPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100) },
            uptime: os.uptime(),
            load: os.loadavg(),
            database: { totalFiles: Number(fileStats.count), totalUsers: Number(userStats.count), totalFolders: Number(folderStats.count), totalStorage: Number(storageStats.total) }
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/analytics', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [jackalStats] = await db.select({
            total: sql<number>`count(*)`,
            uploaded: sql<number>`sum(case when ${files.merkle_hash} is not null and ${files.merkle_hash} != 'UNKNOWN' then 1 else 0 end)`,
            failed: sql<number>`sum(case when ${files.merkle_hash} is null or ${files.merkle_hash} = 'UNKNOWN' then 1 else 0 end)`
        }).from(files);

        const storageByUser = await db.select({
            email: users.email,
            file_count: sql<number>`count(${files.id})`,
            total_storage: sql<number>`coalesce(sum(${files.file_size}), 0)`
        })
            .from(users)
            .leftJoin(files, eq(users.id, files.userId))
            .groupBy(users.id)
            .orderBy(sql`total_storage DESC`)
            .limit(10);

        const [recentUploads] = await db.select({ count: sql<number>`count(*)` })
            .from(files)
            .where(sql`${files.created_at} >= now() - interval '24 hours'`);

        res.json({
            jackal: { total: Number(jackalStats.total), uploaded: Number(jackalStats.uploaded), failed: Number(jackalStats.failed), uploadRate: Number(jackalStats.total) > 0 ? Math.round((Number(jackalStats.uploaded) / Number(jackalStats.total)) * 100) : 0 },
            storage: storageByUser,
            recent: { uploads24h: Number(recentUploads.count) }
        });
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

router.get('/graveyard', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const graveyard = await db.select({
            id: files.id,
            jackal_fid: files.jackal_fid,
            merkle_hash: files.merkle_hash,
            jackal_filename: files.jackal_filename,
            file_size: files.file_size,
            is_chunked: files.is_chunked,
            chunk_count: files.chunk_count,
            created_at: files.created_at,
            deleted_at: files.deleted_at,
            user_id: files.userId,
            user_email: users.email
        })
            .from(files)
            .innerJoin(users, eq(files.userId, users.id))
            .where(and(isNotNull(files.deleted_at), isNotNull(files.merkle_hash)))
            .orderBy(desc(files.deleted_at));

        res.json(graveyard);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
