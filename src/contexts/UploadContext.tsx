import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { filesAPI } from '../api/files';
import { useStorage } from './StorageContext';
import { useRefresh } from './RefreshContext';
import { useAuth } from './AuthContext';
// Dynamic imports for crypto to load lazily
// We'll import them inside the worker function

export interface UploadItem {
    id: string;
    filename: string;
    size: number;
    progress: number;
    status: 'uploading' | 'completed' | 'failed' | 'queued';
    backendFileId?: number;
    error?: string;
}

interface UploadContextType {
    uploads: UploadItem[];
    addUpload: (file: File) => string;
    updateProgress: (id: string, progress: number) => void;
    completeUpload: (id: string) => void;
    failUpload: (id: string, error: string) => void;
    removeUpload: (id: string) => void;
    retryUpload: (id: string) => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

export const useUpload = () => {
    const context = useContext(UploadContext);
    if (!context) {
        throw new Error('useUpload must be used within UploadProvider');
    }
    return context;
};

export const UploadProvider = ({ children }: { children: ReactNode }) => {
    const [uploads, setUploads] = useState<UploadItem[]>([]);
    const [activeUploads, setActiveUploads] = useState<number>(0);
    const { refreshQuota } = useStorage();
    const { triggerFileRefresh } = useRefresh();
    const { masterKey, metadata, setMetadata, saveMetadata } = useAuth();
    const fileRegistry = useRef<Map<string, File>>(new Map());

    // Max 1 concurrent upload to protect efficient bandwidth usage
    const MAX_CONCURRENT_UPLOADS = 1;

    const addUpload = (file: File): string => {
        const id = crypto.randomUUID();
        const uploadItem: UploadItem = {
            id,
            filename: file.name,
            size: file.size,
            progress: 0,
            status: 'queued',
        };

        fileRegistry.current.set(id, file);
        setUploads(prev => [...prev, uploadItem]);
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

        // If it was in progress or failed but had a backend record, clean it up
        if (upload && upload.backendFileId && upload.status !== 'completed') {
            console.log(`[UPLOAD-CTX] Canceling pending backend file: ${upload.backendFileId}`);
            filesAPI.cancelUpload(upload.backendFileId).catch((err: any) => {
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

    // Queue Processor
    useEffect(() => {
        const processQueue = async () => {
            if (activeUploads >= MAX_CONCURRENT_UPLOADS) return;
            const nextUpload = uploads.find(u => u.status === 'queued');

            if (nextUpload) {
                // Double check if we are already processing this ID (race condition in strict mode)
                // But setActiveUploads + Effect dependency should handle it.
                // We'll mark it as 'uploading' immediately inside performUpload or here.

                performUpload(nextUpload.id);
            }
        };
        processQueue();
    }, [uploads, activeUploads]);

    const performUpload = async (uploadId: string) => {
        // Guard: Check if actually queued (to avoid double processing)
        const currentStatus = uploads.find(u => u.id === uploadId)?.status;
        if (currentStatus !== 'queued') return;

        setActiveUploads(prev => prev + 1);
        updateProgress(uploadId, 0); // Mark as uploading

        const file = fileRegistry.current.get(uploadId);
        if (!file) {
            failUpload(uploadId, "File object lost (refresh?)");
            setActiveUploads(prev => prev - 1);
            return;
        }

        try {
            // Load Crypto Libs
            const { encryptFile, generateFileKey, encryptFileKey, encryptFolderKey, toBase64, fromBase64, encryptChunk, decryptFolderKey } = await import('../crypto/v2');
            const { foldersAPI } = await import('../api/folders');

            // Get Master Key from Auth Context (via closure from component level)
            if (!masterKey) {
                throw new Error('Master Key not available. Please log in again.');
            }

            // 1. Get Root Folder ID first
            const rootFolderResponse = await foldersAPI.list(null);
            const rootFolder = rootFolderResponse.folders?.find((f: any) => f.parent_id === null);
            let rootFolderId: number;

            if (!rootFolder?.id) {
                console.warn('[UPLOAD] Root folder missing! Initializing self-healing root...');
                // Generate new Root Folder Key
                const rootFolderKey = generateFileKey(); // Use generateFileKey or generateFolderKey (they both use randombytes(32))
                const rfEnv = encryptFolderKey(rootFolderKey, masterKey);

                // Create Root on Server
                const createRes = await foldersAPI.create(
                    toBase64(rfEnv.encrypted),
                    toBase64(rfEnv.nonce),
                    '/', // pathHash for root
                    undefined // parentId is NULL
                );

                rootFolderId = createRes.folder_id;
                console.log('[UPLOAD] Self-healing root initialized:', rootFolderId);

                // Update metadata with the new root name
                if (metadata) {
                    const updatedMetadata = { ...metadata };
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
            const CHUNK_THRESHOLD = 500 * 1024 * 1024; // 500MB
            const CHUNK_SIZE = 512 * 1024 * 1024;      // 512MB (Jackal Blobs)

            if (file.size >= CHUNK_THRESHOLD) {
                // === CHUNKED UPLOAD ===

                // Init (Quota Check & DB Record)
                const initResult = await filesAPI.initChunkedUpload({
                    filename: file.name,
                    file_size: file.size,
                    mimeType: file.type || 'application/octet-stream',
                    fileKeyEncrypted: toBase64(fileKeyEnv.encrypted),
                    fileKeyNonce: toBase64(fileKeyEnv.nonce)
                });

                // Check for payment/quota error or strict error
                const fileId = initResult.file_id;

                // Store backend file ID so we can cancel if needed
                setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, backendFileId: fileId } : u));

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

                    let retryCount = 0;
                    const maxRetries = 3;
                    let success = false;

                    while (retryCount < maxRetries && !success) {
                        try {
                            // Prepare Chunk
                            const start = i * CHUNK_SIZE;
                            const end = Math.min(start + CHUNK_SIZE, file.size);
                            const chunkBlob = file.slice(start, end);

                            // Encrypt Chunk (Independent)
                            const { encryptedChunk, nonce } = await encryptChunk(chunkBlob, fileKey);

                            // Upload Chunk
                            const result = await filesAPI.uploadChunk(
                                fileId,
                                i,
                                encryptedChunk,
                                toBase64(nonce),
                                encryptedChunk.size
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

                    // Update UI
                    updateProgress(uploadId, ((i + 1) / totalChunks) * 100);
                }

                // Finish
                await filesAPI.finishChunkedUpload(fileId);

                // Update Metadata Blob with file info
                if (metadata) {
                    console.log('[UPLOAD] Updating metadata for file:', fileId, file.name);
                    const updatedMetadata = { ...metadata };
                    updatedMetadata.files[fileId.toString()] = {
                        filename: file.name,
                        mime_type: file.type || 'application/octet-stream',
                        folder_id: rootFolderId.toString() // Upload to root folder
                    };
                    // Update local state immediately
                    setMetadata(updatedMetadata);
                    // Then persist to server
                    await saveMetadata(updatedMetadata);
                    console.log('[UPLOAD] Metadata saved successfully');
                    // Small delay to ensure React state propagates
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    console.warn('[UPLOAD] No metadata object available, cannot save filename');
                }

                completeUpload(uploadId);
                refreshQuota();
                triggerFileRefresh();

            } else {
                // === MONOLITHIC UPLOAD === (Legacy / Small Files)
                const { encryptedBlob } = await encryptFile(file, fileKey);

                const uploadResponse = await filesAPI.upload(
                    encryptedBlob,
                    file.name,
                    file.type || 'application/octet-stream',
                    undefined, // folderId
                    {
                        fileKeyEncrypted: toBase64(fileKeyEnv.encrypted),
                        fileKeyNonce: toBase64(fileKeyEnv.nonce)
                    },
                    (p) => updateProgress(uploadId, p)
                );

                // Update Metadata Blob with file info (server returns file_id)
                if (metadata && uploadResponse.file_id) {
                    console.log('[UPLOAD] Updating metadata for file:', uploadResponse.file_id, file.name);
                    const updatedMetadata = { ...metadata };
                    updatedMetadata.files[uploadResponse.file_id.toString()] = {
                        filename: file.name,
                        mime_type: file.type || 'application/octet-stream',
                        folder_id: rootFolderId.toString() // Upload to root folder
                    };
                    // Update local state immediately
                    setMetadata(updatedMetadata);
                    // Then persist to server
                    await saveMetadata(updatedMetadata);
                    console.log('[UPLOAD] Metadata saved successfully');
                    // Small delay to ensure React state propagates
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    console.warn('[UPLOAD] Cannot save metadata:', { hasMetadata: !!metadata, fileId: uploadResponse.file_id });
                }

                completeUpload(uploadId);
                refreshQuota();
                triggerFileRefresh();
            }

        } catch (error: any) {
            console.error("Upload error:", error);
            let errorMessage = error.message || "Upload failed";

            // Check for 413 Payload Too Large (Quota or File Size limit)
            if (error.response?.status === 413 || error.message?.includes('413')) {
                errorMessage = "File too large for current plan";
            }

            failUpload(uploadId, errorMessage);
        } finally {
            setActiveUploads(prev => prev - 1);
        }
    };

    return (
        <UploadContext.Provider
            value={{
                uploads,
                addUpload,
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
