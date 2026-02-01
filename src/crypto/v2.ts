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

    console.log(`[v2-crypto] > Chunk Header (Nonce): ${toHex(header)}`);

    // 2. Encrypt Data in 64MB blocks (Standard)
    const encryptedParts: Uint8Array[] = [];
    const CHUNK_SIZE = 64 * 1024 * 1024;

    let offset = 0;
    let subChunkIndex = 0;

    while (offset < chunkBlob.size) {
        const end = Math.min(offset + CHUNK_SIZE, chunkBlob.size);
        const isLast = end >= chunkBlob.size;

        // Slice safely
        const slice = chunkBlob.slice(offset, end);
        const chunkData = new Uint8Array(await slice.arrayBuffer());

        const encrypted = sodium.crypto_secretstream_xchacha20poly1305_push(
            pushState.state,
            chunkData,
            null,
            isLast ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
        );
        encryptedParts.push(encrypted as Uint8Array);

        if (subChunkIndex % 5 === 0) console.log(`[v2-crypto] >> Sub-chunk ${subChunkIndex}: ${chunkData.length} bytes -> ${encrypted.length} bytes (Last: ${isLast})`);

        offset = end;
        subChunkIndex++;
    }

    // 3. Construct Blob (Ciphertext Only - Header is returned separately as 'nonce' for DB)
    const encryptedChunk = new Blob(encryptedParts as any, { type: 'application/octet-stream' });
    console.log(`[v2-crypto] ✅ Chunk encrypted. Total size: ${encryptedChunk.size}`);

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

    // Detect if we are using the Segmented Stream Protocol (SSP) OR Metadata-based segmentation
    const isSegmented = Array.isArray(providedChunksOrNonce) && providedChunksOrNonce.length > 0;

    // Track current chunk index if segmented
    let chunkIndex = 0;

    try {
        while (offset < encryptedBlob.size) {
            let currentSegmentSize = 0;
            let currentHeader: Uint8Array | undefined;

            if (isSegmented) {
                // METADATA SEGMENTATION: Use the size and nonce provided in the chunks array
                const chunks = providedChunksOrNonce as any[];
                if (chunkIndex >= chunks.length) break; // Should not happen if sizes match

                const chunkMeta = chunks[chunkIndex];
                currentSegmentSize = chunkMeta.size;

                // Ensure nonce is Uint8Array
                const nonceValue = chunkMeta.nonce;
                currentHeader = typeof nonceValue === 'string' ? fromBase64(nonceValue) : (nonceValue as Uint8Array);

                console.log(`[v2-crypto] Decrypting Chunk ${chunkMeta.index}`);
                console.log(`[v2-crypto] > Meta Size: ${currentSegmentSize}`);
                console.log(`[v2-crypto] > Header (Nonce): ${toHex(currentHeader)}`);
                console.log(`[v2-crypto] > File Key (start): ${toHex(fileKey.slice(0, 8))}...`);

                chunkIndex++;
            } else {
                // MONOLITHIC / STREAM SEGMENTATION

                // MONOLITHIC / STREAM SEGMENTATION

                // 2. Read Header from the start of the stream (Standard Sodium SecretStream)
                if (offset === 0) {
                    if (encryptedBlob.size < headerSize) {
                        throw new Error('File too small to contain header');
                    }

                    const headerSlice = encryptedBlob.slice(0, headerSize);
                    currentHeader = new Uint8Array(await headerSlice.arrayBuffer());
                    offset += headerSize;
                    console.log(`[v2-crypto] Initialized monolithic stream with embedded header (${toHex(currentHeader)})`);
                } else if (!currentHeader) {
                    // Should verify if we have a header for subsequent offsets in monolithic mode
                    // In monolithic, header is only read once. We need to persist it?
                    // Actually, init_pull is called inside the loop.
                    // sodium.crypto_secretstream_xchacha20poly1305_init_pull NEEDS the header.
                    // But for monolithic, we only init once?
                    // NO. The outer loop is `while offset < size`.
                    // If we loop, we call init_pull AGAIN.
                    // For monolithic, we should NOT invoke init_pull multiple times on the same stream unless we use the STATE.
                    // But we DON'T persist 'pullState' across outer loop iterations!
                    // The outer loop structure assumes SEGMENTS.

                    // CRITICAL LOGIC FIX:
                    // Monolithic files should be ONE segment.
                    // If 'isSegmented' is false, the outer loop should ideally run ONCE.
                    // But currently it runs 'while offset < size'.
                    // Inside, 'while (!segmentFinished)'.
                    // For monolithic, segmentFinished only happens at END of file.
                    // So the inner loop should consume the whole file.
                    // If it does, offset increases to end. Outer loop terminates.
                    // So 'currentHeader' is only needed once.
                    // However, compiler thinks 'currentHeader' might be undefined if we somehow loop again.
                    throw new Error("Unexpected state: Monolithic loop iteration without header");
                }
            }

            let pullState: any; // Type as 'any' or 'StateAddress' if available locally

            // Initialize pullState if not already initialized (for monolithic) or for each new segment
            if (isSegmented) {
                if (!currentHeader) throw new Error("Missing Chunk Header");
                pullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(currentHeader, fileKey);
            } else {
                // Monolithic: Init once
                if (!pullState) {
                    if (!currentHeader) throw new Error("Missing Monolithic Header");
                    pullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(currentHeader, fileKey);
                }
            }


            // 3. Decrypt this segment
            let segmentFinished = false;
            let segmentBytesRead = 0; // Bytes read for this segment's CIPHERTEXT (excluding externally handled headers)

            // Special Case: If using embedded headers (monolithic), the header was just read from offset.
            // But currentSegmentSize is not defined for monolithic (it runs until stream end/tag).

            while (offset < encryptedBlob.size && !segmentFinished) {
                let nextPullSize: number;

                if (isSegmented) {
                    // Start of Chunk: We haven't read any ciphertext yet.
                    // currentSegmentSize is the TOTAL size of the stored chunk (which usually includes overhead?)
                    // Actually, 'size' in DB from 'fileChunks' is the file size on disk.
                    // The 'encryptChunk' output is stored directly.
                    // So 'currentSegmentSize' IS the amount of bytes we need to read from blob.

                    nextPullSize = currentSegmentSize - segmentBytesRead;

                    // Cap at standard chunk size if needed, but usually we pull the whole chunk if memory allows?
                    // Let's pull in 64MB blocks to be safe if chunks are huge.
                    nextPullSize = Math.min(nextPullSize, STANDARD_ENCRYPTED_CHUNK);

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

                // console.log(`[v2-crypto] Pulling block at offset ${offset} (size: ${chunkData.length})`);

                const result = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, chunkData, null);

                if (!result) {
                    console.error(`[v2-crypto] ❌ Pull failed at offset ${offset}. ChunkData len: ${chunkData.length}. Header: ${isSegmented ? 'Meta' : 'Stream'}`);
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
    let bytesProcessed = 0;
    let chunkCount = 0;

    console.log(`[v2-crypto] 🚀 Stream Decrypt Init. Header (Hex): ${toHex(header)} (Length: ${header.length}B)`);
    console.log(`[v2-crypto] > File Key (start): ${toHex(fileKey.slice(0, 8))}...`);

    return new TransformStream({
        start() {
            try {
                if (header.length !== sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES) {
                    throw new Error(`Invalid header length: expected ${sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES}, got ${header.length}`);
                }
                pullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, fileKey);
            } catch (e) {
                console.error('[v2-crypto] ❌ Stream Init Pull Failed:', e);
                throw e;
            }
        },
        transform(chunk, controller) {
            // Buffer incoming bytes until we have a full crypto block
            const newBuffer = new Uint8Array(buffer.length + chunk.length);
            newBuffer.set(buffer);
            newBuffer.set(chunk, buffer.length);
            buffer = newBuffer;

            // Process chunks of STANDARD_ENCRYPTED_CHUNK size
            while (buffer.length >= STANDARD_ENCRYPTED_CHUNK) {
                const toProcess = buffer.subarray(0, STANDARD_ENCRYPTED_CHUNK);
                // Use slice for the remaining buffer as it creates a fresh copy, allowing the old large buffer to be GC'd
                buffer = buffer.slice(STANDARD_ENCRYPTED_CHUNK);

                try {
                    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, toProcess, null);
                    if (!result) {
                        throw new Error(`Decryption failed: Tag/Ciphertext mismatch at segment offset ${bytesProcessed} (Block Index ${chunkCount})`);
                    }
                    controller.enqueue(result.message as Uint8Array);
                    bytesProcessed += toProcess.length;
                    chunkCount++;

                    if (chunkCount % 5 === 0) {
                        console.log(`[v2-crypto] >> Decrypted Block ${chunkCount} (Total: ${(bytesProcessed / 1024 / 1024).toFixed(0)} MB)`);
                    }

                    if (result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL && buffer.length > 0) {
                        console.warn(`[v2-crypto] ⚠️ Received TAG_FINAL but buffer still has ${buffer.length} bytes! Stream might be corrupted or combined incorrectly.`);
                    }
                } catch (e) {
                    console.error(`[v2-crypto] ❌ Stream block decryption failed:`, {
                        offset: bytesProcessed,
                        blockIndex: chunkCount,
                        blockSize: toProcess.length,
                        bufferRemaining: buffer.length,
                        error: e
                    });
                    controller.error(e);
                    return;
                }
            }
        },
        flush(controller) {
            // Process any remaining bytes (the final smaller chunk)
            if (buffer.length > 0) {
                try {
                    console.log(`[v2-crypto] 🏁 Stream Flush: processing final ${buffer.length} bytes at offset ${bytesProcessed}`);

                    if (buffer.length < CRYPTO_OVERHEAD) {
                        throw new Error(`Final block too small: expected at least ${CRYPTO_OVERHEAD} bytes, got ${buffer.length}. The file might be truncated.`);
                    }

                    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, buffer, null);
                    if (!result) throw new Error('Decryption failed on final block (Mismatch)');

                    controller.enqueue(result.message as Uint8Array);
                    console.log(`[v2-crypto] ✅ Stream Flush Success.`);
                } catch (e) {
                    console.error('[v2-crypto] ❌ Stream Flush Failed:', e);
                    controller.error(e);
                }
            } else {
                console.log(`[v2-crypto] ✅ Stream Finished smoothly (no remaining bytes).`);
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
