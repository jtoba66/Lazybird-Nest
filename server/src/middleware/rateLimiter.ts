import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';

// Generic limiter for all API requests
export const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per window
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
    max: 10, // Limit each IP to 10 login/signup attempts per 15 mins
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
    max: 50, // Limit each IP to 50 upload attempts per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Upload limit exceeded, please try again in an hour.' },
    handler: (req, res, next, options) => {
        logger.warn(`[RATE-LIMIT] Upload limit exceeded by ${req.ip}`);
        res.status(options.statusCode).send(options.message);
    }
});
