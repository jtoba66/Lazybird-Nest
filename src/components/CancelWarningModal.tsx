import { motion } from 'framer-motion';
import { Warning, ArrowRight } from '@phosphor-icons/react';

interface CancelWarningModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProceed: () => void;
    currentUsage: number;
    freeQuota: number;
}

const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const CancelWarningModal = ({
    isOpen,
    onClose,
    onProceed,
    currentUsage,
    freeQuota
}: CancelWarningModalProps) => {
    if (!isOpen) return null;

    const overageBytes = currentUsage - freeQuota;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="w-full max-w-md glass-panel p-8 relative z-10"
            >
                {/* Warning Icon */}
                <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500 mb-6 mx-auto">
                    <Warning size={32} weight="fill" />
                </div>

                <h2 className="text-2xl font-bold text-text-main text-center mb-2">
                    Storage Warning
                </h2>
                <p className="text-text-muted text-center text-sm mb-6 leading-relaxed">
                    You're using <span className="font-bold text-text-main">{formatBytes(currentUsage)}</span>,
                    but the Free plan only includes <span className="font-bold text-text-main">{formatBytes(freeQuota)}</span>.
                </p>

                {/* Overage Info */}
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-text-muted">Over quota by:</span>
                        <span className="font-bold text-amber-500">{formatBytes(overageBytes)}</span>
                    </div>
                    <p className="text-xs text-text-muted mt-2">
                        If you cancel, you won't be able to upload new files until you delete enough to be under {formatBytes(freeQuota)}.
                    </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                            onClose();
                            window.location.href = '/dashboard';
                        }}
                        className="w-full py-3 px-4 bg-primary text-white rounded-xl font-bold hover:shadow-glow transition-all flex items-center justify-center gap-2"
                    >
                        Delete Files First
                        <ArrowRight weight="bold" />
                    </motion.button>
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onProceed}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 text-text-muted rounded-xl font-medium hover:bg-white/10 transition-all"
                    >
                        Proceed Anyway
                    </motion.button>
                    <button
                        onClick={onClose}
                        className="text-text-muted text-sm hover:text-text-main transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
