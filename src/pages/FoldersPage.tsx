import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FolderPlus } from '@phosphor-icons/react';
import { FileTable } from '../components/FileTable';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { filesAPI } from '../api/files';
import { foldersAPI } from '../api/folders';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useToast } from '../contexts/ToastContext';
import { useRefresh } from '../contexts/RefreshContext';
import { useStorage } from '../contexts/StorageContext';
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

export const FoldersPage = () => {
    const { showToast, updateToast, dismissToast } = useToast();
    const navigate = useNavigate();
    const location = useLocation();
    const { fileListVersion, triggerFileRefresh } = useRefresh();
    const { refreshQuota } = useStorage();
    const { metadata, saveMetadata, masterKey } = useAuth();

    // URL State Management
    const searchParams = new URLSearchParams(location.search);
    const folderIdParam = searchParams.get('folderId');
    const selectedFolderId = (folderIdParam && !isNaN(parseInt(folderIdParam)))
        ? parseInt(folderIdParam)
        : null;

    // Standard navigation helper
    const handleNavigate = (id: number | null) => {
        if (id === null) {
            navigate('/folders', { replace: true });
        } else {
            navigate(`/folders?folderId=${id}`, { replace: true });
        }
    };

    // State
    const [displayFiles, setDisplayFiles] = useState<FileItem[]>([]);
    const [displayFolders, setDisplayFolders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
    const [primaryRootId, setPrimaryRootId] = useState<number | null>(null);

    // Session Recovery: If key is lost, UI will show "Vault Locked" or prompt re-auth locally
    // We remove the auto-redirect to /login because it causes logout loops during race conditions.

    useEffect(() => {
        const loadContent = async () => {
            if (!metadata) return;

            // Only show full-screen loader on initial mount or connection
            // Otherwise, do a "background refresh" to prevent flashing
            if (displayFiles.length === 0 && displayFolders.length === 0) {
                setLoading(true);
            }
            try {
                let targetId = selectedFolderId;

                // 1. Transparent Root Resolution
                // If we are at the root path, we check if there's a single root folder to proxy
                if (targetId === null) {
                    const rootsRes = await foldersAPI.list(null);
                    const roots = rootsRes.folders || [];
                    if (roots.length === 1) {
                        targetId = roots[0].id;
                        setPrimaryRootId(targetId);
                        console.log(`[TransparentRoot] Proxying root folder: ${targetId}`);
                    } else {
                        setPrimaryRootId(null);
                    }
                }

                // 2. Fetch Server Data (using resolved targetId)
                const [filesRes, foldersRes] = await Promise.all([
                    filesAPI.list(targetId),
                    foldersAPI.list(targetId)
                ]);

                // 3. Self-Heal metadata
                let changesMade = false;
                const newMeta = JSON.parse(JSON.stringify(metadata));

                // If targetId is not null, ensure it exists in metadata
                if (targetId !== null && !newMeta.folders[targetId.toString()]) {
                    console.log(`[Self-Heal] Folder ${targetId} missing from metadata. Adding...`);
                    newMeta.folders[targetId.toString()] = {
                        name: `Folder ${targetId}`,
                        created_at: new Date().toISOString()
                    };
                    changesMade = true;
                }

                // If at absolute root with multiple folders, ensure they are in metadata
                if (selectedFolderId === null && targetId === null && foldersRes.folders) {
                    for (const f of foldersRes.folders) {
                        if (f.parent_id === null && !newMeta.folders[f.id.toString()]) {
                            newMeta.folders[f.id.toString()] = { name: f.name || 'Root', created_at: f.created_at };
                            changesMade = true;
                        }
                    }
                }

                if (changesMade) {
                    await saveMetadata(newMeta);
                }

                // 4. Prepare Display State
                const currentMeta = changesMade ? newMeta : metadata;

                // Filter out self-referencing folders
                const visibleFolders = (foldersRes.folders || [])
                    .filter((f: any) => f.id !== targetId)
                    .map((f: any) => ({
                        ...f,
                        name: currentMeta.folders[f.id.toString()]?.name || f.name || `Folder ${f.id}`
                    }));

                const visibleFiles = (filesRes.files || []).map((f: any) => ({
                    ...f,
                    filename: currentMeta.files[f.id.toString()]?.filename || f.filename || `File ${f.id}`
                }));

                setDisplayFolders(visibleFolders);
                setDisplayFiles(visibleFiles);

            } catch (error: any) {
                console.error('[Folders-Load] ❌ Failed:', error);
                if (error.response?.status === 403 || error.response?.status === 404) {
                    showToast('Folder unavailable, returning home.', 'warning');
                    handleNavigate(null);
                } else {
                    showToast('Failed to load folder contents', 'error');
                }
            } finally {
                setLoading(false);
            }
        };

        loadContent();
    }, [selectedFolderId, fileListVersion, metadata?.v]);

    // Auto-dive logic is now consolidated into loadContent for consistency.

    // Handlers
    const handleCreateFolder = async (folderName: string) => {
        if (!metadata || !masterKey) return;
        try {
            // 1. Generate & Encrypt Folder Key locally
            const { generateFolderKey, encryptFolderKey, toBase64 } = await import('../crypto/v2');

            const folderKey = generateFolderKey();
            const { encrypted, nonce } = encryptFolderKey(folderKey, masterKey);

            // If at root, and we have a primary root, use it as parent
            const parentId = selectedFolderId || primaryRootId || undefined;

            // 2. Create on Server
            const res = await foldersAPI.create(
                toBase64(encrypted),
                toBase64(nonce),
                folderName,
                parentId
            );
            const newId = res.folder_id;

            // 3. Update Metadata
            const newMeta = JSON.parse(JSON.stringify(metadata));
            newMeta.folders[newId] = {
                name: folderName,
                created_at: new Date().toISOString()
            };

            // 4. Encrypt & Save Metadata
            await saveMetadata(newMeta);

            showToast('Folder created', 'success');
            triggerFileRefresh();
        } catch (error) {
            console.error('Create folder failed:', error);
            showToast('Failed to create folder', 'error');
        }
    };

    const handleDeleteFolder = async (folderId: number) => {
        if (!metadata) return;
        // Note: Confirmation is handled by the UI modal before calling this function

        try {
            await foldersAPI.delete(folderId);

            // Fix H3: Update metadata to remove folder and child files
            const updatedMetadata = { ...metadata };

            // Remove folder from metadata
            delete updatedMetadata.folders[folderId];

            // Remove all files in this folder from metadata
            Object.keys(updatedMetadata.files).forEach(fileId => {
                const fileFolder = updatedMetadata.files[fileId]?.folder_id;
                if (fileFolder === folderId.toString()) {
                    delete updatedMetadata.files[fileId];
                }
            });

            // Save updated metadata to server
            await saveMetadata(updatedMetadata);

            // Trigger file refresh to reload from server
            triggerFileRefresh();

            showToast('Folder deleted successfully', 'success');
        } catch (error: any) {
            console.error('[FOLDERS] Delete failed:', error);
            showToast(error.response?.data?.error || 'Failed to delete folder', 'error');
        }
    };

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
            try {
                await navigator.clipboard.writeText(shareUrl);
                showToast('Share link copied to clipboard!', 'success');
            } catch (clipboardError) {
                console.warn('[SHARE] Clipboard write failed (likely browser restriction):', clipboardError);
                // Fallback: The link WAS created, just not copied.
                showToast('Link created! Find it in "Shared Links".', 'warning', 5000);
            }
            triggerFileRefresh();
        } catch (error) {
            console.error('Share creation failed:', error);
            showToast('Failed to create share link', 'error');
        }
    };

    const handleDownload = async (file: FileItem) => {
        let toastId: string | undefined;
        try {
            if (!masterKey) {
                showToast('Please log in again to download files', 'error');
                return;
            }

            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, decryptFile, fromBase64 } = await import('../crypto/v2');
            toastId = showToast('Starting download...', 'info', Infinity);

            // 1. Fetch encrypted keys and file metadata from server
            const downloadInfo = await api.get(`/files/download/${file.id}`);

            // 2. Decrypt Keys (moved up to support StreamingDownloader)
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            // NEW: Use StreamingDownloader for Large Files (>500MB) if supported
            const isLargeFile = file.file_size > 500 * 1024 * 1024;
            const hasNativeFS = 'showSaveFilePicker' in window;
            const token = localStorage.getItem('nest_token');

            if (isLargeFile && hasNativeFS && token) {
                if (toastId) updateToast(toastId, 'Starting streaming download...', 'info');

                // Map chunks to DownloadChunk format
                const downloadChunks = downloadInfo.data.chunks.map((c: any) => ({
                    index: c.index,
                    size: c.size,
                    nonce: c.nonce,
                    jackal_merkle: c.jackal_merkle,
                    status: (c.jackal_merkle && c.jackal_merkle !== 'pending' && c.jackal_merkle !== 'pending-chunks') ? 'cloud' : 'local'
                }));

                const { StreamingDownloader } = await import('../utils/StreamingDownloader');

                // Notify user to select file location (since Native FS picker halts JS execution)
                if (toastId) updateToast(toastId, 'Please select where to save the file...', 'info');

                let lastUpdate = 0;
                await StreamingDownloader.download({
                    fileKey,
                    filename: file.filename,
                    chunks: downloadChunks,
                    fileId: file.id,
                    authToken: token,
                    onProgress: (p) => {
                        // Log first few updates to debug
                        if (p < 5 || p > 95 || Math.floor(p) % 10 === 0) console.log(`[UI-DL] Progress: ${p.toFixed(2)}%`);

                        // Throttle updates to every 5% or 500ms to allow React to render
                        const now = Date.now();
                        if (now - lastUpdate > 200 || p === 100) {
                            if (toastId) updateToast(toastId, `Downloading... ${p.toFixed(0)}%`, 'info');
                            lastUpdate = now;
                        }
                    }
                });

                // Dismiss progress toast
                if (toastId) dismissToast(toastId);

                // Show distinct success toast
                setTimeout(() => showToast('Download complete! File saved.', 'success'), 500);
                return;
            }

            // FALLBACK: Legacy Blob Download
            if (isLargeFile && !hasNativeFS) {
                console.warn('Large file download requiring memory blob (Native FS not supported)');
                if (toastId) updateToast(toastId, 'Warning: Large file, may consume high memory...', 'warning');
            }

            // 3. Fetch Raw Encrypted Content
            const contentResponse = await api.get(`/files/raw/${file.id}`, {
                responseType: 'blob',
                onDownloadProgress: (progressEvent) => {
                    const total = progressEvent.total || file.file_size;
                    const percent = (progressEvent.loaded / total) * 100;
                    if (toastId) updateToast(toastId, `Downloading... ${percent.toFixed(0)}%`, 'info');
                }
            });
            const encryptedBlob = contentResponse.data;

            if (toastId) updateToast(toastId, 'Decrypting locally... (Do not close)', 'info');

            // 4. Decrypt Content
            // Allow UI to update before heavy crypto
            await new Promise(r => setTimeout(r, 50));

            const headerNonce = fileKeyNonce;
            const chunks = downloadInfo.data.chunks;

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

        } catch (error: any) {
            console.error('Download failed:', error);
            if (toastId) dismissToast(toastId);
            showToast(`Download failed: ${error.message}`, 'error');
        }
    };

    const handleDeleteFile = async (fileId: number) => {
        try {
            await filesAPI.delete(fileId);
            refreshQuota();
            triggerFileRefresh();
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
            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, encryptFileKey, toBase64, fromBase64 } = await import('../crypto/v2');

            // 1. Get the file's current encrypted keys from the server
            const downloadInfo = await api.get(`/files/download/${fileId}`);

            const currentFileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const currentFileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const currentFolderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const currentFolderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            // 2. Decrypt the file key using the current folder's key
            const currentFolderKey = decryptFolderKey(currentFolderKeyEncrypted, currentFolderKeyNonce, masterKey);
            const fileKey = decryptFileKey(currentFileKeyEncrypted, currentFileKeyNonce, currentFolderKey);

            // 3. Resolve actual target ID and folder key
            // In Transparent Root mode, 'null' target means moving to the primaryRoot.
            const actualTargetId = targetFolderId || primaryRootId;

            if (actualTargetId === null) {
                throw new Error('Destination folder not found.');
            }

            const { key: folderKeyEncryptedBase64, nonce: folderKeyNonceBase64 } = await foldersAPI.getKey(actualTargetId);
            const folderKeyEncrypted = fromBase64(folderKeyEncryptedBase64);
            const folderKeyNonce = fromBase64(folderKeyNonceBase64);
            const targetFolderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);

            // 4. Re-encrypt the file key with the target folder's key
            const reencryptedFileKey = encryptFileKey(fileKey, targetFolderKey);

            // 5. Call the API with re-encrypted keys
            // We still send targetFolderId (which might be null) to the server if that's what's intended,
            // but for a true Transparent Root, the server move should probably target actualTargetId.
            await filesAPI.move(fileId, actualTargetId, {
                fileKeyEncrypted: toBase64(reencryptedFileKey.encrypted),
                fileKeyNonce: toBase64(reencryptedFileKey.nonce)
            });

            // 6. Update metadata to reflect the new folder
            const newMeta = { ...metadata };
            if (newMeta.files[fileId.toString()]) {
                newMeta.files[fileId.toString()].folder_id = targetFolderId?.toString() || null;
                await saveMetadata(newMeta);
            }

            triggerFileRefresh();
            showToast('File moved successfully', 'success');
        } catch (error) {
            console.error('Move failed:', error);
            showToast('Failed to move file', 'error');
            throw error;
        }
    };

    // Breadcrumb Helper State
    const [structureMap, setStructureMap] = useState<Map<number, number | null>>(new Map()); // id -> parentId

    useEffect(() => {
        const fetchStructure = async () => {
            try {
                const res = await foldersAPI.list();
                const map = new Map();
                res.folders.forEach((f: any) => map.set(f.id, f.parent_id));
                setStructureMap(map);
            } catch (e) {
                console.error('Failed to load structure', e);
            }
        };
        fetchStructure();
    }, [fileListVersion]);

    const getBreadcrumbPath = () => {
        if (selectedFolderId === null) return [];
        if (!metadata) return [];

        const path: { id: number; name: string }[] = [];
        let currentId: number | null = selectedFolderId;
        let attempts = 0;

        while (currentId !== null && attempts < 20) {
            const meta = metadata.folders[currentId.toString()];
            const name = meta?.name || `Folder ${currentId}`;

            path.unshift({ id: currentId, name });

            const parent = structureMap.get(currentId);
            if (parent === undefined) break;

            currentId = parent;
            attempts++;
        }
        // Robust Root Hiding:
        // Any folder with parent_id === null is a terminal root.
        // We hide it because the breadcrumb already has a "Home" button for the base level.
        if (path.length > 0) {
            const firstId = path[0].id;
            const parentId = structureMap.get(firstId);
            if (parentId === null) {
                path.shift();
            }
        }

        return path;
    };


    if (!metadata) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-text-muted font-medium">Decrypting Vault...</p>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 flex gap-4 h-full p-4 overflow-hidden"
        >
            <CreateFolderModal
                isOpen={showCreateFolderModal}
                onClose={() => setShowCreateFolderModal(false)}
                onCreate={handleCreateFolder}
            />

            <div className="flex-1 flex flex-col min-w-0">
                <div className="mb-4 flex items-center justify-between glass-panel p-3 rounded-xl">
                    <div className="flex-1 min-w-0 mr-4">
                        <Breadcrumbs
                            path={getBreadcrumbPath()}
                            onNavigate={handleNavigate}
                        />
                    </div>
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setShowCreateFolderModal(true)}
                        className="glass-button px-3 py-1.5 flex items-center gap-2 text-sm flex-shrink-0"
                    >
                        <FolderPlus size={16} weight="bold" />
                        <span>New Folder</span>
                    </motion.button>
                </div>

                <div className="flex-1 glass-panel overflow-hidden p-0 relative">
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/10 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-3">
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                    className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full"
                                />
                                <p className="text-text-muted font-medium">Loading content...</p>
                            </div>
                        </div>
                    ) : (displayFiles.length === 0 && displayFolders.length === 0) ? (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 sm:p-12">
                            <motion.div
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ delay: 0.2 }}
                                className="w-16 h-16 sm:w-20 sm:h-20 bg-background/50 rounded-2xl flex items-center justify-center mb-4 animate-float"
                            >
                                <FolderPlus size={40} className="text-text-muted scale-90 sm:scale-100" weight="duotone" />
                            </motion.div>
                            <p className="text-text-muted font-medium">
                                {selectedFolderId === null
                                    ? 'No files or folders yet.'
                                    : 'This folder is empty.'}
                            </p>
                        </div>
                    ) : (
                        <div className="h-full overflow-auto custom-scrollbar">
                            <FileTable
                                items={[
                                    ...displayFolders.map(folder => ({
                                        id: folder.id,
                                        name: folder.name,
                                        type: 'folder' as const,
                                        createdAt: folder.created_at,
                                        file_count: folder.file_count,
                                        subfolder_count: folder.subfolder_count,
                                        folder_size: folder.folder_size,
                                        onNavigate: () => handleNavigate(folder.id),
                                        onDelete: () => handleDeleteFolder(folder.id),
                                    })),
                                    ...displayFiles.map(file => ({
                                        id: file.id,
                                        name: file.filename, // Using server filename for now
                                        type: 'file' as const,
                                        mimeType: file.mime_type,
                                        size: file.file_size,
                                        createdAt: file.created_at,
                                        folderId: selectedFolderId,
                                        onDownload: () => handleDownload(file),
                                        onShare: () => handleShare(file),
                                        onMove: async (targetFolderId: number | null) => handleMove(file.id, targetFolderId),
                                        onDelete: () => handleDeleteFile(file.id),
                                    }))
                                ]}
                            />
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};
