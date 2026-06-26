import { useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useUpload } from '../contexts/UploadContext';
import { useStorage } from '../contexts/StorageContext';
import { useAuth } from '../contexts/AuthContext';
import { filesAPI } from '../api/files';
import type { FileItem } from '../pages/NestPage';
import api from '../lib/api';

export const useFileCryptoActions = (onActionComplete: () => void) => {
    const { showToast } = useToast();
    const { addDownload, updateProgress, completeUpload, failUpload } = useUpload();
    const { refreshQuota } = useStorage();
    const { masterKey, metadata, saveMetadata } = useAuth();
    
    const [shareModal, setShareModal] = useState<{ isOpen: boolean; link: string; name: string }>({ isOpen: false, link: '', name: '' });

    const handleShare = async (file: FileItem) => {
        try {
            const { decryptFolderKey, decryptFileKey, toBase64, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();

            if (!masterKey) {
                showToast('Please log in again to create share links', 'error');
                return;
            }

            let shareToken = file.share_token;
            if (!shareToken) {
                const response = await filesAPI.createShare(Number(file.id));
                shareToken = response.share_token;
            }

            const downloadInfo = await api.get(`/files/download/${file.id}`);
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            const filename = metadata?.files[file.id.toString()]?.filename || 'file';
            const mimeType = metadata?.files[file.id.toString()]?.mime_type || 'application/octet-stream';

            const fileKeyBase64 = toBase64(fileKey);
            const origin = window.location.origin.trim();
            const token = shareToken.trim();
            const shareUrl = `${origin}/s/${token}#key=${encodeURIComponent(fileKeyBase64)}&name=${encodeURIComponent(filename)}&mime=${encodeURIComponent(mimeType)}`;

            try {
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(shareUrl);
                    showToast('Share link copied to clipboard!', 'success');
                } else {
                    throw new Error('Clipboard API unavailable');
                }
            } catch (clipboardError) {
                console.warn('[SHARE] Clipboard write failed (likely browser restriction):', clipboardError);
                setShareModal({
                    isOpen: true,
                    link: shareUrl,
                    name: filename
                });
            }

            if (!file.share_token) {
                onActionComplete();
            }

        } catch (error) {
            console.error('Share creation failed:', error);
            showToast('Failed to create share link', 'error');
        }
    };

    const handleDownload = async (file: FileItem) => {
        if (!masterKey) {
            showToast('Please log in again to download files', 'error');
            return;
        }

        const downloadId = addDownload(file.filename, file.file_size);
        let fakeProgress = 0;
        let fakeProgressInterval: NodeJS.Timeout | undefined;

        try {
            const isLargeFile = file.file_size > 128 * 1024 * 1024;
            const token = localStorage.getItem('nest_token');

            fakeProgressInterval = setInterval(() => {
                if (fakeProgress < 5) {
                    fakeProgress += 0.5;
                    updateProgress(downloadId, fakeProgress);
                }
            }, 200);

            const { decryptFolderKey, decryptFileKey, decryptFile, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();

            const downloadInfo = await api.get(`/files/download/${file.id}`);
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            if (isLargeFile && token && downloadInfo.data.chunks?.length > 0) {
                const downloadChunks = downloadInfo.data.chunks.map((c: any) => ({
                    index: c.index,
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
                    isGatewayVerified: downloadInfo.data.is_gateway_verified,
                    onProgress: (p) => {
                        clearInterval(fakeProgressInterval);
                        updateProgress(downloadId, Math.max(5, p));
                    }
                });

                clearInterval(fakeProgressInterval);
                completeUpload(downloadId);
                return;
            }

            const contentResponse = await api.get(`/files/raw/${file.id}`, {
                responseType: 'blob',
                onDownloadProgress: (progressEvent) => {
                    clearInterval(fakeProgressInterval);
                    const total = progressEvent.total || file.file_size;
                    const percent = (progressEvent.loaded / total) * 100;
                    updateProgress(downloadId, Math.max(5, percent * 0.9));
                }
            });
            const encryptedBlob = contentResponse.data;

            updateProgress(downloadId, 95);

            const headerNonce = fileKeyNonce;
            const chunks = downloadInfo.data.chunks;

            await new Promise(r => setTimeout(r, 50));
            const decryptedBytes = await decryptFile(encryptedBlob, (chunks && chunks.length > 0) ? chunks : headerNonce, fileKey);

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

            clearInterval(fakeProgressInterval);
            completeUpload(downloadId);

        } catch (error: any) {
            console.error('Download failed:', error);
            if (fakeProgressInterval) clearInterval(fakeProgressInterval);
            failUpload(downloadId, error.message || 'Download failed');
        }
    };

    const handleDelete = async (fileId: number) => {
        try {
            await filesAPI.delete(fileId);
            refreshQuota();
            onActionComplete();
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
            const { decryptFolderKey, decryptFileKey, encryptFileKey, toBase64, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();
            const { foldersAPI } = await import('../api/folders');

            const downloadInfo = await api.get(`/files/download/${fileId}`);

            const currentFileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const currentFileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const currentFolderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const currentFolderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const currentFolderKey = decryptFolderKey(currentFolderKeyEncrypted, currentFolderKeyNonce, masterKey);
            const fileKey = decryptFileKey(currentFileKeyEncrypted, currentFileKeyNonce, currentFolderKey);

            let targetFolderKey: Uint8Array;

            if (targetFolderId === null) {
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
                const { key: folderKeyEncryptedBase64, nonce: folderKeyNonceBase64 } = await foldersAPI.getKey(targetFolderId);
                const folderKeyEncrypted = fromBase64(folderKeyEncryptedBase64);
                const folderKeyNonce = fromBase64(folderKeyNonceBase64);
                targetFolderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            }

            const reencryptedFileKey = encryptFileKey(fileKey, targetFolderKey);

            await filesAPI.move(fileId, targetFolderId, {
                fileKeyEncrypted: toBase64(reencryptedFileKey.encrypted),
                fileKeyNonce: toBase64(reencryptedFileKey.nonce)
            });

            const newMeta = { ...metadata };
            if (newMeta.files[fileId.toString()]) {
                newMeta.files[fileId.toString()].folder_id = targetFolderId?.toString() || null;
                await saveMetadata(newMeta);
            }

            onActionComplete();
            showToast('File moved successfully', 'success');
        } catch (error) {
            console.error('Move failed:', error);
            showToast('Failed to move file', 'error');
            throw error;
        }
    };

    const handleRename = async (fileId: number, newName: string) => {
        if (!metadata || !masterKey) {
            showToast('Authentication required to rename files', 'error');
            return;
        }
        try {
            const updatedMetadata = JSON.parse(JSON.stringify(metadata));
            let finalName = newName;

            const oldName = updatedMetadata.files[fileId.toString()]?.filename || '';
            if (oldName.includes('.')) {
                const oldExt = '.' + oldName.split('.').pop();
                if (oldExt && !newName.includes('.')) {
                    finalName = newName + oldExt;
                }
            }

            if (updatedMetadata.files[fileId.toString()]) {
                updatedMetadata.files[fileId.toString()].filename = finalName;
            } else {
                updatedMetadata.files[fileId.toString()] = { filename: finalName };
            }
            await saveMetadata(updatedMetadata);
            
            onActionComplete();
            showToast('File renamed', 'success');
        } catch (error) {
            console.error('Rename failed:', error);
            showToast('Failed to rename file', 'error');
        }
    };

    return {
        handleShare,
        handleDownload,
        handleDelete,
        handleMove,
        handleRename,
        shareModal,
        setShareModal
    };
};
