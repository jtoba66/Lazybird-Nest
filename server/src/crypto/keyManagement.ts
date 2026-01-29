import argon2 from 'argon2';
import crypto from 'crypto';
import sodium from 'libsodium-wrappers';
import logger from '../utils/logger';

// Initialize sodium (must be called at startup)
export const initCrypto = async () => {
    await sodium.ready;
    logger.info('[CRYPTO] Libsodium initialized');
};

// ============================================================================
// KDF Parameters
// ============================================================================

export interface KDFParams {
    algorithm: 'argon2id' | 'pbkdf2';
    // Argon2 params
    memoryCost?: number;      // in KB
    timeCost?: number;        // iterations
    parallelism?: number;
    // PBKDF2 params
    iterations?: number;
}

const DEFAULT_ARGON2_PARAMS: KDFParams = {
    algorithm: 'argon2id',
    memoryCost: 65536,  // 64 MB
    timeCost: 3,
    parallelism: 4,
};

const DEFAULT_PBKDF2_PARAMS: KDFParams = {
    algorithm: 'pbkdf2',
    iterations: 600000,
};

// ============================================================================
// Master Key Derivation
// ============================================================================

/**
 * Derive Master Key from password using Argon2id or PBKDF2
 * Returns 32-byte key suitable for XChaCha20-Poly1305
 */
export async function deriveMasterKey(
    password: string,
    salt: Buffer,
    params: KDFParams = DEFAULT_ARGON2_PARAMS
): Promise<Buffer> {
    const startTime = Date.now();
    logger.info(`[CRYPTO] Master Key derivation started (algorithm: ${params.algorithm})`);

    try {
        let masterKey: Buffer;

        if (params.algorithm === 'argon2id') {
            masterKey = await argon2.hash(password, {
                type: argon2.argon2id,
                salt,
                raw: true,
                hashLength: 32,
                memoryCost: params.memoryCost || DEFAULT_ARGON2_PARAMS.memoryCost!,
                timeCost: params.timeCost || DEFAULT_ARGON2_PARAMS.timeCost!,
                parallelism: params.parallelism || DEFAULT_ARGON2_PARAMS.parallelism!,
            });
        } else {
            // PBKDF2 fallback
            masterKey = crypto.pbkdf2Sync(
                password,
                salt,
                params.iterations || DEFAULT_PBKDF2_PARAMS.iterations!,
                32,
                'sha256'
            );
        }

        const duration = Date.now() - startTime;
        logger.info(`[CRYPTO] ✅ Master Key derivation complete (took: ${duration}ms)`);

        return masterKey;
    } catch (error) {
        logger.error('[CRYPTO] ❌ Master Key derivation failed:', error);
        throw new Error('Failed to derive Master Key');
    }
}

/**
 * Generate a random salt for Master Key derivation
 */
export function generateSalt(): Buffer {
    logger.info('[CRYPTO] Generating new salt (32 bytes)');
    return crypto.randomBytes(32);
}

// ============================================================================
// Master Key Encryption/Decryption
// ============================================================================

/**
 * Encrypt data with Master Key using XChaCha20-Poly1305
 */
export function encryptWithMasterKey(
    data: Buffer | string,
    masterKey: Buffer
): { encrypted: Buffer; nonce: Buffer } {
    logger.info('[CRYPTO] Encrypting with Master Key');

    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const nonce = Buffer.from(sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES));

    const encrypted = Buffer.from(
        sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
            dataBuffer,
            null,
            null,
            nonce,
            masterKey
        )
    );

    logger.info(`[CRYPTO] ✅ Encrypted ${dataBuffer.length} bytes with Master Key`);
    return { encrypted, nonce };
}

/**
 * Decrypt data with Master Key using XChaCha20-Poly1305
 */
export function decryptWithMasterKey(
    encrypted: Buffer,
    nonce: Buffer,
    masterKey: Buffer
): Buffer {
    logger.info('[CRYPTO] Decrypting with Master Key');

    try {
        const decrypted = Buffer.from(
            sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                null,
                encrypted,
                null,
                nonce,
                masterKey
            )
        );

        logger.info(`[CRYPTO] ✅ Decrypted ${decrypted.length} bytes with Master Key`);
        return decrypted;
    } catch (error) {
        logger.error('[CRYPTO] ❌ Decryption with Master Key failed:', error);
        throw new Error('Failed to decrypt with Master Key');
    }
}

// ============================================================================
// Folder Key Management
// ============================================================================

/**
 * Generate a random Folder Key (32 bytes for XChaCha20-Poly1305)
 */
export function generateFolderKey(): Buffer {
    logger.info('[CRYPTO] Generating new Folder Key (32 bytes)');
    return Buffer.from(sodium.randombytes_buf(32));
}

/**
 * Encrypt Folder Key with Master Key
 */
export function encryptFolderKey(
    folderKey: Buffer,
    masterKey: Buffer
): { encrypted: Buffer; nonce: Buffer } {
    logger.info('[CRYPTO] Encrypting Folder Key with Master Key');
    return encryptWithMasterKey(folderKey, masterKey);
}

/**
 * Decrypt Folder Key with Master Key
 */
export function decryptFolderKey(
    encrypted: Buffer,
    nonce: Buffer,
    masterKey: Buffer
): Buffer {
    logger.info('[CRYPTO] Decrypting Folder Key with Master Key');
    return decryptWithMasterKey(encrypted, nonce, masterKey);
}

// ============================================================================
// File Key Management
// ============================================================================

/**
 * Generate a random File Key (32 bytes for XChaCha20-Poly1305)
 */
export function generateFileKey(): Buffer {
    logger.info('[CRYPTO] Generating new File Key (32 bytes)');
    return Buffer.from(sodium.randombytes_buf(32));
}

/**
 * Encrypt File Key with Folder Key
 */
export function encryptFileKey(
    fileKey: Buffer,
    folderKey: Buffer
): { encrypted: Buffer; nonce: Buffer } {
    logger.info('[CRYPTO] Encrypting File Key with Folder Key');

    const nonce = Buffer.from(sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES));

    const encrypted = Buffer.from(
        sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
            fileKey,
            null,
            null,
            nonce,
            folderKey
        )
    );

    logger.info('[CRYPTO] ✅ File Key encrypted with Folder Key');
    return { encrypted, nonce };
}

/**
 * Decrypt File Key with Folder Key
 */
export function decryptFileKey(
    encrypted: Buffer,
    nonce: Buffer,
    folderKey: Buffer
): Buffer {
    logger.info('[CRYPTO] Decrypting File Key with Folder Key');

    try {
        const decrypted = Buffer.from(
            sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                null,
                encrypted,
                null,
                nonce,
                folderKey
            )
        );

        logger.info('[CRYPTO] ✅ File Key decrypted with Folder Key');
        return decrypted;
    } catch (error) {
        logger.error('[CRYPTO] ❌ File Key decryption failed:', error);
        throw new Error('Failed to decrypt File Key');
    }
}

// ============================================================================
// Metadata Blob Management
// ============================================================================

export interface MetadataBlob {
    v: number;  // Version
    folders: {
        [folderId: string]: {
            name: string;
            created_at: string;
        };
    };
    files: {
        [fileId: string]: {
            filename: string;
            mime_type: string;
            folder_id: string | null;
        };
    };
}

/**
 * Encrypt metadata blob with Master Key
 */
export function encryptMetadataBlob(
    metadata: MetadataBlob,
    masterKey: Buffer
): { encrypted: Buffer; nonce: Buffer } {
    logger.info(`[CRYPTO] Encrypting metadata blob (folders: ${Object.keys(metadata.folders).length}, files: ${Object.keys(metadata.files).length})`);

    const json = JSON.stringify(metadata);
    return encryptWithMasterKey(json, masterKey);
}

/**
 * Decrypt metadata blob with Master Key
 */
export function decryptMetadataBlob(
    encrypted: Buffer,
    nonce: Buffer,
    masterKey: Buffer
): MetadataBlob {
    logger.info('[CRYPTO] Decrypting metadata blob');

    const decrypted = decryptWithMasterKey(encrypted, nonce, masterKey);
    const metadata = JSON.parse(decrypted.toString('utf8'));

    logger.info(`[CRYPTO] ✅ Metadata blob decrypted (folders: ${Object.keys(metadata.folders).length}, files: ${Object.keys(metadata.files).length})`);
    return metadata;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Hash a folder path for indexing
 */
export function hashFolderPath(path: string): string {
    return crypto.createHash('sha256').update(path).digest('hex');
}

/**
 * Convert Buffer to base64 for JSON storage
 */
export function bufferToBase64(buffer: Buffer): string {
    return buffer.toString('base64');
}

/**
 * Convert base64 string back to Buffer
 */
export function base64ToBuffer(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
}
