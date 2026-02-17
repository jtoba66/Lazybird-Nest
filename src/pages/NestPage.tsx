import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileTable } from '../components/FileTable';
import { filesAPI } from '../api/files';
import { useToast } from '../contexts/ToastContext';
import { useUpload } from '../contexts/UploadContext';
import { useStorage } from '../contexts/StorageContext';
import { useRefresh } from '../contexts/RefreshContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { ShareSuccessModal } from '../components/ShareSuccessModal';
import { PageLoader } from '../components/PageLoader';

interface FileItem {
    id: number;
    filename: string;
    mime_type: string;
    file_size: number;
    created_at: string;
    share_token: string | null;
}

export const NestPage = () => {
    const { showToast, updateToast, dismissToast } = useToast();
    const { addUpload } = useUpload();
    const { refreshQuota } = useStorage();
    const { fileListVersion } = useRefresh();
    const { masterKey, metadata, saveMetadata } = useAuth();
    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [shareModal, setShareModal] = useState<{ isOpen: boolean; link: string; name: string }>({ isOpen: false, link: '', name: '' });

    const handleShare = async (file: FileItem) => {
        try {
            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, toBase64, fromBase64 } = await import('../crypto/v2');

            // Get Master Key from context
            if (!masterKey) {
                showToast('Please log in again to create share links', 'error');
                return;
            }

            let shareToken = file.share_token;

            // Step 1: Create share token if it doesn't exist
            if (!shareToken) {
                const response = await filesAPI.createShare(Number(file.id));
                shareToken = response.share_token;
            }

            // Step 2: Fetch encrypted file keys (server returns snake_case with folder keys included)
            const downloadInfo = await api.get(`/files/download/${file.id}`);
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            // Step 3: Decrypt folder key with Master Key
            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);

            // Step 4: Decrypt file key with folder key
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            // Step 5: Get file metadata
            const filename = metadata?.files[file.id.toString()]?.filename || 'file';
            const mimeType = metadata?.files[file.id.toString()]?.mime_type || 'application/octet-stream';

            // Step 6: Build share URL with decrypted file key in fragment
            const fileKeyBase64 = toBase64(fileKey);
            // Ensure no spaces in the URL construction
            const origin = window.location.origin.trim();
            const token = shareToken.trim();
            const shareUrl = `${origin}/s/${token}#key=${encodeURIComponent(fileKeyBase64)}&name=${encodeURIComponent(filename)}&mime=${encodeURIComponent(mimeType)}`;

            // Step 7: Copy to clipboard (or fallback)
            try {
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(shareUrl);
                    showToast('Share link copied to clipboard!', 'success');
                } else {
                    throw new Error('Clipboard API unavailable');
                }
            } catch (clipboardError) {
                console.warn('[SHARE] Clipboard write failed (likely browser restriction):', clipboardError);
                // Fallback: Open Modal for manual copy
                setShareModal({
                    isOpen: true,
                    link: shareUrl,
                    name: filename
                });
            }

            // Reload to update UI if it was a new share
            if (!file.share_token) {
                loadFiles();
            }

        } catch (error) {
            console.error('Share creation failed:', error);
            showToast('Failed to create share link', 'error');
        }
    };

    const handleDownload = async (file: FileItem) => {
        let toastId: string | null = null;
        let fileHandle: any = null;

        try {
            if (!masterKey) {
                showToast('Please log in again to download files', 'error');
                return;
            }

            // PRE-EMPTIVE: If using Native FS for large files, we MUST trigger the picker NOW
            // to satisfy the "recent user gesture" browser security requirement.
            const isLargeFile = file.file_size > 500 * 1024 * 1024;
            const hasNativeFS = 'showSaveFilePicker' in window;
            const token = localStorage.getItem('nest_token');

            // Fix M8: Warn about browser compatibility for large files
            if (isLargeFile && !hasNativeFS) {
                const proceed = confirm(
                    `Large file detected (${(file.file_size / (1024 * 1024 * 1024)).toFixed(2)} GB).\n\n` +
                    `Your browser doesn't support streaming downloads, which may use significant memory.\n\n` +
                    `For best results, use Chrome or Edge. Continue anyway?`
                );
                if (!proceed) return;
            }

            if (isLargeFile && hasNativeFS && token) {
                try {
                    // @ts-ignore
                    fileHandle = await window.showSaveFilePicker({
                        suggestedName: file.filename,
                    });
                } catch (e: any) {
                    console.warn('[Download] Picker cancelled or failed:', e.name);
                    if (e.name === 'AbortError') return; // Silent cancel
                    throw e;
                }
            }

            // Start Feedback
            toastId = showToast('Preparing download...', 'info', Infinity);

            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, decryptFile, fromBase64 } = await import('../crypto/v2');

            // 1. Fetch encrypted keys and file metadata from server
            const downloadInfo = await api.get(`/files/download/${file.id}`);

            // 2. Decrypt Keys (moved here to support StreamingDownloader)
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            // 2. Fetch File Content
            if (toastId) updateToast(toastId, 'Downloading encrypted data...', 'info');

            if (fileHandle) {
                if (toastId) updateToast(toastId, 'Starting streaming download...', 'info');

                // Map chunks to DownloadChunk format
                const downloadChunks = downloadInfo.data.chunks.map((c: any) => ({
                    index: c.index, // Server aliased this to 'index'
                    size: c.size,
                    nonce: c.nonce,
                    jackal_merkle: c.jackal_merkle,
                    status: (c.jackal_merkle && c.jackal_merkle !== 'pending' && c.jackal_merkle !== 'pending-chunks') ? 'cloud' : 'local'
                }));

                const { StreamingDownloader } = await import('../utils/StreamingDownloader');

                await StreamingDownloader.download({
                    fileKey,
                    filename: file.filename,
                    chunks: downloadChunks,
                    fileId: file.id,
                    authToken: token!,
                    existingHandle: fileHandle,
                    onProgress: (p) => {
                        if (toastId) updateToast(toastId, `Downloading... ${p.toFixed(0)}%`, 'info');
                    }
                });

                if (toastId) updateToast(toastId, 'Download complete', 'success');
                setTimeout(() => dismissToast(toastId!), 3000);
                return;
            }

            // FALLBACK: Legacy Blob Download (Memory Intensive)
            if (isLargeFile && !hasNativeFS) {
                console.warn('Large file download requiring memory blob (Native FS not supported)');
                if (toastId) updateToast(toastId, 'Warning: Large file, may consume high memory...', 'warning');
            }

            const contentResponse = await api.get(`/files/raw/${file.id}`, {
                responseType: 'blob',
                onDownloadProgress: (progressEvent) => {
                    const total = progressEvent.total || file.file_size;
                    const percent = (progressEvent.loaded / total) * 100;
                    if (toastId) updateToast(toastId, `Downloading... ${percent.toFixed(0)}%`, 'info');
                }
            });
            const encryptedBlob = contentResponse.data;

            // Update Feedback
            if (toastId) updateToast(toastId, 'Decrypting locally... (Do not close)', 'info');

            // 3. Decrypt Content
            // (Key decryption moved above to support StreamingDownloader)
            const headerNonce = fileKeyNonce;
            const chunks = downloadInfo.data.chunks;

            // Allow UI to update before heavy crypto
            await new Promise(r => setTimeout(r, 50));
            const decryptedBytes = await decryptFile(encryptedBlob, (chunks && chunks.length > 0) ? chunks : headerNonce, fileKey);

            // 5. Trigger Browser Download
            const blob = new Blob([decryptedBytes as unknown as BlobPart], { type: file.mime_type });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = file.filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            if (toastId) updateToast(toastId, 'Download complete', 'success');
            setTimeout(() => dismissToast(toastId!), 3000);

        } catch (error: any) {
            console.error('Download failed:', error);
            if (toastId) updateToast(toastId, `Download failed: ${error.message}`, 'error');
            setTimeout(() => dismissToast(toastId!), 5000);
        }
    };

    const handleDelete = async (fileId: number) => {
        try {
            await filesAPI.delete(fileId);
            refreshQuota(); // Update storage quota globally
            loadFiles();
        } catch (error) {
            console.error('Delete failed:', error);
            throw error;
        }
    };

    const handleMove = async (fileId: number, targetFolderId: number | null) => {
        if (!metadata || !masterKey) {
            showToast('Authentication required to move files', 'error');
            return;
        }

        try {
            // Import crypto functions and foldersAPI
            const { decryptFolderKey, decryptFileKey, encryptFileKey, toBase64, fromBase64 } = await import('../crypto/v2');
            const { foldersAPI } = await import('../api/folders');

            // 1. Get the file's current encrypted keys from the server
            const downloadInfo = await api.get(`/files/download/${fileId}`);

            const currentFileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const currentFileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const currentFolderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const currentFolderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            // 2. Decrypt the file key using the current folder's key
            const currentFolderKey = decryptFolderKey(currentFolderKeyEncrypted, currentFolderKeyNonce, masterKey);
            const fileKey = decryptFileKey(currentFileKeyEncrypted, currentFileKeyNonce, currentFolderKey);

            // 3. Get the target folder's key (or root folder's key)
            let targetFolderKey: Uint8Array;

            if (targetFolderId === null) {
                // Moving to root - get root folder's key
                const rootFolderResponse = await foldersAPI.list(null);
                const rootFolder = rootFolderResponse.folders?.find((f: any) => f.parent_id === null);
                if (!rootFolder?.id) {
                    throw new Error('Root folder not found');
                }
                const { key: folderKeyEncryptedBase64, nonce: folderKeyNonceBase64 } = await foldersAPI.getKey(rootFolder.id);
                const folderKeyEncrypted = fromBase64(folderKeyEncryptedBase64);
                const folderKeyNonce = fromBase64(folderKeyNonceBase64);
                targetFolderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            } else {
                // Moving to a specific folder
                const { key: folderKeyEncryptedBase64, nonce: folderKeyNonceBase64 } = await foldersAPI.getKey(targetFolderId);
                const folderKeyEncrypted = fromBase64(folderKeyEncryptedBase64);
                const folderKeyNonce = fromBase64(folderKeyNonceBase64);
                targetFolderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            }

            // 4. Re-encrypt the file key with the target folder's key
            const reencryptedFileKey = encryptFileKey(fileKey, targetFolderKey);

            // 5. Call the API with re-encrypted keys
            await filesAPI.move(fileId, targetFolderId, {
                fileKeyEncrypted: toBase64(reencryptedFileKey.encrypted),
                fileKeyNonce: toBase64(reencryptedFileKey.nonce)
            });

            // 6. Update metadata to reflect the new folder
            const newMeta = { ...metadata };
            if (newMeta.files[fileId.toString()]) {
                newMeta.files[fileId.toString()].folder_id = targetFolderId?.toString() || null;
                await saveMetadata(newMeta);
            }

            loadFiles();
            showToast('File moved successfully', 'success');
        } catch (error) {
            console.error('Move failed:', error);
            showToast('Failed to move file', 'error');
            throw error;
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            addUpload(file);
        }
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const onDragLeave = () => {
        setIsDragging(false);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            addUpload(file);
        }
    };

    const loadFiles = async () => {
        setLoading(true);
        try {
            const filesRes = await filesAPI.list();
            // Merge metadata (filenames) with server data (stats)
            const mergedFiles = (filesRes.files || []).map((svrFile: any) => {
                const meta = metadata?.files[svrFile.id.toString()];
                return {
                    ...svrFile,
                    filename: meta?.filename || svrFile.filename || `File ${svrFile.id}`,
                    mime_type: meta?.mime_type || svrFile.mime_type
                };
            });
            setFiles(mergedFiles);
        } catch (error) {
            console.error('Failed to load files:', error);
            setFiles([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFiles();
    }, [fileListVersion, metadata]); // Re-run when metadata updates

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 flex flex-col h-full p-4 overflow-hidden"
        >
            <ShareSuccessModal
                isOpen={shareModal.isOpen}
                onClose={() => setShareModal({ ...shareModal, isOpen: false })}
                shareLink={shareModal.link}
                filename={shareModal.name}
            />

            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
            />

            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="mb-4 glass-panel p-3 rounded-xl">
                    <h1 className="text-xl font-bold text-text-main">Nest</h1>
                    <p className="text-sm text-text-muted">All your uploaded files in one place</p>
                </div>

                {/* Content List */}
                <div className="flex-1 glass-panel overflow-hidden p-0 relative">
                    {loading ? (
                        <PageLoader />
                    ) : files.length === 0 ? (
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            className={`h-full flex flex-col items-center justify-center text-center p-6 sm:p-12 transition-all cursor-pointer group ${isDragging ? 'bg-primary/20 border-2 border-dashed border-primary scale-[0.98]' : 'hover:bg-background/40'
                                }`}
                            onDragOver={onDragOver}
                            onDragLeave={onDragLeave}
                            onDrop={onDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <div className={`w-16 h-16 sm:w-20 sm:h-20 bg-background/50 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 ${isDragging ? 'scale-110' : 'animate-float'}`}>
                                <svg className={`w-10 h-10 sm:w-12 sm:h-12 transition-colors ${isDragging ? 'text-primary' : 'text-text-muted group-hover:text-primary'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                            </div>
                            <p className="text-text-main font-bold text-lg group-hover:text-primary transition-colors">
                                {isDragging ? 'Drop to upload' : 'No files uploaded yet'}
                            </p>
                            <p className="text-text-muted text-sm mt-2">
                                {isDragging ? 'Release to start upload' : 'Click or drag and drop a file anywhere here to get started'}
                            </p>
                        </motion.div>
                    ) : (
                        <div className="h-full overflow-auto custom-scrollbar">
                            <FileTable
                                items={files.map(file => ({
                                    id: file.id,
                                    name: file.filename,
                                    type: 'file' as const,
                                    mimeType: file.mime_type,
                                    size: file.file_size,
                                    createdAt: file.created_at,
                                    folderId: null,
                                    onDownload: () => handleDownload(file),
                                    onShare: () => handleShare(file),
                                    onMove: async (targetFolderId: number | null) => handleMove(file.id, targetFolderId),
                                    onDelete: () => handleDelete(file.id),
                                }))}
                            />
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};
