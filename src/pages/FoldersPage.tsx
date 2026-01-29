import { useState, useEffect } from 'react';
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
    const { showToast } = useToast();
    const { fileListVersion, triggerFileRefresh } = useRefresh();
    const { refreshQuota } = useStorage();
    const { metadata, saveMetadata, masterKey } = useAuth();

    // State
    const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
    const [displayFiles, setDisplayFiles] = useState<FileItem[]>([]);
    const [displayFolders, setDisplayFolders] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);

    // Session Recovery: If key is lost, UI will show "Vault Locked" or prompt re-auth locally
    // We remove the auto-redirect to /login because it causes logout loops during race conditions.

    // Initial Load & Sync
    useEffect(() => {
        const loadContent = async () => {
            if (!metadata) return; // Wait for metadata decryption

            setLoading(true);
            try {
                // 1. Fetch Server Stats/IDs (The "Physical" storage state)
                const [filesRes, foldersRes] = await Promise.all([
                    filesAPI.list(selectedFolderId),
                    foldersAPI.list(selectedFolderId)
                ]);

                // 2. Discover Root if missing in Metadata (Self-Healing)
                if (selectedFolderId === null && foldersRes.folders && foldersRes.folders.length > 0) {
                    const dbRoots = foldersRes.folders.filter((f: any) => f.parent_id === null);
                    // Check if we have this root in metadata
                    let changesMade = false;
                    const newMeta = JSON.parse(JSON.stringify(metadata));

                    for (const root of dbRoots) {
                        if (!newMeta.folders[root.id]) {
                            console.log('Discovered orphaned root folder:', root.id);
                            newMeta.folders[root.id] = {
                                name: 'Root',
                                created_at: root.created_at
                            };
                            changesMade = true;
                        }
                    }

                    if (changesMade) {
                        await saveMetadata(newMeta);
                    }
                }

                // 3. Merge Metadata (Names) with Server Data (Stats)
                const mergedFolders = (foldersRes.folders || []).map((svrFolder: any) => {
                    const meta = metadata.folders[svrFolder.id.toString()];
                    return {
                        ...svrFolder,
                        name: meta?.name || `Folder ${svrFolder.id}`, // Fallback if orphaned
                    };
                });

                // 4. Filter out the "Root" folder (it's implicit) but keep other top-level folders
                const visibleFolders = mergedFolders.filter((folder: any) => folder.name !== 'Root');

                // 5. Merge Files (Use metadata for names, server for stats)
                const mergedFiles = (filesRes.files || []).map((svrFile: any) => {
                    const meta = metadata.files[svrFile.id.toString()];
                    return {
                        ...svrFile,
                        filename: meta?.filename || `File ${svrFile.id}`, // Use metadata name
                        mime_type: meta?.mime_type || svrFile.mime_type
                    };
                });

                setDisplayFolders(visibleFolders);
                setDisplayFiles(mergedFiles);

            } catch (error) {
                console.error('Failed to load content:', error);
                showToast('Failed to load folder contents', 'error');
            } finally {
                setLoading(false);
            }
        };

        loadContent();
    }, [selectedFolderId, fileListVersion, metadata]); // Depend on metadata updates

    // Handlers
    const handleCreateFolder = async (folderName: string) => {
        if (!metadata || !masterKey) return;
        try {
            // 1. Generate & Encrypt Folder Key locally
            const { generateFolderKey, encryptFolderKey, toBase64 } = await import('../crypto/v2');

            const folderKey = generateFolderKey();
            const { encrypted, nonce } = encryptFolderKey(folderKey, masterKey);

            // Path Hash (server will handle hashing)
            const pathHash = folderName; // Server hashes this

            // 2. Create on Server
            const res = await foldersAPI.create(
                toBase64(encrypted),
                toBase64(nonce),
                pathHash,
                selectedFolderId || undefined
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
        try {
            // 1. Delete on Server
            await foldersAPI.delete(folderId);

            // 2. Update Metadata
            const newMeta = JSON.parse(JSON.stringify(metadata));
            delete newMeta.folders[folderId];

            // 3. Encrypt & Save
            await saveMetadata(newMeta);

            triggerFileRefresh();
            showToast('Folder deleted', 'success');
        } catch (error: any) {
            console.error('Delete folder failed:', error);
            if (error.response?.data?.error === 'Folder not empty') {
                showToast(`Cannot delete: Folder not empty (${error.response.data.file_count || 0} files)`, 'error');
            } else {
                showToast('Failed to delete folder', 'error');
            }
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
            await navigator.clipboard.writeText(shareUrl);
            showToast('Share link copied to clipboard!', 'success');
            triggerFileRefresh();
        } catch (error) {
            console.error('Share failed:', error);
            showToast('Failed to create/copy share link', 'error');
        }
    };

    const handleDownload = async (file: FileItem) => {
        try {
            if (!masterKey) {
                showToast('Please log in again to download files', 'error');
                return;
            }

            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, decryptFile, fromBase64 } = await import('../crypto/v2');

            showToast('Starting download...', 'info');

            // 1. Fetch encrypted keys and file metadata from server
            const downloadInfo = await api.get(`/files/download/${file.id}`);

            // 2. Fetch raw encrypted content
            const contentResponse = await api.get(`/files/raw/${file.id}`, {
                responseType: 'blob'
            });
            const encryptedBlob = contentResponse.data;

            // 3. Decrypt Keys
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            // 4. Decrypt Content
            const decryptedBytes = await decryptFile(encryptedBlob, downloadInfo.data.chunks || null, fileKey); // Nonce is inside the blob for v2

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
            showToast('Download complete', 'success');

        } catch (error) {
            console.error('Download failed:', error);
            showToast('Failed to download file', 'error');
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
                            onNavigate={setSelectedFolderId}
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
                                        onNavigate: () => setSelectedFolderId(folder.id),
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
