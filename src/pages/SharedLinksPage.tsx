import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    ShareNetwork,
    Copy,
    Trash,
    Image,
    FilePdf,
    FileText,
    FileArchive,
    File as FileIcon,
    Video,
    CheckCircle,
    MagnifyingGlass,
    SortAscending
} from '@phosphor-icons/react';
import { filesAPI } from '../api/files';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { RevokeConfirmationModal } from '../components/RevokeConfirmationModal';
import api from '../lib/api';
import { useQuotaCheck } from '../components/QuotaBanner';

interface SharedFile {
    id: number;
    filename: string;
    share_token: string;
    created_at: string;
    file_size: number;
    mime_type?: string;
}

export const SharedLinksPage = () => {
    const { showToast } = useToast();
    const { metadata, masterKey } = useAuth();
    const { isOverQuota } = useQuotaCheck();
    const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
    const [filteredFiles, setFilteredFiles] = useState<SharedFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');
    const [revokeModal, setRevokeModal] = useState<{ isOpen: boolean; file: SharedFile | null }>({ isOpen: false, file: null });
    const [bulkRevokeModal, setBulkRevokeModal] = useState(false);
    const [isRevoking, setIsRevoking] = useState(false);

    const loadSharedFiles = async () => {
        try {
            const response = await filesAPI.list();
            const shared = (response.files || []).filter((f: any) => f.share_token);

            // Merge with metadata if available
            const merged = shared.map((f: any) => {
                const meta = metadata?.files[f.id.toString()];
                return {
                    ...f,
                    filename: meta?.filename || f.filename || `File ${f.id}`,
                    mime_type: meta?.mime_type || f.mime_type
                };
            });

            setSharedFiles(merged as SharedFile[]);
            setFilteredFiles(merged as SharedFile[]);
        } catch (error) {
            console.error('Failed to load shared files:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSharedFiles();
    }, [metadata]); // Reload when metadata is available/updates

    useEffect(() => {
        let filtered = [...sharedFiles];

        // Apply search
        if (searchQuery) {
            filtered = filtered.filter(f =>
                f.filename.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        // Apply sort
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return a.filename.localeCompare(b.filename);
                case 'size':
                    return b.file_size - a.file_size;
                case 'date':
                default:
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            }
        });

        setFilteredFiles(filtered);
    }, [searchQuery, sortBy, sharedFiles]);

    const copyLink = async (file: SharedFile) => {
        try {
            if (isOverQuota) {
                showToast('Storage quota exceeded. Link generation disabled.', 'error');
                return;
            }

            if (!masterKey) {
                showToast('Please log in again to copy links', 'error');
                return;
            }

            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, toBase64, fromBase64 } = await import('../crypto/v2');

            // 1. Get encrypted keys
            const downloadInfo = await api.get(`/files/download/${file.id}`);
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            // 2. Decrypt folder key
            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);

            // 3. Decrypt file key
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            // 4. Build URL
            const fileKeyBase64 = toBase64(fileKey);
            const origin = window.location.origin.trim();
            const token = file.share_token.trim();

            // Get proper filename/mime from metadata or file object
            const meta = metadata?.files[file.id.toString()];
            const filename = meta?.filename || file.filename || 'file';
            const mimeType = meta?.mime_type || file.mime_type || 'application/octet-stream';

            const shareUrl = `${origin}/s/${token}#key=${encodeURIComponent(fileKeyBase64)}&name=${encodeURIComponent(filename)}&mime=${encodeURIComponent(mimeType)}`;

            navigator.clipboard.writeText(shareUrl);
            setCopiedId(file.id);
            setTimeout(() => setCopiedId(null), 2000);
            showToast('Link copied to clipboard', 'success');
        } catch (error) {
            console.error('Failed to copy link:', error);
            showToast('Failed to generate link', 'error');
        }
    };

    const revokeLink = (file: SharedFile) => {
        setRevokeModal({ isOpen: true, file });
    };

    const handleRevokeConfirm = async () => {
        if (!revokeModal.file) return;

        setIsRevoking(true);
        try {
            await filesAPI.revokeShare(revokeModal.file.id);
            showToast('Share link revoked successfully!', 'success');
            setRevokeModal({ isOpen: false, file: null });
            loadSharedFiles(); // Refresh list
        } catch (error) {
            console.error('Revoke failed:', error);
            showToast('Failed to revoke share link', 'error');
        } finally {
            setIsRevoking(false);
        }
    };

    const toggleSelection = (fileId: number) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(fileId)) {
            newSelected.delete(fileId);
        } else {
            newSelected.add(fileId);
        }
        setSelectedIds(newSelected);
    };

    const selectAll = () => {
        if (selectedIds.size === filteredFiles.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredFiles.map(f => f.id)));
        }
    };

    const revokeSelected = () => {
        if (selectedIds.size === 0) return;
        setBulkRevokeModal(true);
    };

    const handleBulkRevokeConfirm = async () => {
        if (selectedIds.size === 0) return;

        setIsRevoking(true);
        try {
            // Revoke all selected files
            await Promise.all(
                Array.from(selectedIds).map(id => filesAPI.revokeShare(id))
            );
            showToast(`Successfully revoked ${selectedIds.size} share link(s)!`, 'success');
            setBulkRevokeModal(false);
            setSelectedIds(new Set());
            loadSharedFiles();
        } catch (error) {
            console.error('Bulk revoke failed:', error);
            showToast('Failed to revoke some share links', 'error');
        } finally {
            setIsRevoking(false);
        }
    };

    const getFileIcon = (mimeType?: string) => {
        if (!mimeType) return FileIcon;
        if (mimeType.startsWith('image/')) return Image;
        if (mimeType.startsWith('video/')) return Video;
        if (mimeType === 'application/pdf') return FilePdf;
        if (mimeType.includes('zip') || mimeType.includes('archive')) return FileArchive;
        if (mimeType.startsWith('text/')) return FileText;
        return FileIcon;
    };

    const formatBytes = (bytes: number) => {
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i)) + ' ' + sizes[i];
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 p-4 custom-scrollbar overflow-auto h-full"
        >
            {/* Single File Revoke Confirmation Modal */}
            <RevokeConfirmationModal
                isOpen={revokeModal.isOpen}
                onClose={() => setRevokeModal({ isOpen: false, file: null })}
                onConfirm={handleRevokeConfirm}
                fileName={revokeModal.file?.filename || ''}
                isRevoking={isRevoking}
            />

            {/* Bulk Revoke Confirmation Modal */}
            <RevokeConfirmationModal
                isOpen={bulkRevokeModal}
                onClose={() => setBulkRevokeModal(false)}
                onConfirm={handleBulkRevokeConfirm}
                fileName={`${selectedIds.size} file${selectedIds.size > 1 ? 's' : ''}`}
                isRevoking={isRevoking}
            />

            <div className="mb-4">
                <h1 className="text-xl sm:text-2xl font-bold text-text-main mb-1 sm:mb-2">Shared Links</h1>
                <p className="text-text-muted">Manage files you've shared with others</p>
            </div>

            {loading ? (
                <div className="glass-panel p-8 sm:p-16 text-center">
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-4"
                    />
                    <p className="text-text-muted">Loading shared files...</p>
                </div>
            ) : sharedFiles.length === 0 ? (
                <div className="glass-panel p-8 sm:p-16 text-center group">
                    <motion.div
                        whileHover={{ scale: 1.1, rotate: 5 }}
                        className="w-20 h-20 bg-background/50 rounded-2xl flex items-center justify-center mx-auto mb-6 transition-transform duration-300"
                    >
                        <ShareNetwork size={40} className="text-text-muted group-hover:text-primary transition-colors" weight="duotone" />
                    </motion.div>
                    <h3 className="text-xl font-bold text-text-main mb-2">No active shares</h3>
                    <p className="text-text-muted max-w-sm mx-auto">
                        Files you share via link will appear here. You can manage access and copy links at any time.
                    </p>
                </div>
            ) : (
                <>
                    {/* Search and Sort Controls */}
                    <div className="glass-panel p-3 mb-4 flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 relative">
                            <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" weight="bold" />
                            <input
                                type="text"
                                placeholder="Search files..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-1.5 sm:py-2 bg-white/10 border border-white/20 rounded-lg text-sm text-text-main placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <SortAscending size={18} className="text-text-muted" weight="bold" />
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as any)}
                                className="px-3 py-1.5 sm:py-2 bg-white/10 border border-white/20 rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                            >
                                <option value="date">Sort by Date</option>
                                <option value="name">Sort by Name</option>
                                <option value="size">Sort by Size</option>
                            </select>
                        </div>
                    </div>

                    {/* Bulk Actions Bar */}
                    {selectedIds.size > 0 && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="glass-panel p-3 mb-4 flex items-center justify-between"
                        >
                            <span className="text-sm font-medium text-text-main">
                                {selectedIds.size} selected
                            </span>
                            <div className="flex gap-2">
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={revokeSelected}
                                    className="glass-button px-3 py-1.5 flex items-center gap-2 text-sm text-error hover:bg-error/10"
                                >
                                    <Trash size={16} weight="bold" />
                                    Revoke Selected
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setSelectedIds(new Set())}
                                    className="glass-button px-3 py-1.5 text-sm"
                                >
                                    Clear
                                </motion.button>
                            </div>
                        </motion.div>
                    )}

                    {/* List View */}
                    <div className="glass-panel overflow-hidden">
                        {/* Select All Header */}
                        <div className="px-3 sm:px-5 py-2.5 sm:py-3 border-b border-white/10 bg-white/5 flex items-center gap-3 sm:gap-4">
                            <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === filteredFiles.length && filteredFiles.length > 0}
                                    onChange={selectAll}
                                    className="w-4 h-4 rounded border-white/30 bg-white/10 text-primary cursor-pointer accent-primary hover:border-primary/50 transition-colors"
                                />
                            </div>
                            <span className="text-xs sm:text-sm text-text-muted font-semibold tracking-wide flex-1">
                                SELECT ALL ({filteredFiles.length})
                            </span>
                            <div className="hidden sm:grid grid-cols-[100px_120px_80px] gap-6 text-[10px] font-bold text-text-muted/60 uppercase tracking-widest text-right pr-2">
                                <span>Size</span>
                                <span>Shared Date</span>
                                <span>Status</span>
                            </div>
                            <div className="hidden sm:block w-24"></div> {/* Spacer for actions */}
                        </div>

                        {/* File List */}
                        <div className="divide-y divide-white/10">
                            {filteredFiles.map(file => {
                                const Icon = getFileIcon(file.mime_type);
                                const isSelected = selectedIds.has(file.id);

                                return (
                                    <motion.div
                                        layout
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        whileHover={{ scale: 1.02, backgroundColor: "rgba(255, 255, 255, 0.15)" }}
                                        transition={{ duration: 0.2 }}
                                        key={file.id}
                                        className={`px-3 sm:px-5 py-3 sm:py-4 transition-colors duration-200 flex items-center gap-3 sm:gap-4 group cursor-pointer ${isSelected ? 'bg-white/10' : 'hover:bg-white/5'
                                            } `}
                                        onClick={() => toggleSelection(file.id)}
                                    >
                                        {/* Checkbox */}
                                        <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelection(file.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-4 h-4 rounded border-white/30 bg-white/10 text-primary cursor-pointer accent-primary hover:border-primary/50 transition-colors"
                                            />
                                        </div>

                                        {/* File Icon */}
                                        <div className="w-9 h-9 sm:w-10 sm:h-10 bg-primary/15 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                                            <Icon size={18} className="text-primary" weight="duotone" />
                                        </div>

                                        {/* File Info */}
                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-sm font-semibold text-text-main break-words whitespace-normal leading-snug sm:truncate group-hover:text-primary transition-colors">
                                                {file.filename}
                                            </h3>
                                        </div>

                                        {/* Metadata & Status Grid */}
                                        <div className="hidden sm:grid grid-cols-[100px_120px_80px] gap-6 items-center text-right pr-2">
                                            <span className="text-xs font-medium text-text-muted/80">
                                                {formatBytes(file.file_size)}
                                            </span>
                                            <span className="text-xs text-text-muted/60">{formatDate(file.created_at)}</span>

                                            {/* Status Badge */}
                                            <div className="flex items-center justify-end gap-1.5">
                                                <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shadow-[0_0_8px_rgba(255,255,255,0.6)] animate-pulse"></div>
                                                <span className="text-[11px] font-bold text-text-muted/60 uppercase tracking-tight">Active</span>
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1.5 sm:gap-3 ml-2 sm:ml-4 flex-shrink-0 sm:pl-4 sm:border-l border-white/5">
                                            <motion.button
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.9 }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    copyLink(file);
                                                }}
                                                className={`p-1.5 sm:p-2 rounded-lg transition-all transform active:scale-95 ${copiedId === file.id
                                                    ? 'bg-primary/20 text-primary'
                                                    : isOverQuota
                                                        ? 'opacity-30 cursor-not-allowed grayscale'
                                                        : 'hover:bg-primary/20 text-text-muted hover:text-primary'
                                                    }`}
                                                title={isOverQuota ? 'Quota Exceeded - Sharing Disabled' : 'Copy share link'}
                                            >
                                                {copiedId === file.id ? (
                                                    <>
                                                        <CheckCircle size={16} className="sm:hidden" weight="fill" />
                                                        <CheckCircle size={18} className="hidden sm:block" weight="fill" />
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy size={16} className="sm:hidden" weight="bold" />
                                                        <Copy size={18} className="hidden sm:block" weight="bold" />
                                                    </>
                                                )}
                                            </motion.button>
                                            <motion.button
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.9 }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    revokeLink(file);
                                                }}
                                                className="p-1.5 sm:p-2 hover:bg-red-500/20 text-text-muted hover:text-error rounded-lg transition-all transform active:scale-95"
                                                title="Revoke link"
                                            >
                                                <Trash size={16} className="sm:hidden" weight="bold" />
                                                <Trash size={18} className="hidden sm:block" weight="bold" />
                                            </motion.button>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>

                    {filteredFiles.length === 0 && searchQuery && (
                        <div className="glass-panel p-5 sm:p-8 text-center mt-4">
                            <p className="text-text-muted">No files match "{searchQuery}"</p>
                        </div>
                    )}
                </>
            )}
        </motion.div>
    );
};
