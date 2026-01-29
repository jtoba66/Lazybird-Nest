import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// In-memory storage for Master Keys (session-based)
// Key: user_id, Value: { masterKey: Buffer, lastActivity: timestamp }
const masterKeyCache = new Map<number, { masterKey: Buffer; lastActivity: number }>();

// Session timeout: 24 hours
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// Cleanup interval: every hour
setInterval(() => {
    cleanupExpiredSessions();
}, 60 * 60 * 1000);

/**
 * Store Master Key in session
 */
export function cacheMasterKey(userId: number, masterKey: Buffer): void {
    logger.info(`[SESSION] Caching Master Key for user: ${userId}`);
    masterKeyCache.set(userId, {
        masterKey,
        lastActivity: Date.now(),
    });
}

/**
 * Retrieve Master Key from session
 */
export function getMasterKey(userId: number): Buffer | null {
    const session = masterKeyCache.get(userId);

    if (!session) {
        logger.warn(`[SESSION] No Master Key found for user: ${userId}`);
        return null;
    }

    const age = Date.now() - session.lastActivity;
    if (age > SESSION_TIMEOUT_MS) {
        logger.warn(`[SESSION] Master Key expired for user: ${userId} (age: ${Math.round(age / 1000 / 60)}min)`);
        masterKeyCache.delete(userId);
        return null;
    }

    // Update last activity
    session.lastActivity = Date.now();
    logger.info(`[SESSION] Master Key retrieved for user: ${userId}`);

    return session.masterKey;
}

/**
 * Clear Master Key from session (logout)
 */
export function clearMasterKey(userId: number): void {
    logger.info(`[SESSION] Clearing Master Key for user: ${userId}`);
    masterKeyCache.delete(userId);
}

/**
 * Cleanup expired sessions
 */
function cleanupExpiredSessions(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [userId, session] of masterKeyCache.entries()) {
        if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
            masterKeyCache.delete(userId);
            expiredCount++;
        }
    }

    if (expiredCount > 0) {
        logger.info(`[SESSION] Cleaned up ${expiredCount} expired sessions`);
    }
}

/**
 * Middleware to inject Master Key into request
 * Requires auth middleware to run first (sets req.userId)
 */
export function injectMasterKey(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.userId;

    if (!userId) {
        logger.warn('[SESSION] Authorization failed: No user found in request');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const masterKey = getMasterKey(userId);

    if (!masterKey) {
        logger.warn(`[SESSION] Master Key not found or expired for user: ${userId}`);
        return res.status(401).json({
            error: 'Session expired. Please log in again.',
            code: 'SESSION_EXPIRED'
        });
    }

    // Attach to request
    (req as any).masterKey = masterKey;
    next();
}
