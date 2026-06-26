import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileTable } from './FileTable';
import type { FileItem } from '../pages/NestPage';

interface RecentActivityFeedProps {
    files: FileItem[];
    onDownload: (file: FileItem) => void;
    onShare: (file: FileItem) => void;
    onRename: (fileId: number, newName: string) => Promise<void>;
    onMove: (fileId: number, targetFolderId: number | null) => Promise<void>;
    onDelete: (fileId: number) => Promise<void>;
    onLoadMore: () => void;
    hasMore: boolean;
}

interface GroupedFile {
    isBatch: boolean;
    uploadSessionId: string | null;
    files: FileItem[];
}

export const RecentActivityFeed = ({
    files,
    onDownload,
    onShare,
    onRename,
    onMove,
    onDelete,
    onLoadMore,
    hasMore
}: RecentActivityFeedProps) => {
    const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

    const toggleBatch = (sessionId: string) => {
        setExpandedBatches(prev => {
            const next = new Set(prev);
            if (next.has(sessionId)) {
                next.delete(sessionId);
            } else {
                next.add(sessionId);
            }
            return next;
        });
    };

    // Group files by upload_session_id
    const grouped: GroupedFile[] = [];
    let currentBatch: GroupedFile | null = null;

    files.forEach(file => {
        const sessionId = file.upload_session_id || 'legacy_single_' + file.id;
        if (currentBatch && currentBatch.uploadSessionId === sessionId) {
            currentBatch.files.push(file);
        } else {
            currentBatch = { isBatch: true, uploadSessionId: sessionId, files: [file] };
            grouped.push(currentBatch);
        }
    });

    const finalGroups: { type: 'singles' | 'batch', files: any[], sessionId?: string }[] = [];
    grouped.forEach(g => {
        if (g.files.length === 1) {
            const lastFinal = finalGroups[finalGroups.length - 1];
            if (lastFinal && lastFinal.type === 'singles') {
                lastFinal.files.push(g.files[0]);
            } else {
                finalGroups.push({ type: 'singles', files: [g.files[0]] });
            }
        } else {
            finalGroups.push({ type: 'batch', files: g.files, sessionId: g.uploadSessionId! });
        }
    });

    return (
        <div className="flex flex-col space-y-4 pb-12">
            {finalGroups.map((group, index) => {
                if (group.type === 'singles') {
                    // Render single files
                    return (
                        <div key={`singles-${index}`} className="glass-panel p-0 overflow-hidden border border-border/50">
                            <FileTable
                                items={group.files.map(file => ({
                                    id: file.id,
                                    name: file.filename,
                                    type: 'file',
                                    mimeType: file.mime_type,
                                    size: file.file_size,
                                    createdAt: file.created_at,
                                    folderId: file.folder_id,
                                    onDownload: () => onDownload(file),
                                    onShare: () => onShare(file),
                                    onRename: async (newName) => await onRename(file.id, newName),
                                    onMove: async (targetId) => await onMove(file.id, targetId),
                                    onDelete: async () => await onDelete(file.id),
                                }))}
                            />
                        </div>
                    );
                }

                // Render Batch
                const isExpanded = expandedBatches.has(group.sessionId!);
                const firstFile = group.files[0];

                return (
                    <div key={`batch-${group.sessionId}`} className="glass-panel p-0 overflow-hidden border border-border/50">
                        <button
                            onClick={() => toggleBatch(group.sessionId!)}
                            className="w-full flex items-center justify-between p-4 hover:bg-background/40 transition-colors cursor-pointer text-left focus:outline-none"
                        >
                            <div className="flex items-center space-x-3">
                                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-text-main font-medium">Batch Upload</h3>
                                    <p className="text-text-muted text-sm">{group.files.length} files • {new Date(firstFile.created_at).toLocaleTimeString()}</p>
                                </div>
                            </div>
                            <div className="flex items-center space-x-2">
                                <motion.svg
                                    animate={{ rotate: isExpanded ? 180 : 0 }}
                                    className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </motion.svg>
                            </div>
                        </button>
                        
                        <AnimatePresence>
                            {isExpanded && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="border-t border-border/50"
                                >
                                    <FileTable
                                        items={group.files.map(file => ({
                                            id: file.id,
                                            name: file.filename,
                                            type: 'file',
                                            mimeType: file.mime_type,
                                            size: file.file_size,
                                            createdAt: file.created_at,
                                            folderId: file.folder_id,
                                            onDownload: () => onDownload(file),
                                            onShare: () => onShare(file),
                                            onRename: async (newName) => await onRename(file.id, newName),
                                            onMove: async (targetId) => await onMove(file.id, targetId),
                                            onDelete: async () => await onDelete(file.id),
                                        }))}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                );
            })}

            {hasMore && (
                <div className="flex justify-center pt-4">
                    <button
                        onClick={onLoadMore}
                        className="px-6 py-2 bg-background border border-border/50 rounded-lg text-text-main hover:border-primary/50 transition-colors font-medium text-sm"
                    >
                        Load More
                    </button>
                </div>
            )}
        </div>
    );
};
