import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
import { useUpload } from '../contexts/UploadContext';
import api from '../lib/api';
import sodium from 'libsodium-wrappers';
import { fromBase64, decryptWithMasterKey } from '@lazybird-inc/nest-crypto';

interface FileItem {
    id: number;
    filename: string;
    mime_type: string;
    file_size: number;
    created_at: string;
    share_token: string | null;
    file_origin?: string;
    encrypted_filename?: string;
    encrypted_mime_type?: string;
    folderId?: number;
    file_key_encrypted?: string;
    file_key_nonce?: string;
}

export const FoldersPage = () => {
    const { showToast } = useToast();
    const navigate = useNavigate();
    const location = useLocation();
    const { fileListVersion, triggerFileRefresh } = useRefresh();
    const { refreshQuota } = useStorage();
    const { metadata, saveMetadata, masterKey, checkMetadataVersion } = useAuth();
    const { addUpload, addDownload, updateProgress, completeUpload, failUpload } = useUpload();

    // URL State Management
    const searchParams = new URLSearchParams(location.search);
    const folderIdParam = searchParams.get('folderId');
    const selectedFolderId = (folderIdParam && !isNaN(parseInt(folderIdParam)))
        ? parseInt(folderIdParam)
        : null;

    // Standard navigation helper
    const handleNavigate = (id: number | null) => {
        if (collabToken) {
            if (id === null) {
                navigate(`/folders?collabToken=${collabToken}`, { replace: true });
            } else {
                navigate(`/folders?folderId=${id}&collabToken=${collabToken}`, { replace: true });
            }
            return;
        }
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
    const [isDragging, setIsDragging] = useState(false);
    // Tracks folder ids we've already attempted to self-heal into the metadata vault,
    // so repeated loadContent runs (its effect re-fires as dropZones/collab state settle,
    // and `metadata` isn't a dep so the closure stays stale) don't re-save in a loop.
    const selfHealAttemptedRef = useRef<Set<number>>(new Set());

    // Collaboration & Drop Zone States
    const [collabKey, setCollabKey] = useState<Uint8Array | null>(null);
    const [collabRootId, setCollabRootId] = useState<number | null>(null);
    const [rawCollabFolders, setRawCollabFolders] = useState<any[]>([]);
    const [hostCollabFolders, setHostCollabFolders] = useState<any[]>([]);
    const [dropZones, setDropZones] = useState<any[]>([]);

    const collabToken = searchParams.get('collabToken');

    const decryptSymmetricMetadata = (jsonStr: string | null, key: Uint8Array): string => {
        if (!jsonStr) return 'Unnamed Item';
        try {
            const { encrypted, nonce } = JSON.parse(jsonStr);
            const decryptedBytes = decryptWithMasterKey(fromBase64(encrypted), fromBase64(nonce), key);
            return new TextDecoder().decode(decryptedBytes);
        } catch (e) {
            console.error('Failed to decrypt symmetric metadata:', e);
            return 'Decryption Error';
        }
    };

    useEffect(() => {
        if (!collabToken || !masterKey) {
            setCollabKey(null);
            return;
        }
        const loadCollabKey = async () => {
            try {
                const res = await api.get('/collab-folders/shared-with-me');
                if (res.data && res.data.success) {
                    const activeFolder = res.data.shared_folders?.find((f: any) => f.token === collabToken);
                    if (activeFolder) {
                        const { decryptCollabKey, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
                        await init();
                        const key = decryptCollabKey(
                            fromBase64(activeFolder.encrypted_collab_key),
                            fromBase64(activeFolder.collab_key_nonce),
                            masterKey
                        );
                        setCollabKey(key);
                    } else {
                        showToast('Collaborative folder access denied', 'error');
                    }
                }
            } catch (err) {
                console.error('Failed to load collab key:', err);
                showToast('Failed to load collaborative folder', 'error');
            }
        };
        loadCollabKey();
    }, [collabToken, masterKey]);

    useEffect(() => {
        if (!masterKey) return;
        const loadDropZonesAndShares = async () => {
            try {
                const res = await api.get('/drop-zones');
                if (res.data && res.data.success) {
                    const { decryptDropPrivateKey, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
                    await init();
                    await sodium.ready;

                    const decryptedDZs = res.data.drop_zones.map((dz: any) => {
                        try {
                            const privateKey = decryptDropPrivateKey(
                                fromBase64(dz.encrypted_private_key),
                                fromBase64(dz.private_key_nonce),
                                masterKey
                            );
                            const publicKey = sodium.crypto_scalarmult_base(privateKey);
                            return {
                                ...dz,
                                privateKey,
                                publicKey
                            };
                        } catch (err) {
                            console.error('Failed to decrypt private key for drop zone:', dz.id, err);
                            return dz;
                        }
                    });
                    setDropZones(decryptedDZs);
                }
            } catch (err) {
                console.error('Failed to fetch drop zones:', err);
            }

            try {
                const res = await api.get('/shares');
                if (res.data && res.data.success) {
                    const collabShares = (res.data.shares || []).filter((s: any) => s.type === 'collab_folder');
                    setHostCollabFolders(collabShares);
                }
            } catch (err) {
                console.error('Failed to fetch host shares:', err);
            }
        };
        loadDropZonesAndShares();
    }, [masterKey]);

    // Drag-and-drop handlers
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const onDragLeave = () => {
        setIsDragging(false);
    };

    const onFileDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const targetId = selectedFolderId || collabRootId || primaryRootId || null;
            const sessionId = crypto.randomUUID();
            Array.from(e.dataTransfer.files).forEach(file => {
                addUpload(file, targetId, collabToken || undefined, collabKey || undefined, sessionId);
            });
        }
    };

    // Session Recovery: If key is lost, UI will show "Vault Locked" or prompt re-auth locally
    // We remove the auto-redirect to /login because it causes logout loops during race conditions.

    useEffect(() => {
        const loadContent = async () => {
            if (!metadata) return;

            // Wait for collabKey to decrypt collab folder content
            if (collabToken && !collabKey) return;

            // Only show full-screen loader on initial mount or connection
            if (displayFiles.length === 0 && displayFolders.length === 0) {
                setLoading(true);
            }
            try {
                let targetId = selectedFolderId;

                if (collabToken) {
                    // Fetch files and folders for collab folder
                    const response = await api.get(`/collab/${collabToken}/files`);
                    if (response.data && response.data.success) {
                        const rootId = response.data.collab_root_id;
                        setCollabRootId(rootId);
                        
                        const rawFolders = response.data.folders || [];
                        const rawFiles = response.data.files || [];
                        setRawCollabFolders(rawFolders);

                        // Filter based on active folder
                        const activeFolder = targetId === null ? rootId : targetId;

                        // Decrypt and map subfolders
                        const visibleFolders = rawFolders
                            .filter((f: any) => f.parent_id === activeFolder)
                            .map((f: any) => ({
                                ...f,
                                name: collabKey ? decryptSymmetricMetadata(f.encrypted_folder_name, collabKey) : 'Symmetrically Encrypted'
                            }));

                        // Decrypt and map files
                        const visibleFiles = rawFiles
                            .filter((f: any) => f.folder_id === activeFolder)
                            .map((f: any) => ({
                                ...f,
                                filename: collabKey ? decryptSymmetricMetadata(f.encrypted_filename, collabKey) : 'Symmetrically Encrypted',
                                mime_type: collabKey ? decryptSymmetricMetadata(f.encrypted_mime_type, collabKey) : 'application/octet-stream',
                                share_token: null
                            }));

                        setDisplayFolders(visibleFolders);
                        setDisplayFiles(visibleFiles);
                    }
                    setLoading(false);
                    return;
                }

                // 1. Transparent Root Resolution
                if (targetId === null) {
                    const rootFoldersRes = await foldersAPI.list(null, true);
                    const rootFolder = rootFoldersRes.folders?.find((f: any) => f.parent_id === null && !f.path_hash?.startsWith('collab_') && !f.path_hash?.startsWith('dropzone_'));
                    if (rootFolder) {
                        setPrimaryRootId(rootFolder.id);
                        targetId = rootFolder.id;
                    } else {
                        setPrimaryRootId(null);
                    }
                }

                // 2. Fetch Server Data
                const [filesRes, foldersRes] = await Promise.all([
                    filesAPI.list(targetId),
                    foldersAPI.list(targetId)
                ]);

                // 2.5 Merge stranded null folders if we resolved a root
                if (selectedFolderId === null && targetId !== null) {
                    const strandedRes = await foldersAPI.list(null);
                    if (strandedRes.folders && foldersRes.folders) {
                        const existingIds = new Set(foldersRes.folders.map((f: any) => f.id));
                        for (const sf of strandedRes.folders) {
                            if (!existingIds.has(sf.id)) {
                                foldersRes.folders.push(sf);
                            }
                        }
                    }
                }

                // Check for stale metadata
                if (filesRes.metadataVersion) {
                    checkMetadataVersion(filesRes.metadataVersion);
                }

                // 3. Self-Heal metadata
                let changesMade = false;
                const newMeta = JSON.parse(JSON.stringify(metadata));

                if (targetId !== null && !newMeta.folders[targetId.toString()] && !selfHealAttemptedRef.current.has(targetId)) {
                    console.log(`[Self-Heal] Folder ${targetId} missing from metadata. Adding...`);
                    selfHealAttemptedRef.current.add(targetId);
                    newMeta.folders[targetId.toString()] = {
                        name: `Folder ${targetId}`,
                        created_at: new Date().toISOString()
                    };
                    changesMade = true;
                }

                if (selectedFolderId === null && targetId === null && foldersRes.folders) {
                    for (const f of foldersRes.folders) {
                        if (f.parent_id === null && !newMeta.folders[f.id.toString()] && !selfHealAttemptedRef.current.has(f.id)) {
                            selfHealAttemptedRef.current.add(f.id);
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
                
                let allVisibleFolders = foldersRes.folders ? [...foldersRes.folders] : [];
                
                if (!collabToken && targetId === primaryRootId && dropZones && dropZones.length > 0) {
                    const dzFolders = dropZones.map(dz => ({
                        id: dz.folderId,
                        name: dz.name,
                        parent_id: targetId,
                        created_at: dz.created_at
                    }));
                    
                    const existingIds = new Set(allVisibleFolders.map((f: any) => f.id));
                    dzFolders.forEach(dzf => {
                        if (!existingIds.has(dzf.id)) {
                            allVisibleFolders.push(dzf);
                        }
                    });
                }

                // Filter out self-referencing folders
                const visibleFolders = allVisibleFolders
                    .filter((f: any) => f.id !== targetId)
                    .map((f: any) => ({
                        ...f,
                        name: currentMeta.folders[f.id.toString()]?.name || f.name || `Folder ${f.id}`
                    }));

                const visibleFiles = (filesRes.files || []).map((f: any) => {
                    let filename = f.filename || `File ${f.id}`;
                    let mimeType = f.mime_type || 'application/octet-stream';

                    if (currentMeta.files[f.id.toString()]) {
                        filename = currentMeta.files[f.id.toString()].filename;
                        mimeType = currentMeta.files[f.id.toString()].mime_type;
                    } else if (f.file_origin === 'drop_zone' && f.encrypted_filename) {
                        // Asymmetrically encrypted Drop Zone file!
                            const dz = dropZones.find((d: any) => d.folderId === f.folder_id);
                            if (dz && dz.privateKey && dz.publicKey) {
                                try {
                                    const encryptedBytes = fromBase64(f.encrypted_filename);
                                    const decryptedBytes = sodium.crypto_box_seal_open(encryptedBytes as any, dz.publicKey as any, dz.privateKey as any);
                                    filename = sodium.to_string(decryptedBytes as any);

                                    if (f.encrypted_mime_type) {
                                        const encMimeBytes = fromBase64(f.encrypted_mime_type);
                                        const decMimeBytes = sodium.crypto_box_seal_open(encMimeBytes as any, dz.publicKey as any, dz.privateKey as any);
                                        mimeType = sodium.to_string(decMimeBytes as any);
                                    }
                                } catch (e) {
                                    console.error('Failed to decrypt Drop Zone file metadata:', e);
                                    filename = 'Decryption Error';
                                }
                            }
                    }

                    return {
                        ...f,
                        filename,
                        mime_type: mimeType
                    };
                });

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
    }, [selectedFolderId, fileListVersion, collabToken, collabKey, dropZones, hostCollabFolders]);

    // Fire exactly once when metadata first becomes available (login / session restore)
    const metadataReady = metadata !== null;
    useEffect(() => {
        if (metadataReady) triggerFileRefresh();
    }, [metadataReady]);

    // Auto-dive logic is now consolidated into loadContent for consistency.

    // Handlers
    const handleCreateFolder = async (folderName: string) => {
        if (collabToken) {
            if (!collabKey) return;
            try {
                const { encryptWithMasterKey, toBase64, init } = await import('@lazybird-inc/nest-crypto');
                await init();

                const encryptSymmetricMetadata = (text: string, key: Uint8Array): string => {
                    const { encrypted, nonce } = encryptWithMasterKey(text, key);
                    return JSON.stringify({
                        encrypted: toBase64(encrypted),
                        nonce: toBase64(nonce)
                    });
                };

                const folderNameEncrypted = encryptSymmetricMetadata(folderName, collabKey);
                const parentId = selectedFolderId || collabRootId || undefined;

                await api.post(`/collab/${collabToken}/folders`, {
                    folder_name_encrypted: folderNameEncrypted,
                    parent_id: parentId
                });

                showToast('Folder created', 'success');
                triggerFileRefresh();
            } catch (error) {
                console.error('Create folder failed:', error);
                showToast('Failed to create folder', 'error');
            }
            setShowCreateFolderModal(false);
            return;
        }

        if (!metadata || !masterKey) return;
        try {
            // 1. Generate & Encrypt Folder Key locally
            const { generateFolderKey, encryptFolderKey, toBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();

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
        if (collabToken) {
            try {
                await api.delete(`/collab/${collabToken}/folders/${folderId}`);
                showToast('Folder deleted successfully', 'success');
                triggerFileRefresh();
            } catch (error: any) {
                console.error('Delete folder failed:', error);
                showToast(error.response?.data?.error || 'Failed to delete folder', 'error');
            }
            return;
        }

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

            // showToast('Folder deleted successfully', 'success'); // Handled by FileTable
        } catch (error: any) {
            console.error('[FOLDERS] Delete failed:', error);
            showToast(error.response?.data?.error || 'Failed to delete folder', 'error');
        }
    };

    const handleShare = async (file: FileItem) => {
        if (collabToken) {
            showToast('Sharing is disabled for collaborative folders', 'warning');
            return;
        }

        const isDropZoneFile = file.file_origin === 'drop_zone';
        if (isDropZoneFile) {
            showToast('Sharing is disabled for guest deposits', 'warning');
            return;
        }

        try {
            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, toBase64, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();

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
                    // Clipboard API not available (e.g. non-secure context or specific webview)
                    throw new Error('Clipboard API unavailable');
                }
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
        const isDropZoneFile = file.file_origin === 'drop_zone';

        if (collabToken) {
            const downloadId = addDownload(file.filename, file.file_size);
            try {
                const { decryptFileKey, decryptFile, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
                await init();

                // 1. Fetch keys and info
                const response = await api.get(`/collab/${collabToken}/files/${file.id}`);
                const fileInfo = response.data;

                const fileKeyEncrypted = fromBase64(fileInfo.file_key_encrypted);
                const fileKeyNonce = fromBase64(fileInfo.file_key_nonce);
                const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, collabKey!);

                const isLargeFile = file.file_size > 128 * 1024 * 1024;
                const token = localStorage.getItem('nest_token');

                if (isLargeFile && token && fileInfo.chunks?.length > 0) {
                    const downloadChunks = fileInfo.chunks.map((c: any) => ({
                        index: c.index,
                        size: c.size,
                        nonce: c.nonce,
                        jackal_merkle: c.jackal_merkle,
                        status: (c.jackal_merkle && c.jackal_merkle !== 'pending') ? 'cloud' : 'local'
                    }));

                    const { StreamingDownloader } = await import('../utils/StreamingDownloader');
                    await StreamingDownloader.download({
                        fileKey,
                        filename: file.filename,
                        chunks: downloadChunks,
                        fileId: file.id,
                        authToken: token,
                        collabToken,
                        onProgress: (p) => updateProgress(downloadId, p)
                    });

                    completeUpload(downloadId);
                    return;
                }

                // Fallback monolithic download
                const contentResponse = await api.get(`/collab/${collabToken}/files/${file.id}/raw`, {
                    responseType: 'blob',
                    onDownloadProgress: (progressEvent) => {
                        const total = progressEvent.total || file.file_size;
                        const percent = (progressEvent.loaded / total) * 100;
                        updateProgress(downloadId, percent * 0.9);
                    }
                });
                const encryptedBlob = contentResponse.data;
                const decryptedBytes = await decryptFile(encryptedBlob, fileKeyNonce, fileKey);

                const blob = new Blob([decryptedBytes as unknown as BlobPart], { type: file.mime_type });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);

                completeUpload(downloadId);
            } catch (error: any) {
                console.error('Collab download failed:', error);
                failUpload(downloadId, error.message || 'Download failed');
            }
            return;
        }

        if (isDropZoneFile) {
            const downloadId = addDownload(file.filename, file.file_size);
            try {
                const { decryptDropZoneFile, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
                await init();

                const dz = dropZones.find((d: any) => d.folderId === file.folderId);
                if (!dz || !dz.privateKey) {
                    throw new Error('Drop Zone private key not found');
                }

                const contentResponse = await api.get(`/files/raw/${file.id}`, {
                    responseType: 'blob',
                    onDownloadProgress: (progressEvent) => {
                        const total = progressEvent.total || file.file_size;
                        const percent = (progressEvent.loaded / total) * 100;
                        updateProgress(downloadId, percent * 0.9);
                    }
                });
                const encryptedBlob = contentResponse.data;

                const downloadInfo = await api.get(`/files/download/${file.id}`);
                const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
                const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);

                const encryptedBlobBytes = new Uint8Array(await encryptedBlob.arrayBuffer());
                const decryptedBytes = decryptDropZoneFile(
                    encryptedBlobBytes,
                    fileKeyEncrypted,
                    fileKeyNonce,
                    dz.privateKey
                );

                const blob = new Blob([decryptedBytes as any], { type: file.mime_type });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);

                completeUpload(downloadId);
            } catch (error: any) {
                console.error('Drop Zone download failed:', error);
                failUpload(downloadId, error.message || 'Download failed');
            }
            return;
        }

        if (!masterKey) {
            showToast('Please log in again to download files', 'error');
            return;
        }

        const downloadId = addDownload(file.filename, file.file_size);
        let fakeProgress = 0;
        let fakeProgressInterval: NodeJS.Timeout | undefined;

        try {
            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, decryptFile, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();

            // Start Feedback Fake Progress (0-5%)
            fakeProgressInterval = setInterval(() => {
                if (fakeProgress < 5) {
                    fakeProgress += 0.5;
                    updateProgress(downloadId, fakeProgress);
                }
            }, 200);

            // 1. Fetch encrypted keys and file metadata from server
            const downloadInfo = await api.get(`/files/download/${file.id}`);

            // 2. Decrypt Keys (moved up to support StreamingDownloader)
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            // NEW: Use StreamingDownloader for chunked files (universal via StreamSaver.js)
            const isLargeFile = file.file_size > 128 * 1024 * 1024;
            const token = localStorage.getItem('nest_token');

            if (isLargeFile && token && downloadInfo.data.chunks?.length > 0) {
                // Map chunks to DownloadChunk format
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
                    authToken: token,
                    onProgress: (p) => {
                        clearInterval(fakeProgressInterval);
                        updateProgress(downloadId, Math.max(5, p));
                    }
                });

                clearInterval(fakeProgressInterval);
                completeUpload(downloadId);
                return;
            }

            // FALLBACK: Legacy Blob Download (for monolithic/small files)

            // 3. Fetch Raw Encrypted Content
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

            clearInterval(fakeProgressInterval);
            completeUpload(downloadId);

        } catch (error: any) {
            console.error('Download failed:', error);
            if (fakeProgressInterval) clearInterval(fakeProgressInterval);
            failUpload(downloadId, error.message || 'Download failed');
        }
    };

    const handleDeleteFile = async (fileId: number) => {
        if (collabToken) {
            try {
                await api.delete(`/collab/${collabToken}/files/${fileId}`);
                showToast('File deleted successfully', 'success');
                triggerFileRefresh();
            } catch (error: any) {
                console.error('Delete failed:', error);
                showToast('Failed to delete file', 'error');
            }
            return;
        }

        try {
            await filesAPI.delete(fileId);
            refreshQuota();
            triggerFileRefresh();
        } catch (error) {
            console.error('Delete failed:', error);
            throw error;
        }
    };

    const handleRename = async (fileId: number, newName: string) => {
        if (collabToken) {
            if (!collabKey) return;
            try {
                const { encryptWithMasterKey, toBase64, init } = await import('@lazybird-inc/nest-crypto');
                await init();

                const encryptSymmetricMetadata = (text: string, key: Uint8Array): string => {
                    const { encrypted, nonce } = encryptWithMasterKey(text, key);
                    return JSON.stringify({
                        encrypted: toBase64(encrypted),
                        nonce: toBase64(nonce)
                    });
                };

                const newNameEncrypted = encryptSymmetricMetadata(newName, collabKey);
                await api.patch(`/collab/${collabToken}/files/${fileId}`, {
                    new_filename_encrypted: newNameEncrypted
                });

                showToast('File renamed', 'success');
                triggerFileRefresh();
            } catch (error) {
                console.error('Rename failed:', error);
                showToast('Failed to rename file', 'error');
            }
            return;
        }

        if (!metadata || !masterKey) {
            showToast('Authentication required to rename files', 'error');
            return;
        }
        try {
            const updatedMetadata = JSON.parse(JSON.stringify(metadata));
            let finalName = newName;

            // Fix: Auto-append extension if user removed it
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
            triggerFileRefresh(); // Trigger refresh for other components
            showToast('File renamed', 'success');
        } catch (error) {
            console.error('Rename failed:', error);
            showToast('Failed to rename file', 'error');
        }
    };

    const handleMove = async (fileId: number, targetFolderId: number | null) => {
        if (collabToken) {
            showToast('Moving files is disabled for collaborative folders', 'warning');
            return;
        }
        if (!metadata || !masterKey) {
            showToast('Authentication required to move files', 'error');
            return;
        }

        try {
            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, encryptFileKey, toBase64, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();

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
        if (collabToken) {
            if (selectedFolderId === null || selectedFolderId === collabRootId) return [];
            const path: { id: number; name: string }[] = [];
            let currentId: number | null = selectedFolderId;
            let attempts = 0;

            while (currentId !== null && currentId !== collabRootId && attempts < 20) {
                const folder = rawCollabFolders.find(f => f.id === currentId);
                const name = folder && collabKey
                    ? decryptSymmetricMetadata(folder.encrypted_folder_name, collabKey)
                    : `Folder ${currentId}`;
                
                path.unshift({ id: currentId, name });
                currentId = folder ? folder.parent_id : null;
                attempts++;
            }
            return path;
        }

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
        // We only hide the root folder from the breadcrumb if it is the primary root
        // (synonymous with Home). Other roots (like Drop Zones) should be visible.
        if (path.length > 0) {
            const firstId = path[0].id;
            const parentId = structureMap.get(firstId);
            if (parentId === null && firstId === primaryRootId) {
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

                <div
                    className="flex-1 glass-panel overflow-hidden p-0 relative"
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onFileDrop}
                >
                    {/* Drag overlay */}
                    <AnimatePresence>
                        {isDragging && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="absolute inset-0 z-30 bg-primary/10 backdrop-blur-[2px] border-2 border-dashed border-primary rounded-xl flex flex-col items-center justify-center pointer-events-none"
                            >
                                <svg className="w-12 h-12 text-primary mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                <p className="text-primary font-bold text-lg">Drop to upload</p>
                                <p className="text-primary/70 text-sm mt-1">Release to start upload</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
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
                                        isDropZone: dropZones.some((dz: any) => dz.folderId === folder.id),
                                        isCollab: rawCollabFolders.some((cf: any) => cf.folderId === folder.id) || hostCollabFolders.some((cf: any) => cf.folder_id === folder.id),
                                        onNavigate: () => handleNavigate(folder.id),
                                        onRename: collabToken ? async (newName: string) => {
                                            if (!collabKey) return;
                                            try {
                                                const { encryptWithMasterKey, toBase64, init } = await import('@lazybird-inc/nest-crypto');
                                                await init();
                                                const encryptSymmetricMetadata = (text: string, key: Uint8Array): string => {
                                                    const { encrypted, nonce } = encryptWithMasterKey(text, key);
                                                    return JSON.stringify({
                                                        encrypted: toBase64(encrypted),
                                                        nonce: toBase64(nonce)
                                                    });
                                                };
                                                const newNameEncrypted = encryptSymmetricMetadata(newName, collabKey);
                                                await api.patch(`/collab/${collabToken}/folders/${folder.id}`, {
                                                    new_foldername_encrypted: newNameEncrypted
                                                });
                                                showToast('Folder renamed', 'success');
                                                triggerFileRefresh();
                                            } catch (err) {
                                                console.error('Rename folder failed:', err);
                                                showToast('Failed to rename folder', 'error');
                                            }
                                        } : undefined,
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
                                        onRename: (newName: string) => handleRename(file.id, newName),
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
