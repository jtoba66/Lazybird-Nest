import { db } from '../db';
import { files, fileChunks } from '../db/schema';
import { eq, and, isNull, sql, isNotNull } from 'drizzle-orm';
import logger from './logger';
import { retryFileUpload, retryChunkUploads } from './retryHandler';

interface RetrySchedule {
    attemptNumber: number;
    delayMinutes: number;
}

// Progressive backoff: 5min → 30min → 2hr → 6hr → 6hr (forever)
// After attempt 4, retries continue every 6 hours indefinitely.
const RETRY_SCHEDULE: RetrySchedule[] = [
    { attemptNumber: 1, delayMinutes: 5 },
    { attemptNumber: 2, delayMinutes: 30 },
    { attemptNumber: 3, delayMinutes: 120 },
    { attemptNumber: 4, delayMinutes: 360 },   // 6 hours
];

// No cap — retries are infinite. The tail delay (6h) applies forever.
const TAIL_DELAY_MINUTES = 360;

class RetryScheduler {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('[RetryScheduler] Starting background retry scheduler (infinite retries)');
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
        // No retry_count cap — find ALL files that need uploading
        const eligibleFiles = await db.select({
            id: files.id,
            retry_count: files.retry_count,
            last_retry_at: files.last_retry_at
        })
            .from(files)
            .where(and(
                eq(files.is_chunked, 0),
                isNull(files.deleted_at),
                // No lt(retry_count, MAX) — infinite retries
                isNotNull(files.encrypted_file_path),
                sql`(${files.merkle_hash} IS NULL OR ${files.merkle_hash} = 'pending')`,
                sql`(${files.last_retry_at} IS NULL OR ${files.last_retry_at}::timestamp + (${this.getRetryDelay(0)} || ' minutes')::interval <= now())`
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
        // No retry_count cap — find ALL chunks that need uploading
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
                // No lt(retry_count, MAX) — infinite retries
                isNotNull(fileChunks.local_path),
                sql`(${fileChunks.jackal_merkle} IS NULL OR ${fileChunks.jackal_merkle} = 'pending')`,
                sql`(${fileChunks.last_retry_at} IS NULL OR ${fileChunks.last_retry_at}::timestamp + (${this.getRetryDelay(0)} || ' minutes')::interval <= now())`
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
        return schedule ? schedule.delayMinutes : TAIL_DELAY_MINUTES;
    }

    private hasEnoughTimePassed(lastRetryAt: string, delayMinutes: number): boolean {
        const lastRetry = new Date(lastRetryAt);
        const nextRetryTime = new Date(lastRetry.getTime() + delayMinutes * 60 * 1000);
        return new Date() >= nextRetryTime;
    }
}

export const retryScheduler = new RetryScheduler();
