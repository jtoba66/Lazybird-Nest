import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import QRCode from 'react-qr-code';
import { Folder, Lock, Copy, Trash, QrCode, DownloadSimple, ShareNetwork, Users, MagnifyingGlass, GearSix, ArrowCircleDown, ArrowCircleUp, File as FileIcon } from '@phosphor-icons/react';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useRefresh } from '../contexts/RefreshContext';
import { useStorage } from '../contexts/StorageContext';
import { Modal } from '../components/Modal';
import { CreateDropZoneModal } from '../components/share/CreateDropZoneModal';
import { CreateCollabFolderModal } from '../components/share/CreateCollabFolderModal';
import { ShareSettingsModal } from '../components/share/ShareSettingsModal';

import api from '../lib/api';
import { deriveStandardLinkUrl } from '../utils/shareUrl';
import { foldersAPI } from '../api/folders';
import clsx from 'clsx';
import nestLogo from '../assets/nest-logo.png';

interface ShareItem {
    id: number;
    type: 'standard_link' | 'drop_zone' | 'collab_folder';
    token: string;
    name?: string;
    custom_slug: string | null;
    size?: number;
    files_received?: number;
    has_password?: boolean;
    strict_mode?: boolean;
    expires_at: string | null;
    max_downloads?: number | null;
    views: number;
    downloads: number;
    status: string;
    created_at: string;
    collaborators?: string[];
    folder_id?: number;
}

const getEmailColor = (email: string) => {
    const colors = [
        'bg-blue-500/20 text-blue-500 border border-blue-500/30',
        'bg-purple-500/20 text-purple-500 border border-purple-500/30',
        'bg-pink-500/20 text-pink-500 border border-pink-500/30',
        'bg-indigo-500/20 text-indigo-500 border border-indigo-500/30',
        'bg-teal-500/20 text-teal-500 border border-teal-500/30',
        'bg-orange-500/20 text-orange-500 border border-orange-500/30',
        'bg-cyan-500/20 text-cyan-500 border border-cyan-500/30',
        'bg-rose-500/20 text-rose-500 border border-rose-500/30',
    ];
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
        hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
};

function formatBytes(bytes?: number): string {
    if (bytes === undefined || bytes === null) return '-';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const SharedLinksPage = () => {
    const { showToast } = useToast();
    const { metadata, saveMetadata, masterKey } = useAuth();
    const qrRef = useRef<HTMLDivElement>(null);
    const { refreshQuota } = useStorage();
    const { fileListVersion, triggerFileRefresh } = useRefresh();

    const [shares, setShares] = useState<ShareItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<string>('all');
    const [sortBy, setSortBy] = useState<string>('newest');
    
    // Checkbox multi-select state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Modals state
    const [showCreateDz, setShowCreateDz] = useState(false);
    const [showCreateCollab, setShowCreateCollab] = useState(false);
    const [settingsModal, setSettingsModal] = useState<{ isOpen: boolean; share: ShareItem | null }>({ isOpen: false, share: null });
    const [qrModal, setQrModal] = useState<{ isOpen: boolean; share: ShareItem | null }>({ isOpen: false, share: null });
    // The QR must encode the SAME complete URL as the copy button — for standard
    // links that means re-deriving the #key fragment, not the keyless base URL.
    const [qrUrl, setQrUrl] = useState<string | null>(null);
    const [qrDeriving, setQrDeriving] = useState(false);
    const [revokeConfirm, setRevokeConfirm] = useState<{ isOpen: boolean; sharesToRevoke: ShareItem[] }>({ isOpen: false, sharesToRevoke: [] });

    // Loading indicators inside modals
    const [submitting, setSubmitting] = useState(false);

    // ============================================================================
    // LOAD SHARES LIST
    // ============================================================================
    const loadShares = async () => {
        try {
            setLoading(true);
            const res = await api.get('/shares');
            if (res.data && res.data.success) {
                // Merge name from ZK metadata for standard links
                const merged: ShareItem[] = (res.data.shares || []).map((share: any) => {
                    if (share.type === 'standard_link' && metadata) {
                        const fileMeta = metadata.files[share.id.toString()];
                        return {
                            ...share,
                            name: fileMeta?.filename || `File ${share.id}`
                        };
                    }
                    return share;
                });
                setShares(merged);
            }
        } catch (error) {
            console.error('Failed to load shares list:', error);
            showToast('Failed to retrieve shares list', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadShares();
    }, [metadata, fileListVersion]);

    // ============================================================================
    // CREATE FOLDER HELPER (Standard ZK Folder creation)
    // ============================================================================
    const createZKFolder = async (folderName: string): Promise<number> => {
        if (!masterKey || !metadata) throw new Error('Auth components missing');
        const { generateFolderKey, encryptFolderKey, toBase64, init } = await import('@lazybird-inc/nest-crypto');
        await init();

        const folderKey = generateFolderKey();
        const { encrypted, nonce } = encryptFolderKey(folderKey, masterKey);

        const res = await foldersAPI.create(
            toBase64(encrypted),
            toBase64(nonce),
            folderName
        );
        const newId = res.folder_id;

        // Update local metadata
        const newMeta = JSON.parse(JSON.stringify(metadata));
        newMeta.folders[newId.toString()] = {
            name: folderName,
            created_at: new Date().toISOString()
        };
        await saveMetadata(newMeta);

        return newId;
    };

    // ============================================================================
    // REVOKE ACTION (Single & Bulk)
    // ============================================================================
    const handleRevoke = async () => {
        setSubmitting(true);
        try {
            for (const item of revokeConfirm.sharesToRevoke) {
                if (item.type === 'standard_link') {
                    await api.delete(`/files/${item.id}/share`);
                } else if (item.type === 'drop_zone') {
                    await api.delete(`/drop-zones/${item.id}`);
                } else if (item.type === 'collab_folder') {
                    await api.delete(`/collab-folders/${item.id}`);
                }
            }
            showToast('Selected share links successfully revoked.', 'success');
            setSelectedIds(new Set());
            triggerFileRefresh();
            setRevokeConfirm({ isOpen: false, sharesToRevoke: [] });
            refreshQuota();
        } catch (error) {
            console.error('Revocation failed:', error);
            showToast('Failed to revoke some shares.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    // ============================================================================
    // COPY URL LINK
    // ============================================================================
    const handleCopy = async (item: ShareItem) => {
        let url = '';
        if (item.type === 'standard_link') {
            // The decryption key lives only in the #key fragment; re-derive it client-side.
            try {
                url = await deriveStandardLinkUrl(item, masterKey, metadata);
            } catch (e) {
                console.error('Failed to reconstruct standard share URL:', e);
                showToast('Failed to decrypt standard share link. Missing keys or corrupted metadata.', 'error', 6000);
                return;
            }
        } else if (item.type === 'drop_zone') {
            url = `${window.location.origin}/dz/${item.custom_slug || item.token}`;
        } else if (item.type === 'collab_folder') {
            // Collab folders require the lk (linkKey) fragment which is not stored in DB.
            // We alert the user that they must copy the URL generated during creation, or they can re-generate the link key from settings.
            // However, in this UI, if the user didn't save the link key, they will need to generate a new link key or settings updates.
            // Let's check if the collab token can be copied without lk for standard otp authentication if host allows it.
            // Actually, collab link key is required in fragment to decrypt the collab key.
            // So if they copy from here, we will look up the token. If they lost the linkKey, we prompt them.
            // In our implementation, since the server doesn't have the link key, they need it.
            // To make it friendly, we will retrieve/store it or prompt.
            // Let's check: if we cannot copy, we show a toast warning or allow copying the base URL.
            url = `${window.location.origin}/collab/${item.custom_slug || item.token}`;
            showToast('Collab folders require the collaboration key to decrypt. Re-generate a link key in settings if lost.', 'warning', 6000);
        }

        if (url) {
            try {
                await navigator.clipboard.writeText(url);
                showToast('Link copied to clipboard!', 'success');
            } catch {
                showToast('Failed to copy link', 'error');
            }
        }
    };

    // Build the QR URL whenever the list QR modal opens. Standard links must carry
    // the re-derived #key fragment (same as the copy button); drop zones need none.
    useEffect(() => {
        let cancelled = false;
        setQrUrl(null);
        const share = qrModal.share;
        if (!qrModal.isOpen || !share) { setQrDeriving(false); return; }
        if (share.type === 'drop_zone') {
            setQrUrl(`${window.location.origin}/dz/${share.custom_slug || share.token}`);
            setQrDeriving(false);
            return;
        }
        // standard_link (collab folders have no list QR button)
        setQrDeriving(true);
        (async () => {
            try {
                const url = await deriveStandardLinkUrl(share, masterKey, metadata);
                if (!cancelled) setQrUrl(url);
            } catch (e) {
                console.error('Failed to build QR share URL:', e);
            } finally {
                if (!cancelled) setQrDeriving(false);
            }
        })();
        return () => { cancelled = true; };
    }, [qrModal, masterKey, metadata]);

    // ============================================================================
    // SELECTION LOGIC
    // ============================================================================
    const handleSelectRow = (type: string, id: number) => {
        const key = `${type}_${id}`;
        const next = new Set(selectedIds);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        setSelectedIds(next);
    };

    const handleSelectAll = (visibleItems: ShareItem[]) => {
        if (selectedIds.size === visibleItems.length) {
            setSelectedIds(new Set());
        } else {
            const next = new Set<string>();
            visibleItems.forEach(item => next.add(`${item.type}_${item.id}`));
            setSelectedIds(next);
        }
    };

    const getSelectedShares = (): ShareItem[] => {
        return shares.filter(item => selectedIds.has(`${item.type}_${item.id}`));
    };

    // ============================================================================
    // FILTER & SORT LOGIC
    // ============================================================================
    const getVisibleShares = (): ShareItem[] => {
        let result = [...shares];

        // Search Query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(item => 
                (item.name || '').toLowerCase().includes(query) ||
                (item.custom_slug || '').toLowerCase().includes(query) ||
                item.token.toLowerCase().includes(query)
            );
        }

        // Filtering
        if (filterType === 'standard') {
            result = result.filter(item => item.type === 'standard_link');
        } else if (filterType === 'dropzone') {
            result = result.filter(item => item.type === 'drop_zone');
        } else if (filterType === 'collab') {
            result = result.filter(item => item.type === 'collab_folder');
        } else if (filterType === 'ghost') {
            result = result.filter(item => item.type === 'standard_link' && item.max_downloads === 1);
        } else if (filterType === 'expiring') {
            // Expiring within the next 24h — must still be in the future, otherwise
            // already-expired links (negative diff) would also match.
            result = result.filter(item => {
                if (item.expires_at === null) return false;
                const msUntilExpiry = new Date(item.expires_at).getTime() - Date.now();
                return msUntilExpiry > 0 && msUntilExpiry < 24 * 60 * 60 * 1000;
            });
        }

        // Sorting
        result.sort((a, b) => {
            if (sortBy === 'oldest') {
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            } else if (sortBy === 'views') {
                return b.views - a.views;
            } else if (sortBy === 'downloads') {
                return b.downloads - a.downloads;
            } else if (sortBy === 'expiry') {
                if (!a.expires_at) return 1;
                if (!b.expires_at) return -1;
                return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
            } else {
                // newest
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            }
        });

        return result;
    };

    const visibleShares = getVisibleShares();

    // Counts for subtitle
    const standardCount = shares.filter(item => item.type === 'standard_link').length;
    const dzCount = shares.filter(item => item.type === 'drop_zone').length;
    const collabCount = shares.filter(item => item.type === 'collab_folder').length;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex-1 flex flex-col min-h-0 w-full"
        >
            {/* Header */}
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-4 rounded-xl">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold tracking-tight text-text-main flex items-center gap-2">
                        <ShareNetwork className="text-primary" />
                        <span>Access & Sharing</span>
                    </h1>
                    <p className="text-xs text-text-muted mt-1 font-medium">
                        {standardCount} active links &middot; {dzCount} drop zones &middot; {collabCount} collab folders
                    </p>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                        onClick={() => setShowCreateCollab(true)}
                        className="glass-button px-3 py-1.5 flex items-center gap-2 text-xs font-semibold"
                    >
                        <Users size={16} weight="bold" />
                        <span>New Collab Folder</span>
                    </button>
                    <button
                        onClick={() => setShowCreateDz(true)}
                        className="glass-button px-3 py-1.5 flex items-center gap-2 text-xs font-semibold bg-primary/20 text-text-main border-primary/30"
                    >
                        <Folder size={16} weight="fill" />
                        <span>Create Drop Zone</span>
                    </button>
                </div>
            </div>

            {/* Controls Bar */}
            <div className="mb-4 flex flex-col md:flex-row gap-3 items-center justify-between glass-panel p-3 rounded-xl">
                <div className="relative w-full md:w-80">
                    <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                        type="text"
                        placeholder="Search sharing items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 text-sm bg-black/5 rounded-xl border border-white/20 focus:outline-none focus:border-primary/50 text-text-main"
                    />
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
                    {/* Bulk actions */}
                    {selectedIds.size > 0 && (
                        <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 p-1.5 rounded-xl animate-in fade-in slide-in-from-right-2 duration-200">
                            <span className="text-xs font-bold text-primary px-2">
                                {selectedIds.size} selected
                            </span>
                            <button
                                onClick={() => setRevokeConfirm({ isOpen: true, sharesToRevoke: getSelectedShares() })}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-error bg-error/10 hover:bg-error/20 rounded-lg transition-colors border border-error/20"
                            >
                                <Trash size={14} />
                                <span>Revoke</span>
                            </button>
                        </div>
                    )}

                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="bg-white/40 border border-white/20 text-text-main rounded-xl px-3 py-2 text-xs font-medium focus:outline-none cursor-pointer"
                    >
                        <option value="all">All Types</option>
                        <option value="standard">Standard Links</option>
                        <option value="dropzone">Drop Zones</option>
                        <option value="collab">Collab Folders</option>
                        <option value="ghost">Ghost Links</option>
                        <option value="expiring">Expiring Soon</option>
                    </select>

                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="bg-white/40 border border-white/20 text-text-main rounded-xl px-3 py-2 text-xs font-medium focus:outline-none cursor-pointer"
                    >
                        <option value="newest">Sort: Newest</option>
                        <option value="oldest">Sort: Oldest</option>
                        <option value="views">Sort: Views</option>
                        <option value="downloads">Sort: Downloads</option>
                        <option value="expiry">Sort: Expiry</option>
                    </select>
                </div>
            </div>

            {/* Main Content List */}
            <div className="flex-1 glass-panel overflow-hidden p-0 relative flex flex-col min-h-0">
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/10 backdrop-blur-[2px]">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                            <p className="text-text-muted text-sm font-medium">Loading sharing activities...</p>
                        </div>
                    </div>
                ) : visibleShares.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                        <ShareNetwork size={48} className="text-text-muted mb-4 opacity-40 animate-pulse" />
                        <p className="text-text-muted font-semibold">No active sharing links found.</p>
                        <p className="text-xs text-text-muted/70 mt-1 max-w-sm">
                            Create standard file links from your File Manager, or launch Drop Zones and Collab Folders here to collaborate securely.
                        </p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-auto custom-scrollbar min-h-0">
                        <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead>
                                <tr className="border-b border-border bg-black/5 text-[10px] font-bold uppercase tracking-wider text-text-muted sticky top-0 z-10 backdrop-blur-md">
                                    <th className="p-4 w-12 text-center">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.size === visibleShares.length && visibleShares.length > 0}
                                            onChange={() => handleSelectAll(visibleShares)}
                                            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
                                        />
                                    </th>
                                    <th className="p-4">Name</th>
                                    <th className="p-4 w-40">Collaborators</th>
                                    <th className="p-4 w-32">Type</th>
                                    <th className="p-4 w-28 text-right">Size / Files</th>
                                    <th className="p-4 w-28 text-center">Views / Downloads</th>
                                    <th className="p-4 w-32">Status</th>
                                    <th className="p-4 w-28 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleShares.map((item) => {
                                    const isSelected = selectedIds.has(`${item.type}_${item.id}`);
                                    const hasExpired = item.expires_at && new Date(item.expires_at) < new Date();
                                    
                                    return (
                                        <tr
                                            key={`${item.type}_${item.id}`}
                                            className={clsx(
                                                "border-b border-border/40 hover:bg-card-hover/40 transition-colors group text-sm",
                                                isSelected && "bg-primary/5"
                                            )}
                                        >
                                            {/* Checkbox */}
                                            <td className="p-4 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => handleSelectRow(item.type, item.id)}
                                                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
                                                />
                                            </td>

                                            {/* Name & custom slug */}
                                            <td className="p-4 max-w-xs sm:max-w-sm">
                                                <div className="flex items-center gap-3">
                                                    {item.type === 'standard_link' && <FileIcon size={20} className="text-primary" />}
                                                    {item.type === 'drop_zone' && <ArrowCircleDown size={20} className="text-secondary" />}
                                                    {item.type === 'collab_folder' && <ArrowCircleUp size={20} className="text-primary" />}
                                                    
                                                    <div className="min-w-0">
                                                        <div className="font-bold text-text-main truncate" title={item.name || `Folder ${item.id}`}>
                                                            {item.name || `Folder ${item.id}`}
                                                        </div>
                                                        {item.custom_slug && (
                                                            <div className="text-[10px] text-primary/70 font-semibold mt-0.5 truncate">
                                                                slug: /{item.custom_slug}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Stacked collaborator avatars */}
                                            <td className="p-4">
                                                {item.type === 'collab_folder' && item.collaborators && item.collaborators.length > 0 ? (
                                                    <div
                                                        className="flex items-center -space-x-2.5 cursor-pointer"
                                                        onClick={() => setSettingsModal({ isOpen: true, share: item })}
                                                    >
                                                        {item.collaborators.slice(0, 3).map((email, idx) => {
                                                            const initials = email.substring(0, 2).toUpperCase();
                                                            const colorClass = getEmailColor(email);
                                                            return (
                                                                <div
                                                                    key={idx}
                                                                    className={clsx(
                                                                        "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm border border-white",
                                                                        colorClass
                                                                    )}
                                                                    title={email}
                                                                >
                                                                    {initials}
                                                                </div>
                                                            );
                                                        })}
                                                        {item.collaborators.length > 3 && (
                                                            <div className="w-7 h-7 rounded-full bg-slate-200 text-text-muted flex items-center justify-center text-[10px] font-bold border border-white shadow-sm">
                                                                +{item.collaborators.length - 3}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-text-muted/40 text-xs">-</span>
                                                )}
                                            </td>

                                            {/* Type */}
                                            <td className="p-4">
                                                {item.type === 'standard_link' && (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">
                                                        Standard Link
                                                    </span>
                                                )}
                                                {item.type === 'drop_zone' && (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                                                        Drop Zone
                                                    </span>
                                                )}
                                                {item.type === 'collab_folder' && (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700">
                                                        Collab Folder
                                                    </span>
                                                )}
                                            </td>

                                            {/* Size / Files Count */}
                                            <td className="p-4 text-right font-medium">
                                                {item.type === 'standard_link' && formatBytes(item.size)}
                                                {item.type === 'drop_zone' && (
                                                    <span className="text-xs font-semibold text-text-muted">
                                                        {item.files_received || 0} files
                                                    </span>
                                                )}
                                                {item.type === 'collab_folder' && (
                                                    <span className="text-xs font-semibold text-text-muted">
                                                        Workspace
                                                    </span>
                                                )}
                                            </td>

                                            {/* Views / Downloads */}
                                            <td className="p-4 text-center text-xs text-text-muted font-medium">
                                                {item.type === 'standard_link' ? (
                                                    <span>{item.views} views / {item.downloads} downloads</span>
                                                ) : (
                                                    <span>{item.views} views</span>
                                                )}
                                            </td>

                                            {/* Status Badge */}
                                            <td className="p-4">
                                                {hasExpired ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-error bg-error/10 px-2 py-0.5 rounded-md">
                                                        Expired
                                                    </span>
                                                ) : item.status === 'ghost' ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md" title="Self-destructs after 1 download">
                                                        Ghost Link
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
                                                        Active
                                                    </span>
                                                )}
                                            </td>

                                            <td className="p-4 text-center">
                                                <div className="flex items-center justify-center gap-1.5">
                                                    {item.type !== 'collab_folder' && (
                                                        <button
                                                            onClick={() => setQrModal({ isOpen: true, share: item })}
                                                            className="p-1.5 hover:bg-card rounded-lg transition-colors text-text-muted hover:text-text-main"
                                                            title="View QR Code"
                                                        >
                                                            <QrCode size={16} />
                                                        </button>
                                                    )}
                                                    {item.type !== 'collab_folder' && (
                                                        <button
                                                            onClick={() => handleCopy(item)}
                                                            className="p-1.5 hover:bg-card rounded-lg transition-colors text-text-muted hover:text-text-main"
                                                            title="Copy Share URL"
                                                        >
                                                            <Copy size={16} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => setSettingsModal({ isOpen: true, share: item })}
                                                        className="p-1.5 hover:bg-card rounded-lg transition-colors text-text-muted hover:text-text-main"
                                                        title="Settings & Audit Logs"
                                                    >
                                                        <GearSix size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => setRevokeConfirm({ isOpen: true, sharesToRevoke: [item] })}
                                                        className="p-1.5 hover:bg-error/10 rounded-lg transition-colors text-text-muted hover:text-error"
                                                        title="Revoke Share"
                                                    >
                                                        <Trash size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ============================================================================
                MODAL: REVOCATION CONFIRMATION
            ============================================================================ */}
            <Modal
                isOpen={revokeConfirm.isOpen}
                onClose={() => setRevokeConfirm({ isOpen: false, sharesToRevoke: [] })}
                title="Revoke Share Link"
            >
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-text-muted leading-relaxed">
                        Are you sure you want to revoke {revokeConfirm.sharesToRevoke.length === 1 ? 'this share link' : `these ${revokeConfirm.sharesToRevoke.length} share links`}? 
                    </p>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5">
                        <Lock size={20} className="text-amber-700 flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-amber-800 leading-normal">
                            <strong>Note:</strong> Physical files will remain completely safe in your Private File Manager. Only public link access is disabled.
                        </span>
                    </div>
                    
                    <div className="flex justify-end gap-3 mt-4">
                        <button
                            type="button"
                            onClick={() => setRevokeConfirm({ isOpen: false, sharesToRevoke: [] })}
                            className="px-4 py-2 border border-border text-text-main rounded-xl hover:bg-card transition-colors text-sm font-semibold"
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleRevoke}
                            className="px-4 py-2 bg-error text-white rounded-xl hover:bg-error/80 transition-colors text-sm font-semibold flex items-center gap-1.5"
                            disabled={submitting}
                        >
                            {submitting ? 'Revoking...' : 'Revoke Access'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* ============================================================================
                MODAL: CREATE DROP ZONE
            ============================================================================ */}
            <CreateDropZoneModal
                isOpen={showCreateDz}
                onClose={() => setShowCreateDz(false)}
                createZKFolder={createZKFolder}
                onSuccess={() => {
                    setShowCreateDz(false);
                    triggerFileRefresh();
                }}
            />

            {/* ============================================================================
                MODAL: CREATE COLLAB FOLDER
            ============================================================================ */}
            <CreateCollabFolderModal
                isOpen={showCreateCollab}
                onClose={() => setShowCreateCollab(false)}
                createZKFolder={createZKFolder}
                onSuccess={() => {
                    setShowCreateCollab(false);
                    triggerFileRefresh();
                }}
            />

            {/* ============================================================================
                MODAL: SHARE SETTINGS & AUDIT LOGS
            ============================================================================ */}
            <ShareSettingsModal
                isOpen={settingsModal.isOpen}
                onClose={() => setSettingsModal({ isOpen: false, share: null })}
                share={settingsModal.share}
                onSuccess={() => {
                    setSettingsModal({ isOpen: false, share: null });
                    triggerFileRefresh();
                }}
            />

            {/* Standalone QR Code Modal for the list */}
            <Modal
                isOpen={qrModal.isOpen}
                onClose={() => setQrModal({ isOpen: false, share: null })}
                title="Share QR Code"
                maxWidth="max-w-sm"
            >
                {qrModal.share && (
                    <div className="flex flex-col items-center gap-6 py-4">
                        {qrUrl ? (
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-border/20" ref={qrRef}>
                                <QRCode id="list-qr-code" value={qrUrl} size={250} />
                            </div>
                        ) : (
                            <div className="py-10 flex flex-col items-center justify-center gap-3 text-center min-h-[250px]">
                                {qrDeriving ? (
                                    <>
                                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                        <span className="text-sm text-text-muted">Generating secure QR with decryption key…</span>
                                    </>
                                ) : (
                                    <span className="text-sm text-amber-600 font-medium px-4">Couldn't build the secure QR (decryption key unavailable). Close and retry, or use the Copy button instead.</span>
                                )}
                            </div>
                        )}
                        {qrUrl && (
                        <button
                            onClick={() => {
                                const svg = qrRef.current?.querySelector('svg');
                                if (!svg) return;
                                const svgData = new XMLSerializer().serializeToString(svg);
                                const canvas = document.createElement("canvas");
                                const ctx = canvas.getContext("2d");
                                const qrImg = new Image();
                                const logoImg = new Image();
                                let loaded = 0;
                                const onImageLoad = () => {
                                    loaded++;
                                    if (loaded === 2) {
                                        const padding = 40;
                                        const qrSize = 250;
                                        const logoSize = 40;
                                        const cardWidth = qrSize + (padding * 2);
                                        const cardHeight = qrSize + (padding * 2) + 110;
                                        canvas.width = cardWidth;
                                        canvas.height = cardHeight;
                                        if (ctx) {
                                            ctx.fillStyle = "#ffffff";
                                            ctx.fillRect(0, 0, cardWidth, cardHeight);
                                            ctx.drawImage(logoImg, (cardWidth - logoSize) / 2, padding / 1.5, logoSize, logoSize);
                                            ctx.fillStyle = "#0A0A0A";
                                            ctx.font = "bold 22px system-ui, -apple-system, sans-serif";
                                            ctx.textAlign = "center";
                                            const titleText = qrModal.share?.type === 'drop_zone' ? 'Nest Drop Zone' : qrModal.share?.type === 'collab_folder' ? 'Nest Collab Folder' : 'Nest Shared Resource';
                                            ctx.fillText(titleText, cardWidth / 2, padding + logoSize + 10);
                                            ctx.fillStyle = "#ffffff";
                                            ctx.fillRect(padding, padding + logoSize + 30, qrSize, qrSize);
                                            ctx.drawImage(qrImg, padding, padding + logoSize + 30, qrSize, qrSize);
                                            ctx.fillStyle = "#666666";
                                            ctx.font = "16px system-ui, -apple-system, sans-serif";
                                            ctx.textAlign = "center";
                                            const nameStr = qrModal.share?.name || 'Scan to access files';
                                            ctx.fillText(nameStr.length > 35 ? nameStr.substring(0, 32) + '...' : nameStr, cardWidth / 2, cardHeight - 25);
                                        }
                                        const pngFile = canvas.toDataURL("image/png", 1.0);
                                        const downloadLink = document.createElement("a");
                                        downloadLink.download = `Nest_QR_${qrModal.share?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'share'}.png`;
                                        downloadLink.href = pngFile;
                                        downloadLink.click();
                                    }
                                };
                                qrImg.onload = onImageLoad;
                                logoImg.onload = onImageLoad;
                                qrImg.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
                                logoImg.src = nestLogo;
                            }}
                            className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                        >
                            <DownloadSimple size={20} weight="bold" />
                            Download QR Code
                        </button>
                        )}
                    </div>
                )}
            </Modal>
        </motion.div>
    );
};
