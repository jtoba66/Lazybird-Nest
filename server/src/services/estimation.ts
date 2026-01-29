import db from '../db';
import { sql } from 'drizzle-orm';

interface TimeEstimate {
    minSeconds: number;
    maxSeconds: number;
    avgSeconds: number;
    confidence: 'high' | 'medium' | 'low';
    sampleSize: number;
}

/**
 * Get time estimate based on historical data
 * @param settings - Job settings (array of formats or cut operation)
 * @param durationSec - Video duration in seconds
 * @param fileSizeMB - File size in megabytes
 * @returns Time estimate with range and confidence
 */
export async function getLearnedEstimate(settings: any, durationSec: number, fileSizeMB: number): Promise<TimeEstimate> {
    // Determine if this is a cut operation
    const isCutOperation = !Array.isArray(settings) && settings.operation === 'cut';

    if (isCutOperation) {
        return await getCutEstimate(settings, durationSec);
    } else {
        return await getConversionEstimate(settings, durationSec, fileSizeMB);
    }
}

/**
 * Get estimate for cut operations
 */
async function getCutEstimate(settings: any, _durationSec: number): Promise<TimeEstimate> {
    const cutDuration = (settings.end || 0) - (settings.start || 0);
    const isFastMode = settings.mode === 'fast';

    // Query historical cut jobs
    const historicalJobs = await db.execute(sql`
        SELECT actual_processing_time, settings
        FROM jobs
        WHERE status = 'COMPLETED'
        AND actual_processing_time IS NOT NULL
        AND settings LIKE '%"operation":"cut"%'
        ORDER BY completed_at DESC
        LIMIT 50
    `) as any[];

    // Filter by mode
    const relevantJobs = historicalJobs.filter(job => {
        try {
            const s = JSON.parse(job.settings);
            return s.mode === settings.mode;
        } catch {
            return false;
        }
    });

    if (relevantJobs.length >= 3) {
        const times = relevantJobs.map(j => j.actual_processing_time);
        return {
            minSeconds: Math.min(...times),
            maxSeconds: Math.max(...times),
            avgSeconds: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
            confidence: relevantJobs.length >= 10 ? 'high' : relevantJobs.length >= 5 ? 'medium' : 'low',
            sampleSize: relevantJobs.length
        };
    }

    // Fallback to conservative estimate
    const multiplier = isFastMode ? 0.1 : 1.0;
    const estimate = Math.round(cutDuration * multiplier);
    return {
        minSeconds: Math.round(estimate * 0.7),
        maxSeconds: Math.round(estimate * 1.5),
        avgSeconds: estimate,
        confidence: 'low',
        sampleSize: 0
    };
}

/**
 * Get estimate for conversion operations
 */
async function getConversionEstimate(settings: string[], durationSec: number, fileSizeMB: number): Promise<TimeEstimate> {
    // Determine highest complexity format
    const hasOriginalOr1080p = settings.includes('original') || settings.includes('1080p');
    const has720p = settings.includes('720p');
    const has480p = settings.includes('480p');
    const hasAudio = settings.includes('audio');

    let primaryFormat = 'audio';
    if (hasOriginalOr1080p) primaryFormat = 'original';
    else if (has720p) primaryFormat = '720p';
    else if (has480p) primaryFormat = '480p';

    // Query historical jobs with similar settings
    const historicalJobs = await db.execute(sql`
        SELECT actual_processing_time, settings, file_size
        FROM jobs
        WHERE status = 'COMPLETED'
        AND actual_processing_time IS NOT NULL
        AND settings LIKE ${`%${primaryFormat}%`}
        ORDER BY completed_at DESC
        LIMIT 100
    `) as any[];

    // Filter by similar file size (within 50% range)
    const fileSizeBytes = fileSizeMB * 1024 * 1024;
    const relevantJobs = historicalJobs.filter(job => {
        if (!job.file_size) return true; // Include if no file size data
        const ratio = job.file_size / fileSizeBytes;
        return ratio >= 0.5 && ratio <= 2.0; // Within 50-200% of current file size
    });

    if (relevantJobs.length >= 3) {
        const times = relevantJobs.map(j => j.actual_processing_time);
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const stdDev = Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length);

        return {
            minSeconds: Math.max(10, Math.round(avg - stdDev)),
            maxSeconds: Math.round(avg + stdDev),
            avgSeconds: Math.round(avg),
            confidence: relevantJobs.length >= 10 ? 'high' : relevantJobs.length >= 5 ? 'medium' : 'low',
            sampleSize: relevantJobs.length
        };
    }

    // Fallback to conservative estimate
    let multiplier = 0.5;
    if (hasOriginalOr1080p) multiplier = 1.2;
    else if (has720p) multiplier = 0.8;
    else if (has480p) multiplier = 0.5;
    else if (hasAudio) multiplier = 0.3;

    const estimate = Math.round(durationSec * multiplier);
    return {
        minSeconds: Math.round(estimate * 0.7),
        maxSeconds: Math.round(estimate * 1.5),
        avgSeconds: estimate,
        confidence: 'low',
        sampleSize: 0
    };
}

/**
 * Format time estimate for display
 */
export function formatTimeEstimate(estimate: TimeEstimate): string {
    const minMin = Math.ceil(estimate.minSeconds / 60);
    const maxMin = Math.ceil(estimate.maxSeconds / 60);

    if (estimate.confidence === 'low') {
        return `~${maxMin} min (estimating...)`;
    }

    if (minMin === maxMin) {
        return `~${minMin} min`;
    }

    return `${minMin}-${maxMin} min`;
}
