import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { filesAPI } from '../api/files';
import { useStorage } from './StorageContext';
import { useRefresh } from './RefreshContext';
import { useAuth } from './AuthContext';
import API_BASE_URL from '../config/api';
// Dynamic imports for crypto to load lazily
// We'll import them inside the worker function

export interface UploadItem {
    id: string;
    filename: string;
    size: number;
    progress: number;
    status: 'uploading' | 'completed' | 'failed' | 'queued';
    type?: 'upload' | 'download';
    backendFileId?: number;
    folderId?: number; // Target folder ID
    error?: string;
    collabToken?: string;
    collabKey?: Uint8Array;
    uploadSessionId?: string;
}

interface UploadContextType {
    uploads: UploadItem[];
    addUpload: (file: File, folderId?: number | null, collabToken?: string, collabKey?: Uint8Array, uploadSessionId?: string) => string;
    addDownload: (filename: string, size: number) => string;
    updateProgress: (id: string, progress: number) => void;
    completeUpload: (id: string) => void;
    failUpload: (id: string, error: string) => void;
    removeUpload: (id: string) => void;
    retryUpload: (id: string) => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

export function useUpload() {
    const context = useContext(UploadContext);
    if (!context) {
        throw new Error('useUpload must be used within UploadProvider');
    }
    return context;
}

export function UploadProvider({ children }: { children: ReactNode }) {
    const [uploads, setUploads] = useState<UploadItem[]>([]);
    const [activeUploads, setActiveUploads] = useState<number>(0);
    const { refreshQuota } = useStorage();
    const { triggerFileRefresh } = useRefresh();
    const { masterKey, token: authToken,setMetadata, saveMetadata, getLatestMetadata } = useAuth();
    const fileRegistry = useRef<Map<string, File>>(new Map());

    // Max 1 concurrent upload to protect efficient bandwidth usage
    const MAX_CONCURRENT_UPLOADS = 1;

    const addUpload = (file: File, folderId?: number | null, collabToken?: string, collabKey?: Uint8Array, uploadSessionId?: string): string => {
        const id = crypto.randomUUID();
        const uploadItem: UploadItem = {
            id,
            filename: file.name,
            size: file.size,
            progress: 0,
            status: 'queued',
            type: 'upload',
            folderId: folderId ?? undefined,
            collabToken,
            collabKey,
            uploadSessionId,
        };

        fileRegistry.current.set(id, file);
        setUploads(prev => [...prev, uploadItem]);
        return id;
    };

    const addDownload = (filename: string, size: number): string => {
        const id = crypto.randomUUID();
        const downloadItem: UploadItem = {
            id,
            filename,
            size,
            progress: 0,
            status: 'uploading', // Actively processing immediately
            type: 'download',
        };
        setUploads(prev => [...prev, downloadItem]);
        return id;
    };

    const updateProgress = (id: string, progress: number) => {
        setUploads(prev =>
            prev.map(upload =>
                upload.id === id
                    ? { ...upload, progress, status: 'uploading' as const }
                    : upload
            )
        );
    };

    const completeUpload = (id: string) => {
        setUploads(prev =>
            prev.map(upload =>
                upload.id === id
                    ? { ...upload, progress: 100, status: 'completed' as const }
                    : upload
            )
        );
        // fileRegistry.current.delete(id); // Keep file in registry? Maybe not needed if completed.
    };

    const failUpload = (id: string, error: string) => {
        setUploads(prev =>
            prev.map(upload =>
                upload.id === id
                    ? { ...upload, status: 'failed' as const, error }
                    : upload
            )
        );
    };

    const removeUpload = (id: string) => {
        const upload = uploads.find(u => u.id === id);

        // Fix H2: Call dedicated cancel endpoint for cleanup
        if (upload && upload.backendFileId && upload.status !== 'completed') {
            console.log(`[UPLOAD-CTX] Canceling pending backend file: ${upload.backendFileId}`);
            filesAPI.cancelUpload(upload.backendFileId).then(() => {
                console.log(`[UPLOAD-CTX] Successfully cancelled upload ${upload.backendFileId}`);
            }).catch((err: any) => {
                console.error(`[UPLOAD-CTX] Failed to cancel backend upload ${upload.backendFileId}:`, err);
            });
        }

        setUploads(prev => prev.filter(upload => upload.id !== id));
        fileRegistry.current.delete(id);
    };

    const retryUpload = (id: string) => {
        setUploads(prev =>
            prev.map(upload =>
                upload.id === id
                    ? { ...upload, status: 'queued' as const, error: undefined, progress: 0 }
                    : upload
            )
        );
    };

    // Race Condition Fix: Track what's actually being processed to preventing double-firing
    const processingRef = useRef<Set<string>>(new Set());

    // Queue Processor
    useEffect(() => {
        const processQueue = async () => {
            if (!masterKey) return; // Wait for master key before processing queue
            if (activeUploads >= MAX_CONCURRENT_UPLOADS) return;

            // Fix Race Condition: Filter out items already marked as processing. Only pick uploads.
            const nextUpload = uploads.find(u => (u.type === 'upload' || !u.type) && u.status === 'queued' && !processingRef.current.has(u.id));

            if (nextUpload) {
                // Lock immediately
                processingRef.current.add(nextUpload.id);
                performUpload(nextUpload.id);
            }
        };
        processQueue();
    }, [uploads, activeUploads, masterKey]);

    const performUpload = async (uploadId: string) => {
        // Guard: Check if actually queued (to avoid double processing)
        const currentStatus = uploads.find(u => u.id === uploadId)?.status;
        if (currentStatus !== 'queued') {
            processingRef.current.delete(uploadId);
            return;
        }

        setActiveUploads(prev => prev + 1);
        updateProgress(uploadId, 0); // Mark as uploading

        const file = fileRegistry.current.get(uploadId);
        if (!file) {
            failUpload(uploadId, "File object lost (refresh?)");
            setActiveUploads(prev => prev - 1);
            processingRef.current.delete(uploadId);
            return;
        }

        // Fix: Detect GarageBand Packages (.band)
        if (file.name.endsWith('.band')) {
            failUpload(uploadId, "GarageBand projects must be zipped (.zip) before uploading.");
            setActiveUploads(prev => prev - 1);
            processingRef.current.delete(uploadId);
            return;
        }

        // Fix: Zero Byte Files
        if (file.size === 0) {
            failUpload(uploadId, "Cannot upload empty folder or 0-byte file.");
            setActiveUploads(prev => prev - 1);
            processingRef.current.delete(uploadId);
            return;
        }

        try {
            // Load Crypto Libs
            const { encryptFile, generateFileKey, encryptFileKey, encryptFolderKey, toBase64, fromBase64, encryptChunk, decryptFolderKey, init, encryptFileWithCollabKey, encryptWithMasterKey } = await import('@lazybird-inc/nest-crypto');
            await init();

            const nextUpload = uploads.find(u => u.id === uploadId);

            if (nextUpload && nextUpload.collabToken && nextUpload.collabKey) {
                // === COLLABORATIVE UPLOAD ===
                const collabToken = nextUpload.collabToken;
                const collabKey = nextUpload.collabKey;

                const CHUNK_THRESHOLD = 128 * 1024 * 1024; // 128MB
                const CHUNK_SIZE = 128 * 1024 * 1024;      // 128MB

                // 1. Generate unique file key
                const fileKey = generateFileKey();

                // 2. Re-encrypt the file key with the Collab Key
                const encryptedFileKey = encryptFileKey(fileKey, collabKey);

                // Helper for symmetric encryption of metadata
                const encryptSymmetricMetadata = (text: string, key: Uint8Array): string => {
                    const { encrypted, nonce } = encryptWithMasterKey(text, key);
                    return JSON.stringify({
                        encrypted: toBase64(encrypted),
                        nonce: toBase64(nonce)
                    });
                };

                // 3. Encrypt filename and mime-type symmetrically using collabKey
                const encryptedFilename = encryptSymmetricMetadata(file.name, collabKey);
                const encryptedMime = encryptSymmetricMetadata(file.type || 'application/octet-stream', collabKey);

                if (file.size >= CHUNK_THRESHOLD) {
                    // === CHUNKED COLLAB UPLOAD ===
                    const sessionId = nextUpload.uploadSessionId || crypto.randomUUID();

                    const initResult = await filesAPI.initCollabUpload(collabToken, {
                        file_size: file.size,
                        folder_id: nextUpload.folderId,
                        encrypted_file_key: toBase64(encryptedFileKey.encrypted),
                        file_key_nonce: toBase64(encryptedFileKey.nonce),
                        sessionId
                    });

                    const fileId = initResult.file_id;
                    setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, backendFileId: fileId } : u));

                    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

                    for (let i = 0; i < totalChunks; i++) {
                        const start = i * CHUNK_SIZE;
                        const end = Math.min(start + CHUNK_SIZE, file.size);
                        const chunkBlob = file.slice(start, end);

                        const { encryptedChunk, nonce: chunkNonce } = await encryptChunk(chunkBlob, fileKey);
                        const chunkNonceBase64 = toBase64(chunkNonce);

                        let retryCount = 0;
                        const maxRetries = 3;
                        let success = false;

                        while (retryCount < maxRetries && !success) {
                            try {
                                const result = await filesAPI.uploadCollabChunk(
                                    collabToken,
                                    fileId,
                                    i,
                                    encryptedChunk,
                                    chunkNonceBase64,
                                    encryptedChunk.size,
                                    (chunkPercent) => {
                                        const totalPercent = ((i * 100) + chunkPercent) / totalChunks;
                                        updateProgress(uploadId, totalPercent);
                                    }
                                );

                                if (!result.success) throw new Error(`Chunk ${i} failed`);
                                success = true;
                            } catch (err: any) {
                                retryCount++;
                                console.warn(`[COLLAB-CHUNK-UP] Chunk ${i} failed (attempt ${retryCount}/${maxRetries}):`, err.message);
                                if (retryCount >= maxRetries) throw err;
                                await sleep(2000 * retryCount);
                            }
                        }
                        updateProgress(uploadId, ((i + 1) / totalChunks) * 100);
                    }

                    await filesAPI.finishCollabChunkedUpload(collabToken, fileId, encryptedFilename, encryptedMime);

                    completeUpload(uploadId);
                    triggerFileRefresh();
                    return;

                } else {
                    // === MONOLITHIC COLLAB UPLOAD ===
                    const fileBytes = new Uint8Array(await file.arrayBuffer());
                    const encryptedData = encryptFileWithCollabKey(fileBytes, fileKey);

                    // 4. Build FormData
                    const formData = new FormData();
                    const encryptedFileBlob = new Blob([encryptedData.encryptedFile as any], { type: 'application/octet-stream' });
                    formData.append('file', encryptedFileBlob, 'encrypted-collab');
                    formData.append('encrypted_file_key', toBase64(encryptedFileKey.encrypted));
                    formData.append('file_key_nonce', toBase64(encryptedFileKey.nonce));
                    formData.append('file_size', file.size.toString());
                    formData.append('encrypted_filename', encryptedFilename);
                    formData.append('encrypted_mime_type', encryptedMime);
                    if (nextUpload.folderId) {
                        formData.append('folder_id', nextUpload.folderId.toString());
                    }

                    // 5. Post request using XMLHttpRequest for progress tracking
                    const headers: Record<string, string> = {};
                    if (authToken) {
                        headers['Authorization'] = `Bearer ${authToken}`;
                    }

                    const uploadUrl = `${API_BASE_URL}/collab/${collabToken}/upload`;
                    const xhr = new XMLHttpRequest();

                    const promise = new Promise<void>((resolve, reject) => {
                        xhr.upload.addEventListener('progress', (event) => {
                            if (event.lengthComputable) {
                                const percent = (event.loaded / event.total) * 100;
                                updateProgress(uploadId, percent);
                            }
                        });

                        xhr.addEventListener('load', () => {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve();
                            } else {
                                try {
                                    const errResponse = JSON.parse(xhr.responseText);
                                    reject(new Error(errResponse.error || `Upload failed with status ${xhr.status}`));
                                } catch {
                                    reject(new Error(`Upload failed with status ${xhr.status}`));
                                }
                            }
                        });

                        xhr.addEventListener('error', () => {
                            reject(new Error('Network error during upload'));
                        });

                        xhr.open('POST', uploadUrl);
                        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
                        xhr.send(formData);
                    });

                    await promise;

                    completeUpload(uploadId);
                    triggerFileRefresh();
                    return;
                }
            }

            const { foldersAPI } = await import('../api/folders');

            // Get Master Key from Auth Context (via closure from component level)
            if (!masterKey) {
                throw new Error('Master Key not available. Please log in again.');
            }

            // 1. Resolve Target Folder (Priority: Provided -> DB Root -> Create New Root)
            const targetFolderIdFromUpload = uploads.find(u => u.id === uploadId)?.folderId;
            let rootFolderId: number;

            if (targetFolderIdFromUpload) {
                rootFolderId = targetFolderIdFromUpload;
                console.log('[UPLOAD] Using specific target folder:', rootFolderId);
            } else {
                const rootFolderResponse = await foldersAPI.list(null, true);
                const rootFolder = rootFolderResponse.folders?.find((f: any) => f.parent_id === null && !f.path_hash?.startsWith('collab_') && !f.path_hash?.startsWith('dropzone_'));

                if (!rootFolder?.id) {
                    console.warn('[UPLOAD] Root folder missing! Initializing self-healing root...');
                    const rootFolderKey = generateFileKey();
                    const rfEnv = encryptFolderKey(rootFolderKey, masterKey);

                    const createRes = await foldersAPI.create(
                        toBase64(rfEnv.encrypted),
                        toBase64(rfEnv.nonce),
                        '/',
                        undefined
                    );

                    rootFolderId = createRes.folder_id;
                    const currentMeta = getLatestMetadata();
                    if (currentMeta) {
                        const updatedMetadata = { ...currentMeta };
                        updatedMetadata.folders[rootFolderId.toString()] = {
                            name: 'Root',
                            created_at: new Date().toISOString()
                        };
                        setMetadata(updatedMetadata);
                        await saveMetadata(updatedMetadata);
                    }
                } else {
                    rootFolderId = rootFolder.id;
                }
            }

            // 2. Get Folder Key for the ROOT FOLDER
            const { key: folderKeyEncryptedBase64, nonce: folderKeyNonceBase64 } = await foldersAPI.getKey(rootFolderId);
            const folderKeyEncrypted = fromBase64(folderKeyEncryptedBase64);
            const folderKeyNonce = fromBase64(folderKeyNonceBase64);

            // Decrypt Folder Key with Master Key
            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);

            // 2. Generate Encryption Keys
            const fileKey = generateFileKey();
            const fileKeyEnv = encryptFileKey(fileKey, folderKey);

            // 2. Determine Strategy
            const CHUNK_THRESHOLD = 128 * 1024 * 1024; // 128MB (Mobile-safe)
            const CHUNK_SIZE = 128 * 1024 * 1024;      // 128MB

            if (file.size >= CHUNK_THRESHOLD) {
                // === CHUNKED UPLOAD ===

                // Generate unique session ID for this upload attempt
                const sessionId = nextUpload?.uploadSessionId || crypto.randomUUID();

                // Init (Quota Check & DB Record)
                // 1. Step 1: Initialize record on server (Get ID)
                const initResult = await filesAPI.initUpload({
                    filename: 'encrypted', // ZK: Server never sees real filename
                    file_size: file.size,
                    mimeType: file.type || 'application/octet-stream',
                    folderId: rootFolderId,
                    fileKeyEncrypted: toBase64(fileKeyEnv.encrypted),
                    fileKeyNonce: toBase64(fileKeyEnv.nonce),
                    sessionId
                });

                // Check for payment/quota error or strict error
                const fileId = initResult.file_id;

                // Store backend file ID so we can cancel if needed
                setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, backendFileId: fileId } : u));

                // 2. Step 2: Skip Metadata Save (Moved to end to prevent ghost files)
                // We used to save here, but that caused issues if upload failed later.

                // 3. Step 3: Upload the bits (Chunked)
                // Smart Resume: Check Manifest
                const manifest = await filesAPI.getManifest(fileId);
                const existingIndices = new Set(manifest.chunks.map(c => c.chunk_index));

                const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

                for (let i = 0; i < totalChunks; i++) {
                    if (existingIndices.has(i)) {
                        updateProgress(uploadId, ((i + 1) / totalChunks) * 100);
                        continue;
                    }

                    // Prepare Chunk
                    const start = i * CHUNK_SIZE;
                    const end = Math.min(start + CHUNK_SIZE, file.size);
                    const chunkBlob = file.slice(start, end);

                    // Encrypt Chunk (Independent)
                    // Move OUTSIDE retry loop: Ensure the same nonce/cipher is used for ALL retries of this chunk
                    const { encryptedChunk, nonce: chunkNonce } = await encryptChunk(chunkBlob, fileKey);
                    const chunkNonceBase64 = toBase64(chunkNonce);

                    let retryCount = 0;
                    const maxRetries = 3;
                    let success = false;

                    while (retryCount < maxRetries && !success) {
                        try {
                            // Upload Chunk (with intra-chunk progress)
                            const result = await filesAPI.uploadChunk(
                                fileId,
                                i,
                                encryptedChunk,
                                chunkNonceBase64,
                                encryptedChunk.size,
                                (chunkPercent) => {
                                    // Smooth progress: completed chunks + current chunk fraction
                                    const totalPercent = ((i * 100) + chunkPercent) / totalChunks;
                                    updateProgress(uploadId, totalPercent);
                                }
                            );

                            if (!result.success) throw new Error(`Chunk ${i} failed`);

                            success = true;

                        } catch (err: any) {
                            retryCount++;
                            console.warn(`[CHUNK-UP] Chunk ${i} failed (attempt ${retryCount}/${maxRetries}):`, err.message);
                            if (retryCount >= maxRetries) throw err;
                            // Exponential-ish backoff
                            await sleep(2000 * retryCount);
                        }
                    }

                    // Ensure clean chunk boundary
                    updateProgress(uploadId, ((i + 1) / totalChunks) * 100);
                }

                // Finish
                await filesAPI.finishChunkedUpload(fileId);

                // 4. Step 4: Save Metadata to Vault (After Success)
                const currentMetaChunked = getLatestMetadata();
                if (currentMetaChunked) {
                    console.log('[UPLOAD] Upload complete. Securing metadata in vault for file:', fileId, file.name);
                    const updatedMetadata = JSON.parse(JSON.stringify(currentMetaChunked));
                    updatedMetadata.files[fileId.toString()] = {
                        filename: file.name,
                        mime_type: file.type || 'application/octet-stream',
                        file_size: file.size,
                        created_at: new Date().toISOString(),
                        folder_id: rootFolderId.toString()
                    };
                    setMetadata(updatedMetadata);
                    await saveMetadata(updatedMetadata);
                    console.log('[UPLOAD] ✅ Metadata secured');
                }

                completeUpload(uploadId);
                refreshQuota();
                triggerFileRefresh();

            } else {
                // === MONOLITHIC UPLOAD === (Legacy / Small Files)
                const { encryptedBlob } = await encryptFile(file, fileKey);

                // Generate unique session ID for this upload attempt
                const sessionId = nextUpload?.uploadSessionId || crypto.randomUUID();

                // 1. Step 1: Initialize
                const initRes = await filesAPI.initUpload({
                    filename: 'encrypted', // ZK: Server never sees real filename
                    file_size: file.size,
                    mimeType: file.type || 'application/octet-stream',
                    folderId: rootFolderId,
                    fileKeyEncrypted: toBase64(fileKeyEnv.encrypted),
                    fileKeyNonce: toBase64(fileKeyEnv.nonce),
                    sessionId
                });

                const fileId = initRes.file_id;

                // 2. Step 2: Skip Metadata Save (Moved to end)

                // 3. Step 3: Upload Bits
                await filesAPI.upload(fileId, encryptedBlob, (p) => updateProgress(uploadId, p));

                // 4. Step 4: Save Metadata (After Success)
                const currentMetaMonolithic = getLatestMetadata();
                if (currentMetaMonolithic) {
                    console.log('[UPLOAD] Upload complete. Securing metadata in vault for file:', fileId, file.name);
                    const updatedMetadata = JSON.parse(JSON.stringify(currentMetaMonolithic));
                    updatedMetadata.files[fileId.toString()] = {
                        filename: file.name,
                        mime_type: file.type || 'application/octet-stream',
                        file_size: file.size,
                        created_at: new Date().toISOString(),
                        folder_id: rootFolderId.toString()
                    };
                    setMetadata(updatedMetadata);
                    await saveMetadata(updatedMetadata);
                }

                completeUpload(uploadId);
                refreshQuota();
                triggerFileRefresh();
            }

        } catch (error: any) {
            console.error("Upload error:", error);
            let errorMessage = error.message || "Upload failed";

            // Fix: User-friendly error mapping
            if (error.response?.status === 400 || errorMessage.includes('400')) {
                errorMessage = "Upload invalid (Folder or Empty File?)";
            }
            // Check for 413 Payload Too Large (Quota or File Size limit)
            else if (error.response?.status === 413 || errorMessage.includes('413')) {
                errorMessage = "File too large for current plan";
            }

            failUpload(uploadId, errorMessage);
        } finally {
            setActiveUploads(prev => prev - 1);
            processingRef.current.delete(uploadId);
        }
    };

    return (
        <UploadContext.Provider
            value={{
                uploads,
                addUpload,
                addDownload,
                updateProgress,
                completeUpload,
                failUpload,
                removeUpload,
                retryUpload,
            }}
        >
            {children}
        </UploadContext.Provider>
    );
};
