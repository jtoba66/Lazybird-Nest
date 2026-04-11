import { db } from '../db';
import { files as filesTable, users, fileChunks } from '../db/schema';
import { eq, and, sql, isNull, or, isNotNull } from 'drizzle-orm';
import fs from 'fs';
import logger from '../utils/logger';
import { retryFileUpload, retryChunkUploads } from '../utils/retryHandler';
import { verifyOnGateway } from '../jackal';

/**
 * UploadRecoveryService (formerly UploadCleanupService)
 * 
 * DATA SAFETY RULE: Never delete a file or chunk unless it is verified on Jackal.
 * If it's not on Jackal, re-queue it for upload. Retry forever.
 * 
 * This service monitors stale uploads (pending for 24+ hours) and attempts to
 * recover them by:
 * 1. Verifying chunks/files already on Jackal and updating DB accordingly
 * 2. Re-queuing unfinished uploads back to the upload queue
 * 3. Auto-finalizing chunked files when all chunks are verified
 * 4. Only cleaning up local files AFTER Jackal verification succeeds
 */
export class UploadCleanupService {
    private static interval: NodeJS.Timeout | null = null;
    private static readonly STALE_THRESHOLD_HOURS = 24;
    private static readonly RECOVERY_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

    static start() {
        if (this.interval) return;
        logger.info('[RECOVERY-SERVICE] Starting stale upload recovery guardian...');
        // Run once on startup after 60 seconds (give other services time to init)
        setTimeout(() => this.recover(), 60000);
        this.interval = setInterval(() => this.recover(), this.RECOVERY_INTERVAL_MS);
    }

    static stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    private static async recover() {
        logger.info('[RECOVERY-SERVICE] Scanning for stale uploads to recover...');

        try {
            // 1. Find files in 'pending-chunks' or 'pending' state older than threshold
            const staleFiles = await db.select({
                id: filesTable.id,
                userId: filesTable.userId,
                file_size: filesTable.file_size,
                jackal_fid: filesTable.jackal_fid,
                merkle_hash: filesTable.merkle_hash,
                encrypted_file_path: filesTable.encrypted_file_path,
                is_chunked: filesTable.is_chunked,
                retry_count: filesTable.retry_count
            })
                .from(filesTable)
                .where(and(
                    or(
                        eq(filesTable.jackal_fid, 'pending-chunks'),
                        eq(filesTable.jackal_fid, 'pending'),
                        eq(filesTable.merkle_hash, 'pending'),
                        eq(filesTable.merkle_hash, 'pending-chunks')
                    ),
                    isNull(filesTable.deleted_at),
                    sql`${filesTable.created_at} < now() - interval '24 hours'`
                ));

            if (staleFiles.length === 0) {
                logger.debug('[RECOVERY-SERVICE] No stale uploads found.');
                return;
            }

            logger.info(`[RECOVERY-SERVICE] Found ${staleFiles.length} stale uploads. Attempting recovery...`);

            for (const file of staleFiles) {
                try {
                    await this.recoverFile(file);
                } catch (err: any) {
                    logger.error(`[RECOVERY-SERVICE] ❌ Failed to recover file ${file.id}:`, err.message);
                }
            }

        } catch (error) {
            logger.error('[RECOVERY-SERVICE] ❌ Fatal error during recovery cycle:', error);
        }
    }

    private static async recoverFile(file: {
        id: number;
        userId: number;
        file_size: number;
        jackal_fid: string | null;
        merkle_hash: string | null;
        encrypted_file_path: string | null;
        is_chunked: number | null;
        retry_count: number | null;
    }) {
        const fileId = file.id;
        const isChunked = file.is_chunked || file.jackal_fid === 'pending-chunks';

        if (isChunked) {
            await this.recoverChunkedFile(file);
        } else {
            await this.recoverMonolithicFile(file);
        }
    }

    /**
     * Recovery for chunked files:
     * - Check each chunk's Jackal status
     * - Re-queue unverified chunks that have local data
     * - Auto-finalize if all chunks are verified
     */
    private static async recoverChunkedFile(file: {
        id: number;
        userId: number;
        jackal_fid: string | null;
        retry_count: number | null;
    }) {
        const fileId = file.id;
        const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));

        if (chunks.length === 0) {
            logger.warn(`[RECOVERY-SERVICE] File ${fileId} is chunked but has 0 chunks — nothing to recover.`);
            return;
        }

        let verifiedCount = 0;
        let requeuedCount = 0;
        let unreachableCount = 0;

        for (const chunk of chunks) {
            // Already verified — nothing to do
            if (chunk.is_gateway_verified) {
                verifiedCount++;

                // Clean up local copy if still lingering
                if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                    fs.unlinkSync(chunk.local_path);
                    await db.update(fileChunks).set({ local_path: null }).where(eq(fileChunks.id, chunk.id));
                    logger.info(`[RECOVERY-SERVICE] Cleaned verified local chunk ${chunk.chunk_index} for file ${fileId}`);
                }
                continue;
            }

            // Has a merkle hash but not yet verified — try to verify now
            if (chunk.jackal_merkle && chunk.jackal_merkle !== 'pending') {
                const verified = await verifyOnGateway(chunk.jackal_merkle, 3, 10000);
                if (verified) {
                    await db.update(fileChunks).set({ is_gateway_verified: 1, local_path: null }).where(eq(fileChunks.id, chunk.id));
                    if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                        fs.unlinkSync(chunk.local_path);
                    }
                    verifiedCount++;
                    logger.info(`[RECOVERY-SERVICE] ✅ Chunk ${chunk.chunk_index} of file ${fileId} verified on gateway`);
                    continue;
                }
            }

            // Not on Jackal — re-queue if local data exists
            if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                // Reset retry count so RetryScheduler picks it up again
                await db.update(fileChunks).set({
                    retry_count: 0,
                    failure_reason: null,
                    jackal_merkle: 'pending'
                }).where(eq(fileChunks.id, chunk.id));
                requeuedCount++;
                logger.info(`[RECOVERY-SERVICE] 🔄 Re-queued chunk ${chunk.chunk_index} of file ${fileId} for upload`);
            } else {
                // No local data AND not on Jackal — this chunk is truly lost
                unreachableCount++;
                logger.error(`[RECOVERY-SERVICE] ⚠️ Chunk ${chunk.chunk_index} of file ${fileId} has no local data and is not on Jackal`);
            }
        }

        // If all chunks are verified, auto-finalize the file
        if (verifiedCount === chunks.length) {
            await db.update(filesTable).set({
                jackal_fid: 'chunked-complete',
                merkle_hash: 'chunked-complete',
                is_chunked: 1,
                chunk_count: chunks.length
            }).where(eq(filesTable.id, fileId));
            logger.info(`[RECOVERY-SERVICE] ✅ Auto-finalized file ${fileId} — all ${chunks.length} chunks verified`);
        } else {
            // Reset file-level retry count so the system keeps trying
            await db.update(filesTable).set({
                retry_count: 0,
                failure_reason: null
            }).where(eq(filesTable.id, fileId));

            logger.info(`[RECOVERY-SERVICE] File ${fileId} recovery status: ${verifiedCount}/${chunks.length} verified, ${requeuedCount} re-queued, ${unreachableCount} unreachable`);
        }
    }

    /**
     * Recovery for monolithic (non-chunked) files:
     * - If local file exists, reset retry count so RetryScheduler picks it up
     * - If merkle exists but unverified, try to verify
     */
    private static async recoverMonolithicFile(file: {
        id: number;
        userId: number;
        merkle_hash: string | null;
        encrypted_file_path: string | null;
        retry_count: number | null;
    }) {
        const fileId = file.id;

        // Has merkle but not verified — try to verify now
        if (file.merkle_hash && file.merkle_hash !== 'pending' && file.merkle_hash !== 'pending-chunks') {
            const verified = await verifyOnGateway(file.merkle_hash, 3, 10000);
            if (verified) {
                await db.update(filesTable).set({
                    is_gateway_verified: 1,
                    encrypted_file_path: null
                }).where(eq(filesTable.id, fileId));

                if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                    fs.unlinkSync(file.encrypted_file_path);
                }
                logger.info(`[RECOVERY-SERVICE] ✅ Monolithic file ${fileId} verified on gateway`);
                return;
            }
        }

        // Not on Jackal — re-queue if local data exists
        if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
            // Reset retry count so RetryScheduler picks it up forever
            await db.update(filesTable).set({
                retry_count: 0,
                failure_reason: null
            }).where(eq(filesTable.id, fileId));
            logger.info(`[RECOVERY-SERVICE] 🔄 Reset retry count for monolithic file ${fileId} — RetryScheduler will re-attempt`);
        } else {
            logger.error(`[RECOVERY-SERVICE] ⚠️ Monolithic file ${fileId} has no local data and is not on Jackal — unrecoverable`);
        }
    }
}
