import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';

export const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' ? 1000 : 100, // Reduced to 100 requests per minute for prod, 1000 for dev/test
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip global limiter for chunk endpoints and uploads to prevent breaking large file transfers
        // These routes have their own specific limiters (uploadLimiter) or require high burst rates.
        return req.path.includes('/chunk') || req.path.includes('/upload');
    },
    message: { error: 'Too many requests, please try again later.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] Global limit exceeded by ${req.ip} on ${req.path}`);
        res.status(options.statusCode).send(options.message);
    }
});

// Stricter limiter for authentication routes
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Standard 10 attempts per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test', // Skip entirely during E2E tests
    message: { error: 'Too many authentication attempts, please try again in 15 minutes.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] Auth limit exceeded by ${req.ip} on ${req.path}`);
        res.status(options.statusCode).send(options.message);
    }
});

// Limiter for file upload routes (to prevent DDoS via large uploads)
export const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 500, // Limit each IP to 500 upload attempts per hour (better for chunked uploads)
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Upload limit exceeded, please try again in an hour.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] Upload limit exceeded by ${req.ip}`);
        res.status(options.statusCode).send(options.message);
    }
});

export const chunkLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 3000, // 3000 chunks per minute per IP (allows ~100MB/sec at 2MB chunks)
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Chunk rate limit exceeded, please slow down.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] Chunk limit exceeded by ${req.ip}`);
        res.status(options.statusCode).send(options.message);
    }
});

// Per-token limiter for Drop Zone PIN verification (prevent PIN brute-force).
// Keyed by the drop-zone token/slug rather than IP, so an attacker rotating IPs
// against a single short numeric PIN is still capped. Complements the IP-based
// shareLimiter and mirrors the 5-attempt lockout the collab OTP flow already has.
export const pinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 FAILED PIN attempts per 15 min per drop-zone token (across all IPs)
    standardHeaders: true,
    legacyHeaders: false,
    // Only count failures. A drop zone is shared with many legitimate uploaders, so
    // successful (correct-PIN) verifications must not consume the per-token budget —
    // otherwise a popular link could lock out real users. Wrong guesses (401) count.
    skipSuccessfulRequests: true,
    skip: () => process.env.NODE_ENV === 'test', // Skip entirely during E2E tests
    keyGenerator: (req) => `dz-pin:${req.params.tokenOrSlug || 'unknown'}`,
    message: { error: 'Too many incorrect PIN attempts for this link. Please try again in 15 minutes.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] PIN brute-force guard tripped for drop zone ${req.params.tokenOrSlug}`);
        res.status(options.statusCode).send(options.message);
    }
});

// Dedicated limiter for Drop Zone uploads. A drop zone is built for batch deposits
// (e.g. a photographer dropping a few hundred files at once), so the generic
// shareLimiter (100/15min) was too tight — especially behind NAT/shared office IPs.
// The host storage quota is the real backstop against storage abuse; this limiter
// only exists to bound DoS, so a higher-but-finite ceiling is the right balance.
export const dropZoneUploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // 300 uploads per 15 min per IP (~20/min sustained)
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { error: 'Too many uploads in a short period. Please wait a few minutes and continue.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] Drop zone upload limit exceeded by ${req.ip} on ${req.path}`);
        res.status(options.statusCode).send(options.message);
    }
});

// Fix #9: Limiter for public share link access (prevent brute-force token attacks)
export const shareLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 share link attempts per 15 min per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many share link requests, please try again later.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] Share limit exceeded by ${req.ip}`);
        res.status(options.statusCode).send(options.message);
    }
});
