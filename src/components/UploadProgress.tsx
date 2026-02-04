import { useRef, useState, useEffect } from 'react';
import { useUpload } from '../contexts/UploadContext';
import { CheckCircle, XCircle, ArrowClockwise, X, CaretDown, CaretUp } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

export const UploadProgress = () => {
    const { uploads, removeUpload, retryUpload } = useUpload();
    const navigate = useNavigate();
    const [isMinimized, setIsMinimized] = useState(false);
    const constraintsRef = useRef(null);

    // Auto-minimize watcher
    const activeCount = uploads.filter(u => u.status === 'uploading' || u.status === 'queued').length;
    const completedCount = uploads.filter(u => u.status === 'completed').length;
    const failedCount = uploads.filter(u => u.status === 'failed').length;

    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (activeCount === 0 && completedCount > 0 && failedCount === 0 && !isMinimized) {
            // Auto minimize 1 second after completion
            timer = setTimeout(() => {
                setIsMinimized(true);
            }, 1000);
        }
        return () => clearTimeout(timer);
    }, [activeCount, completedCount, failedCount, isMinimized]);

    // Only show if there are uploads
    if (uploads.length === 0) return null;

    const clearAll = () => {
        uploads.forEach(u => removeUpload(u.id));
    };

    return (
        // Full screen container for drag constraints (pointer-events-none allows clicking through)
        <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-50 flex items-end justify-end p-3 sm:p-6 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-6">
            <motion.div
                drag
                dragConstraints={constraintsRef}
                dragMomentum={false}
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="pointer-events-auto w-[calc(100vw-1.5rem)] max-w-md sm:w-96 max-h-[70dvh] sm:max-h-[80vh] flex flex-col glass-panel shadow-2xl overflow-hidden"
            >
                {/* Header - Drag Handle */}
                <div className="p-3 border-b border-white/20 bg-white/10 backdrop-blur-md flex items-center justify-between cursor-grab active:cursor-grabbing">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-text-main text-sm flex items-center gap-2">
                            {isMinimized ? 'Uploads' : 'Upload Queue'}
                        </h3>
                        {activeCount > 0 && (
                            <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full border border-primary/20 font-bold">
                                {activeCount} Active
                            </span>
                        )}
                        {failedCount > 0 && (
                            <span className="text-[10px] bg-red-500/20 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20 font-bold">
                                {failedCount} Failed
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setIsMinimized(!isMinimized)}
                            className="p-1 hover:bg-white/10 rounded-md text-text-muted hover:text-text-main transition-colors"
                            title={isMinimized ? "Expand" : "Minimize"}
                        >
                            {isMinimized ? <CaretUp weight="bold" /> : <CaretDown weight="bold" />}
                        </button>
                        <button
                            onClick={clearAll}
                            className="p-1 hover:bg-red-500/10 rounded-md text-text-muted hover:text-red-500 transition-colors"
                            title="Close & Clear All"
                        >
                            <X weight="bold" />
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <AnimatePresence>
                    {!isMinimized && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden bg-white/5"
                        >
                            <div className="overflow-y-auto custom-scrollbar max-h-[400px] p-2 space-y-2">
                                {uploads.map(upload => (
                                    <div key={upload.id} className="p-3 bg-white/40 rounded-xl hover:bg-white/60 transition-colors border border-white/20 shadow-sm relative overflow-hidden group">
                                        {/* Progress Background */}
                                        {(upload.status === 'uploading' || upload.status === 'queued') && (
                                            <div
                                                className="absolute bottom-0 left-0 h-1 bg-primary/30 transition-all duration-300"
                                                style={{ width: `${upload.progress}%` }}
                                            />
                                        )}

                                        <div className="flex items-start gap-3 relative z-10">
                                            {/* Status Icon */}
                                            <div className="mt-1 flex-shrink-0">
                                                {upload.status === 'completed' && (
                                                    <CheckCircle size={24} weight="fill" className="text-green-500 drop-shadow-sm" />
                                                )}
                                                {upload.status === 'failed' && (
                                                    <XCircle size={24} weight="fill" className="text-red-500 drop-shadow-sm" />
                                                )}
                                                {(upload.status === 'uploading' || upload.status === 'queued') && (
                                                    <div className="w-6 h-6 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
                                                )}
                                            </div>

                                            {/* File Info - Added pr-16 to prevent overlap with absolute buttons */}
                                            <div className="flex-1 min-w-0 pr-16 md:pr-0">
                                                <p className="text-sm font-semibold text-text-main truncate" title={upload.filename}>
                                                    {upload.filename}
                                                </p>
                                                <div className="flex items-center justify-between mt-1">
                                                    <p className="text-xs text-text-muted font-medium">
                                                        {formatBytes(upload.size)}
                                                    </p>
                                                    {(upload.status === 'uploading' || upload.status === 'queued') && (
                                                        <span className="text-xs font-bold text-primary">{Math.round(upload.progress)}%</span>
                                                    )}
                                                </div>
                                                {upload.status === 'failed' && upload.error && (
                                                    <div className="mt-1">
                                                        <p className="text-xs text-red-500 font-medium bg-red-500/10 p-1 rounded px-2 inline-block">
                                                            {upload.error}
                                                        </p>
                                                        {(upload.error.includes('too large') || upload.error.includes('413')) && (
                                                            <button
                                                                onClick={() => navigate('/pricing')}
                                                                className="ml-2 text-xs bg-primary text-white px-2 py-1 rounded hover:bg-secondary transition-colors font-bold shadow-sm"
                                                            >
                                                                Upgrade Plan
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity absolute right-2 top-2 bg-white/80 rounded-lg p-1 shadow-sm backdrop-blur-sm">
                                                {upload.status === 'failed' && (
                                                    <button
                                                        onClick={() => retryUpload(upload.id)}
                                                        className="p-1.5 hover:bg-primary/10 rounded-md text-text-muted hover:text-primary transition-colors"
                                                        title="Retry"
                                                    >
                                                        <ArrowClockwise size={16} weight="bold" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => removeUpload(upload.id)}
                                                    className="p-1.5 hover:bg-red-500/10 rounded-md text-text-muted hover:text-red-500 transition-colors"
                                                    title="Remove"
                                                >
                                                    <X size={16} weight="bold" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {/* Footer Actions */}
                            {completedCount > 0 && (
                                <div className="p-2 bg-white/10 text-center border-t border-white/20 backdrop-blur-md">
                                    <button
                                        onClick={() => uploads.forEach(u => u.status === 'completed' && removeUpload(u.id))}
                                        className="text-xs font-medium text-primary hover:text-secondary transition-colors"
                                    >
                                        Clear {completedCount} completed
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};
