import API_BASE_URL from '../config/api';
import { createDecryptionStream, fromBase64 } from '../crypto/v2';
import streamSaver from 'streamsaver';

export interface DownloadChunk {
    index: number;
    size: number;
    nonce: string; // Base64 header
    jackal_merkle?: string;
    status: 'local' | 'cloud' | 'pending';
}

export interface DownloadOptions {
    fileKey: Uint8Array;
    filename: string;
    chunks: DownloadChunk[];
    onProgress?: (progress: number) => void;
    // Auth Modes
    shareToken?: string;
    fileId?: number;
    authToken?: string;
}

/**
 * Detect if the user is on iOS (Safari, Chrome iOS, etc.)
 */
function isIOS(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * StreamingDownloader (V3 - Universal)
 * Uses StreamSaver.js for universal browser support:
 * - Chrome/Edge: Service Worker MITM streaming (zero memory)
 * - Safari/Firefox: Automatic Blob fallback (in-memory, up to ~500MB on mobile)
 */
export class StreamingDownloader {
    static async download(options: DownloadOptions): Promise<void> {
        const { shareToken, fileId, authToken, fileKey, filename, chunks, onProgress } = options;
        const totalSize = chunks.reduce((acc, c) => acc + c.size, 0);
        let bytesDownloaded = 0;

        // Pre-flight: Warn iOS users about large files
        if (isIOS() && totalSize > 500 * 1024 * 1024) {
            const proceed = confirm(
                `This file is ${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB.\n\n` +
                `iOS browsers have limited memory for large downloads. ` +
                `This may fail on your device.\n\n` +
                `For large files, please use Chrome on Android or desktop.\n\n` +
                `Try anyway?`
            );
            if (!proceed) throw new Error('Download cancelled by user');
        }

        // Create universal writable stream via StreamSaver.js
        // Chrome/Edge: SW MITM streaming (zero memory)
        // Safari: Blob fallback (accumulates in RAM, saves on close)
        const writeStream = streamSaver.createWriteStream(filename, {
            size: totalSize
        });
        const writer = writeStream.getWriter();

        // 2. Sequential Chunk Download & Decrypt
        try {
            for (const chunk of chunks) {
                console.log(`[Downloader] Processing chunk ${chunk.index + 1}/${chunks.length} (${chunk.status})`);

                let chunkUrl = '';
                const headers: HeadersInit = {};

                // Fallback Strategy
                let tryGateway = false;

                if (chunk.status === 'local') {
                    // Force Server Path
                    if (shareToken) {
                        chunkUrl = `${API_BASE_URL}/files/share/${shareToken}/chunk/${chunk.index}`;
                    } else if (fileId && authToken) {
                        chunkUrl = `${API_BASE_URL}/files/${fileId}/chunk/${chunk.index}`;
                        headers['Authorization'] = `Bearer ${authToken}`;
                    } else {
                        throw new Error('Missing auth config for local download');
                    }
                } else if (chunk.status === 'cloud' && chunk.jackal_merkle) {
                    tryGateway = true;
                    chunkUrl = `https://gateway.lazybird.io/file/${chunk.jackal_merkle}`;
                } else {
                    throw new Error(`Chunk ${chunk.index} is not ready yet (Status: ${chunk.status})`);
                }

                let response;

                if (tryGateway) {
                    try {
                        console.log(`[Downloader] 🚀 Attempting Direct Gateway for Chunk ${chunk.index}...`);
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

                        response = await fetch(chunkUrl, { headers, signal: controller.signal });
                        clearTimeout(timeoutId);

                        if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
                        console.log(`[Downloader] ✅ Gateway Success for Chunk ${chunk.index}`);

                    } catch (e) {
                        console.warn(`[Downloader] ⚠️ Gateway failed for Chunk ${chunk.index}, falling back to Server Proxy:`, e);
                        // Fallback to Server
                        if (shareToken) {
                            chunkUrl = `${API_BASE_URL}/files/share/${shareToken}/chunk/${chunk.index}`;
                        } else if (fileId && authToken) {
                            chunkUrl = `${API_BASE_URL}/files/${fileId}/chunk/${chunk.index}`;
                            headers['Authorization'] = `Bearer ${authToken}`;
                        }
                        response = await fetch(chunkUrl, { headers });
                    }
                } else {
                    // Direct Server (Local or forced)
                    response = await fetch(chunkUrl, { headers });
                }

                console.log(`[Downloader] Chunk ${chunk.index} Fetch Status: ${response!.status}`);
                console.log(`[Downloader] Type: ${response!.headers.get('content-type')}`);
                console.log(`[Downloader] Length: ${response!.headers.get('content-length')}`);

                if (!response!.ok) throw new Error(`Failed to fetch chunk ${chunk.index}`);
                if (!response!.body) throw new Error(`Chunk ${chunk.index} body is empty`);

                // Create Decryption Stream for this chunk
                console.log(`[Downloader] Creating decryption stream for Chunk ${chunk.index} (Nonce: ${chunk.nonce.substring(0, 10)}...)`);
                const decryptionStream = createDecryptionStream(fileKey, fromBase64(chunk.nonce));

                const decryptedStream = response!.body.pipeThrough(decryptionStream);
                const reader = decryptedStream.getReader();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    await writer.write(value);

                    bytesDownloaded += value.length;
                    if (onProgress) onProgress((bytesDownloaded / totalSize) * 100);
                }
            }

            await writer.close();
            console.log(`[Downloader] ✅ Download complete: ${filename}`);

        } catch (error) {
            await writer.abort();
            console.error('[Downloader] ❌ Stream failure:', error);
            throw error;
        }
    }
}
