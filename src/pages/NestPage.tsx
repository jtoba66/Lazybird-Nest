import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { RecentActivityFeed } from '../components/RecentActivityFeed';
import { filesAPI } from '../api/files';
import { useRefresh } from '../contexts/RefreshContext';
import { useAuth } from '../contexts/AuthContext';
import { ShareSuccessModal } from '../components/ShareSuccessModal';
import { PageLoader } from '../components/PageLoader';
import { useFileCryptoActions } from '../hooks/useFileCryptoActions';
import api from '../lib/api';

export interface FileItem {
    id: number;
    filename: string;
    mime_type: string;
    file_size: number;
    created_at: string;
    share_token: string | null;
    upload_session_id: string | null;
    folder_id: number | null;
}

import { useUpload } from '../contexts/UploadContext';

export const NestPage = () => {
    const { addUpload } = useUpload();
    const { fileListVersion } = useRefresh();
    const { metadata, checkMetadataVersion, masterKey } = useAuth();
    const [dropZones, setDropZones] = useState<any[]>([]);
    // Collab keys for collab folders this host owns (keyed by folder_id), so collaborator-uploaded
    // files in the "all files" feed show their real names instead of "File <id>".
    const [hostCollabKeys, setHostCollabKeys] = useState<Record<number, Uint8Array>>({});
    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Pagination state
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const LIMIT = 50;

    // Search and Sort State
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [sortBy, setSortBy] = useState('date');
    const [order, setOrder] = useState('desc');

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        if (!masterKey) return;
        const loadDropZones = async () => {
            try {
                const res = await api.get('/drop-zones');
                if (res.data && res.data.success) {
                    const { decryptDropPrivateKey, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
                    await init();
                    const sodium = (await import('libsodium-wrappers')).default;
                    await sodium.ready;

                    const decryptedDZs = res.data.drop_zones.map((dz: any) => {
                        try {
                            const privateKey = decryptDropPrivateKey(
                                fromBase64(dz.encrypted_private_key),
                                fromBase64(dz.private_key_nonce),
                                masterKey
                            );
                            const publicKey = sodium.crypto_scalarmult_base(privateKey);
                            return { ...dz, privateKey, publicKey };
                        } catch (err) {
                            return dz;
                        }
                    });
                    setDropZones(decryptedDZs);
                }
            } catch (err) {
                console.error('Failed to load drop zones:', err);
            }
        };
        loadDropZones();
    }, [masterKey]);

    // Recover collab keys for collab folders this host owns (host_encrypted_collab_key is sealed to
    // the host's master key), so collaborator-uploaded files decrypt in the all-files feed.
    useEffect(() => {
        if (!masterKey) return;
        let cancelled = false;
        const loadCollabKeys = async () => {
            try {
                const sharesRes = await api.get('/shares');
                const collabShares = (sharesRes.data?.shares || []).filter((s: any) => s.type === 'collab_folder');
                if (collabShares.length === 0) return;
                const { decryptCollabKey, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
                await init();
                const keyMap: Record<number, Uint8Array> = {};
                for (const cf of collabShares) {
                    if (!cf.id || !cf.folder_id) continue;
                    try {
                        const res = await api.get(`/collab-folders/${cf.id}/host-key`);
                        if (res.data?.success) {
                            keyMap[cf.folder_id] = decryptCollabKey(
                                fromBase64(res.data.host_encrypted_collab_key),
                                fromBase64(res.data.host_collab_key_nonce),
                                masterKey
                            );
                        }
                    } catch (e) {
                        console.error(`Failed to load host collab key for folder ${cf.folder_id}:`, e);
                    }
                }
                if (!cancelled) setHostCollabKeys(keyMap);
            } catch (e) {
                console.error('Failed to load collab keys for feed:', e);
            }
        };
        loadCollabKeys();
        return () => { cancelled = true; };
    }, [masterKey]);

    const loadFiles = async (reset = false) => {
        if (reset) {
            setLoading(true);
            setOffset(0);
        }
        try {
            const currentOffset = reset ? 0 : offset;
            let filesRes;

            const isClientQuery = debouncedSearch !== '' || sortBy === 'type' || sortBy === 'filename';

            if (isClientQuery) {
                const pageIds = matchedIds.slice(currentOffset, currentOffset + LIMIT);
                filesRes = await filesAPI.queryFiles(pageIds);
                // We must re-order the returned files to match the pageIds array
                const fileMap = new Map(filesRes.files.map((f: any) => [f.id, f]));
                filesRes.files = pageIds.map(id => fileMap.get(id)).filter(Boolean);
            } else {
                filesRes = await filesAPI.getRecent(LIMIT, currentOffset, sortBy, order);
            }

            if (filesRes.metadataVersion) {
                checkMetadataVersion(filesRes.metadataVersion);
            }

            const mergedFiles = await Promise.all((filesRes.files || []).map(async (svrFile: any) => {
                let filename = svrFile.filename || `File ${svrFile.id}`;
                let mimeType = svrFile.mime_type;

                const meta = metadata?.files[svrFile.id.toString()];
                if (meta) {
                    filename = meta.filename;
                    mimeType = meta.mime_type;
                } else if (svrFile.file_origin === 'drop_zone' && svrFile.encrypted_filename) {
                    const dz = dropZones.find((d: any) => d.folderId === svrFile.folder_id);
                    if (dz && dz.privateKey && dz.publicKey) {
                        try {
                            const { fromBase64 } = await import('@lazybird-inc/nest-crypto');
                            const sodium = (await import('libsodium-wrappers')).default;
                            await sodium.ready;

                            const encryptedBytes = fromBase64(svrFile.encrypted_filename);
                            const decryptedBytes = sodium.crypto_box_seal_open(encryptedBytes as any, dz.publicKey as any, dz.privateKey as any);
                            filename = sodium.to_string(decryptedBytes as any);

                            if (svrFile.encrypted_mime_type) {
                                const encMimeBytes = fromBase64(svrFile.encrypted_mime_type);
                                const decMimeBytes = sodium.crypto_box_seal_open(encMimeBytes as any, dz.publicKey as any, dz.privateKey as any);
                                mimeType = sodium.to_string(decMimeBytes as any);
                            }
                        } catch (e) {
                            console.error('Failed to decrypt Drop Zone file metadata in feed:', e);
                            filename = 'Decryption Error';
                        }
                    }
                } else if (svrFile.file_origin === 'collab' && svrFile.encrypted_filename && hostCollabKeys[svrFile.folder_id]) {
                    // Collaborator-uploaded file: name/type are symmetrically encrypted with the
                    // collab key we recovered for folders this host owns.
                    try {
                        const { decryptWithMasterKey, fromBase64 } = await import('@lazybird-inc/nest-crypto');
                        const ck = hostCollabKeys[svrFile.folder_id];
                        const decMeta = (jsonStr: string) => {
                            const { encrypted, nonce } = JSON.parse(jsonStr);
                            return new TextDecoder().decode(decryptWithMasterKey(fromBase64(encrypted), fromBase64(nonce), ck));
                        };
                        filename = decMeta(svrFile.encrypted_filename);
                        if (svrFile.encrypted_mime_type) mimeType = decMeta(svrFile.encrypted_mime_type);
                    } catch (e) {
                        console.error('Failed to decrypt collab file metadata in feed:', e);
                    }
                }

                return {
                    ...svrFile,
                    filename,
                    mime_type: mimeType
                };
            }));
            
            if (reset) {
                setFiles(mergedFiles);
            } else {
                setFiles(prev => [...prev, ...mergedFiles]);
            }
            
            const fetchedCount = (filesRes.files || []).length;
            setHasMore(isClientQuery ? currentOffset + LIMIT < matchedIds.length : fetchedCount === LIMIT);
            
            if (!reset) {
                setOffset(currentOffset + LIMIT);
            } else if (fetchedCount === LIMIT) {
                setOffset(LIMIT);
            }

        } catch (error) {
            console.error('Failed to load files:', error);
            if (reset) setFiles([]);
        } finally {
            setLoading(false);
        }
    };

    const { handleShare, handleDownload, handleDelete, handleMove, handleRename, shareModal, setShareModal } = useFileCryptoActions(() => {
        loadFiles(true);
    });

    const matchedIds = useMemo(() => {
        if (!metadata) return [];
        let allFiles = Object.entries(metadata.files).map(([id, m]: [string, any]) => ({ id: Number(id), ...m }));

        if (debouncedSearch) {
            const lowerQuery = debouncedSearch.toLowerCase();
            allFiles = allFiles.filter(f => f.filename?.toLowerCase().includes(lowerQuery));
        }

        if (sortBy === 'type') {
            allFiles.sort((a, b) => {
                const cmp = (a.mime_type || '').localeCompare(b.mime_type || '');
                return order === 'asc' ? cmp : -cmp;
            });
        } else if (sortBy === 'filename') {
             allFiles.sort((a, b) => {
                const cmp = (a.filename || '').localeCompare(b.filename || '');
                return order === 'asc' ? cmp : -cmp;
            });
        }

        return allFiles.map(f => f.id);
    }, [metadata, debouncedSearch, sortBy, order]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const sessionId = crypto.randomUUID();
            Array.from(e.target.files).forEach(file => {
                addUpload(file, undefined, undefined, undefined, sessionId);
            });
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
            const sessionId = crypto.randomUUID();
            Array.from(e.dataTransfer.files).forEach(file => {
                addUpload(file, undefined, undefined, undefined, sessionId);
            });
        }
    };





    const handleLoadMore = () => {
        if (!loading && hasMore) {
            loadFiles();
        }
    };

    useEffect(() => {
        loadFiles(true);
    }, [fileListVersion]);

    const metadataReady = metadata !== null;
    useEffect(() => {
        if (metadataReady) loadFiles(true);
    }, [metadataReady, debouncedSearch, sortBy, order, dropZones, hostCollabKeys]);

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

            <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {/* Header and Toolbar */}
                <div className="mb-4 glass-panel p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-bold text-text-main">Nest</h1>
                        <p className="text-sm text-text-muted">All your uploaded files in one place</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search files..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-4 py-2 bg-background/50 border border-border/50 rounded-lg text-sm text-text-main placeholder-text-muted focus:outline-none focus:border-primary w-48 sm:w-64"
                            />
                            <svg className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="bg-background/50 border border-border/50 rounded-lg px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary"
                        >
                            <option value="date">Date Added</option>
                            <option value="filename">Name</option>
                            <option value="size">Size</option>
                            <option value="type">Type</option>
                        </select>
                        <button
                            onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
                            className="p-2 bg-background/50 border border-border/50 rounded-lg text-text-muted hover:text-text-main focus:outline-none focus:border-primary"
                            title={order === 'desc' ? 'Descending' : 'Ascending'}
                        >
                            {order === 'desc' ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>

                {/* Content List */}
                <div
                    className="flex-1 glass-panel overflow-hidden min-h-0 p-0 relative"
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                >
                    {/* Drag overlay — visible when dragging over populated list */}
                    <AnimatePresence>
                        {isDragging && files.length > 0 && (
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
                        <PageLoader />
                    ) : files.length === 0 ? (
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            className={`h-full flex flex-col items-center justify-center text-center p-6 sm:p-12 transition-all cursor-pointer group ${isDragging ? 'bg-primary/20 border-2 border-dashed border-primary scale-[0.98]' : 'hover:bg-background/40'
                                }`}
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
                            <RecentActivityFeed
                                files={files}
                                onDownload={handleDownload}
                                onShare={handleShare}
                                onRename={handleRename}
                                onMove={handleMove}
                                onDelete={handleDelete}
                                onLoadMore={handleLoadMore}
                                hasMore={hasMore}
                            />
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};
