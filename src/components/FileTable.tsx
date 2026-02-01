import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../contexts/ToastContext';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
    Image,
    FilePdf,
    FileText,
    FileArchive,
    File as FileIcon,
    Video,
    Folder as FolderIcon,
    Trash,
    ArrowsDownUp,
    ShareNetwork,
    DownloadSimple,
    DotsThreeVertical,
    Lock
} from '@phosphor-icons/react';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';
import { MoveFileModal } from './MoveFileModal';
import { useQuotaCheck } from './QuotaBanner';


export interface UnifiedItem {
    id: string | number;
    name: string;
    type: 'file' | 'folder';
    mimeType?: string; // Only for files
    size?: number;     // Only for files
    createdAt: string;
    folderId?: number | null;

    // Actions
    onNavigate?: () => void; // For folders
    onDownload?: () => void;
    onShare?: () => void;
    onMove?: (folderId: number | null) => Promise<void>;
    onDelete?: () => Promise<void>;
}

// Restore Helper Functions
function getFileIcon(mimeType: string) {
    if (mimeType.startsWith('image/')) return Image;
    if (mimeType.startsWith('video/')) return Video;
    if (mimeType === 'application/pdf') return FilePdf;
    if (mimeType.includes('zip') || mimeType.includes('archive')) return FileArchive;
    if (mimeType.startsWith('text/')) return FileText;
    return FileIcon;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const FileTable = ({ items }: { items: UnifiedItem[] }) => {
    // ... hooks ...
    const { showToast } = useToast();
    const { isOverQuota } = useQuotaCheck();
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; file: UnifiedItem | null }>({
        isOpen: false,
        file: null,
    });
    const [moveModal, setMoveModal] = useState<{ isOpen: boolean; file: UnifiedItem | null }>({
        isOpen: false,
        file: null,
    });
    // ... state ...
    const [isDeleting, setIsDeleting] = useState(false);
    const [isMoving, setIsMoving] = useState(false);
    const [activeMenuKey, setActiveMenuKey] = useState<string | null>(null);

    const [menuPos, setMenuPos] = useState<{ top: number; right: number; origin: string } | null>(null);

    // Defensive check for undefined items
    if (!items || !Array.isArray(items)) {
        return (
            <div className="glass-panel overflow-hidden p-4 sm:p-8 text-center">
                <p className="text-text-muted">No items to display</p>
            </div>
        );
    }

    const getItemKey = (item: UnifiedItem) => `${item.type}:${item.id}`;

    // Find active item
    const activeItem = activeMenuKey ? items.find(i => getItemKey(i) === activeMenuKey) : undefined;

    // ... handlers ...
    const handleDeleteClick = (item: UnifiedItem) => {
        setDeleteModal({ isOpen: true, file: item });
    };

    const handleDeleteConfirm = async () => {
        if (!deleteModal.file || !deleteModal.file.onDelete) return;

        setIsDeleting(true);
        try {
            await deleteModal.file.onDelete();
            showToast(`"${deleteModal.file.name}" deleted successfully`, 'success');
            setDeleteModal({ isOpen: false, file: null });
        } catch (error) {
            console.error("Delete failed", error);
            showToast(`Failed to delete "${deleteModal.file.name}"`, 'error');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleMoveClick = (item: UnifiedItem) => {
        if (item.type === 'folder') return; // Folders generally shouldn't move into themselves or complex logic. simplify for now: files only.
        setMoveModal({ isOpen: true, file: item });
    };

    // ... move confirm similar ...
    const handleMoveConfirm = async (folderId: number | null) => {
        if (!moveModal.file || !moveModal.file.onMove) return;

        setIsMoving(true);
        try {
            await moveModal.file.onMove(folderId);
            // showToast(`"${moveModal.file.name}" moved successfully`, 'success'); // Parent handles toast
            setMoveModal({ isOpen: false, file: null });
        } catch (error) {
            console.error("Move failed", error);
            showToast(`Failed to move "${moveModal.file.name}"`, 'error');
        } finally {
            setIsMoving(false);
        }
    };

    const mobileMenu =
        activeMenuKey !== null && activeItem && menuPos && typeof document !== 'undefined'
            ? createPortal(
                <>
                    <div
                        className="fixed inset-0 z-[50] bg-black/10 backdrop-blur-[1px] md:hidden"
                        onClick={() => setActiveMenuKey(null)}
                    />
                    <div
                        className="fixed z-[51] bg-white/90 backdrop-blur-xl border border-white/40 shadow-2xl rounded-xl p-1.5 min-w-[150px] flex flex-col gap-0.5 md:hidden animate-in fade-in zoom-in-95 duration-200"
                        style={{
                            top: menuPos.top,
                            right: menuPos.right,
                            transform: menuPos.origin === 'bottom' ? 'translateY(-100%)' : 'none',
                            transformOrigin: `right ${menuPos.origin}`
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {activeItem.type === 'file' && activeItem.onDownload && (
                            <button
                                onClick={() => { activeItem.onDownload!(); setActiveMenuKey(null); }}
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-primary/10 rounded-lg text-text-main text-xs font-semibold text-left transition-colors"
                            >
                                <DownloadSimple size={16} className="text-primary" weight="bold" />
                                Download
                            </button>
                        )}
                        {activeItem.onShare && (
                            <button
                                onClick={() => {
                                    if (isOverQuota) {
                                        showToast('Storage quota exceeded. Sharing is disabled.', 'error');
                                        return;
                                    }
                                    activeItem.onShare!();
                                    setActiveMenuKey(null);
                                }}
                                className={clsx(
                                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition-colors",
                                    isOverQuota ? "opacity-30 grayscale" : "hover:bg-primary/10 text-text-main"
                                )}
                            >
                                <ShareNetwork size={16} className="text-primary" weight="bold" />
                                Share {isOverQuota && <Lock size={12} className="ml-auto text-error" />}
                            </button>
                        )}
                        {activeItem.type === 'file' && activeItem.onMove && (
                            <button
                                onClick={() => { handleMoveClick(activeItem); setActiveMenuKey(null); }}
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-primary/10 rounded-lg text-text-main text-xs font-semibold text-left transition-colors"
                            >
                                <ArrowsDownUp size={16} className="text-primary" weight="bold" />
                                Move
                            </button>
                        )}
                        <div className="h-px bg-black/5 my-0.5" />
                        {activeItem.onDelete && (
                            <button
                                onClick={() => { handleDeleteClick(activeItem); setActiveMenuKey(null); }}
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-red-500/10 rounded-lg text-error text-xs font-bold text-left transition-colors"
                            >
                                <Trash size={16} weight="bold" />
                                Delete
                            </button>
                        )}
                    </div>
                </>,
                document.body
            )
            : null;

    return (
        <>
            <div className="glass-panel overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full table-fixed md:table-auto">
                        <thead className="bg-white/30 border-b border-white/20">
                            <tr>
                                <th className="text-left px-3 md:px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider md:w-1/2">Name</th>
                                <th className="text-left px-3 md:px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider hidden md:table-cell">Type</th>
                                <th className="text-left px-3 md:px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider hidden md:table-cell">Size</th>
                                <th className="text-left px-3 md:px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider hidden md:table-cell">Uploaded</th>
                                <th className="text-right px-2 md:px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider w-12" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/20">
                            <AnimatePresence>
                                {items.map((item) => {
                                    const isFolder = item.type === 'folder';
                                    const Icon = isFolder ? FolderIcon : getFileIcon(item.mimeType || '');

                                    return (
                                        <motion.tr
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            whileHover={{ scale: 1.01, backgroundColor: "rgba(255, 255, 255, 0.4)" }}
                                            transition={{ duration: 0.2 }}
                                            key={`${item.type}-${item.id}`}
                                            className="hover:bg-white/30 transition-colors duration-200 group cursor-pointer border-b border-white/5 last:border-0"
                                            onClick={() => {
                                                if (isFolder && item.onNavigate) {
                                                    item.onNavigate();
                                                }
                                            }}
                                        >
                                            <td className="px-2 md:px-4 py-2">
                                                <div className="flex items-center gap-3 min-w-0 w-full">
                                                    <div className={`p-1.5 sm:p-1.5 rounded-md shadow-sm border border-white/20 ${isFolder ? 'bg-primary/20 text-primary' : 'bg-white/40 text-text-main'}`}>
                                                        <Icon size={16} className="sm:hidden" weight={isFolder ? "fill" : "duotone"} />
                                                        <Icon size={18} className="hidden sm:block" weight={isFolder ? "fill" : "duotone"} />
                                                    </div>
                                                    <div className="flex flex-col min-w-0 flex-1">
                                                        <span className={`text-sm font-medium min-w-0 w-full break-words [overflow-wrap:anywhere] whitespace-normal leading-snug sm:truncate transition-colors ${isFolder ? 'text-text-main group-hover:text-primary' : 'text-text-main group-hover:text-primary'}`}>
                                                            {item.name}
                                                        </span>
                                                        {isFolder && (item as any).subfolder_count !== undefined && (
                                                            <span className="text-[10px] text-text-muted">
                                                                {(item as any).file_count || 0} {(item as any).file_count === 1 ? 'file' : 'files'}
                                                                {(item as any).subfolder_count > 0 && `, ${(item as any).subfolder_count} ${(item as any).subfolder_count === 1 ? 'folder' : 'folders'}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 hidden md:table-cell">
                                                <div className="inline-flex px-1.5 py-0.5 rounded-md bg-white/20 border border-white/20 text-[10px] font-medium text-text-muted">
                                                    {isFolder ? 'FOLDER' : (item.mimeType?.split('/')[1]?.toUpperCase() || 'FILE')}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 hidden md:table-cell">
                                                <span className="text-xs text-text-muted font-medium">
                                                    {isFolder
                                                        ? ((item as any).folder_size !== undefined && (item as any).folder_size > 0
                                                            ? formatBytes((item as any).folder_size)
                                                            : '—')
                                                        : formatBytes(item.size || 0)
                                                    }
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 hidden md:table-cell">
                                                <span className="text-xs text-text-muted">{formatDate(item.createdAt)}</span>
                                            </td>
                                            <td className="px-2 md:px-4 py-2 text-right relative" onClick={(e) => e.stopPropagation()}>
                                                {/* Mobile: Kebab Menu */}
                                                <div className="md:hidden">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const itemKey = getItemKey(item);
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            // Ensure menu doesn't go off bottom
                                                            const spaceBelow = window.innerHeight - rect.bottom;
                                                            const estimatedHeight = 160;
                                                            const showAbove = spaceBelow < estimatedHeight;

                                                            setMenuPos({
                                                                top: showAbove ? rect.top - 8 : rect.bottom + 8,
                                                                right: 16,
                                                                origin: showAbove ? 'bottom' : 'top'
                                                            });
                                                            setActiveMenuKey(activeMenuKey === itemKey ? null : itemKey);
                                                        }}
                                                        className={`p-2 transition-colors ${activeMenuKey === getItemKey(item) ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
                                                    >
                                                        <DotsThreeVertical size={24} weight="bold" />
                                                    </button>
                                                </div>

                                                {/* Desktop: Hover Actions */}
                                                <div className="hidden md:flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
                                                    {item.type === 'file' && item.onDownload && (
                                                        <motion.button
                                                            whileHover={{ scale: 1.1 }}
                                                            whileTap={{ scale: 0.9 }}
                                                            onClick={(e) => { e.stopPropagation(); item.onDownload!(); }}
                                                            className="p-1.5 hover:bg-white/50 rounded-md text-primary transition-colors flex items-center gap-1"
                                                            title="Download"
                                                        >
                                                            <DownloadSimple size={16} weight="bold" />
                                                        </motion.button>
                                                    )}
                                                    {item.onShare && (
                                                        <motion.button
                                                            whileHover={!isOverQuota ? { scale: 1.1 } : {}}
                                                            whileTap={!isOverQuota ? { scale: 0.9 } : {}}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (isOverQuota) {
                                                                    showToast('Storage quota exceeded. Sharing is disabled.', 'error');
                                                                    return;
                                                                }
                                                                item.onShare!();
                                                            }}
                                                            className={clsx(
                                                                "p-1.5 transition-colors flex items-center gap-1",
                                                                isOverQuota ? "opacity-30 cursor-not-allowed grayscale" : "hover:bg-white/50 rounded-md text-primary"
                                                            )}
                                                            title={isOverQuota ? "Quota Exceeded - Sharing Disabled" : "Share"}
                                                        >
                                                            {isOverQuota ? <Lock size={16} weight="bold" className="text-error" /> : <ShareNetwork size={16} weight="bold" />}
                                                        </motion.button>
                                                    )}
                                                    {item.type === 'file' && item.onMove && (
                                                        <motion.button
                                                            whileHover={{ scale: 1.1 }}
                                                            whileTap={{ scale: 0.9 }}
                                                            onClick={(e) => { e.stopPropagation(); handleMoveClick(item); }}
                                                            className="p-1.5 hover:bg-white/50 rounded-md text-primary transition-colors flex items-center gap-1"
                                                            title="Move"
                                                        >
                                                            <ArrowsDownUp size={16} weight="bold" />
                                                        </motion.button>
                                                    )}
                                                    {item.onDelete && (
                                                        <motion.button
                                                            whileHover={{ scale: 1.1 }}
                                                            whileTap={{ scale: 0.9 }}
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteClick(item); }}
                                                            className="p-1.5 hover:bg-red-500/10 rounded-md text-error transition-colors"
                                                            title="Delete"
                                                        >
                                                            <Trash size={16} weight="fill" />
                                                        </motion.button>
                                                    )}
                                                </div>
                                            </td>
                                        </motion.tr>
                                    );
                                })}
                            </AnimatePresence>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {deleteModal.file && (
                <DeleteConfirmationModal
                    isOpen={deleteModal.isOpen}
                    onClose={() => setDeleteModal({ isOpen: false, file: null })}
                    onConfirm={handleDeleteConfirm}
                    itemName={deleteModal.file.name}
                    itemType={deleteModal.file.type}
                    isDeleting={isDeleting}
                />
            )}

            {/* Move File Modal */}
            {moveModal.file && (
                <MoveFileModal
                    isOpen={moveModal.isOpen}
                    onClose={() => setMoveModal({ isOpen: false, file: null })}
                    onMove={handleMoveConfirm}
                    currentFolderId={moveModal.file.folderId}
                    isMoving={isMoving}
                />
            )}

            {mobileMenu}
        </>
    );
};
