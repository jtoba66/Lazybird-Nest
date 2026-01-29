import os from 'os';
import logger from '../utils/logger';
import { env } from '../config/env';
import { execSync } from 'child_process';

interface ResourceMetrics {
    cpuLoadPercent: number;
    memoryUsedPercent: number;
    memoryFreeMB: number;
    memoryTotalMB: number;
    diskUsedPercent: number;
    activeJobs: number;
    currentMaxConcurrent: number;
    timestamp: number;
}

class ResourceMonitor {
    private maxConcurrent: number;
    private readonly minConcurrent = 2;
    private readonly maxConcurrentLimit = 12;
    private readonly cpuThresholdHigh: number;
    private readonly cpuThresholdLow: number;
    private readonly memoryThresholdLow: number;
    private readonly diskThresholdHigh: number;
    private readonly checkInterval: number;
    private intervalId?: NodeJS.Timeout;
    private metrics: ResourceMetrics;

    constructor() {
        // Read from validated config
        this.maxConcurrent = env.MAX_CONCURRENT_JOBS;
        this.cpuThresholdHigh = env.CPU_THRESHOLD_HIGH;
        this.cpuThresholdLow = env.CPU_THRESHOLD_LOW;
        this.memoryThresholdLow = env.MEMORY_THRESHOLD_LOW;
        this.diskThresholdHigh = 90; // Default 90%
        this.checkInterval = env.ADAPTIVE_CHECK_INTERVAL;

        this.metrics = this.collectMetrics();
    }

    /**
     * Collect current system resource metrics
     */
    private collectMetrics(): ResourceMetrics {
        // CPU Load (1 minute average)
        const loadAvg = os.loadavg()[0]; // 1-minute load average
        const cpuCount = os.cpus().length;
        const cpuLoadPercent = Math.round((loadAvg / cpuCount) * 100);

        // Memory
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memoryUsedPercent = Math.round((usedMem / totalMem) * 100);
        const memoryFreeMB = Math.round(freeMem / (1024 * 1024));
        const memoryTotalMB = Math.round(totalMem / (1024 * 1024));

        // Disk (Shell out to df on Mac/Linux)
        let diskUsedPercent = 0;
        try {
            const output = execSync("df -h / | tail -1 | awk '{print $5}'").toString().trim();
            diskUsedPercent = parseInt(output.replace('%', ''));
        } catch (e) {
            logger.warn('Failed to collect disk metrics', e);
        }

        return {
            cpuLoadPercent,
            memoryUsedPercent,
            memoryFreeMB,
            memoryTotalMB,
            diskUsedPercent,
            activeJobs: 0, // Will be updated by queue
            currentMaxConcurrent: this.maxConcurrent,
            timestamp: Date.now()
        };
    }

    /**
     * Adjust MAX_CONCURRENT based on resource usage
     */
    private adjustConcurrency(): void {
        const metrics = this.collectMetrics();
        const memoryFreePercent = 100 - metrics.memoryUsedPercent;

        let adjustment = 0;
        let reason = '';

        // Check if we should decrease concurrency
        if (metrics.cpuLoadPercent > this.cpuThresholdHigh) {
            adjustment = -1;
            reason = `CPU load high (${metrics.cpuLoadPercent}%)`;
        } else if (memoryFreePercent < this.memoryThresholdLow) {
            adjustment = -1;
            reason = `Memory low (${memoryFreePercent}% free)`;
        }
        // Check if we should increase concurrency
        else if (metrics.cpuLoadPercent < this.cpuThresholdLow && memoryFreePercent > 30) {
            adjustment = 1;
            reason = `Resources available (CPU: ${metrics.cpuLoadPercent}%, Mem: ${memoryFreePercent}% free)`;
        }

        if (adjustment !== 0) {
            const newMax = Math.max(this.minConcurrent, Math.min(this.maxConcurrentLimit, this.maxConcurrent + adjustment));

            if (newMax !== this.maxConcurrent) {
                logger.info('Adaptive concurrency adjustment', {
                    from: this.maxConcurrent,
                    to: newMax,
                    reason,
                    cpuLoad: metrics.cpuLoadPercent,
                    memoryFree: memoryFreePercent
                });
                this.maxConcurrent = newMax;
            }
        }

        this.metrics = { ...metrics, currentMaxConcurrent: this.maxConcurrent };
    }

    /**
     * Start monitoring and adaptive adjustment
     */
    start(): void {
        if (process.env.ENABLE_ADAPTIVE_CONCURRENCY === 'false') {
            logger.info('Adaptive concurrency disabled');
            return;
        }

        logger.info('Starting adaptive concurrency monitor', {
            initialMax: this.maxConcurrent,
            cpuThresholds: `${this.cpuThresholdLow}-${this.cpuThresholdHigh}%`,
            memoryThreshold: `${this.memoryThresholdLow}% free`,
            checkInterval: `${this.checkInterval}ms`
        });

        // Initial check
        this.adjustConcurrency();

        // Periodic checks
        this.intervalId = setInterval(() => {
            this.adjustConcurrency();
        }, this.checkInterval);
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
            logger.info('Stopped adaptive concurrency monitor');
        }
    }

    /**
     * Get current MAX_CONCURRENT value
     */
    getMaxConcurrent(): number {
        return this.maxConcurrent;
    }

    /**
     * Get current metrics
     */
    getMetrics(): ResourceMetrics {
        return { ...this.metrics };
    }

    /**
     * Update active jobs count (called by queue)
     */
    setActiveJobs(count: number): void {
        this.metrics.activeJobs = count;
    }
}

// Singleton instance
export const resourceMonitor = new ResourceMonitor();
