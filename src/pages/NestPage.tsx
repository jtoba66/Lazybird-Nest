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

            // Step 7: Copy to clipboard
            await navigator.clipboard.writeText(shareUrl);
            showToast('Share link copied to clipboard!', 'success');

            // Reload to update UI if it was a new share
            if (!file.share_token) {
                loadFiles();
            }

        } catch (error) {
            console.error('Share failed:', error);
            showToast('Failed to create/copy share link', 'error');
        }
    };

    const handleDownload = async (file: FileItem) => {
        let toastId: string | null = null;
        try {
            if (!masterKey) {
                showToast('Please log in again to download files', 'error');
                return;
            }

            // Start Feedback
            toastId = showToast('Downloading encrypted file...', 'info', Infinity);

            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, decryptFile, fromBase64 } = await import('../crypto/v2');

            // 1. Fetch encrypted keys and file metadata from server
            const downloadInfo = await api.get(`/files/download/${file.id}`);

            // 2. Fetch raw encrypted content
            const contentResponse = await api.get(`/files/raw/${file.id}`, {
                responseType: 'blob'
            });
            const encryptedBlob = contentResponse.data;

            // Update Feedback
            if (toastId) updateToast(toastId, 'Decrypting locally... (Do not close)', 'info');

            // 3. Decrypt Keys
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            // 4. Decrypt Content
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

            // Cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            if (toastId) dismissToast(toastId);
            showToast('Download complete', 'success');

        } catch (error) {
            console.error('Download failed:', error);
            if (toastId) dismissToast(toastId);
            showToast('Failed to download file', 'error');
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
                    filename: meta?.filename || `File ${svrFile.id}`,
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
                        <div className="absolute inset-0 flex items-center justify-center bg-white/10 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-3">
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                    className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full"
                                />
                                <p className="text-text-muted font-medium">Loading files...</p>
                            </div>
                        </div>
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
