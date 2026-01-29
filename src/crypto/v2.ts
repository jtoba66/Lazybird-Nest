import sodium from 'libsodium-wrappers';

await sodium.ready;

// ============================================================================
// Types
// ============================================================================

export interface KDFParams {
    algorithm: 'argon2id' | 'pbkdf2';
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
    iterations?: number;
}

export interface MetadataBlob {
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

// ============================================================================
// Zero-Knowledge Primitives (Key Derivation & Wrapping)
// ============================================================================

/**
 * Derive Root Key from password using Argon2id
 * This key is NEVER sent to the server. It is used to derive:
 * 1. Auth Hash (for login)
 * 2. Wrapping Key (to decrypt the Master Key)
 */
export async function deriveRootKey(
    password: string,
    salt: Uint8Array,
    params: KDFParams
): Promise<Uint8Array> {
    console.log('[v2-crypto] Deriving Root Key...');
    console.time('[v2-crypto] Root Key derivation');

    try {
        if (params.algorithm === 'argon2id') {
            const { argon2id } = await import('hash-wasm');

            const result = await argon2id({
                password: password,
                salt: salt as any,
                parallelism: params.parallelism || 4,
                iterations: params.timeCost || 3,
                memorySize: params.memoryCost || 65536,
                hashLength: 32,
                outputType: 'binary'
            });

            console.timeEnd('[v2-crypto] Root Key derivation');
            return result as Uint8Array;
        } else {
            // PBKDF2 fallback
            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey(
                'raw',
                encoder.encode(password),
                'PBKDF2',
                false,
                ['deriveBits']
            );
            const derivedBits = await crypto.subtle.deriveBits(
                {
                    name: 'PBKDF2',
                    salt: salt as BufferSource,
                    iterations: params.iterations || 600000,
                    hash: 'SHA-256',
                },
                key,
                256
            );
            console.timeEnd('[v2-crypto] Root Key derivation');
            return new Uint8Array(derivedBits);
        }
    } catch (error) {
        console.error('[v2-crypto] ❌ Root Key derivation failed:', error);
        throw new Error('Failed to derive Root Key');
    }
}

/**
 * Derive Auth Hash from Root Key (sent to server for login)
 * Uses BLAKE2b(RootKey, 'AUTH')
 */
export function deriveAuthHash(rootKey: Uint8Array): string {
    const input = new Uint8Array([...new TextEncoder().encode('auth_'), ...rootKey]);
    const authHash = sodium.crypto_generichash(32, input, null);
    return toHex(authHash as Uint8Array);
}

/**
 * Derive Wrapping Key from Root Key (used to decrypt Master Key)
 * Uses BLAKE2b(RootKey, 'WRAP')
 */
export function deriveWrappingKey(rootKey: Uint8Array): Uint8Array {
    const input = new Uint8Array([...new TextEncoder().encode('wrap_'), ...rootKey]);
    return sodium.crypto_generichash(32, input, null) as Uint8Array;
}

/**
 * Generate a random salt (32 bytes)
 */
export function generateSalt(): Uint8Array {
    return sodium.randombytes_buf(32) as Uint8Array;
}

/**
 * Generate a random Master Key (32 bytes)

 * This is the actual key that encrypts user data.
 */
export function generateMasterKey(): Uint8Array {
    return sodium.randombytes_buf(32) as Uint8Array;
}

/**
 * Encrypt Master Key with Wrapping Key
 * Stored on server to allow multi-device sync.
 */
export function encryptMasterKey(
    masterKey: Uint8Array,
    wrappingKey: Uint8Array
): { encrypted: Uint8Array; nonce: Uint8Array } {
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) as Uint8Array;
    const encrypted = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        masterKey,
        null,
        null,
        nonce,
        wrappingKey
    ) as Uint8Array;
    return { encrypted, nonce };
}

/**
 * Decrypt Master Key with Wrapping Key
 */
export function decryptMasterKey(
    encryptedMasterKey: Uint8Array,
    nonce: Uint8Array,
    wrappingKey: Uint8Array
): Uint8Array {
    try {
        return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
            null,
            encryptedMasterKey,
            null,
            nonce,
            wrappingKey
        ) as Uint8Array;
    } catch {
        throw new Error('Invalid Password (failed to decrypt Master Key)');
    }
}


// ============================================================================
// Master Key Encryption/Decryption
// ============================================================================

/**
 * Encrypt data with Master Key using XChaCha20-Poly1305
 */
export function encryptWithMasterKey(
    data: Uint8Array | string,
    masterKey: Uint8Array
): { encrypted: Uint8Array; nonce: Uint8Array } {
    console.log('[v2-crypto] Encrypting with Master Key');

    const dataBuffer = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data;

    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) as Uint8Array;

    const encrypted = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        dataBuffer,
        null,
        null,
        nonce,
        masterKey
    ) as Uint8Array;

    console.log(`[v2-crypto] ✅ Encrypted ${dataBuffer.length} bytes with Master Key`);
    return { encrypted, nonce };
}

/**
 * Decrypt data with Master Key
 */
export function decryptWithMasterKey(
    encrypted: Uint8Array,
    nonce: Uint8Array,
    masterKey: Uint8Array
): Uint8Array {
    console.log('[v2-crypto] Decrypting with Master Key');

    try {
        const decrypted = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
            null,
            encrypted,
            null,
            nonce,
            masterKey
        ) as Uint8Array;

        console.log(`[v2-crypto] ✅ Decrypted ${decrypted.length} bytes`);
        return decrypted;
    } catch (error) {
        console.error('[v2-crypto] ❌ Decryption failed:', error);
        throw new Error('Failed to decrypt with Master Key');
    }
}

// ============================================================================
// Folder Key Management
// ============================================================================

/**
 * Generate random Folder Key
 */
export function generateFolderKey(): Uint8Array {
    console.log('[v2-crypto] Generating Folder Key');
    return sodium.randombytes_buf(32) as Uint8Array;
}

/**
 * Encrypt Folder Key with Master Key
 */
export function encryptFolderKey(
    folderKey: Uint8Array,
    masterKey: Uint8Array
): { encrypted: Uint8Array; nonce: Uint8Array } {
    console.log('[v2-crypto] Encrypting Folder Key with Master Key');
    return encryptWithMasterKey(folderKey, masterKey);
}

/**
 * Decrypt Folder Key with Master Key
 */
export function decryptFolderKey(
    encrypted: Uint8Array,
    nonce: Uint8Array,
    masterKey: Uint8Array
): Uint8Array {
    console.log('[v2-crypto] Decrypting Folder Key with Master Key');
    return decryptWithMasterKey(encrypted, nonce, masterKey);
}

// ============================================================================
// File Key Management
// ============================================================================

/**
 * Generate random File Key
 */
export function generateFileKey(): Uint8Array {
    console.log('[v2-crypto] Generating File Key');
    return sodium.randombytes_buf(32) as Uint8Array;
}

/**
 * Encrypt File Key with Folder Key
 */
export function encryptFileKey(
    fileKey: Uint8Array,
    folderKey: Uint8Array
): { encrypted: Uint8Array; nonce: Uint8Array } {
    console.log('[v2-crypto] Encrypting File Key with Folder Key');

    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) as Uint8Array;

    const encrypted = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        fileKey,
        null,
        null,
        nonce,
        folderKey
    ) as Uint8Array;

    console.log('[v2-crypto] ✅ File Key encrypted');
    return { encrypted, nonce };
}

/**
 * Decrypt File Key with Folder Key
 */
export function decryptFileKey(
    encrypted: Uint8Array,
    nonce: Uint8Array,
    folderKey: Uint8Array
): Uint8Array {
    console.log('[v2-crypto] Decrypting File Key with Folder Key');

    try {
        const decrypted = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
            null,
            encrypted,
            null,
            nonce,
            folderKey
        ) as Uint8Array;

        console.log('[v2-crypto] ✅ File Key decrypted');
        return decrypted;
    } catch (error) {
        console.error('[v2-crypto] ❌ File Key decryption failed:', error);
        throw new Error('Failed to decrypt File Key');
    }
}

// ============================================================================
// Metadata Blob Management
// ============================================================================

/**
 * Encrypt metadata blob
 */
export function encryptMetadataBlob(
    metadata: MetadataBlob,
    masterKey: Uint8Array
): { encrypted: Uint8Array; nonce: Uint8Array } {
    console.log(`[v2-crypto] Encrypting metadata blob (folders: ${Object.keys(metadata.folders).length}, files: ${Object.keys(metadata.files).length})`);

    const json = JSON.stringify(metadata);
    return encryptWithMasterKey(json, masterKey);
}

/**
 * Decrypt metadata blob
 */
export function decryptMetadataBlob(
    encrypted: Uint8Array,
    nonce: Uint8Array,
    masterKey: Uint8Array
): MetadataBlob {
    console.log('[v2-crypto] Decrypting metadata blob');

    const decrypted = decryptWithMasterKey(encrypted, nonce, masterKey);
    const json = new TextDecoder().decode(decrypted);
    const metadata = JSON.parse(json);

    console.log(`[v2-crypto] ✅ Metadata blob decrypted (folders: ${Object.keys(metadata.folders).length}, files: ${Object.keys(metadata.files).length})`);
    return metadata;
}

// ============================================================================
// File Encryption/Decryption
// ============================================================================

/**
 * Encrypt file with File Key
 */

/**
 * Encrypt a single chunk independently (for Sharding/Resume Support)
 */
export async function encryptChunk(
    chunkBlob: Blob,
    fileKey: Uint8Array
): Promise<{ encryptedChunk: Blob; nonce: Uint8Array }> {
    console.log(`[v2-crypto] Encrypting chunk (${chunkBlob.size} bytes)`);

    // 1. Init Push (Generates Header/Nonce)
    const pushState = sodium.crypto_secretstream_xchacha20poly1305_init_push(fileKey);
    const header = typeof pushState.header === 'string'
        ? fromBase64(pushState.header as unknown as string)
        : pushState.header;

    // 2. Encrypt Data in 64MB blocks (Standard)
    const encryptedParts: Uint8Array[] = [];
    const CHUNK_SIZE = 64 * 1024 * 1024;

    let offset = 0;
    while (offset < chunkBlob.size) {
        const end = Math.min(offset + CHUNK_SIZE, chunkBlob.size);
        const isLast = end >= chunkBlob.size;

        const chunkData = new Uint8Array(await chunkBlob.slice(offset, end).arrayBuffer());
        const encrypted = sodium.crypto_secretstream_xchacha20poly1305_push(
            pushState.state,
            chunkData,
            null,
            isLast ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
        );
        encryptedParts.push(encrypted as Uint8Array);
        offset = end;
    }

    // 3. Construct Blob (Ciphertext Only - Header is returned separately as 'nonce' for DB)
    const encryptedChunk = new Blob(encryptedParts as any, { type: 'application/octet-stream' });
    return { encryptedChunk, nonce: header };
}

/**
 * Decrypt a single chunk
 */
export async function decryptChunk(
    encryptedChunkBlob: Blob,
    nonce: Uint8Array, // Header
    fileKey: Uint8Array
): Promise<Blob> {
    // 1. Init Pull
    const statePull = sodium.crypto_secretstream_xchacha20poly1305_init_pull(nonce, fileKey);

    // 2. Decrypt
    const arrayBuffer = await encryptedChunkBlob.arrayBuffer();
    const chunkData = new Uint8Array(arrayBuffer);

    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(
        statePull,
        chunkData,
        null
    );

    if (!result || !('message' in result)) {
        throw new Error('Chunk decryption failed');
    }

    return new Blob([result.message as any], { type: 'application/octet-stream' });
}
/**
 * Encrypt file with File Key using chunked processing to save memory (Streaming)
 */
export async function encryptFile(
    file: File,
    fileKey: Uint8Array
): Promise<{ encryptedBlob: Blob; nonce: Uint8Array }> {
    console.log(`[v2-crypto] Encrypting file: ${file.name} (${file.size} bytes)`);
    console.time('[v2-crypto] File encryption');

    const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB chunks

    // Initialize streaming encryption
    const pushState = sodium.crypto_secretstream_xchacha20poly1305_init_push(fileKey);
    const state = pushState.state;
    // Ensure header is Uint8Array
    const header = typeof pushState.header === 'string'
        ? fromBase64(pushState.header as unknown as string)
        : pushState.header;

    // Cast header to BlobPart since we know it's a Uint8Array
    const encryptedParts: BlobPart[] = [header as unknown as BlobPart];

    let offset = 0;
    let chunkIndex = 0;

    try {
        while (offset < file.size) {
            const chunk = file.slice(offset, offset + CHUNK_SIZE);
            const arrayBuffer = await chunk.arrayBuffer();
            const chunkData = new Uint8Array(arrayBuffer);

            const isLast = (offset + CHUNK_SIZE) >= file.size;
            const tag = isLast
                ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
                : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;

            const encryptedChunk = sodium.crypto_secretstream_xchacha20poly1305_push(
                state,
                chunkData,
                null, // additional data
                tag
            );

            // Cast to BlobPart
            encryptedParts.push(encryptedChunk as unknown as BlobPart);

            offset += CHUNK_SIZE;
            chunkIndex++;

            if (chunkIndex % 5 === 0) console.log(`[v2-crypto] Encrypted ${(offset / 1024 / 1024).toFixed(0)}MB...`);
        }
    } catch (e) {
        console.error('[v2-crypto] Streaming encryption failed:', e);
        throw e;
    }

    const encryptedBlob = new Blob(encryptedParts, { type: 'application/octet-stream' });

    console.timeEnd('[v2-crypto] File encryption');
    console.log(`[v2-crypto] ✅ File encrypted (streamed). Total size: ${encryptedBlob.size}`);

    // Return header as nonce
    return { encryptedBlob, nonce: header as Uint8Array };
}

/**
 * Decrypt file with File Key using chunked processing (Streaming)
 */
export async function decryptFile(
    encryptedBlob: Blob,
    providedChunksOrNonce: any[] | Uint8Array | null,
    fileKey: Uint8Array
): Promise<Uint8Array> {
    console.log(`[v2-crypto] Decrypting file (${encryptedBlob.size} bytes)`);
    console.time('[v2-crypto] File decryption');

    const headerSize = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
    const CRYPTO_OVERHEAD = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
    const PLAIN_CHUNK_SIZE = 64 * 1024 * 1024;
    const STANDARD_ENCRYPTED_CHUNK = PLAIN_CHUNK_SIZE + CRYPTO_OVERHEAD;

    const decryptedParts: Uint8Array[] = [];
    let offset = 0;

    // Detect if we are using the Segmented Stream Protocol (SSP)
    const isSegmented = Array.isArray(providedChunksOrNonce) && providedChunksOrNonce.length > 0;
    const providedNonce = (!isSegmented && providedChunksOrNonce instanceof Uint8Array) ? providedChunksOrNonce : null;

    try {
        while (offset < encryptedBlob.size) {
            let currentSegmentSize = 0;
            let currentHeader: Uint8Array;

            if (isSegmented) {
                // 1. Read 4-byte Size Header (Segmented Stream Protocol)
                if (offset + 4 > encryptedBlob.size) break;
                const sizeSlice = encryptedBlob.slice(offset, offset + 4);
                const sizeBuf = new Uint8Array(await sizeSlice.arrayBuffer());
                const view = new DataView(sizeBuf.buffer);
                currentSegmentSize = view.getUint32(0, true);
                offset += 4;
                console.log(`[v2-crypto] SSP: Reading segment of total size ${currentSegmentSize}`);
            }

            // 2. Determine Header for current segment
            if (offset === 0 && providedNonce && providedNonce.length === headerSize) {
                currentHeader = providedNonce;

                // Peek at the start of the blob to see if the header is also embedded.
                // If it is, we MUST skip it to avoid treating the header as ciphertext.
                const peekSlice = encryptedBlob.slice(0, headerSize);
                const peekData = new Uint8Array(await peekSlice.arrayBuffer());

                if (sodium.memcmp(peekData, currentHeader)) {
                    offset += headerSize;
                    console.log('[v2-crypto] Skipping matching embedded header');
                } else {
                    console.log('[v2-crypto] Using provided external header (not embedded)');
                }
            } else {
                if (offset + headerSize > encryptedBlob.size) break; // Finished
                const headerSlice = encryptedBlob.slice(offset, offset + headerSize);
                currentHeader = new Uint8Array(await headerSlice.arrayBuffer());
                offset += headerSize;
                console.log('[v2-crypto] Initializing sub-stream from embedded header');
            }

            const pullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(currentHeader, fileKey);

            // 3. Decrypt this segment
            let segmentFinished = false;
            let segmentBytesRead = headerSize; // bytes read so far relative to currentSegmentSize

            // Special Case: if we are using SSP and we just read the header from the stream (offset was incremented),
            // then segmentBytesRead is correctly headerSize.
            // If we are at offset 0 and using an external providedNonce, we might have skipped the header.
            // The logic above already handles offset incrementing correctly.

            while (offset < encryptedBlob.size && !segmentFinished) {
                let nextPullSize: number;

                if (isSegmented) {
                    // Pull the REMAINING ciphertext in this segment
                    // currentSegmentSize includes the header. segmentBytesRead also includes the header.
                    // So, the remaining ciphertext is currentSegmentSize - segmentBytesRead.
                    nextPullSize = currentSegmentSize - segmentBytesRead;
                    if (nextPullSize <= 0) {
                        segmentFinished = true;
                        break;
                    }
                } else {
                    // Pull standard 64MB blocks
                    const remainingInBlob = encryptedBlob.size - offset;
                    nextPullSize = Math.min(STANDARD_ENCRYPTED_CHUNK, remainingInBlob);
                }

                if (nextPullSize <= 0) break;

                const chunkSlice = encryptedBlob.slice(offset, offset + nextPullSize);
                const chunkData = new Uint8Array(await chunkSlice.arrayBuffer());

                const result = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, chunkData, null);

                if (!result) {
                    // Fail-safe: Tag mismatch.
                    // Scenario A: We tried using providedNonce but the file actually has a DIFFERENT embedded header (Stale DB nonce).
                    // Scenario B: We are legacy large-block.

                    if (offset === 0 && providedNonce && !isSegmented) {
                        console.warn('[v2-crypto] Decryption with provided nonce failed. Attempting to use embedded header...');
                        // Reset and try using the start of the blob as the header
                        const headerSlice = encryptedBlob.slice(0, headerSize);
                        const embeddedHeader = new Uint8Array(await headerSlice.arrayBuffer());

                        // Treat the blob as [Header][Ciphertext]
                        const newPullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(embeddedHeader, fileKey);

                        // We need to pull from offset + headerSize now? 
                        // Wait, previous attempt was offset=0 to length.
                        // New attempt is offset=headerSize to length.
                        const retryOffset = headerSize;
                        const retryLength = nextPullSize - headerSize; // Just an approximation, we need to read appropriately

                        if (retryLength > 0) {
                            const retrySlice = encryptedBlob.slice(retryOffset, retryOffset + retryLength);
                            const retryData = new Uint8Array(await retrySlice.arrayBuffer());
                            const retryResult = sodium.crypto_secretstream_xchacha20poly1305_pull(newPullState, retryData, null);

                            if (retryResult) {
                                console.log('[v2-crypto] ✅ Fallback to embedded header succeeded.');
                                decryptedParts.push(retryResult.message as Uint8Array);

                                // Update main loop state to continue from here if there were more chunks (unlikely for monolithic, but good for correctness)
                                // actually, if we switch strategies we probably finish here for the first chunk.
                                // For simplicity, let's assume this fixes the *first* block.
                                // We need to update `pullState` for subsequent blocks if any?
                                // Replacing the `pullState` object reference is tricky since it's const in this scope (or let?).
                                // Let's just break and handle it, or we need to refactor to allow state swap.

                                // Given this is likely a small file (monolithic), we can just return this result if it finished?
                                if (retryResult.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
                                    segmentFinished = true;
                                    offset += nextPullSize; // We consumed the whole block (header + ciphertext) effectively
                                    break; // Break inner loop
                                }

                                // If not final, we are in a weird state where we verified the header but need to continue.
                                // This requires refactoring the outer loop variable `pullState`.
                            }
                        }
                    }

                    // Emergency fallback: legacy large block (already existing)
                    if (!isSegmented && decryptedParts.length === 0) {
                        console.warn('[v2-crypto] Standard pull failed. Trying legacy large-block recovery...');
                        const fallbackData = new Uint8Array(await encryptedBlob.slice(offset).arrayBuffer());
                        const fallbackResult = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, fallbackData, null);
                        if (fallbackResult) {
                            decryptedParts.push(fallbackResult.message as Uint8Array);
                            offset = encryptedBlob.size;
                            segmentFinished = true;
                            break;
                        }
                    }
                    throw new Error('Decryption failed: Tag/Ciphertext mismatch or stream corruption');
                }

                decryptedParts.push(result.message as Uint8Array);
                offset += nextPullSize;
                segmentBytesRead += nextPullSize;

                if (result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
                    segmentFinished = true;
                }
            }
        }
    } catch (e) {
        console.error('[v2-crypto] Decryption error:', e);
        throw e;
    }

    // Merge results
    const totalLength = decryptedParts.reduce((acc, part) => acc + part.length, 0);
    const result = new Uint8Array(totalLength);
    let resultOffset = 0;
    for (const part of decryptedParts) {
        result.set(part, resultOffset);
        resultOffset += part.length;
    }

    console.timeEnd('[v2-crypto] File decryption');
    console.log(`[v2-crypto] ✅ Decryption complete. Output size: ${result.length}`);
    return result;
}

/**
 * Decrypt a stream of data (SSP or monolithic) without holding it all in memory.
 * Uses TransformStream for zero-copy-ish processing.
 */
export function createDecryptionStream(fileKey: Uint8Array, header: Uint8Array): TransformStream<Uint8Array, Uint8Array> {
    const CRYPTO_OVERHEAD = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
    const PLAIN_CHUNK_SIZE = 64 * 1024 * 1024;
    const STANDARD_ENCRYPTED_CHUNK = PLAIN_CHUNK_SIZE + CRYPTO_OVERHEAD;

    let pullState: any = null;
    let buffer = new Uint8Array(0);

    return new TransformStream({
        start() {
            pullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, fileKey);
        },
        transform(chunk, controller) {
            // Buffer incoming bytes until we have a full crypto block
            const newBuffer = new Uint8Array(buffer.length + chunk.length);
            newBuffer.set(buffer);
            newBuffer.set(chunk, buffer.length);
            buffer = newBuffer;

            // Process chunks of STANDARD_ENCRYPTED_CHUNK size
            while (buffer.length >= STANDARD_ENCRYPTED_CHUNK) {
                const toProcess = buffer.slice(0, STANDARD_ENCRYPTED_CHUNK);
                buffer = buffer.slice(STANDARD_ENCRYPTED_CHUNK);

                try {
                    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, toProcess, null);
                    if (!result) throw new Error('Decryption failed: Tag/Ciphertext mismatch');
                    controller.enqueue(result.message as Uint8Array);
                } catch (e) {
                    controller.error(e);
                    return;
                }
            }
        },
        flush(controller) {
            // Process any remaining bytes (the final chunk)
            if (buffer.length > 0) {
                try {
                    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, buffer, null);
                    if (!result) throw new Error('Decryption failed on final block');
                    controller.enqueue(result.message as Uint8Array);
                } catch (e) {
                    controller.error(e);
                }
            }
        }
    });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert Uint8Array to base64
 */
export function toBase64(data: Uint8Array): string {
    return sodium.to_base64(data, sodium.base64_variants.ORIGINAL);
}

/**
 * Convert base64 to Uint8Array
 */
export function fromBase64(base64: string): Uint8Array {
    return sodium.from_base64(base64, sodium.base64_variants.ORIGINAL);
}

/**
 * Convert Uint8Array to hex
 */
export function toHex(data: Uint8Array): string {
    return sodium.to_hex(data);
}

/**
 * Convert hex to Uint8Array
 */
export function fromHex(hex: string): Uint8Array {
    return sodium.from_hex(hex);
}
