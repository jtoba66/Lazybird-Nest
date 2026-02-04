import './instrument'; // Must be first
import './bootstrap-undici';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import * as Sentry from "@sentry/node";
import { env } from './config/env';
import path from 'path';
import fs from 'fs';

// Import database to initialize schema
import { db } from './db';
import { sql } from 'drizzle-orm';

// Import routes
import authRoutes from './routes/auth';
import billingRoutes from './routes/billing';
import filesRoutes from './routes/files';
import foldersRoutes from './routes/folders';
import storageRoutes from './routes/storage';
import adminRoutes from './routes/admin';

import { globalLimiter } from './middleware/rateLimiter';

const app = express();
const PORT = env.PORT;

// Trust first proxy (Caddy) for accurate client IP detection
app.set('trust proxy', 1);

// Apply global rate limiter
app.use(globalLimiter);

// Production-only Security Guards
if (env.NODE_ENV === 'production') {
    // 1. Enforce HTTPS Redirection (via proxy headers)
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
            return res.redirect(`https://${req.header('host')}${req.url}`);
        }
        next();
    });

    // 2. Enable HSTS via Helmet (Strict Transport Security)
    app.use(helmet.hsts({
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }));
}

// Security middleware
app.use(helmet());
const allowedOrigins = [
    ...(env.FRONTEND_URL || 'http://localhost:5173').split(','),
    'https://nest.lazybird.io',
    'https://lazybird.io',
    'https://www.lazybird.io',
    'https://lazybird-nest.netlify.app'
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }

        // Allow any subdomain of lazybird.io
        if (origin.endsWith('.lazybird.io') || origin === 'https://lazybird.io') {
            return callback(null, true);
        }

        // Log blocked origin for debugging
        console.warn(`[CORS] Blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// Logging
app.use(morgan('dev'));

// Body parsing - IMPORTANT: Place raw handler before JSON for Stripe webhooks
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.get('/health', async (req, res) => {
    try {
        // Simple DB check
        await db.execute(sql`SELECT 1`);
        res.json({
            status: 'ok',
            database: 'connected',
            service: 'nest-server',
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        console.error('[Health Check Failure]', err);
        res.status(503).json({
            status: 'error',
            database: 'disconnected',
            message: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/folders', foldersRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/admin', adminRoutes);

app.get("/api/debug-sentry", function mainHandler(req, res) {
    throw new Error("My first Sentry error!");
});

// The error handler must be registered before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path });
});

// Error Handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Server Error]', err);

    // Manual Sentry capture as a fail-safe
    Sentry.captureException(err);

    res.status(err.status || 500).json({
        error: 'Internal server error',
        message: env.NODE_ENV === 'development' ? err.message : undefined
    });
});

import { initCrypto } from './crypto/keyManagement';
import { UploadCleanupService } from './services/uploadCleanup';
import { TrashReaperService } from './services/trashReaper';
import { retryScheduler } from './utils/retryScheduler';
import { startVerificationJob } from './cron/verificationJob';
import { initRetentionWorker } from './utils/retention';


// Start background services
UploadCleanupService.start();
TrashReaperService.start();
retryScheduler.start();
startVerificationJob();
initRetentionWorker();

// Fix #4 & #6: Register cron jobs for edge case cleanup
import cron from 'node-cron';
import { cleanupStaleUploads } from './jobs/cleanupStaleUploads';
import { autoPurgeTrash } from './jobs/autoPurgeTrash';

// Run stale upload cleanup every 6 hours
cron.schedule('0 */6 * * *', async () => {
    await cleanupStaleUploads();
});

// Run trash auto-purge every hour
cron.schedule('0 * * * *', async () => {
    await autoPurgeTrash();
});

console.log('[Cron] Background jobs initialized: stale uploads (6h), trash purge (1h)');

// Fix: Register email digest jobs
import { shareLinkDigestJob, accountInactiveJob } from './cron/emailJobs';
shareLinkDigestJob.start();
accountInactiveJob.start();
console.log('[Cron] Email digest jobs initialized: share digest (Mon), inactive nudge (Wed)');


// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down gracefully');
    retryScheduler.stop();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[Server] SIGINT received, shutting down gracefully');
    retryScheduler.stop();
    process.exit(0);
});

// Initialize Crypto then start server
initCrypto().then(() => {
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║   🪺 NEST - Zero-Knowledge Cloud Storage ║
║                                          ║
╠══════════════════════════════════════════╣
║  Server:  http://localhost:${PORT}       ║
║  Health:  http://localhost:${PORT}/health║
║  Mode:    ${env.NODE_ENV}              ║
╚══════════════════════════════════════════╝
        `);
    });
}).catch(err => {
    console.error('[Server] Failed to initialize crypto:', err);
    process.exit(1);
});

export default app;
