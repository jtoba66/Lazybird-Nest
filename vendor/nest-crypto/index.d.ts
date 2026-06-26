/**
 * @lazybird-inc/nest-crypto
 *
 * Client-side zero-knowledge encryption engine for Nest by LazyBird.
 *
 * This library is the single source of truth for all cryptographic operations
 * performed in the Nest application. It is open-source and publicly auditable
 * so that users can verify no backdoors exist in the encryption pipeline.
 *
 * Cryptographic design:
 *  - Key derivation:   Argon2id (primary) / PBKDF2 (fallback)
 *  - Key wrapping:     XChaCha20-Poly1305 via libsodium
 *  - File encryption:  XChaCha20-Poly1305 secretstream via libsodium
 *  - Auth hash:        BLAKE2b via libsodium
 *
 * The password NEVER leaves the user's device.
 * The server only ever receives the AuthHash (a one-way derivative of the password).
 *
 * @license MIT
 * @see https://github.com/Lazybird-inc/nest-crypto
 */
/**
 * Initialise the underlying libsodium WASM module.
 * Must be called and awaited before using any function in this library.
 *
 * @example
 * import { init, encryptFile } from '@lazybird-inc/nest-crypto';
 * await init();
 * const { encryptedBlob, nonce } = await encryptFile(file, fileKey);
 */
export declare function init(): Promise<void>;
export interface KDFParams {
    /** Key derivation algorithm to use. Argon2id is strongly preferred. */
    algorithm: 'argon2id' | 'pbkdf2';
    /** Argon2id: memory cost in KiB (default: 65536 = 64MB) */
    memoryCost?: number;
    /** Argon2id: number of iterations (default: 3) */
    timeCost?: number;
    /** Argon2id: degree of parallelism (default: 4) */
    parallelism?: number;
    /** PBKDF2: number of iterations (default: 600000) */
    iterations?: number;
}
export interface MetadataBlob {
    /** Schema version */
    v: number;
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
 * Derive the Root Key from a user's password using Argon2id (or PBKDF2 as fallback).
 *
 * The Root Key is NEVER sent to the server. It is used exclusively on the
 * client to derive two child keys:
 *  1. AuthHash  — sent to the server for login (cannot reverse to password)
 *  2. Wrapping Key — used to decrypt the encrypted Master Key stored on server
 *
 * @param password - The user's plaintext password
 * @param salt     - A 32-byte random salt retrieved from the server
 * @param params   - KDF algorithm and cost parameters
 * @returns        A 32-byte Root Key (kept only in memory, never persisted)
 */
export declare function deriveRootKey(password: string, salt: Uint8Array, params: KDFParams): Promise<Uint8Array>;
/**
 * Derive the AuthHash from the Root Key using BLAKE2b.
 *
 * This is the ONLY derivative of the password that is sent to the server.
 * The server stores a bcrypt hash of this value — meaning the server cannot
 * reverse the AuthHash back to the Root Key or the original password.
 *
 * @param rootKey - 32-byte Root Key from deriveRootKey()
 * @returns Hex-encoded 32-byte AuthHash
 */
export declare function deriveAuthHash(rootKey: Uint8Array): string;
/**
 * Derive the Wrapping Key from the Root Key using BLAKE2b.
 *
 * Used exclusively to encrypt/decrypt the Master Key locally.
 * Never sent to the server.
 *
 * @param rootKey - 32-byte Root Key from deriveRootKey()
 * @returns 32-byte Wrapping Key
 */
export declare function deriveWrappingKey(rootKey: Uint8Array): Uint8Array;
/**
 * Generate a cryptographically secure random 32-byte salt.
 */
export declare function generateSalt(): Uint8Array;
/**
 * Generate a cryptographically secure random 32-byte Master Key.
 *
 * The Master Key encrypts all Folder Keys. It is generated once at
 * account creation, then stored encrypted (wrapped) on the server.
 */
export declare function generateMasterKey(): Uint8Array;
/**
 * Encrypt the Master Key with the Wrapping Key using XChaCha20-Poly1305.
 * The encrypted result is stored on the server for multi-device sync.
 *
 * @param masterKey   - 32-byte Master Key
 * @param wrappingKey - 32-byte Wrapping Key from deriveWrappingKey()
 * @returns Encrypted Master Key and its nonce
 */
export declare function encryptMasterKey(masterKey: Uint8Array, wrappingKey: Uint8Array): {
    encrypted: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Decrypt the Master Key with the Wrapping Key.
 * Throws if the password (and therefore wrapping key) is incorrect.
 *
 * @param encryptedMasterKey - Encrypted Master Key from the server
 * @param nonce              - Nonce stored alongside the encrypted key
 * @param wrappingKey        - 32-byte Wrapping Key from deriveWrappingKey()
 * @returns Decrypted 32-byte Master Key
 */
export declare function decryptMasterKey(encryptedMasterKey: Uint8Array, nonce: Uint8Array, wrappingKey: Uint8Array): Uint8Array;
/**
 * Encrypt arbitrary data with the Master Key using XChaCha20-Poly1305.
 *
 * @param data      - Plaintext bytes or string to encrypt
 * @param masterKey - 32-byte Master Key
 * @returns Ciphertext and nonce
 */
export declare function encryptWithMasterKey(data: Uint8Array | string, masterKey: Uint8Array): {
    encrypted: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Decrypt data with the Master Key.
 *
 * @param encrypted - Ciphertext bytes
 * @param nonce     - Nonce used during encryption
 * @param masterKey - 32-byte Master Key
 * @returns Decrypted plaintext bytes
 */
export declare function decryptWithMasterKey(encrypted: Uint8Array, nonce: Uint8Array, masterKey: Uint8Array): Uint8Array;
/** Generate a cryptographically secure random 32-byte Folder Key. */
export declare function generateFolderKey(): Uint8Array;
/**
 * Encrypt a Folder Key with the Master Key.
 * The encrypted Folder Key is stored on the server per-folder.
 */
export declare function encryptFolderKey(folderKey: Uint8Array, masterKey: Uint8Array): {
    encrypted: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Decrypt a Folder Key with the Master Key.
 */
export declare function decryptFolderKey(encrypted: Uint8Array, nonce: Uint8Array, masterKey: Uint8Array): Uint8Array;
/** Generate a cryptographically secure random 32-byte File Key. */
export declare function generateFileKey(): Uint8Array;
/**
 * Encrypt a File Key with the Folder Key that contains it.
 * The encrypted File Key is stored on the server per-file.
 */
export declare function encryptFileKey(fileKey: Uint8Array, folderKey: Uint8Array): {
    encrypted: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Decrypt a File Key with the Folder Key.
 */
export declare function decryptFileKey(encrypted: Uint8Array, nonce: Uint8Array, folderKey: Uint8Array): Uint8Array;
/**
 * Encrypt the metadata blob (folder names, file names, MIME types) with the Master Key.
 * The server only ever sees encrypted JSON — it cannot read folder or file names.
 */
export declare function encryptMetadataBlob(metadata: MetadataBlob, masterKey: Uint8Array): {
    encrypted: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Decrypt and parse the metadata blob.
 */
export declare function decryptMetadataBlob(encrypted: Uint8Array, nonce: Uint8Array, masterKey: Uint8Array): MetadataBlob;
/**
 * Encrypt a single file chunk independently.
 *
 * Each chunk is encrypted with its own XChaCha20-Poly1305 secretstream session,
 * producing a unique header (nonce) stored in the database. This enables
 * resumable uploads and parallel decryption of individual chunks.
 *
 * @param chunkBlob - Raw file chunk as a Blob
 * @param fileKey   - 32-byte File Key for this file
 * @returns Encrypted chunk Blob and the stream header (stored as nonce in DB)
 */
export declare function encryptChunk(chunkBlob: Blob, fileKey: Uint8Array): Promise<{
    encryptedChunk: Blob;
    nonce: Uint8Array;
}>;
/**
 * Decrypt a single file chunk.
 *
 * @param encryptedChunkBlob - Encrypted chunk Blob
 * @param nonce              - Stream header (nonce) stored in DB for this chunk
 * @param fileKey            - 32-byte File Key for this file
 * @returns Decrypted chunk as a Blob
 */
export declare function decryptChunk(encryptedChunkBlob: Blob, nonce: Uint8Array, fileKey: Uint8Array): Promise<Blob>;
/**
 * Encrypt an entire file using XChaCha20-Poly1305 secretstream.
 *
 * Processes the file in 64 MB blocks to avoid holding the entire file in memory.
 * The stream header is prepended to the output blob and also returned separately
 * as the `nonce` for storage in the database.
 *
 * @param file    - The original File object from the browser
 * @param fileKey - 32-byte File Key for this file
 * @returns Encrypted Blob (header prepended) and the stream header as nonce
 */
export declare function encryptFile(file: File, fileKey: Uint8Array): Promise<{
    encryptedBlob: Blob;
    nonce: Uint8Array;
}>;
/**
 * Decrypt a file using XChaCha20-Poly1305 secretstream.
 *
 * Supports two decryption modes:
 * - **Segmented mode**: Pass an array of chunk metadata (with individual nonces).
 *   Used for chunked/resumable uploads where each chunk has its own stream.
 * - **Monolithic mode**: Pass a single Uint8Array nonce or null.
 *   Used for smaller files encrypted in one pass.
 *
 * @param encryptedBlob           - The full encrypted file Blob
 * @param providedChunksOrNonce   - Chunk metadata array (segmented) or nonce (monolithic)
 * @param fileKey                 - 32-byte File Key
 * @returns Decrypted file as a Uint8Array
 */
export declare function decryptFile(encryptedBlob: Blob, providedChunksOrNonce: any[] | Uint8Array | null, fileKey: Uint8Array): Promise<Uint8Array>;
/**
 * Create a streaming TransformStream for decrypting a file without holding
 * the entire contents in memory. Ideal for large file downloads.
 *
 * Usage:
 * ```ts
 * const stream = createDecryptionStream(fileKey, header);
 * encryptedReadableStream.pipeThrough(stream).pipeTo(writable);
 * ```
 *
 * @param fileKey - 32-byte File Key
 * @param header  - Stream header (nonce) for this file
 * @returns A Web Streams API TransformStream
 */
export declare function createDecryptionStream(fileKey: Uint8Array, header: Uint8Array): TransformStream<Uint8Array, Uint8Array>;
/** Convert a Uint8Array to a base64 string. */
export declare function toBase64(data: Uint8Array): string;
/** Convert a base64 string to a Uint8Array. */
export declare function fromBase64(base64: string): Uint8Array;
/** Convert a Uint8Array to a lowercase hex string. */
export declare function toHex(data: Uint8Array): string;
/** Convert a lowercase hex string to a Uint8Array. */
export declare function fromHex(hex: string): Uint8Array;
/** Generate a cryptographically secure random 32-byte Collab Key. */
export declare function generateCollabKey(): Uint8Array;
/** Generate a cryptographically secure random 32-byte Link Key. */
export declare function generateLinkKey(): Uint8Array;
/**
 * Encrypt the Collab Key with the Host's Master Key using XChaCha20-Poly1305.
 */
export declare function encryptCollabKeyForHost(collabKey: Uint8Array, masterKey: Uint8Array): {
    encrypted: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Encrypt the Collab Key with a Link Key using XChaCha20-Poly1305.
 */
export declare function encryptCollabKeyForLink(collabKey: Uint8Array, linkKey: Uint8Array): {
    encrypted: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Decrypt the Collab Key with a Decryption Key (either Master Key or Link Key).
 */
export declare function decryptCollabKey(encryptedCollabKey: Uint8Array, nonce: Uint8Array, decryptionKey: Uint8Array): Uint8Array;
/**
 * Generate a Drop Zone keypair (Curve25519) for asymmetric write-only access.
 */
export declare function generateDropZoneKeyPair(): {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
};
/**
 * Encrypt the Drop Zone private key using the Master Key.
 */
export declare function encryptDropPrivateKey(privateKey: Uint8Array, masterKey: Uint8Array): {
    encrypted: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Decrypt the Drop Zone private key using the Master Key.
 */
export declare function decryptDropPrivateKey(encryptedPrivateKey: Uint8Array, nonce: Uint8Array, masterKey: Uint8Array): Uint8Array;
/**
 * Encrypt a file for a Drop Zone using an ephemeral key and asymmetric encryption (sealed box).
 *
 * @param fileBytes     - Plaintext file bytes
 * @param dropPublicKey - Drop Zone public key
 */
export declare function encryptFileForDropZone(fileBytes: Uint8Array, dropPublicKey: Uint8Array): {
    encryptedFile: Uint8Array;
    encryptedFileKey: Uint8Array;
    fileKeyNonce: Uint8Array;
};
/**
 * Decrypt a Drop Zone file using the Drop Zone private key.
 */
export declare function decryptDropZoneFile(encryptedFile: Uint8Array, encryptedFileKey: Uint8Array, fileKeyNonce: Uint8Array, dropPrivateKey: Uint8Array): Uint8Array;
/**
 * Encrypt a file using the Collab Folder key.
 */
export declare function encryptFileWithCollabKey(fileBytes: Uint8Array, collabKey: Uint8Array): {
    encryptedFile: Uint8Array;
    nonce: Uint8Array;
};
/**
 * Re-encrypt a file's encryption key from the folder key to the Collab Folder key.
 */
export declare function rekeyFileForCollab(encryptedFileKey: Uint8Array, fileKeyNonce: Uint8Array, folderKey: Uint8Array, collabKey: Uint8Array): {
    newEncryptedFileKey: Uint8Array;
    newNonce: Uint8Array;
};
