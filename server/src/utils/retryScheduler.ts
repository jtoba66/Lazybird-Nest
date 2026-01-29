import { db } from '../db';
import { files, fileChunks } from '../db/schema';
import { eq, and, isNull, sql, lt, isNotNull } from 'drizzle-orm';
import logger from './logger';
import { retryFileUpload, retryChunkUploads } from './retryHandler';

interface RetrySchedule {
    attemptNumber: number;
    delayMinutes: number;
}

// Exponential backoff: 5min → 30min → 2hr
const RETRY_SCHEDULE: RetrySchedule[] = [
    { attemptNumber: 1, delayMinutes: 5 },
    { attemptNumber: 2, delayMinutes: 30 },
    { attemptNumber: 3, delayMinutes: 120 }
];

const MAX_AUTO_RETRIES = 3;

class RetryScheduler {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('[RetryScheduler] Starting background retry scheduler');
        this.checkAndScheduleRetries();
        this.intervalId = setInterval(() => this.checkAndScheduleRetries(), 60 * 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info('[RetryScheduler] Stopped');
    }

    private async checkAndScheduleRetries() {
        try {
            await this.retryFailedFiles();
            await this.retryFailedChunks();
        } catch (err) {
            logger.error('[RetryScheduler] Error during retry check:', err);
        }
    }

    private async retryFailedFiles() {
        const minRetryDelay = this.getRetryDelay(0);

        const eligibleFiles = await db.select({
            id: files.id,
            retry_count: files.retry_count,
            last_retry_at: files.last_retry_at
        })
            .from(files)
            .where(and(
                eq(files.is_chunked, 0),
                isNull(files.deleted_at),
                lt(files.retry_count, MAX_AUTO_RETRIES),
                isNull(files.merkle_hash),
                isNotNull(files.encrypted_file_path),
                sql`(${files.last_retry_at} IS NULL OR ${files.last_retry_at}::timestamp + (${minRetryDelay} || ' minutes')::interval <= now())`
            ));

        for (const file of eligibleFiles) {
            const delayMinutes = this.getRetryDelay(file.retry_count || 0);
            const shouldRetry = !file.last_retry_at || this.hasEnoughTimePassed(file.last_retry_at, delayMinutes);

            if (shouldRetry) {
                logger.info(`[RetryScheduler] Scheduling retry for file ${file.id} - Attempt ${(file.retry_count || 0) + 1}`);
                retryFileUpload(file.id).catch(e => logger.error(`[RetryScheduler] Failed file retry ${file.id}:`, e));
            }
        }
    }

    private async retryFailedChunks() {
        const minRetryDelay = this.getRetryDelay(0);

        const eligibleChunks = await db.select({
            id: fileChunks.id,
            file_id: fileChunks.fileId,
            retry_count: fileChunks.retry_count,
            last_retry_at: fileChunks.last_retry_at
        })
            .from(fileChunks)
            .innerJoin(files, eq(fileChunks.fileId, files.id))
            .where(and(
                isNull(files.deleted_at),
                lt(fileChunks.retry_count, MAX_AUTO_RETRIES),
                isNull(fileChunks.jackal_merkle),
                isNotNull(fileChunks.local_path),
                sql`(${fileChunks.last_retry_at} IS NULL OR ${fileChunks.last_retry_at}::timestamp + (${minRetryDelay} || ' minutes')::interval <= now())`
            ));

        const chunksByFile = new Map<number, any[]>();
        for (const chunk of eligibleChunks) {
            if (!chunksByFile.has(chunk.file_id)) chunksByFile.set(chunk.file_id, []);
            chunksByFile.get(chunk.file_id)!.push(chunk);
        }

        for (const [fileId, chunks] of chunksByFile) {
            const filtered = chunks.filter(c => {
                const delayMinutes = this.getRetryDelay(c.retry_count || 0);
                return !c.last_retry_at || this.hasEnoughTimePassed(c.last_retry_at, delayMinutes);
            });

            if (filtered.length > 0) {
                logger.info(`[RetryScheduler] Scheduling retry for ${filtered.length} chunks of file ${fileId}`);
                retryChunkUploads(fileId, filtered.map(c => c.id)).catch(e => logger.error(`[RetryScheduler] Failed chunk retry ${fileId}:`, e));
            }
        }
    }

    private getRetryDelay(retryCount: number): number {
        const schedule = RETRY_SCHEDULE.find(s => s.attemptNumber === retryCount + 1);
        return schedule ? schedule.delayMinutes : RETRY_SCHEDULE[RETRY_SCHEDULE.length - 1].delayMinutes;
    }

    private hasEnoughTimePassed(lastRetryAt: string, delayMinutes: number): boolean {
        const lastRetry = new Date(lastRetryAt);
        const nextRetryTime = new Date(lastRetry.getTime() + delayMinutes * 60 * 1000);
        return new Date() >= nextRetryTime;
    }
}

export const retryScheduler = new RetryScheduler();
