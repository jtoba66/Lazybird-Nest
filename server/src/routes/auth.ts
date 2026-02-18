import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import { db } from '../db';
import { users, userCrypto, folders, files, graveyard, graveyardChunks, fileChunks, analyticsEvents, userDevices } from '../db/schema';
import { eq, and, gt, sql } from 'drizzle-orm';

import { validate } from '../middleware/validate';
import {
    signupSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema
} from '../schemas/auth';
import { authenticateToken, AuthRequest } from '../middleware/auth';
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
import { env } from '../config/env';
import { authLimiter } from '../middleware/rateLimiter';

const router = express.Router();
const JWT_SECRET = env.JWT_SECRET;

// Apply auth rate limiting to all auth routes
router.use(authLimiter);

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

        if (!user) {
            // Fake salt to prevent enumeration
            return res.json({
                salt: bufferToBase64(crypto.randomBytes(32)),
                kdfParams: JSON.stringify({ algorithm: 'argon2id', memoryCost: 65536, timeCost: 3, parallelism: 4 })
            });
        }

        // 2. Find Crypto Data
        const [cryptoData] = await db.select().from(userCrypto).where(eq(userCrypto.userId, user.id)).limit(1);
        if (!cryptoData) return res.status(500).json({ error: 'Account setup incomplete' });

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
                bytes: 1,
                meta: `user_${result.userId}`
            });

            logger.info(`[AUTH-SIGNUP] ✅ User created: ${result.userId} (${Date.now() - startTime}ms)`);

            // Send welcome email (fire and forget)
            sendWelcomeEmail(email).catch((err: any) => logger.error('[AUTH-SIGNUP] Failed to send welcome email:', err));

            res.status(201).json({ message: 'User created' });

        } catch (err: any) {
            // In Postgres, unique violation is code 23505
            if (err.code === '23505' || err.constraint === 'users_email_unique') {
                const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

                if (existingUser) {
                    const [hasCrypto] = await db.select({ id: userCrypto.userId }).from(userCrypto).where(eq(userCrypto.userId, existingUser.id)).limit(1);

                    if (!hasCrypto) {
                        // 1. Update Password Hash and Reset Quota (taking over legacy account)
                        await db.update(users)
                            .set({ password_hash: storedAuthHash, storage_used_bytes: 0 })
                            .where(eq(users.id, existingUser.id));

                        // 2. Wipe Legacy Data (Move to Graveyard first)
                        const allUserFiles = await db.select().from(files).where(eq(files.userId, existingUser.id));

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
                                }
                            }

                            // Hard Delete from Files (clearing user view)
                            await db.delete(files).where(eq(files.id, file.id));
                        }

                        // Clear folders
                        await db.delete(folders).where(eq(folders.userId, existingUser.id));

                        // 3. Insert Crypto Data
                        await db.insert(userCrypto).values({
                            userId: existingUser.id,
                            salt: base64ToBuffer(salt),
                            kdf_algorithm: 'argon2id',
                            kdf_params: kdfParams,
                            metadata_blob: base64ToBuffer(encryptedMetadata),
                            metadata_nonce: base64ToBuffer(encryptedMetadataNonce),
                            encrypted_master_key: base64ToBuffer(encryptedMasterKey),
                            encrypted_master_key_nonce: base64ToBuffer(encryptedMasterKeyNonce)
                        });

                        // 4. Create Root Folder Record
                        const { hashFolderPath } = await import('../crypto/keyManagement');
                        await db.insert(folders).values({
                            userId: existingUser.id,
                            parentId: null,
                            folder_key_encrypted: base64ToBuffer(rootFolderKeyEncrypted),
                            folder_key_nonce: base64ToBuffer(rootFolderKeyNonce),
                            path_hash: hashFolderPath('/')
                        });

                        logger.info(`[AUTH-SIGNUP] ✅ Legacy account migrated: ${existingUser.id}`);
                        sendWelcomeEmail(email).catch((err: any) => logger.error('[AUTH-SIGNUP] Failed to send migration welcome email:', err));

                        return res.status(201).json({ message: 'Account migrated to Zero-Knowledge' });
                    }
                }
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
// LOGIN
// ============================================================================

router.post('/login', validate(loginSchema), async (req: express.Request, res: express.Response) => {
    try {
        const { email, authHash } = req.body;

        logger.info(`[AUTH-LOGIN] Attempt for: ${email}`);

        // 1. Get User
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        if (!user) {
            logger.warn(`[AUTH-LOGIN] User not found: ${email}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.is_banned) {
            return res.status(403).json({ error: 'Account suspended' });
        }

        // 2. Verify AuthHash (Double-hashed check)
        const passwordMatch = await bcrypt.compare(authHash, user.password_hash);

        if (!passwordMatch) {
            logger.warn(`[AUTH-LOGIN] Invalid password: ${email}`);
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

        // 5. Generate JWT
        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                tier: user.subscription_tier,
                role: user.role
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

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
            user: {
                id: user.id,
                email: user.email,
                tier: user.subscription_tier,
                storageUsed: user.storage_used_bytes,
                storageQuota: user.storage_quota_bytes,
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

        res.json({ user });
    } catch (e) {
        logger.error('[AUTH-ME] ❌ Get user failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// METADATA SYNC
// ============================================================================


router.get('/metadata', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        const [cryptoData] = await db.select({
            metadata_blob: userCrypto.metadata_blob,
            metadata_nonce: userCrypto.metadata_nonce,
            metadata_version: userCrypto.metadata_version
        }).from(userCrypto).where(eq(userCrypto.userId, decoded.userId)).limit(1);

        if (!cryptoData) {
            return res.json({ encryptedMetadata: null, encryptedMetadataNonce: null, metadataVersion: 0 });
        }

        res.json({
            encryptedMetadata: bufferToBase64(cryptoData.metadata_blob),
            encryptedMetadataNonce: bufferToBase64(cryptoData.metadata_nonce),
            metadataVersion: cryptoData.metadata_version
        });
    } catch (e) {
        logger.error('[AUTH-METADATA-GET] ❌ Failed:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/metadata', async (req, res) => {
    try {
        // Use JWT for authentication instead of trusting email in body
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        const { encryptedMetadata, encryptedMetadataNonce } = req.body;

        if (!encryptedMetadata || !encryptedMetadataNonce) {
            return res.status(400).json({ error: 'Missing metadata fields' });
        }

        await db.update(userCrypto)
            .set({
                metadata_blob: base64ToBuffer(encryptedMetadata),
                metadata_nonce: base64ToBuffer(encryptedMetadataNonce),
                metadata_version: sql`${userCrypto.metadata_version} + 1`,
                updated_at: new Date()
            })
            .where(eq(userCrypto.userId, decoded.userId));

        res.json({ success: true });
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
            .set({ reset_token: token, reset_token_expires: expires })
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
            .where(and(eq(users.reset_token, token), gt(users.reset_token_expires, new Date())))
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
                storage_used_bytes: 0
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

router.post('/change-password', async (req, res) => {
    const {
        email,
        currentAuthHash,
        newAuthHash,
        newEncryptedMasterKey,
        newEncryptedMasterKeyNonce,
        newSalt,
        kdfParams
    } = req.body;

    try {
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
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

        logger.info(`[AUTH] ✅ Password changed for user ${user.id}`);
        sendPasswordResetConfirmation(email).catch(err => logger.error(`[AUTH] Failed to send password change email: ${err.message}`));

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

        // 4. Scrub User Identity
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

        logger.info(`[GDPR-ERASURE] ✅ Account ${userId} scrubbed successfully. Email anonymized to ${anonymousEmail}`);

        res.json({ message: 'Account permanently deleted.' });

    } catch (e: any) {
        logger.error(`[GDPR-ERASURE] ❌ Scrub failed for ${userId}:`, e.message);
        res.status(500).json({ error: 'Server error during account deletion' });
    }
});

export default router;
