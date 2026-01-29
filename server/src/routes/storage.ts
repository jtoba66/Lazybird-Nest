import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { db } from '../db';
import { users, files, folders } from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import logger from '../utils/logger';

const router = express.Router();

/**
 * Get storage quota and usage for authenticated user
 */
router.get('/quota', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const userId = req.user!.userId;

        const [user] = await db.select({
            storage_used_bytes: users.storage_used_bytes,
            storage_quota_bytes: users.storage_quota_bytes,
            subscription_tier: users.subscription_tier,
            email: users.email
        })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Self-healing: If user is Pro but quota is incorrect (less than 100GB), fix it
        const PRO_QUOTA = 100 * 1024 * 1024 * 1024;
        if (user.subscription_tier === 'pro' && (user.storage_quota_bytes || 0) < PRO_QUOTA) {
            await db.update(users).set({ storage_quota_bytes: PRO_QUOTA }).where(eq(users.id, userId));
            user.storage_quota_bytes = PRO_QUOTA;
            logger.info(`[Storage Quota] Auto-corrected quota for Pro user ${userId} to 100GB`);
        }

        const isGodMode = user.email === 'josephtoba29@gmail.com';

        const response: any = {
            used: user.storage_used_bytes || 0,
            quota: user.storage_quota_bytes || 2 * 1024 * 1024 * 1024,
            tier: user.subscription_tier,
            percentage: ((user.storage_used_bytes || 0) / (user.storage_quota_bytes || 1)) * 100
        };

        if (isGodMode) {
            response.tier = 'God Mode';
            response.quota = 100 * 1024 * 1024 * 1024;
            response.percentage = ((user.storage_used_bytes || 0) / response.quota) * 100;
        }

        res.json(response);

    } catch (error: any) {
        logger.error('[Storage Quota] Error:', error);
        res.status(500).json({ error: 'Failed to get storage quota', message: error.message });
    }
});

/**
 * Get detailed storage usage breakdown
 */
router.get('/usage-breakdown', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const userId = req.user!.userId;

        // Total by folder
        // Note: Drizzle handles joins and grouping. Use sql for the folder name column logic if needed.
        const byFolder = await db.select({
            folderName: sql<string>`coalesce(${folders.path_hash}, 'Root')`, // Using path_hash as a placeholder for name since server is ZK
            folderId: sql<number>`coalesce(${files.folderId}, 0)`,
            fileCount: sql<number>`count(${files.id})`,
            totalSize: sql<number>`coalesce(sum(${files.file_size}), 0)`
        })
            .from(files)
            .leftJoin(folders, eq(files.folderId, folders.id))
            .where(and(eq(files.userId, userId), isNull(files.deleted_at)))
            .groupBy(files.folderId, folders.path_hash)
            .orderBy(sql`totalSize DESC`);

        // Total files and size
        const [totals] = await db.select({
            totalFiles: sql<number>`count(${files.id})`,
            totalSize: sql<number>`coalesce(sum(${files.file_size}), 0)`
        })
            .from(files)
            .where(and(eq(files.userId, userId), isNull(files.deleted_at)));

        res.json({
            byFolder,
            totals: {
                files: totals?.totalFiles || 0,
                bytes: totals?.totalSize || 0
            }
        });

    } catch (error: any) {
        logger.error('[Usage Breakdown] Error:', error);
        res.status(500).json({ error: 'Failed to get usage breakdown', message: error.message });
    }
});

export default router;
