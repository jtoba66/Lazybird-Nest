import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';

// Generic limiter for all API requests
export const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1000, // Limit each IP to 1000 requests per window (increased for dashboard polling)
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] Global limit exceeded by ${req.ip}`);
        res.status(options.statusCode).send(options.message);
    }
});

// Stricter limiter for authentication routes
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Increased to 100 to prevent locking out devs during testing
    standardHeaders: true,
    legacyHeaders: false,
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
