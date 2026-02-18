import API_BASE_URL from '../config/api';
import { createDecryptionStream, fromBase64 } from '../crypto/v2';

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
    existingHandle?: any; // FileSystemFileHandle
}

/**
 * StreamingDownloader (V3)
 * Orchestrates memory-efficient downloads of large files by:
 * 1. Using Native File System API to write directly to disk.
 * 2. Downloading chunks individually (Hybrid: Local vs Cloud).
 * 3. Decrypting as data flows through (Zero-Memory).
 */
export class StreamingDownloader {
    static async download(options: DownloadOptions): Promise<void> {
        const { shareToken, fileId, authToken, fileKey, filename, chunks, onProgress, existingHandle } = options;
        const totalSize = chunks.reduce((acc, c) => acc + c.size, 0);
        let bytesDownloaded = 0;

        // 1. Get File Handle (Native File System API)
        let writable: FileSystemWritableFileStream | null = null;
        const hasNativeFS = 'showSaveFilePicker' in window;

        if (hasNativeFS) {
            try {
                let handle = existingHandle;
                if (!handle) {
                    console.log('[Downloader] No pre-acquired handle provided, requesting one...');
                    // @ts-ignore
                    handle = await window.showSaveFilePicker({
                        suggestedName: filename,
                    });
                }
                writable = await handle.createWritable();
            } catch (e) {
                console.error('[Downloader] Native FS Picker cancelled or failed:', e);
                // User might have cancelled, so we just return (or throw if you want UI feedback)
                throw new Error('Download cancelled (Permission Required)');
            }
        } else {
            console.warn('[Downloader] Native File System API not supported. Large files may crash browser.');
            // Fallback to legacy Blob accumulation? Or just throw for >2GB?
            // For now, we proceed but writable remains null, triggering the fallback logic below.
        }

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
                // Note: Each chunk in our V3 system has its own SecretStream HEADER (nonce)
                // For Server-proxied chunks, the nonce might be in the header 'X-Chunk-Nonce' or embedded
                // Use the one from the manifest (chunk.nonce) as source of truth
                console.log(`[Downloader] Creating decryption stream for Chunk ${chunk.index} (Nonce: ${chunk.nonce.substring(0, 10)}...)`);
                const decryptionStream = createDecryptionStream(fileKey, fromBase64(chunk.nonce));

                const decryptedStream = response!.body.pipeThrough(decryptionStream);
                const reader = decryptedStream.getReader();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    if (writable) {
                        await (writable as any).write(value);
                    } else {
                        // FALLBACK: Memory accumulation (not ideal but works for Safari/FF for now)
                        // In a real V3, we'd use a Service Worker "pseudo-download" here.
                        // For this task, we assume Native FS is the primary target.
                        throw new Error('Streaming download requires Chrome/Edge (Native File System API)');
                    }

                    bytesDownloaded += value.length;
                    if (onProgress) onProgress((bytesDownloaded / totalSize) * 100);
                }
            }

            if (writable) {
                await writable.close();
            }

            console.log(`[Downloader] ✅ Download complete: ${filename}`);

        } catch (error) {
            if (writable) await writable.abort();
            console.error('[Downloader] ❌ Stream failure:', error);
            throw error;
        }
    }
}
