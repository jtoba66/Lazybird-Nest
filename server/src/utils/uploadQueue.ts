import logger from './logger';

type Task = () => Promise<void>;

class UploadQueue {
    private queue: Task[] = [];
    private isProcessing: boolean = false;

    /**
     * Add a task to the queue and trigger processing
     */
    public add(task: Task) {
        this.queue.push(task);
        logger.info(`[UPLOAD-QUEUE] Task added. Queue size: ${this.queue.length}`);
        this.processNext();
    }

    /**
     * Process the next task in the queue if immediately available
     */
    private async processNext() {
        if (this.isProcessing) {
            return;
        }

        if (this.queue.length === 0) {
            logger.info('[UPLOAD-QUEUE] Queue empty. Idle.');
            return;
        }

        this.isProcessing = true;
        const task = this.queue.shift();

        if (task) {
            try {
                await task();
            } catch (error: any) {
                logger.error('[UPLOAD-QUEUE] Task execution failed:', error);
            } finally {
                this.isProcessing = false;
                // Process next task recursively
                this.processNext();
            }
        } else {
            this.isProcessing = false;
        }
    }

    public getSize(): number {
        return this.queue.length;
    }

    public isBusy(): boolean {
        return this.isProcessing;
    }
}

// Export singleton instance
export const uploadQueue = new UploadQueue();
