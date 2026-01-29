import { db } from '../db';
import { files, fileChunks } from '../db/schema';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import logger from './logger';
import { uploadQueue } from './uploadQueue';
import { getJackalHandler, uploadFileToJackal, verifyOnGateway } from '../jackal';
import { withTimeout } from './promise';
import fs from 'fs';

/**
 * Retry upload for a single monolithic file
 */
export async function retryFileUpload(fileId: number): Promise<void> {
    const [file] = await db.select({
        id: files.id,
        userId: files.userId,
        jackal_filename: files.jackal_filename,
        encrypted_file_path: files.encrypted_file_path,
        file_size: files.file_size
    })
        .from(files)
        .where(and(eq(files.id, fileId), isNull(files.deleted_at)))
        .limit(1);

    if (!file) {
        logger.warn(`[RETRY] File ${fileId} not found or deleted - skipping retry`);
        return;
    }

    if (!file.encrypted_file_path || !fs.existsSync(file.encrypted_file_path)) {
        logger.warn(`[RETRY] File ${fileId} local encrypted copy missing - skipping retry`);
        return;
    }

    logger.info(`[RETRY] Starting retry for file ${fileId}`);

    const now = new Date().toISOString();
    await db.update(files).set({ last_retry_at: now }).where(eq(files.id, fileId));

    uploadQueue.add(async () => {
        try {
            const { storage: jackalStorage } = await getJackalHandler();
            const jackalFilename = file.jackal_filename || `${file.userId}_${fileId}_file`;

            const fileSizeMB = file.file_size / (1024 * 1024);
            const timeoutMs = (15 * 60 * 1000) + (fileSizeMB * 5000);

            const result = await withTimeout(
                uploadFileToJackal(jackalStorage, file.encrypted_file_path!, jackalFilename),
                timeoutMs,
                `Retry upload timed out after ${Math.round(timeoutMs / 1000)}s`
            );

            if (result.success && result.merkle_hash) {
                await db.update(files)
                    .set({ jackal_fid: result.merkle_hash, merkle_hash: result.merkle_hash, jackal_filename: jackalFilename })
                    .where(eq(files.id, fileId));

                logger.info(`[RETRY] ✅ File ${fileId} uploaded to Jackal`);

                verifyOnGateway(result.merkle_hash).then(async (verified: boolean) => {
                    if (verified) {
                        await db.update(files).set({ is_gateway_verified: 1, encrypted_file_path: null }).where(eq(files.id, fileId));
                        if (fs.existsSync(file.encrypted_file_path!)) fs.unlinkSync(file.encrypted_file_path!);
                    }
                });
            }
        } catch (error: any) {
            logger.error(`[RETRY] ❌ File ${fileId} retry failed:`, error.message);
            await db.update(files).set({
                retry_count: sql`${files.retry_count} + 1`,
                last_retry_at: new Date().toISOString(),
                failure_reason: error.message || 'Retry failed'
            }).where(eq(files.id, fileId));
        }
    });
}

/**
 * Retry upload for specific chunks of a file
 */
export async function retryChunkUploads(fileId: number, chunkIds?: string[]): Promise<void> {
    const [file] = await db.select({
        id: files.id,
        jackal_filename: files.jackal_filename
    }).from(files).where(and(eq(files.id, fileId), isNull(files.deleted_at))).limit(1);

    if (!file) throw new Error(`File ${fileId} not found or deleted`);

    let chunkList;
    if (chunkIds && chunkIds.length > 0) {
        chunkList = await db.select().from(fileChunks).where(and(inArray(fileChunks.id, chunkIds), eq(fileChunks.fileId, fileId)));
    } else {
        chunkList = await db.select().from(fileChunks).where(and(eq(fileChunks.fileId, fileId), sql`(${fileChunks.jackal_merkle} is null or ${fileChunks.is_gateway_verified} = 0)`));
    }

    if (chunkList.length === 0) {
        logger.info(`[RETRY] No chunks to retry for file ${fileId}`);
        return;
    }

    const now = new Date().toISOString();
    const idsToUpdate = chunkList.map(c => c.id);
    await db.update(fileChunks).set({ last_retry_at: now }).where(inArray(fileChunks.id, idsToUpdate));

    for (const chunk of chunkList) {
        if (!chunk.local_path || !fs.existsSync(chunk.local_path)) continue;

        uploadQueue.add(async () => {
            try {
                const { storage: jackalStorage } = await getJackalHandler();
                const chunkJackalName = `${file.jackal_filename || `file_${fileId}`}_chunk_${chunk.chunk_index}`;

                const fileSizeMB = chunk.size / (1024 * 1024);
                const timeoutMs = (10 * 60 * 1000) + (fileSizeMB * 5000);

                const result = await withTimeout(
                    uploadFileToJackal(jackalStorage, chunk.local_path!, chunkJackalName),
                    timeoutMs,
                    `Chunk retry timed out`
                );

                if (result.success && result.merkle_hash) {
                    await db.update(fileChunks).set({ jackal_merkle: result.merkle_hash, jackal_cid: result.cid || null }).where(eq(fileChunks.id, chunk.id));
                    verifyOnGateway(result.merkle_hash).then(async verified => {
                        if (verified) {
                            await db.update(fileChunks).set({ is_gateway_verified: 1, local_path: null }).where(eq(fileChunks.id, chunk.id));
                            if (fs.existsSync(chunk.local_path!)) fs.unlinkSync(chunk.local_path!);
                        }
                    });
                }
            } catch (error: any) {
                await db.update(fileChunks).set({
                    retry_count: sql`${fileChunks.retry_count} + 1`,
                    last_retry_at: new Date().toISOString(),
                    failure_reason: error.message || 'Chunk retry failed'
                }).where(eq(fileChunks.id, chunk.id));
            }
        });
    }
}
