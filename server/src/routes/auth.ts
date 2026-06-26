import express from 'express';
import { env } from '../config/env';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import { db } from '../db';
import { users, userCrypto, folders, files, graveyard, graveyardChunks, fileChunks, analyticsEvents, userDevices, refreshTokens } from '../db/schema';
import { eq, and, gt, sql, or } from 'drizzle-orm';

import { validate } from '../middleware/validate';
import {
    signupSchema,
    migrateLegacySchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema
} from '../schemas/auth';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import Stripe from 'stripe';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-12-15.clover' as any,
});
import logger from '../utils/logger';
import {
    bufferToBase64,
    base64ToBuffer,
} from '../crypto/keyManagement';
import {
    sendPasswordResetEmail,
    sendWelcomeEmail,
    sendPasswordResetConfirmation,
    sendSecurityAlertEmail
} from '../services/email';
import { authLimiter } from '../middleware/rateLimiter';

const router = express.Router();
const JWT_SECRET = env.JWT_SECRET;

// Anti-enumeration: when a login email doesn't exist we still run a bcrypt comparison
// against this dummy hash, so the missing-user path costs the same as the real path and
// response latency can't reveal whether an account exists. Computed once at startup.
const DUMMY_AUTH_HASH = bcrypt.hashSync('nonexistent-user-timing-equalizer', 12);

// Password-reset tokens are stored as a SHA-256 hash so a DB read can't yield a usable
// reset token. The raw token still goes in the emailed link; we hash on store + lookup.
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

// The strict auth brute-force limiter (10/15min per IP) must only guard
// credential/abuse endpoints (login, signup, salt, password reset, etc.).
// The routes below are normal recurring/session traffic — NOT brute-force
// targets — so capping them at the auth rate causes spurious 429s during
// ordinary use (and, behind NAT where many users share one IP, breaks them
// outright). They stay protected by authenticateToken (where applicable) and
// the app-wide globalLimiter (100/min):
//   /metadata — read on every page load, written on every vault save
//               (saveMetadata does a GET version-check + POST each time)
//   /refresh  — token refresh runs ~every 15min per session; rate-limiting it
//               yields no security benefit but causes silent logouts under NAT
//   /me       — fetched on load / session checks
//   /logout   — recurring, no abuse value
const AUTH_LIMITER_EXEMPT = new Set(['/metadata', '/refresh', '/me', '/logout']);
router.use((req, res, next) => {
    if (AUTH_LIMITER_EXEMPT.has(req.path)) return next();
    return authLimiter(req, res, next);
});

// ============================================================================
// GET SALT (Client-side usage)
// ============================================================================

router.post('/salt', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        logger.info(`[AUTH] Salt request for: ${email}`);

        // 1. Find User
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

        // 2. Find Crypto Data
        const [cryptoData] = user ? await db.select().from(userCrypto).where(eq(userCrypto.userId, user.id)).limit(1) : [null];

        if (!user || !cryptoData) {
            // Fake salt to prevent enumeration
            return res.json({
                salt: bufferToBase64(crypto.randomBytes(32)),
                kdfParams: JSON.stringify({ algorithm: 'argon2id', memoryCost: 65536, timeCost: 3, parallelism: 4 })
            });
        }

        res.json({
            salt: bufferToBase64(cryptoData.salt),
            kdfParams: cryptoData.kdf_params,
            encryptedMasterKey: bufferToBase64(cryptoData.encrypted_master_key!),
            encryptedMasterKeyNonce: bufferToBase64(cryptoData.encrypted_master_key_nonce!)
        });

    } catch (e) {
        logger.error('[AUTH] ❌ Get salt failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// SIGNUP
// ============================================================================

router.post('/signup', validate(signupSchema), async (req, res) => {
    const startTime = Date.now();
    logger.info(`[AUTH-SIGNUP] Request for: ${req.body.email}`);

    try {
        const {
            email,
            authHash,
            salt,
            encryptedMasterKey,
            encryptedMasterKeyNonce,
            encryptedMetadata,
            encryptedMetadataNonce,
            rootFolderKeyEncrypted,
            rootFolderKeyNonce,
            kdfParams
        } = req.body;

        // Validation
        if (!authHash || !salt || !encryptedMasterKey) {
            return res.status(400).json({ error: 'Missing Zero-Knowledge parameters' });
        }

        // 1. Hash the AuthHash (Double-hashing strategy) -> Stored as password_hash
        const storedAuthHash = await bcrypt.hash(authHash, 12);

        // Fix H5: Wrap signup in transaction for idempotency
        try {
            const result = await db.transaction(async (tx) => {
                // 1. Create User
                const [newUser] = await tx.insert(users).values({
                    email,
                    password_hash: storedAuthHash,
                    subscription_tier: 'free',
                    subscription_status: 'active',
                    storage_quota_bytes: 2 * 1024 * 1024 * 1024, // 2GB
                    storage_used_bytes: 0,
                    role: 'user',
                }).returning({ id: users.id });

                const userId = newUser.id;

                // 2. Insert Crypto Data
                await tx.insert(userCrypto).values({
                    userId,
                    salt: base64ToBuffer(salt),
                    kdf_algorithm: 'argon2id',
                    kdf_params: kdfParams,
                    metadata_blob: base64ToBuffer(encryptedMetadata),
                    metadata_nonce: base64ToBuffer(encryptedMetadataNonce),
                    encrypted_master_key: base64ToBuffer(encryptedMasterKey),
                    encrypted_master_key_nonce: base64ToBuffer(encryptedMasterKeyNonce)
                });

                // 3. Create Root Folder
                const { hashFolderPath } = await import('../crypto/keyManagement');
                await tx.insert(folders).values({
                    userId,
                    parentId: null,
                    folder_key_encrypted: base64ToBuffer(rootFolderKeyEncrypted),
                    folder_key_nonce: base64ToBuffer(rootFolderKeyNonce),
                    path_hash: hashFolderPath('/')
                });

                return { userId };
            });

            // Log Analytics Event (outside transaction as it's not critical for user creation atomicity)
            await db.insert(analyticsEvents).values({
                type: 'user_signup',
                bytes: 0,
                meta: `user_${result.userId}`
            });

            logger.info(`[AUTH-SIGNUP] ✅ User created: ${result.userId} (${Date.now() - startTime}ms)`);

            // Send welcome email (fire and forget)
            sendWelcomeEmail(email).catch((err: any) => logger.error('[AUTH-SIGNUP] Failed to send welcome email:', err));

            res.status(201).json({ message: 'User created' });

        } catch (err: any) {
            // In Postgres, unique violation is code 23505
            if (err.code === '23505' || err.constraint === 'users_email_unique') {
                return res.status(400).json({ error: 'Email already exists' });
            }
            throw err;
        }
    } catch (e: any) {
        logger.error('[AUTH] ❌ Registration failed:', e);
        res.status(500).json({ error: e.message || 'Server error' });
    }
});

// ============================================================================
// LEGACY MIGRATION
// ============================================================================

router.post('/migrate-legacy', validate(migrateLegacySchema), async (req: express.Request, res: express.Response) => {
    const startTime = Date.now();
    logger.info(`[AUTH-MIGRATE] Request for: ${req.body.email}`);

    try {
        const {
            email,
            password, // Original legacy password (from login form)
            authHash,
            salt,
            encryptedMasterKey,
            encryptedMasterKeyNonce,
            encryptedMetadata,
            encryptedMetadataNonce,
            rootFolderKeyEncrypted,
            rootFolderKeyNonce,
            kdfParams
        } = req.body;

        if (!authHash || !salt || !encryptedMasterKey || !password) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        // 1. Find User
        const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!existingUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // 2. Verify Legacy Password
        const passwordMatch = await bcrypt.compare(password, existingUser.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 3. Verify they actually need migration
        const [hasCrypto] = await db.select({ id: userCrypto.userId }).from(userCrypto).where(eq(userCrypto.userId, existingUser.id)).limit(1);
        if (hasCrypto) {
            return res.status(400).json({ error: 'Account is already migrated' });
        }

        const storedAuthHash = await bcrypt.hash(authHash, 12);
        const { hashFolderPath } = await import('../crypto/keyManagement');

        // Steps 4-7 are destructive (wipe legacy data) AND constructive (insert new ZK
        // crypto + root folder). They MUST be atomic — previously a failure between the
        // wipe and the crypto insert left the account with its data destroyed and no new
        // keys (unrecoverable). Wrap the whole thing in one transaction.
        await db.transaction(async (tx) => {
            // 4. Update Password Hash and Reset Quota
            await tx.update(users)
                .set({ password_hash: storedAuthHash, storage_used_bytes: 0 })
                .where(eq(users.id, existingUser.id));

            // 5. Wipe Legacy Data (Move to Graveyard first)
            const allUserFiles = await tx.select().from(files).where(eq(files.userId, existingUser.id));

            for (const file of allUserFiles) {
                const [gv] = await tx.insert(graveyard).values({
                    original_file_id: file.id,
                    user_id: file.userId,
                    filename: file.jackal_filename || 'unknown',
                    file_size: file.file_size,
                    jackal_fid: file.jackal_fid,
                    merkle_hash: file.merkle_hash,
                    original_created_at: file.created_at,
                    deletion_reason: 'account_nuke'
                }).returning({ id: graveyard.id });

                if (file.is_chunked) {
                    const chunks = await tx.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                    if (chunks.length > 0) {
                        await tx.insert(graveyardChunks).values(
                            chunks.map(c => ({
                                graveyard_id: gv.id,
                                chunk_index: c.chunk_index,
                                jackal_merkle: c.jackal_merkle,
                                size: c.size
                            }))
                        );
                    }
                }
                await tx.delete(files).where(eq(files.id, file.id));
            }

            await tx.delete(folders).where(eq(folders.userId, existingUser.id));

            // 6. Insert Crypto Data
            await tx.insert(userCrypto).values({
                userId: existingUser.id,
                salt: base64ToBuffer(salt),
                kdf_algorithm: 'argon2id',
                kdf_params: kdfParams,
                metadata_blob: base64ToBuffer(encryptedMetadata),
                metadata_nonce: base64ToBuffer(encryptedMetadataNonce),
                encrypted_master_key: base64ToBuffer(encryptedMasterKey),
                encrypted_master_key_nonce: base64ToBuffer(encryptedMasterKeyNonce)
            });

            // 7. Create Root Folder Record
            await tx.insert(folders).values({
                userId: existingUser.id,
                parentId: null,
                folder_key_encrypted: base64ToBuffer(rootFolderKeyEncrypted),
                folder_key_nonce: base64ToBuffer(rootFolderKeyNonce),
                path_hash: hashFolderPath('/')
            });
        });

        logger.info(`[AUTH-MIGRATE] ✅ Legacy account migrated: ${existingUser.id}`);

        return res.status(200).json({ message: 'Account migrated to Zero-Knowledge' });

    } catch (e: any) {
        logger.error('[AUTH-MIGRATE] ❌ Failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// LOGIN
// ============================================================================

router.post('/login', validate(loginSchema), async (req: express.Request, res: express.Response) => {
    try {
        const { email, authHash } = req.body;

        logger.info(`[AUTH-LOGIN] Attempt for: ${email}`);

        // 1. Get User
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        if (!user) {
            // Equalize timing with the real-user path (constant-time enumeration defense).
            await bcrypt.compare(authHash || '', DUMMY_AUTH_HASH);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.is_banned) {
            return res.status(403).json({ error: 'Account suspended' });
        }

        // 2. Verify AuthHash (Double-hashed check)
        const passwordMatch = await bcrypt.compare(authHash, user.password_hash);

        if (!passwordMatch) {
            logger.warn(`[AUTH-LOGIN] Invalid credentials for user ${user.id}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 3. Check for mandatory ZK migration (Legacy users who haven't set up keys yet)
        const [cryptoData] = await db.select().from(userCrypto).where(eq(userCrypto.userId, user.id)).limit(1);
        if (!cryptoData) {
            logger.info(`[AUTH-LOGIN] User needs migration: ${email}`);
            return res.status(403).json({
                error: 'Account requires security upgrade',
                needsMigration: true
            });
        }

        // 4. Update last accessed
        await db.update(users)
            .set({ last_accessed_at: new Date() })
            .where(eq(users.id, user.id));

        // 5. Generate JWT (Short-lived Access Token)
        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                tier: user.subscription_tier,
                role: user.role
            },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        // Generate Long-lived Refresh Token
        const refreshToken = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        await db.insert(refreshTokens).values({
            userId: user.id,
            token: refreshToken,
            expiresAt
        });

        logger.info(`[AUTH-LOGIN] ✅ Success: ${user.id}`);

        // 6. Device Logging (Silent) & Security Alert (Throttled 24h)
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const deviceString = `${user.id}:${ip}:${userAgent}`;
        const deviceHash = crypto.createHash('sha256').update(deviceString).digest('hex');

        // Log device for audit trail (Silent - does not trigger email)
        const [knownDevice] = await db.select().from(userDevices)
            .where(and(
                eq(userDevices.userId, user.id),
                eq(userDevices.device_hash, deviceHash)
            )).limit(1);

        if (knownDevice) {
            await db.update(userDevices)
                .set({ last_seen_at: new Date() })
                .where(eq(userDevices.id, knownDevice.id));
        } else {
            await db.insert(userDevices).values({
                userId: user.id,
                device_hash: deviceHash,
                ip_address: ip as string,
                user_agent: userAgent as string,
            });
        }

        // SIMPLIFIED ALERT LOGIC: One email per 24 hours max
        // If user hasn't logged in for > 24 hours, send a "New Login" alert.
        // If they are active daily, we assume they know they are logging in.
        const LAST_LOGIN_THRESHOLD = 24 * 60 * 60 * 1000; // 24 Hours
        const lastSeen = user.last_accessed_at ? new Date(user.last_accessed_at).getTime() : 0;
        const timeSinceLastLogin = Date.now() - lastSeen;

        if (timeSinceLastLogin > LAST_LOGIN_THRESHOLD) {
            logger.info(`[AUTH-LOGIN] Mailing security alert (Last login: ${timeSinceLastLogin / 1000}s ago)`);
            sendSecurityAlertEmail(user.email).catch(err => logger.error('[AUTH-LOGIN] Failed to send security alert:', err));
        }

        // Fetch keys for response (we already checked existence in step 3)
        // Re-using cryptoData from step 3 if available, or fetching if strictly needed
        // Actually step 3 variable 'cryptoData' is available in this scope

        res.json({
            token,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                tier: user.role === 'admin' ? 'God Mode' : user.subscription_tier,
                storageUsed: user.storage_used_bytes,
                storageQuota: user.role === 'admin' ? 10 * 1024 * 1024 * 1024 * 1024 : user.storage_quota_bytes,
                role: user.role
            },
            // Return keys so frontend can unlock vault
            encryptedMasterKey: bufferToBase64(cryptoData.encrypted_master_key!),
            encryptedMasterKeyNonce: bufferToBase64(cryptoData.encrypted_master_key_nonce!),
            // Also sending metadata keys just in case, though frontend fetches them separately usually
            encryptedMetadata: bufferToBase64(cryptoData.metadata_blob),
            encryptedMetadataNonce: bufferToBase64(cryptoData.metadata_nonce)
        });

    } catch (e) {
        logger.error('[AUTH] ❌ Login failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// REFRESH & LOGOUT
// ============================================================================

router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

        // 1. Verify token exists and is valid (check current OR previous)
        const [storedToken] = await db.select().from(refreshTokens)
            .where(
                or(
                    eq(refreshTokens.token, refreshToken),
                    eq(refreshTokens.previousToken, refreshToken)
                )
            ).limit(1);

        if (!storedToken) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        if (new Date() > new Date(storedToken.expiresAt)) {
            await db.delete(refreshTokens).where(eq(refreshTokens.id, storedToken.id));
            return res.status(401).json({ error: 'Refresh token expired' });
        }

        // 2. Check for Grace Period / Theft
        if (storedToken.previousToken === refreshToken) {
            const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
            if (storedToken.rotatedAt && new Date(storedToken.rotatedAt) > thirtySecondsAgo) {
                // Grace Period active - token was recently rotated by a concurrent request
                const [user] = await db.select().from(users).where(eq(users.id, storedToken.userId)).limit(1);
                if (!user || user.is_banned) return res.status(401).json({ error: 'User invalid' });

                const token = jwt.sign(
                    { userId: user.id, email: user.email, tier: user.subscription_tier, role: user.role },
                    JWT_SECRET, { expiresIn: '15m' }
                );
                // Return the already-rotated token
                return res.json({ token, refreshToken: storedToken.token });
            } else {
                // THEFT DETECTED: An old token was replayed after the grace period
                logger.warn(`[AUTH-REFRESH] 🚨 Token theft detected for user ${storedToken.userId}! Revoking ALL of the user's refresh tokens.`);
                // Revoke the entire family (every refresh token for this user), not just the
                // replayed row — otherwise the attacker's other live sessions keep working.
                await db.delete(refreshTokens).where(eq(refreshTokens.userId, storedToken.userId));
                return res.status(401).json({ error: 'Compromised token family detected' });
            }
        }

        // 3. Normal Rotation (reqToken === storedToken.token)
        const [user] = await db.select().from(users).where(eq(users.id, storedToken.userId)).limit(1);
        if (!user || user.is_banned) {
            return res.status(401).json({ error: 'User invalid' });
        }

        // Issue new Access Token
        const token = jwt.sign(
            { userId: user.id, email: user.email, tier: user.subscription_tier, role: user.role },
            JWT_SECRET, { expiresIn: '15m' }
        );

        // Rotate Refresh Token
        const newRefreshToken = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        await db.update(refreshTokens).set({
            token: newRefreshToken,
            previousToken: storedToken.token,
            rotatedAt: new Date(),
            expiresAt
        }).where(eq(refreshTokens.id, storedToken.id));

        res.json({ token, refreshToken: newRefreshToken });

    } catch (e) {
        logger.error('[AUTH-REFRESH] ❌ Failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/logout', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (refreshToken) {
            await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));
        }
        res.json({ success: true });
    } catch (e) {
        logger.error('[AUTH-LOGOUT] ❌ Failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// GET CURRENT USER (For session restoration on refresh)
// ============================================================================

router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const [user] = await db.select({
            id: users.id,
            email: users.email,
            tier: users.subscription_tier,
            storageUsed: users.storage_used_bytes,
            storageQuota: users.storage_quota_bytes,
            role: users.role
        }).from(users).where(eq(users.id, req.user!.userId)).limit(1);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.role === 'admin') {
            user.tier = 'God Mode';
            user.storageQuota = 10 * 1024 * 1024 * 1024 * 1024;
        }

        res.json({ user });
    } catch (e) {
        logger.error('[AUTH-ME] ❌ Get user failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// METADATA SYNC
// ============================================================================


router.get('/metadata', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const [cryptoData] = await db.select({
            metadata_blob: userCrypto.metadata_blob,
            metadata_nonce: userCrypto.metadata_nonce,
            metadata_version: userCrypto.metadata_version
        }).from(userCrypto).where(eq(userCrypto.userId, req.user.userId)).limit(1);

        if (!cryptoData) {
            return res.json({ encryptedMetadata: null, encryptedMetadataNonce: null, metadata_version: 0 });
        }

        res.json({
            encryptedMetadata: bufferToBase64(cryptoData.metadata_blob),
            encryptedMetadataNonce: bufferToBase64(cryptoData.metadata_nonce),
            metadata_version: cryptoData.metadata_version
        });
    } catch (e) {
        logger.error('[AUTH-METADATA-GET] ❌ Failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/metadata', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const { encryptedMetadata, encryptedMetadataNonce, metadata_version } = req.body;

        if (!encryptedMetadata || !encryptedMetadataNonce || metadata_version === undefined) {
            return res.status(400).json({ error: 'Missing metadata fields' });
        }

        const result = await db.update(userCrypto)
            .set({
                metadata_blob: base64ToBuffer(encryptedMetadata),
                metadata_nonce: base64ToBuffer(encryptedMetadataNonce),
                metadata_version: sql`${userCrypto.metadata_version} + 1`,
                updated_at: new Date()
            })
            .where(
                and(
                    eq(userCrypto.userId, req.user.userId),
                    eq(userCrypto.metadata_version, metadata_version)
                )
            )
            .returning({ newVersion: userCrypto.metadata_version });

        if (result.length === 0) {
            return res.status(409).json({ error: 'Metadata version conflict' });
        }

        res.json({ success: true, newVersion: result[0].newVersion });
    } catch (e) {
        logger.error('[AUTH-METADATA] ❌ Failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});


// ============================================================================
// UTILS
// ============================================================================

router.post('/forgot-password', validate(forgotPasswordSchema), async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hour
        await db.update(users)
            .set({ reset_token: hashToken(token), reset_token_expires: expires }) // store hash, email the raw token
            .where(eq(users.id, user.id));
        sendPasswordResetEmail(email, token).catch(console.error);
    }

    res.json({ message: 'If an account exists, instructions have been sent.' });
});

router.post('/reset-password', validate(resetPasswordSchema), async (req, res) => {
    const {
        token,
        authHash,
        salt,
        encryptedMasterKey,
        encryptedMasterKeyNonce,
        encryptedMetadata,
        encryptedMetadataNonce,
        rootFolderKeyEncrypted,
        rootFolderKeyNonce,
        kdfParams
    } = req.body;
    // Fix H1: Coerce wipeData to boolean for type safety
    const wipeData = !!req.body.wipeData; // Boolean coercion

    try {
        // 1. Verify Token
        const [user] = await db.select()
            .from(users)
            // Match the hashed token; also accept a legacy plaintext token still inside its
            // 1h window (transition safety) so resets issued just before deploy still work.
            .where(and(
                or(eq(users.reset_token, hashToken(token)), eq(users.reset_token, token)),
                gt(users.reset_token_expires, new Date())
            ))
            .limit(1);

        if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

        // 2. Hash New AuthHash
        const storedAuthHash = await bcrypt.hash(authHash, 12);

        // 3. Destructive Reset: Data Wipe
        if (wipeData === true) {
            logger.warn(`[AUTH] ⚠️ Performing destructive password reset for user ${user.id} (${user.email})`);

            // Invalidate all share tokens before deletion
            await db.update(files).set({ share_token: null }).where(eq(files.userId, user.id));

            // 1. Archive to Graveyard and cleanup disk space
            const userFiles = await db.select().from(files).where(eq(files.userId, user.id));

            for (const file of userFiles) {
                // Archive to Graveyard
                const [gv] = await db.insert(graveyard).values({
                    original_file_id: file.id,
                    user_id: file.userId,
                    filename: file.jackal_filename || 'unknown',
                    file_size: file.file_size,
                    jackal_fid: file.jackal_fid,
                    merkle_hash: file.merkle_hash,
                    original_created_at: file.created_at,
                    deletion_reason: 'account_nuke'
                }).returning({ id: graveyard.id });

                // Archive Chunks
                if (file.is_chunked) {
                    const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                    if (chunks.length > 0) {
                        await db.insert(graveyardChunks).values(
                            chunks.map(c => ({
                                graveyard_id: gv.id,
                                chunk_index: c.chunk_index,
                                jackal_merkle: c.jackal_merkle,
                                size: c.size
                            }))
                        );

                        // Cleanup local chunks
                        for (const chunk of chunks) {
                            if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                                try { fs.unlinkSync(chunk.local_path); } catch (e) { }
                            }
                        }
                    }
                }

                // Cleanup local encrypted file
                if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                    try { fs.unlinkSync(file.encrypted_file_path); } catch (e) { }
                }

                // HARD DELETE from Files (this hides it from user account/trash)
                await db.delete(files).where(eq(files.id, file.id));
            }

            // 2. Clear Folders
            await db.delete(folders).where(eq(folders.userId, user.id));

            // 3. Add Pruning Event to Analytics
            if ((user.storage_used_bytes || 0) > 0) {
                await db.insert(analyticsEvents).values({
                    type: 'prune',
                    bytes: -(user.storage_used_bytes || 0),
                    timestamp: new Date(),
                    meta: `nuke: password-reset (${user.id})`
                });
            }

            // 4. Re-initialize Root Folder
            if (rootFolderKeyEncrypted && rootFolderKeyNonce) {
                const { hashFolderPath } = await import('../crypto/keyManagement');
                await db.insert(folders).values({
                    userId: user.id,
                    parentId: null,
                    folder_key_encrypted: base64ToBuffer(rootFolderKeyEncrypted),
                    folder_key_nonce: base64ToBuffer(rootFolderKeyNonce),
                    path_hash: hashFolderPath('/')
                });
                logger.info(`[AUTH-WIPE] Re-initialized Root Folder for user ${user.id}`);
            }
        }

        // 4. Update Credentials
        await db.update(users)
            .set({
                password_hash: storedAuthHash,
                reset_token: null,
                reset_token_expires: null,
                ...(wipeData ? { storage_used_bytes: 0 } : {})
            })
            .where(eq(users.id, user.id));

        // 5. Update Crypto Data
        const cryptoUpdate: any = {
            salt: base64ToBuffer(salt),
            kdf_params: kdfParams,
            encrypted_master_key: base64ToBuffer(encryptedMasterKey),
            encrypted_master_key_nonce: base64ToBuffer(encryptedMasterKeyNonce),
            updated_at: new Date()
        };

        if (encryptedMetadata && encryptedMetadataNonce) {
            cryptoUpdate.metadata_blob = base64ToBuffer(encryptedMetadata);
            cryptoUpdate.metadata_nonce = base64ToBuffer(encryptedMetadataNonce);
        }

        await db.update(userCrypto)
            .set(cryptoUpdate)
            .where(eq(userCrypto.userId, user.id));

        sendPasswordResetConfirmation(user.email).catch(err => logger.error(`[AUTH] Failed to send reset confirmation email: ${err.message}`));

        res.json({ message: 'Password reset successful' });

    } catch (e) {
        logger.error('[AUTH] ❌ Reset failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/change-password', authenticateToken, async (req: AuthRequest, res) => {
    const {
        currentAuthHash,
        newAuthHash,
        newEncryptedMasterKey,
        newEncryptedMasterKeyNonce,
        newSalt,
        kdfParams
    } = req.body;
    const userId = req.user!.userId;

    try {
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const match = await bcrypt.compare(currentAuthHash, user.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Incorrect current password' });
        }

        const storedAuthHash = await bcrypt.hash(newAuthHash, 12);

        await db.update(users)
            .set({ password_hash: storedAuthHash })
            .where(eq(users.id, user.id));

        await db.update(userCrypto)
            .set({
                salt: base64ToBuffer(newSalt),
                encrypted_master_key: base64ToBuffer(newEncryptedMasterKey),
                encrypted_master_key_nonce: base64ToBuffer(newEncryptedMasterKeyNonce),
                kdf_params: kdfParams,
                updated_at: new Date()
            })
            .where(eq(userCrypto.userId, user.id));

        // Invalidate all active refresh tokens for absolute security
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));

        logger.info(`[AUTH] ✅ Password changed for user ${user.id}`);
        sendPasswordResetConfirmation(user.email).catch(err => logger.error(`[AUTH] Failed to send password change email: ${err.message}`));

        res.json({ message: 'Password changed successfully' });

    } catch (e) {
        logger.error('[AUTH] ❌ Change password failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// ACCOUNT DELETION (GDPR Compliance: Right to Erasure)
// ============================================================================

router.delete('/account', authenticateToken, async (req: AuthRequest, res) => {
    const { authHash } = req.body;
    const userId = req.user.userId;

    try {
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!(await bcrypt.compare(authHash, user.password_hash))) {
            return res.status(401).json({ error: 'Incorrect password' });
        }

        logger.warn(`[GDPR-ERASURE] Starting account scrub for user ${userId} (${user.email})`);

        // 1. Cancel active Stripe subscription if it exists
        if (user.stripe_subscription_id) {
            try {
                logger.info(`[GDPR-ERASURE] Canceling Stripe subscription ${user.stripe_subscription_id} for user ${userId}`);
                await stripe.subscriptions.cancel(user.stripe_subscription_id);
            } catch (stripeErr: any) {
                logger.error(`[GDPR-ERASURE] ⚠️ Failed to cancel Stripe subscription: ${stripeErr.message}`);
            }
        }

        // 2. Process Files (Hard Delete and Archive to Graveyard)
        const allUserFiles = await db.select().from(files).where(eq(files.userId, userId));

        for (const file of allUserFiles) {
            // Archive to Graveyard
            const [gv] = await db.insert(graveyard).values({
                original_file_id: file.id,
                user_id: file.userId,
                filename: file.jackal_filename || 'unknown',
                file_size: file.file_size,
                jackal_fid: file.jackal_fid,
                merkle_hash: file.merkle_hash,
                original_created_at: file.created_at,
                deletion_reason: 'account_deletion'
            }).returning({ id: graveyard.id });

            // Archive Chunks
            if (file.is_chunked) {
                const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, file.id));
                if (chunks.length > 0) {
                    await db.insert(graveyardChunks).values(
                        chunks.map(c => ({
                            graveyard_id: gv.id,
                            chunk_index: c.chunk_index,
                            jackal_merkle: c.jackal_merkle,
                            size: c.size
                        }))
                    );

                    // Cleanup local chunks
                    for (const chunk of chunks) {
                        if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                            try { fs.unlinkSync(chunk.local_path); } catch (e) { }
                        }
                    }
                }
            }

            // Cleanup local encrypted file
            if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                try { fs.unlinkSync(file.encrypted_file_path); } catch (e) { }
            }

            // HARD DELETE from Files
            await db.delete(files).where(eq(files.id, file.id));
        }

        // 3. Wipe Metadata & Structure
        await db.delete(folders).where(eq(folders.userId, userId));
        await db.delete(userCrypto).where(eq(userCrypto.userId, userId));

        const anonymousEmail = `deleted_user_${userId}_${crypto.randomBytes(4).toString('hex')}@nest.internal`;
        await db.update(users)
            .set({
                email: anonymousEmail,
                password_hash: 'DELETED',
                stripe_customer_id: null,
                stripe_subscription_id: null,
                is_banned: 1,
                storage_used_bytes: 0,
                reset_token: null
            })
            .where(eq(users.id, userId));

        // Remove all refresh tokens to terminate any dangling sessions
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));

        logger.info(`[GDPR-ERASURE] ✅ Account ${userId} scrubbed successfully. Email anonymized to ${anonymousEmail}`);

        res.json({ message: 'Account permanently deleted.' });

    } catch (e: any) {
        logger.error(`[GDPR-ERASURE] ❌ Scrub failed for ${userId}:`, e.message);
        res.status(500).json({ error: 'Server error during account deletion' });
    }
});

export default router;
