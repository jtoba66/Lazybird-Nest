import { motion, AnimatePresence } from 'framer-motion';
import { Warning, Rocket } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const QuotaBanner = () => {
    const { user } = useAuth();

    if (!user) return null;

    const isOverQuota = (user.storageUsed || 0) > (user.storageQuota || 0);

    return (
        <AnimatePresence>
            {isOverQuota && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="bg-error/10 border-b border-error/20 overflow-hidden"
                >
                    <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 text-error">
                            <div className="w-8 h-8 rounded-full bg-error/20 flex items-center justify-center flex-shrink-0 animate-pulse">
                                <Warning size={18} weight="bold" />
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                                <span className="text-sm font-bold tracking-tight">Storage Quota Exceeded</span>
                                <span className="text-xs text-error/80">You're over your limit. Uploading and sharing are disabled.</span>
                            </div>
                        </div>

                        <Link
                            to="/pricing"
                            className="flex items-center gap-2 px-3 py-1.5 bg-error text-white rounded-lg text-xs font-bold hover:bg-error/90 transition-colors shadow-lg shadow-error/20 flex-shrink-0"
                        >
                            <Rocket size={14} weight="bold" />
                            <span>Upgrade to Pro</span>
                        </Link>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// Helper hook for other components
export const useQuotaCheck = () => {
    const { user } = useAuth();
    if (!user) return { isOverQuota: false };
    return { isOverQuota: (user.storageUsed || 0) > (user.storageQuota || 0) };
};
