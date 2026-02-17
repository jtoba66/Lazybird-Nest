
import streamSaver from 'streamsaver';
import * as fflate from 'fflate';
import { filesAPI, type File } from '../api/files';
import API_BASE_URL from '../config/api';

import type { MetadataBlob } from '../crypto/v2';

// Use the default MITM to support browsers without Service Worker stream support
// streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0';

interface ExportMetadata {
    user: any;
    quota: any;
}

export const streamExport = async (
    files: File[],
    metadata: ExportMetadata,
    masterKey: Uint8Array | null,
    cryptoMetadata: MetadataBlob | null,
    onProgress: (progress: number, currentFile: string) => void
) => {
    if (!masterKey) {
        throw new Error("Master Key is missing. Cannot decrypt files.");
    }

    // 1. Setup StreamSaver
    const fileStream = streamSaver.createWriteStream(`nest_export_${new Date().toISOString().split('T')[0]}.zip`);
    const writer = fileStream.getWriter();

    // 2. Setup fflate Zip
    const zip = new fflate.Zip((err, data, final) => {
        if (err) {
            console.error('[StreamingExport] Zip Error:', err);
            writer.abort(err);
            return;
        }
        writer.write(data);
        if (final) {
            writer.close();
        }
    });

    try {
        // Import Crypto Utilities dynamically
        const {
            decryptChunk,
            fromBase64,
            decryptFileKey,
            decryptFolderKey
        } = await import('../crypto/v2');

        // 3. Add Metadata JSON
        const metadataFile = new fflate.ZipPassThrough('account_info.json');
        zip.add(metadataFile);
        metadataFile.push(new TextEncoder().encode(JSON.stringify(metadata, null, 2)), true);

        // 4. Process Files
        let completedBytes = 0;
        const totalBytes = files.reduce((acc, f) => acc + f.file_size, 0);

        // Cache for Folder Keys to avoid re-decrypting the same folder key multiple times
        const folderKeyCache: Record<string, Uint8Array> = {};

        for (const file of files) {
            // Restore filename from metadata if available
            const realFilename = cryptoMetadata?.files[file.id]?.filename || file.filename;

            onProgress(totalBytes > 0 ? (completedBytes / totalBytes) * 100 : 0, realFilename);

            try {
                // Fetch download info (keys + locations)
                const keyResponse = await fetch(`${API_BASE_URL}/files/download/${file.id}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('nest_token')}` },
                });

                if (!keyResponse.ok) {
                    console.warn(`[StreamingExport] Failed to get keys for ${file.id} (Status: ${keyResponse.status}), skipping.`);
                    // Write error file to zip so user knows something went wrong
                    const errFile = new fflate.ZipPassThrough(`${realFilename}.export_error.txt`);
                    zip.add(errFile);
                    errFile.push(new TextEncoder().encode(`Failed to retrieve file metadata from server. Status: ${keyResponse.status}`), true);
                    continue;
                }

                const fileInfo = await keyResponse.json();

                // --- DECRYPTION KEY CHAIN ---

                // 1. Decrypt Folder Key
                let folderKey: Uint8Array;
                // If the file is in a folder and we have encrypted folder key
                if (fileInfo.folder_key_encrypted && fileInfo.folder_key_nonce) {
                    const cacheKey = fileInfo.folder_id || 'root'; // Should rely on ID

                    if (folderKeyCache[cacheKey]) {
                        folderKey = folderKeyCache[cacheKey];
                    } else {
                        folderKey = decryptFolderKey(
                            fromBase64(fileInfo.folder_key_encrypted),
                            fromBase64(fileInfo.folder_key_nonce),
                            masterKey
                        );
                        folderKeyCache[cacheKey] = folderKey;
                    }
                } else {
                    // Fallback to "Root" logic if applicable, or error. 
                    // In Nest v2, everything usually has a folder key (even root might be implicit or handled).
                    // If file info has no folder key provided, it might mean it uses the Root Folder Key which we don't have here easily unless passed.
                    // BUT: The API /download/:id usually returns the encrypted folder key for the specific file's parent.
                    if (!fileInfo.folder_key_encrypted) {
                        throw new Error("Missing folder key encryption data.");
                    }
                    // Should be handled by logic above.
                    throw new Error("Unexpected state: Code should have entered folder key block.");
                }

                // 2. Decrypt File Key
                if (!fileInfo.file_key_encrypted || !fileInfo.file_key_nonce) {
                    throw new Error("Missing file key encryption data.");
                }

                const fileKey = decryptFileKey(
                    fromBase64(fileInfo.file_key_encrypted),
                    fromBase64(fileInfo.file_key_nonce),
                    folderKey
                );

                // --- STREAMING DOWNLOAD & DECRYPT ---

                if (!fileInfo.is_chunked) {
                    // Monolithic Download
                    const downloadUrl = fileInfo.is_gateway_verified
                        ? `https://gateway.lazybird.io/file/${fileInfo.jackal_fid || fileInfo.merkle_hash}`
                        : `${API_BASE_URL}/files/raw/${file.id}`;

                    const response = await fetch(downloadUrl, {
                        headers: fileInfo.is_gateway_verified ? {} : { 'Authorization': `Bearer ${localStorage.getItem('nest_token')}` }
                    });

                    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

                    const reader = response.body?.getReader();
                    if (!reader) throw new Error("No response body");

                    const zipFile = new fflate.ZipPassThrough(realFilename);
                    zip.add(zipFile);

                    // Sodium's secretstream (chunked/stream) vs simple monolithic decryption.
                    // If the file was encrypted with `encryptWithMasterKey` (simple AEAD), we need the whole blob.
                    // If it was encrypted with `encryptFile` (secretstream), we can stream it.
                    // Looking at `crypto/v2.ts`, `encryptFile` uses `crypto_secretstream_xchacha20poly1305`.
                    // So YES, we can stream decrypt using the header.

                    // The first part of the monolithic file IS the header.

                    // We need to implement a streaming decryption loop here similar to `decryptChunk` but continuous.
                    // Or we can buffer the whole file if small enough? No, we promised support for 100GB.
                    // We MUST implement streaming decryption.

                    // Ideally we'd use `createDecryptionStream` from v2 but it returns a TransformStream (Web Streams API).
                    // We can read from that.

                    // Let's manually implement the chunk pulling since `createDecryptionStream` requires a separate header argument, 
                    // but for monolithic, the header is inside the stream (first 24 bytes).

                    // Actually `decryptChunk` takes a Blob.
                    // We are reading a stream.

                    // Simplified Approach for Monolithic Stream:
                    // 1. Read first 24 bytes (Header).
                    // 2. Init Pull.
                    // 3. Read chunks, Pull, Write.

                    const sodium = (await import('libsodium-wrappers')).default; // access sodium directly for raw calls

                    let header: Uint8Array | null = null;
                    let pullState: any = null;
                    let buffer = new Uint8Array(0);
                    const HEADER_SIZE = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        // Append new data to buffer
                        const newBuffer = new Uint8Array(buffer.length + value.length);
                        newBuffer.set(buffer);
                        newBuffer.set(value, buffer.length);
                        buffer = newBuffer;

                        // 1. Read Header if needed
                        if (!header) {
                            if (buffer.length >= HEADER_SIZE) {
                                header = buffer.slice(0, HEADER_SIZE);
                                buffer = buffer.slice(HEADER_SIZE);
                                pullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, fileKey);
                            } else {
                                continue; // Need more data for header
                            }
                        }

                        // 2. Process Chunks
                        // We can decrypt any amount of data as long as it aligns with the stream tags?
                        // NO. SecretStream PUSHES chunks with a TAG. We must PULL the exact same chunks.
                        // Implication: Monolithic files encrypted via `encryptFile` (streaming) must be decrypted knowing the chunk boundaries.
                        // `encryptFile` uses 64MB chunks.
                        // If we don't know the exact boundaries, we can't blindly pass bytes to `pull`.

                        // WAIT. `encryptFile` in v2.ts pushes chunks.
                        // "The state contains the stream state... The ciphertext is the encrypted message + the authentication tag."
                        // It does NOT include length prefixing.
                        // THIS IS A PROBLEM. Without length prefixing, how do we know where one chunk ends and the next begins in a continuous stream?
                        // `encryptFile` uses fixed 64MB chunks.
                        // So we know the size: 64MB + ABYTES (overhead).
                        // EXCEPT the last chunk.

                        // So we can assume chunks are (64MB + overhead).
                        const PLAIN_CHUNK = 64 * 1024 * 1024;
                        const OVERHEAD = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
                        const ENCRYPTED_CHUNK_SIZE = PLAIN_CHUNK + OVERHEAD;

                        while (buffer.length >= ENCRYPTED_CHUNK_SIZE) {
                            const chunkToDecrypt = buffer.slice(0, ENCRYPTED_CHUNK_SIZE);
                            buffer = buffer.slice(ENCRYPTED_CHUNK_SIZE);

                            const result = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, chunkToDecrypt, null);
                            if (!result) throw new Error("Decryption failed during stream");

                            zipFile.push(result.message as Uint8Array, false);
                        }
                    }

                    // Process Final Chunk (Remaining Buffer)
                    if (buffer.length > 0) {
                        const result = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, buffer, null);
                        if (!result) throw new Error("Decryption failed on final chunk");
                        zipFile.push(result.message as Uint8Array, true); // Final zip file chunk
                    } else {
                        zipFile.push(new Uint8Array(0), true);
                    }

                } else {
                    // CHUNKED FILE
                    const { chunks } = await filesAPI.getManifest(file.id);
                    const zipFile = new fflate.ZipPassThrough(realFilename);
                    zip.add(zipFile);

                    for (let i = 0; i < chunks.length; i++) {
                        const chunk = chunks[i];
                        const chunkUrl = chunk.is_gateway_verified
                            ? `https://gateway.lazybird.io/file/${chunk.jackal_merkle}`
                            : `${API_BASE_URL}/files/chunks/raw/${chunk.id}`;

                        const cResp = await fetch(chunkUrl);
                        if (!cResp.ok) throw new Error(`Failed to fetch chunk ${i}`);
                        const cBuf = await cResp.blob(); // Get as Blob for decryptChunk

                        // Decrypt Chunk
                        // The chunk.nonce is actually the HEADER for the secretstream
                        const nonce = typeof chunk.nonce === 'string'
                            ? fromBase64(chunk.nonce)
                            : (chunk.nonce as Uint8Array);

                        const decryptedChunkBlob = await decryptChunk(
                            cBuf,
                            nonce,
                            fileKey
                        );

                        const decryptedBytes = new Uint8Array(await decryptedChunkBlob.arrayBuffer());

                        // Push to zip stream
                        zipFile.push(decryptedBytes, i === chunks.length - 1);
                    }
                }

                completedBytes += file.file_size;

            } catch (e: any) {
                console.error(`[StreamingExport] Failed file ${file.filename}`, e);
                const errFile = new fflate.ZipPassThrough(`${file.filename}.error.txt`);
                zip.add(errFile);
                errFile.push(new TextEncoder().encode(`Failed to export: ${e.message || e}`), true);
            }
        }

        zip.end();
        onProgress(100, 'Done');

    } catch (err) {
        console.error('[StreamingExport] Critical Error:', err);
        writer.abort(err);
        throw err;
    }
};
